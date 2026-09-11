import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { connect, createServer, type Server } from "node:net";
import { dirname, join, resolve } from "node:path";
import { assertReleaseMetadata, type ReleaseMetadata } from "./release.ts";

const DEFAULT_STATE_PATH = "/var/lib/atlas/update-state.json";
const DEFAULT_SOCKET_PATH = "/run/atlas-updater/updater.sock";
const DEFAULT_KEY_PATH = "/etc/atlas/updater.key";
const DEFAULT_RELEASES_ROOT = "/opt/atlas/releases";
const DEFAULT_DOWNLOAD_BASE = "https://github.com/SandunRathsara/atlas/releases/download";
const MAX_MESSAGE_BYTES = 256 * 1024;
const MAX_ARTIFACT_BYTES = 1024 * 1024 * 1024;
const activeStates = new Set<UpdaterStatus["state"]>(["requested", "downloading", "verifying", "extracting"]);
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
  tag: string;
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
  failedTags: string[];
  lastResult: ActivationResult | null;
};

export const activationInProgress = (status: Pick<UpdaterStatus, "activation">) =>
  activeActivationStates.has(status.activation.state);

export type HostRuntime = { bun: string | null; git: string | null; gh: string | null };

export type RuntimeRequirements = {
  required: ReleaseMetadata["runtime"];
  available: HostRuntime;
  unmet: string[];
};

export type UpdaterResult = {
  tag: string;
  state: "staged" | "failed";
  message: string;
  at: string;
};

export type UpdaterStatus = {
  schemaVersion: 1;
  state: "idle" | "requested" | "downloading" | "verifying" | "extracting" | "staged" | "failed";
  metadata: ReleaseMetadata | null;
  requestedAt: string | null;
  updatedAt: string | null;
  stagedPath: string | null;
  message: string;
  requirements: RuntimeRequirements | null;
  lastResult: UpdaterResult | null;
  activation: ActivationStatus;
};

export type UpdaterClient = {
  status: () => Promise<UpdaterStatus>;
  stage: (metadata: ReleaseMetadata) => Promise<UpdaterStatus>;
  prepareActivation: (metadata: ReleaseMetadata, retry: boolean) => Promise<UpdaterStatus>;
  activate: (metadata: ReleaseMetadata) => Promise<UpdaterStatus>;
  abandonActivation: (metadata: ReleaseMetadata, message: string) => Promise<UpdaterStatus>;
};

type UpdaterRequest =
  | { key: string; operation: "status" }
  | { key: string; operation: "stage"; metadata: ReleaseMetadata }
  | { key: string; operation: "prepare_activation"; metadata: ReleaseMetadata; retry: boolean }
  | { key: string; operation: "activate"; metadata: ReleaseMetadata }
  | { key: string; operation: "abandon_activation"; metadata: ReleaseMetadata; message: string };

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

const initialStatus = (): UpdaterStatus => ({
  schemaVersion: 1,
  state: "idle",
  metadata: null,
  requestedAt: null,
  updatedAt: null,
  stagedPath: null,
  message: "No release has been staged yet.",
  requirements: null,
  lastResult: null,
  activation: initialActivation(),
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
      !Array.isArray(activation.failedTags) || !activation.failedTags.every((tag) => typeof tag === "string") ||
      lastResult === undefined || (lastResult !== null && (typeof lastResult.tag !== "string" ||
        !["succeeded", "rolled_back", "rollback_failed", "abandoned"].includes(lastResult.state ?? "") ||
        typeof lastResult.message !== "string" || typeof lastResult.at !== "string"))) {
    throw new Error("Updater activation state is invalid");
  }
  if (activation.state !== "idle" && activation.metadata === null) throw new Error("Updater activation state is invalid");
  return activation as ActivationStatus;
};

