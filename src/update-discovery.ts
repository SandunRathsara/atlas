import type { Persistence, UpdateDiscoveryState } from "./persistence.ts";
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

  const start = () => {
    if (timer) return;
    void check();
    timer = scheduleEvery(() => void check(), UPDATE_CHECK_INTERVAL_MS);
    (timer as { unref?: () => void }).unref?.();
  };

  const stop = () => {
    if (timer) cancelSchedule(timer);
    timer = undefined;
  };

  return { start, stop, check, status };
};

export const createUnavailableUpdateService = (
  persistence: Persistence,
  installed: ReleaseIdentity,
): UpdateService => ({
  start: () => undefined,
  stop: () => undefined,
  check: async () => undefined,
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
