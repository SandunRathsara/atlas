import { lstatSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { readSessionHelperReferences } from "./credentials.ts";
import { parseToolVersion } from "./host-tools.ts";
import { unprivilegedCommandPrefix, type ReleaseFolderRunAs } from "./release-layout.ts";
import type { ReleaseMetadata } from "./release.ts";
import { createUpdaterService, installShippedSupportServices } from "./updater.ts";

/**
 * One activation health probe: `GET /health?activation=1` with the shared
 * token. Healthy only when the Atlas process and storage are healthy, the
 * running Release is exactly `candidate`, and no OpenCode readiness is mixed in
 * (activation never depends on OpenCode).
 */
export const checkActivationHealth = async (
  candidate: Pick<ReleaseMetadata, "identity">,
  target: { port: number; token: string },
  fetcher: typeof fetch = fetch,
) => {
  try {
    const response = await fetcher(`http://127.0.0.1:${target.port}/health?activation=1`, {
      headers: { Authorization: `Bearer ${target.token}`, Accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return false;
    const body = await response.json() as {
      atlas?: { process?: unknown; release?: { published?: unknown; tag?: unknown; gitSha?: unknown } };
      persistence?: { healthy?: unknown };
    } | null;
    return !!body && typeof body === "object" && !Object.hasOwn(body, "openCode") &&
      body.atlas?.process === true && body.persistence?.healthy === true &&
      body.atlas.release?.published === true && body.atlas.release.tag === candidate.identity.tag &&
      body.atlas.release.gitSha === candidate.identity.gitSha;
  } catch {
    return false;
  }
};

const absolute = (label: string, value: string) => {
  if (!isAbsolute(value)) throw new Error(`${label} must be an absolute path`);
  return value;
};

export const run = async () => {
  const servicesRoot = Bun.env.ATLAS_SUPPORT_ROOT ?? "/opt/atlas/services";
  const atlasEnvironmentPath = Bun.env.ATLAS_ENV_PATH ?? "/etc/atlas/atlas.env";
  const realGit = absolute("ATLAS_REAL_GIT", Bun.env.ATLAS_REAL_GIT ?? "/usr/bin/git");
  const realGh = absolute("ATLAS_REAL_GH", Bun.env.ATLAS_REAL_GH ?? "/usr/bin/gh");
  // Candidates and host-tool probes run as this account, never as root.
  const runAs: ReleaseFolderRunAs | undefined = Bun.env.ATLAS_SERVICE_USER
    ? { user: Bun.env.ATLAS_SERVICE_USER, group: Bun.env.ATLAS_SERVICE_GROUP ?? Bun.env.ATLAS_SERVICE_USER }
    : undefined;
  if (process.getuid?.() === 0) unprivilegedCommandPrefix(runAs);
  const registryPath = resolve(Bun.env.ATLAS_CREDENTIAL_REGISTRY_PATH ?? "/var/lib/atlas/session-scopes.json");
  const registryDirectory = lstatSync(dirname(registryPath));
  if (!registryDirectory.isDirectory() || registryDirectory.isSymbolicLink() || (registryDirectory.mode & 0o077) !== 0) {
    throw new Error("Session scope registry directory must be private");
  }
  const readAtlasHealthEnvironment = () => {
    const stat = lstatSync(atlasEnvironmentPath);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error("Atlas environment must be a private regular file");
    const values = new Map<string, string>();
    for (const line of readFileSync(atlasEnvironmentPath, "utf8").split(/\r?\n/u)) {
      const match = /^\s*(ATLAS_SHARED_TOKEN|ATLAS_PORT)\s*=\s*(.*?)\s*$/.exec(line);
      if (!match) continue;
      const raw = match[2]!;
      const value = raw.length >= 2 && ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")))
        ? raw.slice(1, -1)
        : raw;
      if (!value || value.includes("\0") || value.includes("\n")) throw new Error("Atlas health environment is invalid");
      values.set(match[1]!, value);
    }
    const token = values.get("ATLAS_SHARED_TOKEN");
    const port = Number(values.get("ATLAS_PORT") ?? "3000");
    if (!token || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Atlas health environment is incomplete");
    return { token, port };
  };
  const runSystemctl = async (operation: "stop" | "start") => {
    const child = Bun.spawn(["systemctl", operation === "start" ? "restart" : "stop", "atlas.service"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    return await child.exited === 0;
  };
  const checkAtlasHealth = async (candidate: ReleaseMetadata) => {
    try {
      return await checkActivationHealth(candidate, readAtlasHealthEnvironment());
    } catch {
      return false;
    }
  };
  const toolVersion = (command: string) => {
    try {
      const result = Bun.spawnSync([...unprivilegedCommandPrefix(runAs), command, "--version"], {
        cwd: "/",
        env: { PATH: "/usr/bin:/bin", LANG: "C" },
        stdout: "pipe",
        stderr: "ignore",
        timeout: 10_000,
      });
      return result.exitCode === 0 ? parseToolVersion(result.stdout.toString()) : null;
    } catch {
      return null;
    }
  };
  const updater = createUpdaterService({
    statePath: Bun.env.ATLAS_UPDATE_STATE_PATH,
    socketPath: Bun.env.ATLAS_UPDATER_SOCKET,
    keyPath: Bun.env.ATLAS_UPDATER_KEY_PATH,
    releasesRoot: Bun.env.ATLAS_RELEASES_ROOT,
    currentPath: Bun.env.ATLAS_CURRENT_PATH,
    downloadBaseUrl: Bun.env.ATLAS_RELEASE_DOWNLOAD_BASE_URL,
    controlAtlas: runSystemctl,
    checkAtlasHealth,
    listHelperReferences: () => readSessionHelperReferences({ registryPath, expectedOwnerUid: registryDirectory.uid }),
    updateSupportServices: async (releasePath, metadata) => {
      await installShippedSupportServices(releasePath, metadata, servicesRoot, runAs);
    },
    hostRuntime: () => ({ git: toolVersion(realGit), gh: toolVersion(realGh) }),
    runAs,
  });

  await updater.start();
  console.log("Atlas updater is ready");

  let stopping = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    updater.close();
    process.exit(signal === "SIGINT" ? 130 : 143);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
};

