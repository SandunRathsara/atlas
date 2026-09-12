import type { Persistence, UpdateDiscoveryState } from "./persistence.ts";
import type { UpdatePauseOutcome } from "./update-pause.ts";
import {
  assertReleaseMetadata,
  compareReleaseTags,
  parseReleaseTag,
  type ReleaseIdentity,
  type ReleaseMetadata,
  type ReleaseTag,
} from "./release.ts";
import { activationInProgress, type UpdatePolicy, type UpdaterClient, type UpdaterStatus } from "./updater.ts";

export const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const DEFAULT_API_URL = "https://api.github.com/repos/SandunRathsara/atlas/releases";
const DEFAULT_DOWNLOAD_BASE = "https://github.com/SandunRathsara/atlas/releases/download";
const MAX_METADATA_BYTES = 1024 * 1024;
const activeStage = new Set<UpdaterStatus["state"]>(["requested", "downloading", "verifying", "extracting"]);

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
  start: (pause?: () => Promise<UpdatePauseOutcome>) => void;
  stop: () => void;
  check: (pause?: () => Promise<UpdatePauseOutcome>) => Promise<void>;
  status: () => Promise<UpdateStatus>;
  setPolicy: (policy: UpdatePolicy, pause?: () => Promise<UpdatePauseOutcome>) => Promise<void>;
  install: (tag: ReleaseTag, retry: boolean, pause: () => Promise<UpdatePauseOutcome>) => Promise<void>;
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
  sleep?: (milliseconds: number) => Promise<void>;
};

