import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { connect, createServer, type Server } from "node:net";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { compareVersions, isNumericVersion, type HostToolName, type HostTools } from "./host-tools.ts";
import { buildReleaseFolder, releaseFolderIntact, type ReleaseFolderRunAs } from "./release-layout.ts";
import {
  assertReleaseMetadata,
  compareReleaseTags,
  parseReleaseTag,
  type ReleaseMetadata,
  type ReleaseTag,
} from "./release.ts";

// Root-owned (systemd StateDirectory, 0700). The old service-writable
// /var/lib/atlas/update-state.json is never read again.
const DEFAULT_STATE_PATH = "/var/lib/atlas-updater/update-state.json";
const DEFAULT_SOCKET_PATH = "/run/atlas-updater/updater.sock";
const DEFAULT_KEY_PATH = "/etc/atlas/updater.key";
const DEFAULT_RELEASES_ROOT = "/opt/atlas/releases";
const DEFAULT_DOWNLOAD_BASE = "https://github.com/SandunRathsara/atlas/releases/download";
const MAX_MESSAGE_BYTES = 256 * 1024;
const MAX_METADATA_BYTES = 64 * 1024;
const MAX_CHECKSUM_BYTES = 4 * 1024;
const MAX_REDIRECTS = 5;
const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1_000;
const activeStates = new Set<UpdaterStatus["state"]>(["requested", "downloading", "verifying", "preparing"]);
export const ACTIVATION_HEALTH_TIMEOUT_MS = 60 * 1_000;

export type ActivationState =
  | "idle"
  | "awaiting_checkpoint"
  | "requested"
  | "stopping"
  | "selecting"
  | "starting"
  | "validating"
  | "selecting_previous"
  | "restarting_previous"
  | "validating_previous"
  | "succeeded"
  | "rolled_back"
  | "rollback_failed"
  | "abandoned";

const activeActivationStates = new Set<ActivationState>([
  "awaiting_checkpoint",
  "requested",
  "stopping",
  "selecting",
  "starting",
  "validating",
  "selecting_previous",
  "restarting_previous",
  "validating_previous",
]);

export type ActivationResult = {
  tag: ReleaseTag;
  state: "succeeded" | "rolled_back" | "rollback_failed" | "abandoned";
  message: string;
  at: string;
};

export type ActivationStatus = {
  state: ActivationState;
  metadata: ReleaseMetadata | null;
  previousPath: string | null;
  previousMetadata: ReleaseMetadata | null;
  requestedAt: string | null;
  updatedAt: string | null;
  deadlineAt: string | null;
  message: string;
  failureMessage: string | null;
  retry: boolean;
  failedTags: ReleaseTag[];
  lastResult: ActivationResult | null;
};

export const activationInProgress = (status: Pick<UpdaterStatus, "activation">) =>
  activeActivationStates.has(status.activation.state);

/** Host git/gh versions as reported by the tools (numeric X.Y.Z), or null when missing. */
export type HostRuntime = { git: string | null; gh: string | null };

export type RuntimeRequirements = {
  /** Minimum versions from the candidate metadata. */
  required: HostTools;
  available: HostRuntime;
  unmet: string[];
};

export type UpdaterResult = {
  tag: ReleaseTag;
  state: "staged" | "failed";
  message: string;
  at: string;
};

export type UpdatePolicy = "approval_required" | "automatic";

export type CleanupStatus = {
  state: "idle" | "cleaning" | "succeeded" | "failed";
  message: string;
  updatedAt: string | null;
  pendingTags: ReleaseTag[];
  removedTags: ReleaseTag[];
};

export type UpdaterStatus = {
  schemaVersion: 2;
  policy: UpdatePolicy;
  state: "idle" | "requested" | "downloading" | "verifying" | "preparing" | "staged" | "failed";
  metadata: ReleaseMetadata | null;
  requestedAt: string | null;
  updatedAt: string | null;
  stagedPath: string | null;
  message: string;
  requirements: RuntimeRequirements | null;
  lastResult: UpdaterResult | null;
  activation: ActivationStatus;
  cleanup: CleanupStatus;
};

export type UpdaterClient = {
  status: () => Promise<UpdaterStatus>;
  setPolicy: (policy: UpdatePolicy) => Promise<UpdaterStatus>;
  stage: (metadata: ReleaseMetadata) => Promise<UpdaterStatus>;
  prepareActivation: (metadata: ReleaseMetadata, retry: boolean) => Promise<UpdaterStatus>;
  activate: (metadata: ReleaseMetadata) => Promise<UpdaterStatus>;
  abandonActivation: (metadata: ReleaseMetadata, message: string) => Promise<UpdaterStatus>;
};

// Callers send only a tag (plus intent). The root updater never trusts caller
// metadata: it fetches `atlas-release.json` for the tag itself.
type UpdaterRequest =
  | { key: string; operation: "status" }
  | { key: string; operation: "set_policy"; policy: UpdatePolicy }
  | { key: string; operation: "stage"; tag: string }
  | { key: string; operation: "prepare_activation"; tag: string; retry: boolean }
  | { key: string; operation: "activate"; tag: string }
  | { key: string; operation: "abandon_activation"; tag: string; message: string };

type UpdaterResponse =
  | { ok: true; status: UpdaterStatus }
  | { ok: false; error: string };

const initialActivation = (): ActivationStatus => ({
  state: "idle",
  metadata: null,
  previousPath: null,
  previousMetadata: null,
  requestedAt: null,
  updatedAt: null,
  deadlineAt: null,
  message: "No release activation has been requested.",
  failureMessage: null,
  retry: false,
  failedTags: [],
  lastResult: null,
});

const initialCleanup = (): CleanupStatus => ({
  state: "idle",
  message: "Release cleanup has not run yet.",
  updatedAt: null,
  pendingTags: [],
  removedTags: [],
});

