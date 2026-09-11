import type { Persistence, UpdateDiscoveryState } from "./persistence.ts";
import type { UpdatePauseOutcome } from "./update-pause.ts";
import {
  assertReleaseMetadata,
  compareReleaseTags,
  type ReleaseIdentity,
  type ReleaseMetadata,
} from "./release.ts";
import type { UpdaterClient, UpdaterStatus } from "./updater.ts";

export const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const DEFAULT_API_URL = "https://api.github.com/repos/SandunRathsara/atlas/releases";
const DEFAULT_DOWNLOAD_BASE = "https://github.com/SandunRathsara/atlas/releases/download";
const MAX_METADATA_BYTES = 1024 * 1024;

export type UpdateStatus = {
  installed: ReleaseIdentity;
  checking: boolean;
  discovery: UpdateDiscoveryState;
  candidates: ReleaseMetadata[];
  available: ReleaseMetadata | null;
  updater: UpdaterStatus | null;
  updaterError: string | null;
};

export type UpdateService = {
  start: () => void;
  stop: () => void;
  check: () => Promise<void>;
  status: () => Promise<UpdateStatus>;
  install: (tag: string, retry: boolean, pause: () => Promise<UpdatePauseOutcome>) => Promise<void>;
};

type GitHubRelease = { tag_name: string; draft: boolean; prerelease: boolean };

export type UpdateServiceOptions = {
  persistence: Persistence;
  installed: ReleaseIdentity;
  updater: UpdaterClient;
  fetcher?: typeof fetch;
  apiUrl?: string;
  downloadBaseUrl?: string;
  scheduleEvery?: (callback: () => void, milliseconds: number) => ReturnType<typeof setInterval>;
  cancelSchedule?: (timer: ReturnType<typeof setInterval>) => void;
};

const availableRelease = (installed: ReleaseIdentity, candidates: readonly ReleaseMetadata[]) => {
  if (!installed.published) return null;
  return candidates.find((candidate) => compareReleaseTags(candidate.identity.tag, installed.tag) > 0) ?? null;
};

const metadataUrl = (base: string, tag: string) =>
  `${base.replace(/\/$/u, "")}/${encodeURIComponent(tag)}/atlas-release.json`;

const responseJson = async (response: Response, label: string) => {
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
  const declaredLength = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_METADATA_BYTES) throw new Error(`${label} is too large`);
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_METADATA_BYTES) throw new Error(`${label} is too large`);
  return JSON.parse(text) as unknown;
};

