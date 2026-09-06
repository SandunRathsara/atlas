import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createPrivateKey, createSign, randomBytes, timingSafeEqual } from "node:crypto";
import { connect, createServer, type Server } from "node:net";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const DEFAULT_GITHUB_ENV = join(homedir(), ".config", "atlas", "github.env");
const DEFAULT_REGISTRY = join(homedir(), ".config", "atlas", "session-scopes.json");
const DEFAULT_SOCKET = join(homedir(), ".config", "atlas", "supplier.sock");
const DEFAULT_KEY = join(homedir(), ".config", "atlas", "supplier.key");
const DEFAULT_API_URL = "https://api.github.com";
const DEFAULT_API_VERSION = "2026-03-10";
const MAX_REQUEST_BYTES = 64 * 1024;
const TOKEN_RENEWAL_MARGIN_MS = 5 * 60 * 1000;

export class CredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialError";
  }
}

type GithubEnv = Record<string, string>;

export type CredentialScope = {
  atlasId: string;
  directory: string;
  repositoryId: string;
  fullName: string;
};

type Registry = {
  version: 1;
  scopes: CredentialScope[];
};

type SupplierRequest = {
  key: string;
  operation: "git" | "gh" | "preflight";
  sessionDirectory: string;
  protocol?: string;
  host?: string;
  path?: string;
  requestedRepository?: string;
};

type SupplierResponse =
  | { ok: true; username: "x-access-token"; password: string; expiresAt: string }
  | { ok: false; error: string };

type CredentialBoundaryOptions = {
  credentialsPath?: string;
  registryPath?: string;
  socketPath?: string;
  keyPath?: string;
  apiUrl?: string;
  apiVersion?: string;
  authorizedRepositories?: readonly string[];
  fetcher?: typeof fetch;
  /** Only test callers may explicitly provide a static, already scoped token. */
  staticToken?: string;
  allowStaticToken?: boolean;
};

type CachedToken = {
  token: string;
  expiresAt: string;
  expiresAtMs: number;
};

const normalizedRepository = (value: string) => value.trim().toLocaleLowerCase("en-US");

const assertRestrictedFile = (path: string, label: string) => {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    throw new CredentialError(`${label} is unavailable`);
  }

  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  if (!stat.isFile() || (stat.mode & 0o077) !== 0 || (uid !== undefined && stat.uid !== uid)) {
    throw new CredentialError(`${label} must be a private regular file`);
  }
  return stat;
};

const parseEnvValue = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (typeof parsed === "string") return parsed;
    } catch {
      throw new CredentialError("GitHub credential configuration is malformed");
    }
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

export const readGithubEnvFile = (path = DEFAULT_GITHUB_ENV): GithubEnv => {
  assertRestrictedFile(path, "GitHub credential file");
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch {
    throw new CredentialError("GitHub credential file could not be read");
  }

  const values: GithubEnv = {};
  for (const line of contents.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/u.exec(trimmed);
    if (!match) throw new CredentialError("GitHub credential configuration is malformed");
    values[match[1]!] = parseEnvValue(match[2]!);
  }
  return values;
};

/** Load only the server-side GitHub settings; never echoes values. */
export const loadGithubEnv = (path = DEFAULT_GITHUB_ENV) => {
  if (!existsSync(path)) return {};
  const values = readGithubEnvFile(path);
  for (const name of [
    "ATLAS_GITHUB_ORGANIZATION",
    "ATLAS_GITHUB_APP_ID",
    "ATLAS_GITHUB_INSTALLATION_ID",
    "ATLAS_GITHUB_APP_PRIVATE_KEY_PATH",
    "ATLAS_GITHUB_INSTALLATION_TOKEN",
  ]) {
    if (process.env[name] === undefined && values[name] !== undefined) process.env[name] = values[name];
  }
  return values;
};

const ensurePrivateDirectory = (path: string) => {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
};