const initialStatus = (): UpdaterStatus => ({
  schemaVersion: 2,
  policy: "approval_required",
  state: "idle",
  metadata: null,
  requestedAt: null,
  updatedAt: null,
  stagedPath: null,
  message: "No release has been staged yet.",
  requirements: null,
  lastResult: null,
  activation: initialActivation(),
  cleanup: initialCleanup(),
});

const readKey = (path: string) => {
  const stat = lstatSync(path);
  if (!stat.isFile() || (stat.mode & 0o007) !== 0) throw new Error("Updater key must be a restricted regular file");
  const key = readFileSync(path, "utf8").trim();
  if (key.length < 32) throw new Error("Updater key is invalid");
  return key;
};

const keysMatch = (left: string, right: string) => {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
};

const activationStates: ActivationState[] = [
  "idle",
  "awaiting_checkpoint",
  "requested",
  "stopping",
  "selecting",
  "starting",
  "validating",
  "selecting_previous",
  "restarting_previous",
  "validating_previous",
  "succeeded",
  "rolled_back",
  "rollback_failed",
  "abandoned",
];

const validReleaseTag = (value: unknown): value is ReleaseTag => {
  if (typeof value !== "string") return false;
  try {
    return parseReleaseTag(value).tag === value;
  } catch {
    return false;
  }
};

const validReleaseTags = (value: unknown): value is ReleaseTag[] =>
  Array.isArray(value) && value.every(validReleaseTag);

const parseActivation = (value: unknown): ActivationStatus => {
  if (value === undefined) return initialActivation();
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Updater activation state is invalid");
  const activation = value as Partial<ActivationStatus>;
  const lastResult = activation.lastResult as Partial<ActivationResult> | null | undefined;
  if (typeof activation.state !== "string" || !activationStates.includes(activation.state as ActivationState) ||
      activation.metadata === undefined || (activation.metadata !== null && !assertReleaseMetadata(activation.metadata)) ||
      activation.previousMetadata === undefined || (activation.previousMetadata !== null && !assertReleaseMetadata(activation.previousMetadata)) ||
      ![activation.previousPath, activation.requestedAt, activation.updatedAt, activation.deadlineAt, activation.failureMessage]
        .every((item) => item === null || typeof item === "string") ||
      typeof activation.message !== "string" || typeof activation.retry !== "boolean" ||
      !validReleaseTags(activation.failedTags) ||
      lastResult === undefined || (lastResult !== null && (!validReleaseTag(lastResult.tag) ||
        !["succeeded", "rolled_back", "rollback_failed", "abandoned"].includes(lastResult.state ?? "") ||
        typeof lastResult.message !== "string" || typeof lastResult.at !== "string"))) {
    throw new Error("Updater activation state is invalid");
  }
  if (activation.state !== "idle" && activation.metadata === null) throw new Error("Updater activation state is invalid");
  return activation as ActivationStatus;
};

const parseCleanup = (value: unknown): CleanupStatus => {
  if (value === undefined) return initialCleanup();
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Updater cleanup state is invalid");
  const cleanup = value as Partial<CleanupStatus>;
  if (typeof cleanup.state !== "string" || !["idle", "cleaning", "succeeded", "failed"].includes(cleanup.state) ||
      typeof cleanup.message !== "string" || (cleanup.updatedAt !== null && typeof cleanup.updatedAt !== "string") ||
      !validReleaseTags(cleanup.pendingTags) || !validReleaseTags(cleanup.removedTags)) {
    throw new Error("Updater cleanup state is invalid");
  }
  return cleanup as CleanupStatus;
};

const parseStatus = (value: unknown): UpdaterStatus => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Updater state is invalid");
  const status = value as Partial<UpdaterStatus>;
  const requirements = status.requirements as Partial<RuntimeRequirements> | null | undefined;
  const available = requirements?.available as Partial<HostRuntime> | undefined;
  const lastResult = status.lastResult as Partial<UpdaterResult> | null | undefined;
  const policy = status.policy ?? "approval_required";
  if (status.schemaVersion !== 2 || !["approval_required", "automatic"].includes(policy) || typeof status.state !== "string" ||
      !["idle", "requested", "downloading", "verifying", "preparing", "staged", "failed"].includes(status.state) ||
      status.metadata === undefined || (status.metadata !== null && !assertReleaseMetadata(status.metadata)) ||
      ![status.requestedAt, status.updatedAt, status.stagedPath].every((item) => item === null || typeof item === "string") ||
      typeof status.message !== "string" || requirements === undefined ||
      (requirements !== null && (!requirements.required || typeof requirements.required !== "object" || !available ||
        ![available.git, available.gh].every((item) => item === null || typeof item === "string") ||
        !Array.isArray(requirements.unmet) || !requirements.unmet.every((item) => typeof item === "string"))) ||
      lastResult === undefined || (lastResult !== null && (!validReleaseTag(lastResult.tag) ||
        !["staged", "failed"].includes(lastResult.state ?? "") || typeof lastResult.message !== "string" || typeof lastResult.at !== "string"))) {
    throw new Error("Updater state is invalid");
  }
  if (status.state !== "idle" && status.metadata === null) throw new Error("Updater state is invalid");
  return { ...status, policy, activation: parseActivation(status.activation), cleanup: parseCleanup(status.cleanup) } as UpdaterStatus;
};

const readStatusFile = (path: string) => {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) return initialStatus();
  // A state file someone else could have written is ignored and rebuilt.
  const uid = typeof process.getuid === "function" ? process.getuid() : stat.uid;
  if (!stat.isFile() || stat.uid !== uid || (stat.mode & 0o022) !== 0) return initialStatus();
  const value = JSON.parse(readFileSync(path, "utf8")) as { schemaVersion?: unknown; policy?: unknown } | null;
  // Schema 1 described tarball Releases that this Atlas can no longer stage or
  // roll back to. Keep only the operator's policy and start clean.
  if (value && typeof value === "object" && value.schemaVersion === 1) {
    return { ...initialStatus(), policy: value.policy === "automatic" ? "automatic" : "approval_required" } as UpdaterStatus;
  }
  return parseStatus(value);
};