const parseStatus = (value: unknown): UpdaterStatus => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Updater state is invalid");
  const status = value as Partial<UpdaterStatus>;
  const requirements = status.requirements as Partial<RuntimeRequirements> | null | undefined;
  const available = requirements?.available as Partial<HostRuntime> | undefined;
  const lastResult = status.lastResult as Partial<UpdaterResult> | null | undefined;
  if (status.schemaVersion !== 1 || typeof status.state !== "string" ||
      !["idle", "requested", "downloading", "verifying", "extracting", "staged", "failed"].includes(status.state) ||
      status.metadata === undefined || (status.metadata !== null && !assertReleaseMetadata(status.metadata)) ||
      ![status.requestedAt, status.updatedAt, status.stagedPath].every((item) => item === null || typeof item === "string") ||
      typeof status.message !== "string" || requirements === undefined ||
      (requirements !== null && (!requirements.required || typeof requirements.required !== "object" || !available ||
        ![available.bun, available.git, available.gh].every((item) => item === null || typeof item === "string") ||
        !Array.isArray(requirements.unmet) || !requirements.unmet.every((item) => typeof item === "string"))) ||
      lastResult === undefined || (lastResult !== null && (typeof lastResult.tag !== "string" ||
        !["staged", "failed"].includes(lastResult.state ?? "") || typeof lastResult.message !== "string" || typeof lastResult.at !== "string"))) {
    throw new Error("Updater state is invalid");
  }
  if (status.state !== "idle" && status.metadata === null) throw new Error("Updater state is invalid");
  return { ...status, activation: parseActivation(status.activation) } as UpdaterStatus;
};

const readStatusFile = (path: string) => {
  if (!existsSync(path)) return initialStatus();
  return parseStatus(JSON.parse(readFileSync(path, "utf8")));
};

const writeStatusFile = (path: string, status: UpdaterStatus) => {
  mkdirSync(dirname(path), { recursive: true, mode: 0o750 });
  const temporary = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(status)}\n`, { encoding: "utf8", mode: 0o640 });
  chmodSync(temporary, 0o640);
  renameSync(temporary, path);
};

const metadataRecord = (metadata: ReleaseMetadata) => JSON.stringify({
  schemaVersion: metadata.schemaVersion,
  identity: metadata.identity,
  artifact: metadata.artifact,
  runtime: metadata.runtime,
  rollback: metadata.rollback,
});

const requirementsFor = (metadata: ReleaseMetadata, available: HostRuntime): RuntimeRequirements => {
  const labels = { bun: "Bun", git: "Git", gh: "gh" } as const;
  const unmet = (Object.keys(labels) as Array<keyof HostRuntime>).flatMap((name) =>
    available[name] === metadata.runtime[name]
      ? []
      : [`${labels[name]} ${metadata.runtime[name]} is required; this host reports ${available[name] ?? "unknown"}.`],
  );
  return { required: metadata.runtime, available, unmet };
};

const downloadUrl = (base: string, tag: string, name: string) =>
  `${base.replace(/\/$/u, "")}/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;