const availableRelease = (
  installed: ReleaseIdentity,
  candidates: readonly ReleaseMetadata[],
  policy: UpdatePolicy,
) => {
  if (!installed.published) return null;
  const newer = candidates.filter((candidate) => compareReleaseTags(candidate.identity.tag, installed.tag) > 0);
  if (policy === "automatic") {
    const sameSemver = newer.find((candidate) => candidate.identity.semver === installed.semver);
    if (sameSemver) return sameSemver;
  }
  return newer[0] ?? null;
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
  const sleep = options.sleep ?? Bun.sleep;
  let checking = false;
  let currentCheck: Promise<void> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let activationRequest: { tag: ReleaseTag; task: Promise<void> } | undefined;
  let activationWork: { tag: ReleaseTag; task: Promise<void> } | undefined;
  let automaticTarget: { candidate: ReleaseMetadata; pause: () => Promise<UpdatePauseOutcome> } | undefined;
  let automaticWork: Promise<void> | undefined;

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
    const seen = new Set<ReleaseTag>();
    for (const release of releases) {
      const tag = parseReleaseTag(release.tag_name).tag;
      if (seen.has(tag)) throw new Error("GitHub release discovery returned a duplicate identity");
      seen.add(tag);
      const response = await fetcher(metadataUrl(downloadBaseUrl, tag), { headers: { "User-Agent": "Atlas" } });
      const metadata = assertReleaseMetadata(await responseJson(response, `Release ${tag} metadata`));
      if (metadata.identity.tag !== tag) throw new Error("Published release metadata does not match its GitHub Release");
      candidates.push(metadata);
    }
    return candidates.sort((left, right) => compareReleaseTags(right.identity.tag, left.identity.tag));
  };

  const matchingActivation = (updaterStatus: UpdaterStatus, candidate: ReleaseMetadata) =>
    updaterStatus.activation.metadata?.identity.tag === candidate.identity.tag;

  const isAutomaticCandidate = (candidate: ReleaseMetadata) => options.installed.published &&
    candidate.identity.semver === options.installed.semver && candidate.identity.build > options.installed.build;

  const queueAutomatic = (candidate: ReleaseMetadata, pause: () => Promise<UpdatePauseOutcome>) => {
    automaticTarget = { candidate, pause };
    if (automaticWork) return;
    automaticWork = (async () => {
      while (automaticTarget) {
        const target = automaticTarget;
        automaticTarget = undefined;
        const tag = target.candidate.identity.tag;
        while (true) {
          const updaterStatus = await options.updater.status();
          const latest = availableRelease(options.installed, options.persistence.getUpdateDiscoveryState().candidates, updaterStatus.policy);
          if (updaterStatus.policy !== "automatic" || latest?.identity.tag !== tag ||
              updaterStatus.activation.failedTags.includes(tag) || activationInProgress(updaterStatus)) break;
          if (updaterStatus.metadata?.identity.tag !== tag) {
            if (activeStage.has(updaterStatus.state)) {
              await sleep(250);
              continue;
            }
            await options.updater.stage(target.candidate);
            continue;
          }
          if (activeStage.has(updaterStatus.state)) {
            await sleep(250);
            continue;
          }
          if (updaterStatus.state === "staged") {
            await activateCandidate(target.candidate, false, target.pause, true);
          }
          break;
        }
      }
    })().catch(() => undefined).finally(() => {
      automaticWork = undefined;
      if (automaticTarget) queueAutomatic(automaticTarget.candidate, automaticTarget.pause);
    });
  };

  const applyCandidates = async (
    candidates: readonly ReleaseMetadata[],
    pause?: () => Promise<UpdatePauseOutcome>,
  ) => {
    let updaterStatus: UpdaterStatus;
    try {
      updaterStatus = await options.updater.status();
    } catch {
      persist(() => options.persistence.recordUpdateStageRequestFailure("The host updater could not accept the staging request."));
      return;
    }
    const available = availableRelease(options.installed, candidates, updaterStatus.policy);
    if (!available) return;
    try {
      updaterStatus = await options.updater.stage(available);
      if (updaterStatus.metadata?.identity.tag !== available.identity.tag) {
        persist(() => options.persistence.recordUpdateStageRequestFailure(
          `The updater is already staging ${updaterStatus.metadata?.identity.tag ?? "another release"}; ${available.identity.tag} remains available.`,
        ));
      }
      if (pause && updaterStatus.policy === "automatic" && isAutomaticCandidate(available) &&
          !updaterStatus.activation.failedTags.includes(available.identity.tag)) {
        queueAutomatic(available, pause);
      }
    } catch {
      persist(() => options.persistence.recordUpdateStageRequestFailure("The host updater could not accept the staging request."));
    }
  };

  const check = (pause?: () => Promise<UpdatePauseOutcome>) => {
    if (currentCheck) return currentCheck;
    checking = true;
    currentCheck = (async () => {
      try {
        const candidates = await fetchPublished();
        persist(() => options.persistence.recordUpdateDiscoverySuccess(candidates));
        await applyCandidates(candidates, pause);
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
    const available = availableRelease(options.installed, discovery.candidates, updater?.policy ?? "approval_required");
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
      await sleep(250);
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
      if (!accepted) await sleep(250);
    }
    if (!accepted) {
      outcome.resume();
      await abandonDurably(candidate, "Activation was abandoned because the host updater could not confirm the request.");
      return;
    }

    while (true) {
      try {
        const durable = await options.updater.status();
        if (matchingActivation(durable, candidate) && !activationInProgress(durable)) {
          outcome.resume();
          return;
        }
      } catch {
        // The updater owns recovery; retry status without changing the active selection.
      }
      await sleep(250);
    }
  };

  async function activateCandidate(
    candidate: ReleaseMetadata,
    retry: boolean,
    pause: () => Promise<UpdatePauseOutcome>,
    automatic = false,
  ) {
    const tag = candidate.identity.tag;
    if (activationRequest) {
      if (activationRequest.tag !== tag) throw new Error("Another Atlas activation is already in progress.");
      return activationRequest.task;
    }
    if (activationWork) {
      if (activationWork.tag !== tag) throw new Error("Another Atlas activation is already in progress.");
      return;
    }
    const request = (async () => {
      const current = await status();
      const updaterStatus = current.updater;
      if (!current.available || current.available.identity.tag !== tag) throw new Error("The requested release is not the available Atlas release.");
      if (!updaterStatus) throw new Error("The host updater is unavailable.");
      if (automatic && (updaterStatus.policy !== "automatic" || !isAutomaticCandidate(candidate))) {
        throw new Error("The requested release requires explicit approval.");
      }
      if (matchingActivation(updaterStatus, candidate) && activationInProgress(updaterStatus)) {
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
    })();
    activationRequest = { tag, task: request };
    try {
      await request;
    } finally {
      if (activationRequest?.task === request) activationRequest = undefined;
    }
  }

  const install = async (tag: ReleaseTag, retry: boolean, pause: () => Promise<UpdatePauseOutcome>) => {
    const current = await status();
    if (!current.available || current.available.identity.tag !== tag) {
      throw new Error("The requested release is not the available Atlas release.");
    }
    await activateCandidate(current.available, retry, pause);
  };

  const setPolicy = async (policy: UpdatePolicy, pause?: () => Promise<UpdatePauseOutcome>) => {
    await options.updater.setPolicy(policy);
    await applyCandidates(options.persistence.getUpdateDiscoveryState().candidates, pause);
  };

  const start = (pause?: () => Promise<UpdatePauseOutcome>) => {
    if (timer) return;
    void check(pause);
    void options.updater.status().then((updaterStatus) => {
      if (updaterStatus.activation.state === "awaiting_checkpoint" && updaterStatus.activation.metadata) {
        return options.updater.abandonActivation(
          updaterStatus.activation.metadata,
          "Activation was abandoned because Atlas restarted before confirming its safe checkpoint.",
        );
      }
    }).catch(() => undefined);
    timer = scheduleEvery(() => void check(pause), UPDATE_CHECK_INTERVAL_MS);
    (timer as { unref?: () => void }).unref?.();
  };

  const stop = () => {
    if (timer) cancelSchedule(timer);
    timer = undefined;
  };

  return { start, stop, check, status, setPolicy, install };
};

export const createUnavailableUpdateService = (
  persistence: Persistence,
  installed: ReleaseIdentity,
): UpdateService => ({
  start: () => undefined,
  stop: () => undefined,
  check: async () => undefined,
  setPolicy: async () => { throw new Error("The host updater is unavailable."); },
  install: async () => { throw new Error("The host updater is unavailable."); },
  status: async () => {
    const discovery = persistence.getUpdateDiscoveryState();
    return {
      installed,
      checking: false,
      discovery,
      candidates: discovery.candidates,
      available: availableRelease(installed, discovery.candidates, "approval_required"),
      updater: null,
      updaterError: "The host updater is unavailable. Known release information is retained.",
    };
  },
});