const writeStatusFile = (path: string, status: UpdaterStatus) => {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(status)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
};

const metadataRecord = (metadata: ReleaseMetadata) => JSON.stringify({
  schemaVersion: metadata.schemaVersion,
  identity: metadata.identity,
  asset: metadata.asset,
  minimumHostTools: metadata.minimumHostTools,
  openCodeClient: metadata.openCodeClient,
  rollback: metadata.rollback,
});

const requirementsFor = (metadata: ReleaseMetadata, available: HostRuntime): RuntimeRequirements => {
  const labels: Record<HostToolName, string> = { git: "Git", gh: "gh" };
  const required = metadata.minimumHostTools;
  const unmet = (Object.keys(labels) as HostToolName[]).flatMap((name) => {
    const version = available[name];
    return version !== null && isNumericVersion(version) && compareVersions(version, required[name]) >= 0
      ? []
      : [`${labels[name]} ${required[name]} or newer is required; this host reports ${version ?? "unknown"}.`];
  });
  return { required, available, unmet };
};

const downloadUrl = (base: string, tag: string, name: string) =>
  `${base.replace(/\/$/u, "")}/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;

const assertHttps = (url: string, label: string) => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${label} URL is invalid.`);
  }
  if (parsed.protocol !== "https:") throw new Error(`${label} must be downloaded over HTTPS.`);
  return parsed.toString();
};

/** GET over HTTPS; follows at most MAX_REDIRECTS redirects, each to an https URL. */
const fetchHttps = async (fetcher: typeof fetch, url: string, label: string) => {
  let current = assertHttps(url, label);
  for (let hop = 0; ; hop += 1) {
    let response: Response;
    try {
      response = await fetcher(current, {
        headers: { "User-Agent": "Atlas updater" },
        redirect: "manual",
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
    } catch {
      throw new Error(`${label} download failed.`);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel().catch(() => undefined);
      const location = response.headers.get("Location");
      if (!location || hop >= MAX_REDIRECTS) throw new Error(`${label} download failed (too many or invalid redirects).`);
      current = assertHttps(new URL(location, current).toString(), label);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`${label} download failed (HTTP ${response.status}).`);
    }
    return response;
  }
};

/** Streams the body to `sink`, aborting as soon as it exceeds `limit` bytes. */
const streamBody = async (response: Response, label: string, limit: number, sink: (chunk: Uint8Array) => void) => {
  const declared = Number(response.headers.get("Content-Length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`${label} is too large.`);
  }
  let total = 0;
  const reader = response.body?.getReader();
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > limit) throw new Error(`${label} is too large.`);
        sink(value);
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      if (error instanceof Error && error.message === `${label} is too large.`) throw error;
      throw new Error(`${label} download failed.`);
    }
  }
  return total;
};

/** Downloads into a new private file (never follows or reuses an existing path). */
const fetchFile = async (fetcher: typeof fetch, url: string, path: string, label: string, limit: number) => {
  const response = await fetchHttps(fetcher, url, label);
  const descriptor = openSync(
    path,
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
    0o600,
  );
  try {
    return await streamBody(response, label, limit, (chunk) => {
      let offset = 0;
      while (offset < chunk.byteLength) offset += writeSync(descriptor, chunk, offset);
    });
  } finally {
    closeSync(descriptor);
  }
};

const fetchText = async (fetcher: typeof fetch, url: string, label: string, limit: number) => {
  const response = await fetchHttps(fetcher, url, label);
  const chunks: Uint8Array[] = [];
  await streamBody(response, label, limit, (chunk) => chunks.push(chunk));
  return Buffer.concat(chunks).toString("utf8");
};

const removeTree = (path: string) => {
  if (!existsSync(path)) return;
  const makeWritable = (current: string) => {
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      chmodSync(current, 0o700);
      for (const name of readdirSync(current)) makeWritable(join(current, name));
    } else if (stat.isFile()) {
      chmodSync(current, 0o600);
    }
  };
  makeWritable(path);
  rmSync(path, { recursive: true, force: true });
};

/**
 * Installs the activated Release's binary as the surviving-service bundle
 * (`<supportRoot>/releases/atlas-<tag>`, same builder and checks as staging)
 * and atomically points `<supportRoot>/current` at it. The credential and
 * updater units run `<supportRoot>/current/atlas`, so they keep running from a
 * known-good bundle across UI restarts and rollbacks. Bundles are outside
 * Release retention cleanup.
 */