const canonicalPath = (path: string) => {
  const absolute = resolve(path);
  const tail: string[] = [];
  let current = absolute;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return absolute;
    tail.push(current.slice(parent.length + 1));
    current = parent;
  }
  return join(realpathSync.native(current), ...tail.reverse());
};

const isWithin = (root: string, candidate: string) => {
  const remainder = relative(root, candidate);
  return remainder === "" || (remainder !== ".." && !remainder.startsWith(`..${"/"}`) && !isAbsolute(remainder));
};

const readRegistry = (path: string): Registry => {
  if (!existsSync(path)) return { version: 1, scopes: [] };
  assertRestrictedFile(path, "Session scope registry");
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<Registry>;
    if (parsed.version !== 1 || !Array.isArray(parsed.scopes)) throw new Error();
    if (!parsed.scopes.every((scope) =>
      scope && typeof scope === "object" &&
      typeof scope.atlasId === "string" &&
      typeof scope.directory === "string" && isAbsolute(scope.directory) &&
      typeof scope.repositoryId === "string" && typeof scope.fullName === "string",
    )) throw new Error();
    return { version: 1, scopes: parsed.scopes as CredentialScope[] };
  } catch {
    throw new CredentialError("Session scope registry is invalid");
  }
};

const writeRegistry = (path: string, registry: Registry) => {
  ensurePrivateDirectory(dirname(path));
  const temporary = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  writeFileSync(temporary, JSON.stringify(registry), { encoding: "utf8", mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
  chmodSync(path, 0o600);
};

const readSupplierKey = (path: string) => {
  assertRestrictedFile(path, "Credential supplier key");
  const key = readFileSync(path, "utf8").trim();
  if (key.length < 32) throw new CredentialError("Credential supplier key is invalid");
  return key;
};

const keyMatches = (provided: string, expected: string) => {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
};

const base64Url = (value: string | Uint8Array) => Buffer.from(value).toString("base64url");

const appJwt = (appId: string, privateKeyPath: string) => {
  if (!/^\d+$/u.test(appId)) throw new CredentialError("GitHub App ID is invalid");
  assertRestrictedFile(privateKeyPath, "GitHub App private key");
  let privateKey: string;
  try {
    privateKey = readFileSync(privateKeyPath, "utf8");
  } catch {
    throw new CredentialError("GitHub App private key could not be read");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({ iat: now - 30, exp: now + 9 * 60, iss: appId }));
  const unsigned = `${header}.${payload}`;
  try {
    const signer = createSign("RSA-SHA256");
    signer.update(unsigned);
    signer.end();
    return `${unsigned}.${signer.sign(createPrivateKey(privateKey), "base64url")}`;
  } catch {
    throw new CredentialError("GitHub App private key is invalid");
  }
};

const safeApiUrl = (value: string) => {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error();
    return url.toString().replace(/\/$/u, "");
  } catch {
    throw new CredentialError("GitHub API URL is invalid");
  }
};

const validCredentialRequest = (request: SupplierRequest) => {
  if (!request.sessionDirectory || !isAbsolute(request.sessionDirectory) || request.sessionDirectory.length > 4096) return false;
  if (request.operation === "git") {
    return request.protocol === "https" && request.host === "github.com" &&
      typeof request.path === "string" && /^\/?[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/u.test(request.path);
  }
  return request.operation === "gh" || request.operation === "preflight";
};

const repositoryFromGitPath = (path: string) => path.replace(/^\//u, "").replace(/\.git$/u, "");

export const requestCredential = async (request: Omit<SupplierRequest, "key">, options: { socketPath?: string; keyPath?: string } = {}) => {
  const socketPath = options.socketPath ?? process.env.ATLAS_SUPPLIER_SOCKET ?? DEFAULT_SOCKET;
  const keyPath = options.keyPath ?? process.env.ATLAS_SUPPLIER_KEY_PATH ?? DEFAULT_KEY;
  const key = readSupplierKey(keyPath);
  const payload: SupplierRequest = { ...request, key };
  const encoded = `${JSON.stringify(payload)}\n`;
  if (Buffer.byteLength(encoded) > MAX_REQUEST_BYTES) throw new CredentialError("Credential request is too large");

  return await new Promise<Extract<SupplierResponse, { ok: true }>>((resolveResponse, reject) => {
    let settled = false;
    let buffer = "";
    const socket = connect(socketPath);
    const finish = (error?: Error, response?: SupplierResponse) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) {
        reject(error);
        return;
      }
      if (!response || !response.ok) {
        reject(new CredentialError("Credential supplier rejected the request"));
        return;
      }
      resolveResponse(response);
    };

    socket.setTimeout(5000, () => finish(new CredentialError("Credential supplier timed out")));
    socket.on("error", () => finish(new CredentialError("Credential supplier is unavailable")));
    socket.on("data", (chunk: Buffer | string) => {
      buffer += chunk.toString();
      if (Buffer.byteLength(buffer) > MAX_REQUEST_BYTES) {
        finish(new CredentialError("Credential supplier response is too large"));
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      try {
        finish(undefined, JSON.parse(buffer.slice(0, newline)) as SupplierResponse);
      } catch {
        finish(new CredentialError("Credential supplier returned an invalid response"));
      }
    });
    socket.on("connect", () => socket.write(encoded));
  });
};

export const createCredentialBoundary = (options: CredentialBoundaryOptions = {}) => {
  const credentialsPath = options.credentialsPath ?? DEFAULT_GITHUB_ENV;
  const registryPath = options.registryPath ?? DEFAULT_REGISTRY;
  const socketPath = options.socketPath ?? DEFAULT_SOCKET;
  const keyPath = options.keyPath ?? DEFAULT_KEY;
  const apiUrl = safeApiUrl(options.apiUrl ?? process.env.ATLAS_GITHUB_API_URL ?? DEFAULT_API_URL);
  const apiVersion = options.apiVersion ?? DEFAULT_API_VERSION;
  const allowed = options.authorizedRepositories
    ? new Set(options.authorizedRepositories.map(normalizedRepository))
    : undefined;
  const fetcher = options.fetcher ?? fetch;
  const tokenCache = new Map<string, CachedToken>();
  let installationTokenCache: CachedToken | undefined;
  let server: Server | undefined;
  let startPromise: Promise<void> | undefined;
  let supplierKey: string | undefined;

  const resolveScope = (directory: string) => {
    if (!isAbsolute(directory)) throw new CredentialError("Session directory must be absolute");
    const requested = canonicalPath(directory);
    const registry = readRegistry(registryPath);
    const scope = registry.scopes
      .filter((entry) => isWithin(canonicalPath(entry.directory), requested))
      .sort((left, right) => right.directory.length - left.directory.length)[0];
    if (!scope || (allowed && !allowed.has(normalizedRepository(scope.fullName)))) {
      throw new CredentialError("Session directory is not registered for an authorized Repository");
    }
    return scope;
  };

  const mintAppToken = async (
    repositoryIds?: string[],
    permissions: Record<string, "read" | "write"> = {
      contents: "read",
      metadata: "read",
      issues: "read",
      pull_requests: "read",
    },
  ) => {
    const env = readGithubEnvFile(credentialsPath);
    const appId = env.ATLAS_GITHUB_APP_ID;
    const installationId = env.ATLAS_GITHUB_INSTALLATION_ID;
    const privateKeyPath = env.ATLAS_GITHUB_APP_PRIVATE_KEY_PATH;
    if (!appId || !installationId || !privateKeyPath || !/^\d+$/u.test(installationId)) {
      throw new CredentialError("Repository-scoped GitHub App credentials are incomplete");
    }
    const numericRepositoryIds = repositoryIds?.map((repositoryId) => {
      if (!/^\d+$/u.test(repositoryId) || !Number.isSafeInteger(Number(repositoryId))) {
        throw new CredentialError("Repository identity cannot be scoped safely");
      }
      return Number(repositoryId);
    });

    let response: Response;
    try {
      response = await fetcher(`${apiUrl}/app/installations/${encodeURIComponent(installationId)}/access_tokens`, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${appJwt(appId, privateKeyPath)}`,
          "X-GitHub-Api-Version": apiVersion,
          "Content-Type": "application/json",
          "User-Agent": "Atlas",
        },
        body: JSON.stringify({
          ...(numericRepositoryIds ? { repository_ids: numericRepositoryIds } : {}),
          permissions,
        }),
        redirect: "manual",
      });
    } catch {
      throw new CredentialError("GitHub token supplier could not be reached");
    }
    if (!response.ok) throw new CredentialError("GitHub token supplier rejected the request");

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new CredentialError("GitHub token supplier returned invalid data");
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new CredentialError("GitHub token supplier returned invalid data");
    }
    const token = (payload as Record<string, unknown>).token;
    const expiresAt = (payload as Record<string, unknown>).expires_at;
    if (typeof token !== "string" || token.length === 0 || typeof expiresAt !== "string") {
      throw new CredentialError("GitHub token supplier returned incomplete data");
    }
    const expiresAtMs = Date.parse(expiresAt);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now() + TOKEN_RENEWAL_MARGIN_MS) {
      throw new CredentialError("GitHub token supplier returned an already-expiring token");
    }
    if (repositoryIds) {
      const returnedPermissions = (payload as Record<string, unknown>).permissions;
      if (!returnedPermissions || typeof returnedPermissions !== "object" || Array.isArray(returnedPermissions)) {
        throw new CredentialError("GitHub installation token permissions could not be verified");
      }
      const contents = (returnedPermissions as Record<string, unknown>).contents;
      const pullRequests = (returnedPermissions as Record<string, unknown>).pull_requests;
      if (contents !== "write" || pullRequests !== "write") {
        throw new CredentialError("GitHub App installation lacks required Repository write permissions");
      }
    }
    const value = { token, expiresAt, expiresAtMs };
    return value;
  };

  const mintToken = async (scope: CredentialScope) => {
    const repository = normalizedRepository(scope.fullName);
    if (allowed && !allowed.has(repository)) throw new CredentialError("Repository is outside the authorized preparation scope");
    const cached = tokenCache.get(repository);
    if (cached && cached.expiresAtMs > Date.now() + TOKEN_RENEWAL_MARGIN_MS) return cached;

    if (options.allowStaticToken && options.staticToken) {
      const expiresAtMs = Date.now() + 10 * 60 * 1000;
      const value = { token: options.staticToken, expiresAt: new Date(expiresAtMs).toISOString(), expiresAtMs };
      tokenCache.set(repository, value);
      return value;
    }

    const value = await mintAppToken([scope.repositoryId], {
      contents: "write",
      metadata: "read",
      issues: "read",
      pull_requests: "write",
    });
    tokenCache.set(repository, value);
    return value;
  };

  const tokenForRequest = async (request: SupplierRequest) => {
    if (!validCredentialRequest(request)) throw new CredentialError("Credential request is invalid");
    const scope = resolveScope(request.sessionDirectory);
    if (request.operation === "git") {
      const requested = repositoryFromGitPath(request.path!);
      if (normalizedRepository(requested) !== normalizedRepository(scope.fullName)) {
        throw new CredentialError("GitHub Repository is outside the registered Session scope");
      }
    }
    if (request.requestedRepository && normalizedRepository(request.requestedRepository) !== normalizedRepository(scope.fullName)) {
      throw new CredentialError("GitHub Repository is outside the registered Session scope");
    }
    return { scope, token: await mintToken(scope) };
  };

  const start = async () => {
    if (startPromise) return startPromise;
    startPromise = new Promise<void>((resolveStart, rejectStart) => {
      try {
        ensurePrivateDirectory(dirname(socketPath));
        if (existsSync(keyPath)) {
          supplierKey = readSupplierKey(keyPath);
        } else {
          ensurePrivateDirectory(dirname(keyPath));
          supplierKey = randomBytes(32).toString("hex");
          writeFileSync(keyPath, `${supplierKey}\n`, { encoding: "utf8", mode: 0o600 });
          chmodSync(keyPath, 0o600);
        }
        if (existsSync(socketPath)) {
          throw new CredentialError("Credential supplier socket path is already in use");
        }
        server = createServer((socket) => {
          let buffer = "";
          socket.setTimeout(6000, () => socket.destroy());
          socket.on("error", () => socket.destroy());
          socket.on("data", (chunk: Buffer | string) => {
            buffer += chunk.toString();
            if (Buffer.byteLength(buffer) > MAX_REQUEST_BYTES) {
              socket.destroy();
              return;
            }
            const newline = buffer.indexOf("\n");
            if (newline < 0) return;
            const line = buffer.slice(0, newline);
            buffer = "";
            void (async () => {
              let response: SupplierResponse;
              try {
                const request = JSON.parse(line) as SupplierRequest;
                if (!supplierKey || !keyMatches(request.key, supplierKey)) throw new CredentialError("Credential supplier authentication failed");
                const result = await tokenForRequest(request);
                response = { ok: true, username: "x-access-token", password: result.token.token, expiresAt: result.token.expiresAt };
              } catch {
                response = { ok: false, error: "Credential supplier rejected the request" };
              }
              if (!socket.destroyed) socket.end(`${JSON.stringify(response)}\n`);
            })();
          });
        });
        server.on("error", (error) => rejectStart(error));
        server.listen(socketPath, () => {
          try {
            chmodSync(socketPath, 0o600);
            server?.unref();
            resolveStart();
          } catch (error) {
            rejectStart(error);
          }
        });
      } catch (error) {
        rejectStart(error);
      }
    });
    return startPromise;
  };

  const registerScope = (scope: CredentialScope) => {
    if (!isAbsolute(scope.directory)) throw new CredentialError("Session directory must be absolute");
    if (allowed && !allowed.has(normalizedRepository(scope.fullName))) {
      throw new CredentialError("Repository is outside the authorized preparation scope");
    }
    const directory = canonicalPath(scope.directory);
    const registry = readRegistry(registryPath);
    const next = registry.scopes.filter((entry) => entry.atlasId !== scope.atlasId);
    next.push({ ...scope, directory });
    writeRegistry(registryPath, { version: 1, scopes: next });
  };

  const close = () => {
    const current = server;
    current?.close(() => {
      try {
        if (existsSync(socketPath) && lstatSync(socketPath).isSocket()) unlinkSync(socketPath);
      } catch {
        // The socket is runtime state; failure to remove it must not touch any other path.
      }
    });
    server = undefined;
    startPromise = undefined;
  };

  return {
    credentialsPath,
    registryPath,
    socketPath,
    keyPath,
    start,
    close,
    registerScope,
    resolveScope,
    requestToken: (request: Omit<SupplierRequest, "key">) => requestCredential(request, { socketPath, keyPath }),
    assertReady: async (scope: CredentialScope) => {
      await start();
      await requestCredential({ operation: "preflight", sessionDirectory: scope.directory }, { socketPath, keyPath });
    },
    installationToken: async () => {
      if (installationTokenCache && installationTokenCache.expiresAtMs > Date.now() + TOKEN_RENEWAL_MARGIN_MS) return installationTokenCache.token;
      installationTokenCache = await mintAppToken();
      return installationTokenCache.token;
    },
    helperEnvironment: () => ({
      ATLAS_SUPPLIER_SOCKET: socketPath,
      ATLAS_SUPPLIER_KEY_PATH: keyPath,
    }),
  };
};

export type CredentialBoundary = ReturnType<typeof createCredentialBoundary>;
