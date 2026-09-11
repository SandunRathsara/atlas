import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
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
};

export type UpdaterClient = {
  status: () => Promise<UpdaterStatus>;
  stage: (metadata: ReleaseMetadata) => Promise<UpdaterStatus>;
};

type UpdaterRequest =
  | { key: string; operation: "status" }
  | { key: string; operation: "stage"; metadata: ReleaseMetadata };

type UpdaterResponse =
  | { ok: true; status: UpdaterStatus }
  | { ok: false; error: string };

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
  return status as UpdaterStatus;
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
  let status = readStatusFile(statePath);
  let server: Server | undefined;
  let staging: Promise<void> | undefined;

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
    if (activeStates.has(status.state)) return status;
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
    });
    void runStage();
    return status;
  };

  const close = () => {
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
  };

  return { start, close, status: () => status, requestStage };
};

export type UpdaterClientOptions = { socketPath?: string; keyPath?: string };

export const createUpdaterClient = (options: UpdaterClientOptions = {}): UpdaterClient => {
  const socketPath = resolve(options.socketPath ?? process.env.ATLAS_UPDATER_SOCKET ?? DEFAULT_SOCKET_PATH);
  const keyPath = resolve(options.keyPath ?? process.env.ATLAS_UPDATER_KEY_PATH ?? DEFAULT_KEY_PATH);
  const request = async (payload: { operation: "status" } | { operation: "stage"; metadata: ReleaseMetadata }) => {
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
  };
};