export const installShippedSupportServices = async (
  releasePathValue: string,
  metadata: ReleaseMetadata,
  supportRootValue = "/opt/atlas/services",
  runAs?: ReleaseFolderRunAs,
) => {
  const releasePath = resolve(releasePathValue);
  const supportRoot = resolve(supportRootValue);
  if (releasePath === "/" || supportRoot === "/" || !existsSync(releasePath) ||
      realpathSync(releasePath) !== releasePath || !lstatSync(releasePath).isDirectory() || lstatSync(releasePath).isSymbolicLink()) {
    throw new Error("The shipped support-service source is unsafe.");
  }
  const embedded = assertReleaseMetadata(JSON.parse(readFileSync(join(releasePath, "RELEASE_METADATA.json"), "utf8")));
  if (metadataRecord(embedded) !== metadataRecord(metadata)) throw new Error("The shipped support-service source does not match the candidate release.");
  const selectedPath = join(supportRoot, "current");
  if (lstatSync(selectedPath, { throwIfNoEntry: false })?.isSymbolicLink()) {
    try {
      const selected = realpathSync(selectedPath);
      const selectedMetadata = assertReleaseMetadata(JSON.parse(readFileSync(join(selected, "RELEASE_METADATA.json"), "utf8")));
      if (dirname(selected) === join(supportRoot, "releases") && selectedMetadata.identity.build > metadata.identity.build) return selected;
    } catch {
      // An unreadable selection is replaced by the verified bundle below.
    }
  }
  const bundlePath = await buildReleaseFolder({
    binaryPath: join(releasePath, "atlas"),
    metadata,
    releasesRoot: join(supportRoot, "releases"),
    runAs,
  });

  const currentPath = join(supportRoot, "current");
  if (existsSync(currentPath) && !lstatSync(currentPath).isSymbolicLink()) {
    throw new Error("The stable support-service selection is unsafe.");
  }
  const temporary = join(supportRoot, `.current-${process.pid}-${randomBytes(8).toString("hex")}`);
  try {
    symlinkSync(bundlePath, temporary, "dir");
    renameSync(temporary, currentPath);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
  return bundlePath;
};

export type UpdaterServiceOptions = {
  statePath?: string;
  socketPath?: string;
  keyPath?: string;
  releasesRoot?: string;
  downloadBaseUrl?: string;
  fetcher?: typeof fetch;
  now?: () => number;
  hostRuntime?: (metadata: ReleaseMetadata) => HostRuntime;
  currentPath?: string;
  activationTimeoutMs?: number;
  activationPollMs?: number;
  controlAtlas?: (operation: "stop" | "start") => boolean | Promise<boolean>;
  checkAtlasHealth?: (metadata: ReleaseMetadata) => boolean | Promise<boolean>;
  updateSupportServices?: (releasePath: string, metadata: ReleaseMetadata) => void | Promise<void>;
  sleep?: (milliseconds: number) => Promise<void>;
  listHelperReferences?: () => string[];
  /** Unprivileged account for candidate `atlas version --json` checks; required when the updater runs as root. */
  runAs?: ReleaseFolderRunAs;
};

export const createUpdaterService = (options: UpdaterServiceOptions = {}) => {
  const statePath = resolve(options.statePath ?? DEFAULT_STATE_PATH);
  const socketPath = resolve(options.socketPath ?? DEFAULT_SOCKET_PATH);
  const keyPath = resolve(options.keyPath ?? DEFAULT_KEY_PATH);
  const releasesRoot = resolve(options.releasesRoot ?? DEFAULT_RELEASES_ROOT);
  const downloadBaseUrl = assertHttps(options.downloadBaseUrl ?? DEFAULT_DOWNLOAD_BASE, "The release download base");
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const hostRuntime = options.hostRuntime ?? (() => ({ git: null, gh: null }));
  const currentPath = resolve(options.currentPath ?? "/opt/atlas/current");
  const activationTimeoutMs = options.activationTimeoutMs ?? ACTIVATION_HEALTH_TIMEOUT_MS;
  const activationPollMs = options.activationPollMs ?? 1_000;
  const controlAtlas = options.controlAtlas ?? (() => false);
  const checkAtlasHealth = options.checkAtlasHealth ?? (() => false);
  const updateSupportServices = options.updateSupportServices ?? (() => undefined);
  const sleep = options.sleep ?? Bun.sleep;
  const listHelperReferences = options.listHelperReferences ?? (() => []);
  if (!Number.isSafeInteger(activationTimeoutMs) || activationTimeoutMs < 1 ||
      !Number.isSafeInteger(activationPollMs) || activationPollMs < 1) {
    throw new Error("Updater activation timing must use positive safe integers");
  }
  let status = readStatusFile(statePath);
  let server: Server | undefined;
  let staging: Promise<void> | undefined;
  let requesting: Promise<UpdaterStatus> | undefined;
  let activating: Promise<void> | undefined;
  let closing = false;

  const socketInUse = () => new Promise<boolean>((resolveUse) => {
    const socket = connect(socketPath);
    const finish = (used: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolveUse(used);
    };
    socket.setTimeout(250, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });

  const save = (next: UpdaterStatus) => {
    status = next;
    writeStatusFile(statePath, status);
  };
  const timestamp = () => new Date(now()).toISOString();
  const releasePath = (tag: ReleaseTag) => join(releasesRoot, `atlas-${tag}`);
  const candidatePath = (metadata: ReleaseMetadata) => releasePath(metadata.identity.tag);
  const sameMetadata = (left: ReleaseMetadata | null, right: ReleaseMetadata) =>
    left !== null && metadataRecord(left) === metadataRecord(right);
  const within = (root: string, path: string) => {
    const remainder = relative(root, path);
    return remainder === "" || (remainder !== ".." && !remainder.startsWith(`..${"/"}`) && !isAbsolute(remainder));
  };

  const saveActivation = (next: ActivationStatus) => save({ ...status, activation: next });
  const activationProgress = (state: ActivationState, message: string, deadlineAt: string | null = null) => {
    saveActivation({ ...status.activation, state, message, updatedAt: timestamp(), deadlineAt });
  };

  const releaseMetadataAt = (path: string) =>
    assertReleaseMetadata(JSON.parse(readFileSync(join(path, "RELEASE_METADATA.json"), "utf8")));

  const selectedRelease = () => {
    if (!existsSync(currentPath) || !lstatSync(currentPath).isSymbolicLink()) {
      throw new Error("The active Atlas release selection is unsafe.");
    }
    const path = realpathSync(currentPath);
    if (dirname(path) !== releasesRoot || !lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()) {
      throw new Error("The active Atlas release is outside the managed release directory.");
    }
    return { path, metadata: releaseMetadataAt(path) };
  };

  const selectRelease = (path: string) => {
    if (dirname(path) !== releasesRoot || !existsSync(path) || !lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()) {
      throw new Error("The requested Atlas release path is unsafe.");
    }
    mkdirSync(dirname(currentPath), { recursive: true, mode: 0o755 });
    const temporary = join(dirname(currentPath), `.current-${process.pid}-${randomBytes(8).toString("hex")}`);
    try {
      symlinkSync(path, temporary, "dir");
      renameSync(temporary, currentPath);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  };

  const cleanupReleases = () => {
    let pendingTags = [...status.cleanup.pendingTags];
    let removedTags: ReleaseTag[] = [];
    try {
      const current = selectedRelease();
      if (current.path !== candidatePath(current.metadata)) throw new Error("The active Atlas release path is not cleanup-safe.");
      const references = listHelperReferences();
      if (!references.every((path) => typeof path === "string" && isAbsolute(path))) {
        throw new Error("Session helper references are invalid.");
      }
      const protectedPaths = new Set([
        current.path,
        ...(status.stagedPath ? [resolve(status.stagedPath)] : []),
        ...(status.activation.previousPath ? [resolve(status.activation.previousPath)] : []),
        ...(activationInProgress(status) && status.activation.metadata ? [candidatePath(status.activation.metadata)] : []),
      ]);
      const pending = new Set(pendingTags);
      for (const entry of readdirSync(releasesRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.startsWith("atlas-")) continue;
        try {
          const tag = parseReleaseTag(entry.name.slice("atlas-".length)).tag;
          if (!pending.has(tag) && releaseMetadataAt(join(releasesRoot, entry.name)).identity.tag !== tag) continue;
          pending.add(tag);
        } catch {
          // Unknown or incomplete trees are retained unless a prior durable cleanup already owned them.
        }
      }
      pendingTags = [...pending]
        .filter((tag) => compareReleaseTags(tag, current.metadata.identity.tag) < 0)
        .filter((tag) => {
          const path = releasePath(tag);
          return !protectedPaths.has(path) && !references.some((reference) => within(path, reference));
        })
        .sort(compareReleaseTags);
      save({
        ...status,
        cleanup: {
          state: "cleaning",
          message: "Removing older unreferenced Atlas releases.",
          updatedAt: timestamp(),
          pendingTags,
          removedTags,
        },
      });
      while (pendingTags.length > 0) {
        const tag = pendingTags[0]!;
        const path = releasePath(tag);
        const currentReferences = listHelperReferences();
        if (!currentReferences.every((reference) => typeof reference === "string" && isAbsolute(reference))) {
          throw new Error("Session helper references are invalid.");
        }
        if (!currentReferences.some((reference) => within(path, reference))) {
          if (existsSync(path) && (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink())) {
            throw new Error(`Atlas release ${tag} is not a cleanup-safe directory.`);
          }
          removeTree(path);
          removedTags.push(tag);
        }
        pendingTags = pendingTags.slice(1);
        save({ ...status, cleanup: { ...status.cleanup, pendingTags, removedTags, updatedAt: timestamp() } });
      }
      save({
        ...status,
        cleanup: {
          state: "succeeded",
          message: removedTags.length === 0
            ? "No older unreferenced Atlas releases needed cleanup."
            : `Removed ${removedTags.length} older unreferenced Atlas release${removedTags.length === 1 ? "" : "s"}.`,
          updatedAt: timestamp(),
          pendingTags: [],
          removedTags,
        },
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Release cleanup could not be completed.";
      save({
        ...status,
        cleanup: {
          state: "failed",
          message: `Release cleanup failed: ${reason} The active Atlas release remains selected and protected releases were retained.`,
          updatedAt: timestamp(),
          pendingTags,
          removedTags,
        },
      });
    }
  };

  const waitForHealth = async (metadata: ReleaseMetadata, existingDeadline: string | null) => {
    const deadline = existingDeadline ? Date.parse(existingDeadline) : now() + activationTimeoutMs;
    if (!Number.isFinite(deadline)) throw new Error("Updater activation deadline is invalid");
    if (!existingDeadline) activationProgress(status.activation.state, status.activation.message, new Date(deadline).toISOString());
    while (now() < deadline) {
      if (closing) return "closed" as const;
      try {
        if (await checkAtlasHealth(metadata)) return "healthy" as const;
      } catch {
        // Candidate health is retried until the fixed activation deadline.
      }
      if (closing) return "closed" as const;
      await sleep(Math.min(activationPollMs, Math.max(1, deadline - now())));
    }
    return "timed_out" as const;
  };

  const terminalActivation = (state: ActivationResult["state"], message: string) => {
    const metadata = status.activation.metadata;
    if (!metadata) return;
    const at = timestamp();
    saveActivation({
      ...status.activation,
      state,
      message,
      updatedAt: at,
      deadlineAt: null,
      lastResult: { tag: metadata.identity.tag, state, message, at },
    });
  };

  const recoverPrevious = async () => {
    const activation = status.activation;
    const previousPath = activation.previousPath;
    const previousMetadata = activation.previousMetadata;
    if (!previousPath || !previousMetadata) {
      terminalActivation("rollback_failed", `${activation.failureMessage ?? "Atlas activation failed"} The previous release identity is unavailable; automatic rollback could not be verified.`);
      return;
    }
    try {
      if (activation.state === "selecting_previous") {
        // Roll back only to the folder recorded at approval, and only while it is intact.
        if (dirname(resolve(previousPath)) !== releasesRoot || resolve(previousPath) !== candidatePath(previousMetadata) ||
            !await releaseFolderIntact(previousPath, previousMetadata) || !sameMetadata(releaseMetadataAt(previousPath), previousMetadata)) {
          terminalActivation("rollback_failed", `${activation.failureMessage ?? "Atlas activation failed"} The previous release folder is missing or changed; automatic rollback was refused.`);
          return;
        }
        selectRelease(previousPath);
        activationProgress("restarting_previous", "The previous Atlas release was selected; restarting it now.");
      }
      if (status.activation.state === "restarting_previous") {
        if (!await controlAtlas("start")) {
          terminalActivation("rollback_failed", `${status.activation.failureMessage ?? "Atlas activation failed"} The previous release was selected but could not be started.`);
          return;
        }
        activationProgress("validating_previous", "Waiting for the previous Atlas release to recover.");
      }
      if (status.activation.state === "validating_previous") {
        const outcome = await waitForHealth(previousMetadata, status.activation.deadlineAt);
        if (outcome === "closed") return;
        if (outcome !== "healthy") {
          terminalActivation("rollback_failed", `${status.activation.failureMessage ?? "Atlas activation failed"} The previous release did not report its expected identity and healthy storage before the recovery deadline.`);
          return;
        }
        cleanupReleases();
        terminalActivation("rolled_back", `${status.activation.failureMessage ?? "Atlas activation failed"} The previous release recovered successfully.`);
      }
    } catch {
      if (!closing) terminalActivation("rollback_failed", `${status.activation.failureMessage ?? "Atlas activation failed"} The previous release could not be selected and verified.`);
    }
  };

  const failAndRollback = async (message: string) => {
    const metadata = status.activation.metadata;
    if (!metadata) return;
    const failedTags = [...new Set([...status.activation.failedTags, metadata.identity.tag])];
    saveActivation({
      ...status.activation,
      state: "selecting_previous",
      message: `${message} Restoring the previous Atlas release.`,
      failureMessage: message,
      failedTags,
      updatedAt: timestamp(),
      deadlineAt: null,
    });
    await recoverPrevious();
  };

  const activateCurrent = async () => {
    if (activating) return activating;
    activating = (async () => {
      if (["selecting_previous", "restarting_previous", "validating_previous"].includes(status.activation.state)) {
        await recoverPrevious();
        return;
      }
      if (!["requested", "stopping", "selecting", "starting", "validating"].includes(status.activation.state)) return;
      const metadata = status.activation.metadata;
      if (!metadata) return;
      try {
        if (["requested", "stopping"].includes(status.activation.state)) {
          activationProgress("stopping", "Stopping Atlas while OpenCode and credential serving continue.");
          if (!await controlAtlas("stop")) {
            await failAndRollback("Atlas could not be stopped for activation.");
            return;
          }
          if (closing) return;
          activationProgress("selecting", "Selecting the complete staged Atlas release.");
        }
        if (status.activation.state === "selecting") {
          const path = candidatePath(metadata);
          if (!sameMetadata(releaseMetadataAt(path), metadata)) throw new Error("The staged release identity changed before activation.");
          selectRelease(path);
          activationProgress("starting", "The candidate Atlas release was selected; starting it now.");
        }
        if (status.activation.state === "starting") {
          if (!await controlAtlas("start")) {
            await failAndRollback("The candidate Atlas release failed to start.");
            return;
          }
          if (closing) return;
          activationProgress("validating", "Waiting for the candidate to report its exact identity and healthy Atlas storage.");
        }
        if (status.activation.state === "validating") {
          const outcome = await waitForHealth(metadata, status.activation.deadlineAt);
          if (outcome === "closed") return;
          if (outcome !== "healthy") {
            await failAndRollback("The candidate did not report its expected identity and healthy Atlas storage within 60 seconds.");
            return;
          }
          await updateSupportServices(candidatePath(metadata), metadata);
          cleanupReleases();
          terminalActivation("succeeded", `Atlas ${metadata.identity.tag} was activated and verified.`);
        }
      } catch {
        if (!closing) await failAndRollback("The candidate Atlas release could not be selected or verified.");
      }
    })().finally(() => {
      activating = undefined;
    });
    return activating;
  };

  const setProgress = (state: UpdaterStatus["state"], message: string) => save({
    ...status,
    state,
    message,
    updatedAt: timestamp(),
  });

  const stageCurrent = async () => {
    const metadata = status.metadata;
    if (!metadata) return;
    const finalPath = candidatePath(metadata);
    const workPath = join(releasesRoot, `.download-${metadata.identity.tag}`);
    const staged = () => {
      const at = timestamp();
      save({ ...status, state: "staged", stagedPath: finalPath, message: "Release is staged and inactive.", updatedAt: at, lastResult: { tag: metadata.identity.tag, state: "staged", message: "Release is staged and inactive.", at } });
    };
    try {
      mkdirSync(releasesRoot, { recursive: true, mode: 0o755 });
      if (lstatSync(finalPath, { throwIfNoEntry: false })) {
        if (!await releaseFolderIntact(finalPath, metadata)) throw new Error("Existing staged release does not match the request.");
        staged();
        return;
      }

      removeTree(workPath);
      mkdirSync(workPath, { recursive: true, mode: 0o700 });
      const binaryPath = join(workPath, metadata.asset.name);
      const checksumPath = join(workPath, metadata.asset.checksum);
      setProgress("downloading", "Downloading the published Atlas binary.");
      const size = await fetchFile(fetcher, downloadUrl(downloadBaseUrl, metadata.identity.tag, metadata.asset.name), binaryPath, "Release binary", metadata.asset.size);
      if (size !== metadata.asset.size) throw new Error("Release binary size does not match the published metadata.");
      await fetchFile(fetcher, downloadUrl(downloadBaseUrl, metadata.identity.tag, metadata.asset.checksum), checksumPath, "Release checksum", MAX_CHECKSUM_BYTES);

      setProgress("verifying", "Verifying the published Atlas binary.");
      const checksumParts = readFileSync(checksumPath, "utf8").trim().split(/\s+/u);
      if (checksumParts.length !== 2 || checksumParts[0] !== metadata.asset.sha256 || checksumParts[1]!.replace(/^\*/u, "") !== metadata.asset.name) {
        throw new Error("Release checksum sidecar does not match the published metadata.");
      }

      // The builder re-hashes its own copy before anything runs it.
      setProgress("preparing", "Checking the binary's identity and preparing the release folder.");
      await buildReleaseFolder({ binaryPath, metadata, releasesRoot, runAs: options.runAs });
      removeTree(workPath);
      staged();
    } catch (error) {
      try {
        removeTree(workPath);
      } catch {
        // Preserve the staging failure as the durable result even if temporary cleanup also fails.
      }
      const message = error instanceof Error ? error.message : "Release staging failed.";
      const at = timestamp();
      save({ ...status, state: "failed", stagedPath: null, message, updatedAt: at, lastResult: { tag: metadata.identity.tag, state: "failed", message, at } });
    }
  };

  const runStage = () => {
    if (staging) return staging;
    staging = stageCurrent().then(() => {
      if (!activationInProgress(status)) cleanupReleases();
    }).finally(() => {
      staging = undefined;
    });
    return staging;
  };

  const tagFrom = (value: unknown) => {
    if (!validReleaseTag(value)) throw new Error("Release tag is invalid");
    return value;
  };

  /** Refuses anything that is not newer than the active Release (no downgrades). */
  const assertForward = (metadata: ReleaseMetadata) => {
    const active = selectedRelease().metadata;
    if (metadata.identity.build <= active.identity.build) {
      throw new Error(`Atlas ${metadata.identity.tag} is not newer than the active ${active.identity.tag}.`);
    }
  };

  /** The published metadata for `tag`, fetched by the updater itself over HTTPS. */
  const publishedMetadata = async (tag: ReleaseTag) => {
    const text = await fetchText(fetcher, downloadUrl(downloadBaseUrl, tag, "atlas-release.json"), "Release metadata", MAX_METADATA_BYTES);
    let metadata: ReleaseMetadata;
    try {
      metadata = assertReleaseMetadata(JSON.parse(text));
    } catch {
      throw new Error("Release metadata is invalid.");
    }
    if (metadata.identity.tag !== tag) throw new Error("Release metadata does not match the requested tag.");
    return metadata;
  };

  const requestStage = async (tagValue: unknown): Promise<UpdaterStatus> => {
    const tag = tagFrom(tagValue);
    if (requesting) return await requesting;
    if (activeStates.has(status.state) || activationInProgress(status)) return status;
    requesting = (async () => {
      const metadata = await publishedMetadata(tag);
      assertForward(metadata);
      if (activeStates.has(status.state) || activationInProgress(status)) return status;
      return startStage(metadata);
    })().finally(() => {
      requesting = undefined;
    });
    return await requesting;
  };

  const startStage = (metadata: ReleaseMetadata) => {
    const at = timestamp();
    save({
      schemaVersion: 2,
      policy: status.policy,
      state: "requested",
      metadata,
      requestedAt: at,
      updatedAt: at,
      stagedPath: null,
      message: "Release staging was requested.",
      requirements: requirementsFor(metadata, hostRuntime(metadata)),
      lastResult: status.lastResult,
      activation: status.activation,
      cleanup: status.cleanup,
    });
    void runStage();
    return status;
  };

  const setPolicy = (policyValue: unknown) => {
    if (policyValue !== "approval_required" && policyValue !== "automatic") {
      throw new Error("Update policy is invalid");
    }
    if (status.policy !== policyValue) save({ ...status, policy: policyValue });
    return status;
  };

  const prepareActivation = async (tagValue: unknown, retryValue: unknown) => {
    const tag = tagFrom(tagValue);
    if (typeof retryValue !== "boolean") throw new Error("Activation retry value is invalid");
    if (activationInProgress(status)) {
      if (status.activation.metadata?.identity.tag === tag && status.activation.state === "awaiting_checkpoint") return status;
      throw new Error("Another Atlas activation is already in progress.");
    }
    // Only the metadata this updater fetched and staged is ever used.
    const metadata = status.metadata;
    if (!metadata || metadata.identity.tag !== tag) {
      throw new Error("The requested release is not fully staged and host-runtime eligible.");
    }
    const finalPath = candidatePath(metadata);
    if (status.state !== "staged" || status.stagedPath !== finalPath) {
      throw new Error("The requested release is not fully staged and host-runtime eligible.");
    }
    const requirements = requirementsFor(metadata, hostRuntime(metadata));
    if (JSON.stringify(status.requirements) !== JSON.stringify(requirements)) save({ ...status, requirements });
    if (requirements.unmet.length > 0) throw new Error("The requested release is not fully staged and host-runtime eligible.");
    if (!metadata.rollback.codeOnlyCompatible) throw new Error("The requested release requires manual maintenance.");
    if (!existsSync(finalPath) || realpathSync(finalPath) !== finalPath || !lstatSync(finalPath).isDirectory() ||
        !sameMetadata(releaseMetadataAt(finalPath), metadata) || !await releaseFolderIntact(finalPath, metadata)) {
      throw new Error("The staged release identity could not be verified.");
    }
    const previous = selectedRelease();
    if (previous.path === finalPath) throw new Error("The requested release is already active.");
    assertForward(metadata);
    const suppressed = status.activation.failedTags.includes(metadata.identity.tag);
    if (suppressed && !retryValue) throw new Error("This failed release requires an explicit Retry.");
    if (!suppressed && retryValue) throw new Error("This release does not require Retry.");
    const at = timestamp();
    saveActivation({
      ...status.activation,
      state: "awaiting_checkpoint",
      metadata,
      previousPath: previous.path,
      previousMetadata: previous.metadata,
      requestedAt: at,
      updatedAt: at,
      deadlineAt: null,
      message: "Approval was recorded; waiting for Atlas preparation and handoff to reach a safe checkpoint.",
      failureMessage: null,
      retry: retryValue,
    });
    return status;
  };

  const beginActivation = (tagValue: unknown) => {
    const tag = tagFrom(tagValue);
    const matches = status.activation.metadata?.identity.tag === tag;
    if (matches && activationInProgress(status) && status.activation.state !== "awaiting_checkpoint") {
      return status;
    }
    if (status.activation.state !== "awaiting_checkpoint" || !matches) {
      throw new Error("Activation has no matching confirmed safe checkpoint.");
    }
    activationProgress("requested", "The safe checkpoint is confirmed; host activation was requested.");
    void activateCurrent();
    return status;
  };

  const abandonActivation = (tagValue: unknown, messageValue: unknown) => {
    const tag = tagFrom(tagValue);
    if (typeof messageValue !== "string" || !messageValue || messageValue.length > 2_000) {
      throw new Error("Activation abandonment reason is invalid");
    }
    const matches = status.activation.metadata?.identity.tag === tag;
    if (matches && ["abandoned", "succeeded", "rolled_back", "rollback_failed"].includes(status.activation.state)) {
      return status;
    }
    if (status.activation.state !== "awaiting_checkpoint" || !matches) {
      throw new Error("Activation cannot be abandoned from its current state.");
    }
    terminalActivation("abandoned", messageValue);
    cleanupReleases();
    return status;
  };

  const close = () => {
    closing = true;
    const current = server;
    if (!current) return;
    server = undefined;
    try {
      current.close();
    } catch {
      // Process exit releases the listener even if close races a request.
    }
    try {
      if (existsSync(socketPath) && lstatSync(socketPath).isSocket()) unlinkSync(socketPath);
    } catch {
      // Remove only this service's runtime socket on a best-effort basis.
    }
  };

  const start = async () => {
    if (server) return;
    closing = false;
    const key = readKey(keyPath);
    mkdirSync(dirname(socketPath), { recursive: true, mode: 0o750 });
    if (existsSync(socketPath)) {
      if (!lstatSync(socketPath).isSocket() || await socketInUse()) throw new Error("Updater socket path is already in use");
      unlinkSync(socketPath);
    }
    await new Promise<void>((resolveStart, rejectStart) => {
      server = createServer((socket) => {
        let buffer = "";
        socket.setTimeout(60_000, () => socket.destroy());
        socket.on("error", () => socket.destroy());
        let handled = false;
        socket.on("data", (chunk: Buffer | string) => {
          if (handled) return;
          buffer += chunk.toString();
          if (Buffer.byteLength(buffer) > MAX_MESSAGE_BYTES) return socket.destroy();
          const newline = buffer.indexOf("\n");
          if (newline < 0) return;
          handled = true;
          const respond = async (): Promise<UpdaterResponse> => {
            try {
              const request = JSON.parse(buffer.slice(0, newline)) as UpdaterRequest;
              if (!request || typeof request !== "object" || typeof request.key !== "string" || !keysMatch(request.key, key)) throw new Error();
              switch (request.operation) {
                case "status": return { ok: true, status };
                case "set_policy": return { ok: true, status: setPolicy(request.policy) };
                case "stage": return { ok: true, status: await requestStage(request.tag) };
                case "prepare_activation": return { ok: true, status: await prepareActivation(request.tag, request.retry) };
                case "activate": return { ok: true, status: beginActivation(request.tag) };
                case "abandon_activation": return { ok: true, status: abandonActivation(request.tag, request.message) };
                default: return { ok: false, error: "Updater request was rejected." };
              }
            } catch {
              return { ok: false, error: "Updater request was rejected." };
            }
          };
          void respond().then((response) => socket.end(`${JSON.stringify(response)}\n`));
        });
      });
      server.once("error", rejectStart);
      server.listen(socketPath, () => {
        try {
          chmodSync(socketPath, 0o660);
          resolveStart();
        } catch (error) {
          rejectStart(error);
        }
      });
    });
    if (activeStates.has(status.state) && status.metadata) void runStage();
    if (status.activation.state === "awaiting_checkpoint" && status.activation.metadata) {
      abandonActivation(status.activation.metadata.identity.tag, "Activation was abandoned because the updater restarted before Atlas confirmed a safe checkpoint.");
    } else if (activationInProgress(status)) {
      void activateCurrent();
    } else if (!activeStates.has(status.state)) {
      cleanupReleases();
    }
  };

  return { start, close, status: () => status, setPolicy, requestStage, prepareActivation, beginActivation, abandonActivation };
};

export type UpdaterClientOptions = { socketPath?: string; keyPath?: string };

export const createUpdaterClient = (options: UpdaterClientOptions = {}): UpdaterClient => {
  const socketPath = resolve(options.socketPath ?? process.env.ATLAS_UPDATER_SOCKET ?? DEFAULT_SOCKET_PATH);
  const keyPath = resolve(options.keyPath ?? process.env.ATLAS_UPDATER_KEY_PATH ?? DEFAULT_KEY_PATH);
  const request = async (payload:
    | { operation: "status" }
    | { operation: "set_policy"; policy: UpdatePolicy }
    | { operation: "stage"; tag: string }
    | { operation: "prepare_activation"; tag: string; retry: boolean }
    | { operation: "activate"; tag: string }
    | { operation: "abandon_activation"; tag: string; message: string }) => {
    const encoded = `${JSON.stringify({ ...payload, key: readKey(keyPath) })}\n`;
    if (Buffer.byteLength(encoded) > MAX_MESSAGE_BYTES) throw new Error("Updater request is too large");
    return await new Promise<UpdaterStatus>((resolveStatus, reject) => {
      const socket = connect(socketPath);
      let buffer = "";
      let settled = false;
      const finish = (error?: Error, response?: UpdaterResponse) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (error) return reject(error);
        if (!response?.ok) return reject(new Error(response?.error ?? "Updater request failed."));
        try {
          resolveStatus(parseStatus(response.status));
        } catch {
          reject(new Error("Updater returned invalid status."));
        }
      };
      // Staging first fetches the Release metadata, so allow for a slow network.
      socket.setTimeout(60_000, () => finish(new Error("Updater request timed out.")));
      socket.on("error", () => finish(new Error("Updater service is unavailable.")));
      socket.on("connect", () => socket.write(encoded));
      socket.on("data", (chunk: Buffer | string) => {
        buffer += chunk.toString();
        if (Buffer.byteLength(buffer) > MAX_MESSAGE_BYTES) return finish(new Error("Updater response is too large."));
        const newline = buffer.indexOf("\n");
        if (newline < 0) return;
        try {
          finish(undefined, JSON.parse(buffer.slice(0, newline)) as UpdaterResponse);
        } catch {
          finish(new Error("Updater returned invalid status."));
        }
      });
    });
  };
  return {
    status: () => request({ operation: "status" }),
    setPolicy: (policy) => request({ operation: "set_policy", policy }),
    stage: (metadata) => request({ operation: "stage", tag: metadata.identity.tag }),
    prepareActivation: (metadata, retry) => request({ operation: "prepare_activation", tag: metadata.identity.tag, retry }),
    activate: (metadata) => request({ operation: "activate", tag: metadata.identity.tag }),
    abandonActivation: (metadata, message) => request({ operation: "abandon_activation", tag: metadata.identity.tag, message }),
  };
};