export const createUpdateService = (options: UpdateServiceOptions): UpdateService => {
  const fetcher = options.fetcher ?? fetch;
  const apiUrl = options.apiUrl ?? DEFAULT_API_URL;
  const downloadBaseUrl = options.downloadBaseUrl ?? DEFAULT_DOWNLOAD_BASE;
  const scheduleEvery: NonNullable<UpdateServiceOptions["scheduleEvery"]> = options.scheduleEvery ??
    ((callback, milliseconds) => setInterval(callback, milliseconds));
  const cancelSchedule = options.cancelSchedule ?? clearInterval;
  let checking = false;
  let currentCheck: Promise<void> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let activationWork: { tag: string; task: Promise<void> } | undefined;

  const persist = (operation: () => void) => {
    try {
      operation();
    } catch {
      options.persistence.markUnhealthy("Atlas persistence is unavailable; release discovery state was not saved.");
      throw new Error("Atlas persistence is unavailable");
    }
  };

  const fetchPublished = async () => {
    const releases: GitHubRelease[] = [];
    for (let page = 1; page <= 100; page += 1) {
      const separator = apiUrl.includes("?") ? "&" : "?";
      const response = await fetcher(`${apiUrl}${separator}per_page=100&page=${page}`, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "Atlas" },
      });
      const value = await responseJson(response, "GitHub release discovery");
      if (!Array.isArray(value) || !value.every((release) => release && typeof release === "object" &&
        typeof (release as Record<string, unknown>).tag_name === "string" &&
        typeof (release as Record<string, unknown>).draft === "boolean" &&
        typeof (release as Record<string, unknown>).prerelease === "boolean")) {
        throw new Error("GitHub release discovery returned invalid data");
      }
      const pageReleases = value as GitHubRelease[];
      releases.push(...pageReleases.filter((release) => !release.draft && !release.prerelease));
      if (pageReleases.length < 100) break;
      if (page === 100) throw new Error("GitHub release discovery exceeded its supported page limit");
    }

    const candidates: ReleaseMetadata[] = [];
    const seen = new Set<string>();
    for (const release of releases) {
      if (seen.has(release.tag_name)) throw new Error("GitHub release discovery returned a duplicate identity");
      seen.add(release.tag_name);
      const response = await fetcher(metadataUrl(downloadBaseUrl, release.tag_name), { headers: { "User-Agent": "Atlas" } });
      const metadata = assertReleaseMetadata(await responseJson(response, `Release ${release.tag_name} metadata`));
      if (metadata.identity.tag !== release.tag_name) throw new Error("Published release metadata does not match its GitHub Release");
      candidates.push(metadata);
    }
    return candidates.sort((left, right) => compareReleaseTags(right.identity.tag, left.identity.tag));
  };

  const check = () => {
    if (currentCheck) return currentCheck;
    checking = true;
    currentCheck = (async () => {
      try {
        const candidates = await fetchPublished();
        persist(() => options.persistence.recordUpdateDiscoverySuccess(candidates));
        const available = availableRelease(options.installed, candidates);
        if (!available) return;
        try {
          const updaterStatus = await options.updater.stage(available);
          if (updaterStatus.metadata?.identity.tag !== available.identity.tag) {
            persist(() => options.persistence.recordUpdateStageRequestFailure(
              `The updater is already staging ${updaterStatus.metadata?.identity.tag ?? "another release"}; ${available.identity.tag} remains available.`,
            ));
          }
        } catch {
          persist(() => options.persistence.recordUpdateStageRequestFailure("The host updater could not accept the staging request."));
        }
      } catch {
        try {
          persist(() => options.persistence.recordUpdateDiscoveryFailure(
            "Published Atlas releases could not be checked. Known release information was retained.",
          ));
        } catch {
          // Persistence health already carries the durable failure.
        }
      }
    })().finally(() => {
      checking = false;
      currentCheck = undefined;
    });
    return currentCheck;
  };

  const status = async (): Promise<UpdateStatus> => {
    let discovery = options.persistence.getUpdateDiscoveryState();
    let updater: UpdaterStatus | null = null;
    let updaterError: string | null = null;
    try {
      updater = await options.updater.status();
    } catch {
      updaterError = "The host updater is unavailable. Known release information is retained.";
    }
    const available = availableRelease(options.installed, discovery.candidates);
    if (discovery.stageRequestFailureReason && updater?.metadata?.identity.tag === available?.identity.tag) {
      discovery = { ...discovery, stageRequestFailureAt: null, stageRequestFailureReason: null };
    }
    return {
      installed: options.installed,
      checking,
      discovery,
      candidates: discovery.candidates,
      available,
      updater,
      updaterError,
    };
  };

  const matchingActivation = (updaterStatus: UpdaterStatus, candidate: ReleaseMetadata) =>
    updaterStatus.activation.metadata?.identity.tag === candidate.identity.tag;

  const abandonDurably = async (candidate: ReleaseMetadata, message: string) => {
    while (true) {
      try {
        const durable = await options.updater.abandonActivation(candidate, message);
        if (matchingActivation(durable, candidate) && durable.activation.state !== "awaiting_checkpoint") return;
      } catch {
        try {
          const durable = await options.updater.status();
          if (!matchingActivation(durable, candidate) || durable.activation.state !== "awaiting_checkpoint") return;
        } catch {
          // Retry until the surviving updater records or supersedes this abandonment.
        }
      }
      await Bun.sleep(250);
    }
  };

  const continueActivation = async (
    candidate: ReleaseMetadata,
    pause: () => Promise<UpdatePauseOutcome>,
  ) => {
    const outcome = await pause();
    if (outcome.status === "timed_out") {
      await abandonDurably(
        candidate,
        "Activation was abandoned because Atlas preparation or handoff did not reach a safe checkpoint within five minutes.",
      );
      return;
    }

    let accepted = false;
    try {
      const requested = await options.updater.activate(candidate);
      accepted = matchingActivation(requested, candidate) && requested.activation.state !== "awaiting_checkpoint";
    } catch {
      // Reconcile the lost response from durable updater state below.
    }
    while (!accepted) {
      try {
        const durable = await options.updater.status();
        if (!matchingActivation(durable, candidate)) break;
        if (durable.activation.state !== "awaiting_checkpoint") {
          accepted = true;
          break;
        }
        const requested = await options.updater.activate(candidate);
        accepted = matchingActivation(requested, candidate) && requested.activation.state !== "awaiting_checkpoint";
      } catch {
        // Keep the safe pause while the surviving updater's decision is unavailable.
      }
      if (!accepted) await Bun.sleep(250);
    }
    if (!accepted) {
      outcome.resume();
      await abandonDurably(candidate, "Activation was abandoned because the host updater could not confirm the request.");
      return;
    }

    while (true) {
      try {
        const durable = await options.updater.status();
        if (matchingActivation(durable, candidate) && ![
          "awaiting_checkpoint", "requested", "stopping", "selecting", "starting", "validating",
          "selecting_previous", "restarting_previous", "validating_previous",
        ].includes(durable.activation.state)) {
          outcome.resume();
          return;
        }
      } catch {
        // The updater owns recovery; retry status without changing the active selection.
      }
      await Bun.sleep(250);
    }
  };

  const install = async (tag: string, retry: boolean, pause: () => Promise<UpdatePauseOutcome>) => {
    if (activationWork) {
      if (activationWork.tag !== tag) throw new Error("Another Atlas activation is already in progress.");
      return;
    }
    const current = await status();
    const candidate = current.available;
    const updaterStatus = current.updater;
    if (!candidate || candidate.identity.tag !== tag) throw new Error("The requested release is not the available Atlas release.");
    if (!updaterStatus) throw new Error("The host updater is unavailable.");
    if (matchingActivation(updaterStatus, candidate) &&
        ["awaiting_checkpoint", "requested", "stopping", "selecting", "starting", "validating", "selecting_previous", "restarting_previous", "validating_previous"].includes(updaterStatus.activation.state)) {
      return;
    }
    if (updaterStatus.state !== "staged" || updaterStatus.metadata?.identity.tag !== tag || !updaterStatus.stagedPath ||
        updaterStatus.requirements === null || updaterStatus.requirements.unmet.length > 0) {
      throw new Error("The requested release is not fully staged and host-runtime eligible.");
    }
    if (!candidate.rollback.codeOnlyCompatible) throw new Error("The requested release requires manual maintenance.");
    const suppressed = updaterStatus.activation.failedTags.includes(tag);
    if (suppressed !== retry) throw new Error(suppressed ? "This failed release requires Retry." : "This release does not require Retry.");

    let prepared: UpdaterStatus;
    try {
      prepared = await options.updater.prepareActivation(candidate, retry);
    } catch (error) {
      try {
        const durable = await options.updater.status();
        if (!matchingActivation(durable, candidate) || durable.activation.state !== "awaiting_checkpoint") throw error;
        prepared = durable;
      } catch {
        throw error;
      }
    }
    if (!matchingActivation(prepared, candidate) || prepared.activation.state !== "awaiting_checkpoint") {
      throw new Error("The host updater did not persist the activation approval.");
    }
    const task = continueActivation(candidate, pause).finally(() => {
      if (activationWork?.task === task) activationWork = undefined;
    });
    activationWork = { tag, task };
  };

  const start = () => {
    if (timer) return;
    void check();
    void options.updater.status().then((updaterStatus) => {
      if (updaterStatus.activation.state === "awaiting_checkpoint" && updaterStatus.activation.metadata) {
        return options.updater.abandonActivation(
          updaterStatus.activation.metadata,
          "Activation was abandoned because Atlas restarted before confirming its safe checkpoint.",
        );
      }
    }).catch(() => undefined);
    timer = scheduleEvery(() => void check(), UPDATE_CHECK_INTERVAL_MS);
    (timer as { unref?: () => void }).unref?.();
  };

  const stop = () => {
    if (timer) cancelSchedule(timer);
    timer = undefined;
  };

  return { start, stop, check, status, install };
};

export const createUnavailableUpdateService = (
  persistence: Persistence,
  installed: ReleaseIdentity,
): UpdateService => ({
  start: () => undefined,
  stop: () => undefined,
  check: async () => undefined,
  install: async () => { throw new Error("The host updater is unavailable."); },
  status: async () => {
    const discovery = persistence.getUpdateDiscoveryState();
    return {
      installed,
      checking: false,
      discovery,
      candidates: discovery.candidates,
      available: availableRelease(installed, discovery.candidates),
      updater: null,
      updaterError: "The host updater is unavailable. Known release information is retained.",
    };
  },
});