const fetchFile = async (fetcher: typeof fetch, url: string, path: string, label: string) => {
  let response: Response;
  try {
    response = await fetcher(url, { headers: { "User-Agent": "Atlas updater" }, redirect: "follow" });
  } catch {
    throw new Error(`${label} download failed.`);
  }
  if (!response.ok) throw new Error(`${label} download failed (HTTP ${response.status}).`);
  const declaredLength = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ARTIFACT_BYTES) throw new Error(`${label} is too large.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_ARTIFACT_BYTES) throw new Error(`${label} is too large.`);
  writeFileSync(path, bytes, { mode: 0o600, flag: "wx" });
};

const makeReadOnly = (path: string) => {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    for (const name of readdirSync(path)) makeReadOnly(join(path, name));
    chmodSync(path, 0o555);
    return;
  }
  if (stat.isFile()) chmodSync(path, stat.mode & 0o111 ? 0o555 : 0o444);
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
  sleep?: (milliseconds: number) => Promise<void>;
};

export const createUpdaterService = (options: UpdaterServiceOptions = {}) => {
  const statePath = resolve(options.statePath ?? DEFAULT_STATE_PATH);
  const socketPath = resolve(options.socketPath ?? DEFAULT_SOCKET_PATH);
  const keyPath = resolve(options.keyPath ?? DEFAULT_KEY_PATH);
  const releasesRoot = resolve(options.releasesRoot ?? DEFAULT_RELEASES_ROOT);
  const downloadBaseUrl = options.downloadBaseUrl ?? DEFAULT_DOWNLOAD_BASE;
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const hostRuntime = options.hostRuntime ?? (() => ({ bun: Bun.version, git: null, gh: null }));
  const currentPath = resolve(options.currentPath ?? "/opt/atlas/current");
  const activationTimeoutMs = options.activationTimeoutMs ?? ACTIVATION_HEALTH_TIMEOUT_MS;
  const activationPollMs = options.activationPollMs ?? 1_000;
  const controlAtlas = options.controlAtlas ?? (() => false);
  const checkAtlasHealth = options.checkAtlasHealth ?? (() => false);
  const sleep = options.sleep ?? Bun.sleep;
  if (!Number.isSafeInteger(activationTimeoutMs) || activationTimeoutMs < 1 ||
      !Number.isSafeInteger(activationPollMs) || activationPollMs < 1) {
    throw new Error("Updater activation timing must use positive safe integers");
  }
  let status = readStatusFile(statePath);
  let server: Server | undefined;
  let staging: Promise<void> | undefined;
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
  const candidatePath = (metadata: ReleaseMetadata) => join(releasesRoot, `atlas-${metadata.identity.tag}`);
  const sameMetadata = (left: ReleaseMetadata | null, right: ReleaseMetadata) =>
    left !== null && metadataRecord(left) === metadataRecord(right);

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
    const workPath = join(releasesRoot, `.staging-${metadata.identity.tag}`);
    try {
      mkdirSync(releasesRoot, { recursive: true, mode: 0o755 });
      if (existsSync(finalPath)) {
        const stat = lstatSync(finalPath);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Existing staged release path is unsafe.");
        const embedded = assertReleaseMetadata(JSON.parse(readFileSync(join(finalPath, "RELEASE_METADATA.json"), "utf8")));
        if (metadataRecord(embedded) !== metadataRecord(metadata)) throw new Error("Existing staged release identity does not match the request.");
        makeReadOnly(finalPath);
        const at = timestamp();
        save({ ...status, state: "staged", stagedPath: finalPath, message: "Release is staged and inactive.", updatedAt: at, lastResult: { tag: metadata.identity.tag, state: "staged", message: "Release is staged and inactive.", at } });
        return;
      }

      removeTree(workPath);
      mkdirSync(workPath, { recursive: true, mode: 0o700 });
      const archivePath = join(workPath, metadata.artifact.name);
      const checksumPath = join(workPath, metadata.artifact.checksum);
      setProgress("downloading", "Downloading the published release archive.");
      await fetchFile(fetcher, downloadUrl(downloadBaseUrl, metadata.identity.tag, metadata.artifact.name), archivePath, "Release archive");
      await fetchFile(fetcher, downloadUrl(downloadBaseUrl, metadata.identity.tag, metadata.artifact.checksum), checksumPath, "Release checksum");

      setProgress("verifying", "Verifying the published release archive.");
      const checksumParts = readFileSync(checksumPath, "utf8").trim().split(/\s+/u);
      const digest = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
      if (checksumParts.length !== 2 || checksumParts[0] !== digest || checksumParts[1]!.replace(/^\*/u, "") !== metadata.artifact.name) {
        throw new Error("Release archive checksum does not match its published sidecar.");
      }

      setProgress("extracting", "Extracting and validating the complete release tree.");
      const extractPath = join(workPath, "extract");
      mkdirSync(extractPath, { mode: 0o700 });
      const extraction = Bun.spawnSync([
        "tar", "--extract", "--gzip", "--file", archivePath, "--directory", extractPath,
        "--no-same-owner", "--no-same-permissions",
      ], { stdout: "ignore", stderr: "ignore" });
      if (extraction.exitCode !== 0) throw new Error("Release archive could not be extracted.");
      const expectedRoot = `atlas-${metadata.identity.tag}`;
      const extractedEntries = readdirSync(extractPath);
      const extractedRoot = join(extractPath, expectedRoot);
      if (extractedEntries.length !== 1 || extractedEntries[0] !== expectedRoot || !lstatSync(extractedRoot).isDirectory()) {
        throw new Error("Release archive does not contain one complete release tree.");
      }
      const embedded = assertReleaseMetadata(JSON.parse(readFileSync(join(extractedRoot, "RELEASE_METADATA.json"), "utf8")));
      if (metadataRecord(embedded) !== metadataRecord(metadata)) throw new Error("Staged release identity does not match its published metadata.");
      renameSync(extractedRoot, finalPath);
      makeReadOnly(finalPath);
      removeTree(workPath);
      const at = timestamp();
      save({ ...status, state: "staged", stagedPath: finalPath, message: "Release is staged and inactive.", updatedAt: at, lastResult: { tag: metadata.identity.tag, state: "staged", message: "Release is staged and inactive.", at } });
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
    staging = stageCurrent().finally(() => {
      staging = undefined;
    });
    return staging;
  };

  const requestStage = (metadataValue: unknown) => {
    const metadata = assertReleaseMetadata(metadataValue);
    if (activeStates.has(status.state) || activationInProgress(status)) return status;
    const at = timestamp();
    save({
      schemaVersion: 1,
      state: "requested",
      metadata,
      requestedAt: at,
      updatedAt: at,
      stagedPath: null,
      message: "Release staging was requested.",
      requirements: requirementsFor(metadata, hostRuntime(metadata)),
      lastResult: status.lastResult,
      activation: status.activation,
    });
    void runStage();
    return status;
  };

  const prepareActivation = (metadataValue: unknown, retryValue: unknown) => {
    const metadata = assertReleaseMetadata(metadataValue);
    if (typeof retryValue !== "boolean") throw new Error("Activation retry value is invalid");
    if (activationInProgress(status)) {
      if (sameMetadata(status.activation.metadata, metadata) && status.activation.state === "awaiting_checkpoint") return status;
      throw new Error("Another Atlas activation is already in progress.");
    }
    const finalPath = candidatePath(metadata);
    if (status.state !== "staged" || status.stagedPath !== finalPath || !sameMetadata(status.metadata, metadata) ||
        status.requirements === null || status.requirements.unmet.length > 0) {
      throw new Error("The requested release is not fully staged and host-runtime eligible.");
    }
    if (!metadata.rollback.codeOnlyCompatible) throw new Error("The requested release requires manual maintenance.");
    if (!existsSync(finalPath) || realpathSync(finalPath) !== finalPath || !lstatSync(finalPath).isDirectory() ||
        !sameMetadata(releaseMetadataAt(finalPath), metadata)) {
      throw new Error("The staged release identity could not be verified.");
    }
    const previous = selectedRelease();
    if (previous.path === finalPath) throw new Error("The requested release is already active.");
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

  const beginActivation = (metadataValue: unknown) => {
    const metadata = assertReleaseMetadata(metadataValue);
    if (sameMetadata(status.activation.metadata, metadata) &&
        ["requested", "stopping", "selecting", "starting", "validating", "selecting_previous", "restarting_previous", "validating_previous"].includes(status.activation.state)) {
      return status;
    }
    if (status.activation.state !== "awaiting_checkpoint" || !sameMetadata(status.activation.metadata, metadata)) {
      throw new Error("Activation has no matching confirmed safe checkpoint.");
    }
    activationProgress("requested", "The safe checkpoint is confirmed; host activation was requested.");
    void activateCurrent();
    return status;
  };

  const abandonActivation = (metadataValue: unknown, messageValue: unknown) => {
    const metadata = assertReleaseMetadata(metadataValue);
    if (typeof messageValue !== "string" || !messageValue || messageValue.length > 2_000) {
      throw new Error("Activation abandonment reason is invalid");
    }
    if (sameMetadata(status.activation.metadata, metadata) && ["abandoned", "succeeded", "rolled_back", "rollback_failed"].includes(status.activation.state)) {
      return status;
    }
    if (status.activation.state !== "awaiting_checkpoint" || !sameMetadata(status.activation.metadata, metadata)) {
      throw new Error("Activation cannot be abandoned from its current state.");
    }
    terminalActivation("abandoned", messageValue);
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
        socket.setTimeout(10_000, () => socket.destroy());
        socket.on("error", () => socket.destroy());
        socket.on("data", (chunk: Buffer | string) => {
          buffer += chunk.toString();
          if (Buffer.byteLength(buffer) > MAX_MESSAGE_BYTES) return socket.destroy();
          const newline = buffer.indexOf("\n");
          if (newline < 0) return;
          let response: UpdaterResponse;
          try {
            const request = JSON.parse(buffer.slice(0, newline)) as UpdaterRequest;
            if (!request || typeof request !== "object" || typeof request.key !== "string" || !keysMatch(request.key, key)) throw new Error();
            response = request.operation === "status"
              ? { ok: true, status }
              : request.operation === "stage"
                ? { ok: true, status: requestStage(request.metadata) }
                : request.operation === "prepare_activation"
                  ? { ok: true, status: prepareActivation(request.metadata, request.retry) }
                  : request.operation === "activate"
                    ? { ok: true, status: beginActivation(request.metadata) }
                    : request.operation === "abandon_activation"
                      ? { ok: true, status: abandonActivation(request.metadata, request.message) }
                      : { ok: false, error: "Updater request was rejected." };
          } catch {
            response = { ok: false, error: "Updater request was rejected." };
          }
          socket.end(`${JSON.stringify(response)}\n`);
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
      abandonActivation(status.activation.metadata, "Activation was abandoned because the updater restarted before Atlas confirmed a safe checkpoint.");
    } else if (activationInProgress(status)) {
      void activateCurrent();
    }
  };

  return { start, close, status: () => status, requestStage, prepareActivation, beginActivation, abandonActivation };
};

export type UpdaterClientOptions = { socketPath?: string; keyPath?: string };

export const createUpdaterClient = (options: UpdaterClientOptions = {}): UpdaterClient => {
  const socketPath = resolve(options.socketPath ?? process.env.ATLAS_UPDATER_SOCKET ?? DEFAULT_SOCKET_PATH);
  const keyPath = resolve(options.keyPath ?? process.env.ATLAS_UPDATER_KEY_PATH ?? DEFAULT_KEY_PATH);
  const request = async (payload:
    | { operation: "status" }
    | { operation: "stage"; metadata: ReleaseMetadata }
    | { operation: "prepare_activation"; metadata: ReleaseMetadata; retry: boolean }
    | { operation: "activate"; metadata: ReleaseMetadata }
    | { operation: "abandon_activation"; metadata: ReleaseMetadata; message: string }) => {
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
      socket.setTimeout(10_000, () => finish(new Error("Updater request timed out.")));
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
    stage: (metadata) => request({ operation: "stage", metadata }),
    prepareActivation: (metadata, retry) => request({ operation: "prepare_activation", metadata, retry }),
    activate: (metadata) => request({ operation: "activate", metadata }),
    abandonActivation: (metadata, message) => request({ operation: "abandon_activation", metadata, message }),
  };
};
