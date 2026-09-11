import { lstatSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { readSessionHelperReferences } from "./credentials.ts";
import type { ReleaseMetadata } from "./release.ts";
import { createUpdaterService, installShippedSupportServices } from "./updater.ts";

const toolsRoot = Bun.env.ATLAS_TOOLS_ROOT ?? "/opt/atlas/tools";
const supportRoot = Bun.env.ATLAS_UPDATER_SUPPORT_ROOT ?? "/opt/atlas/services/current/atlas-updater";
const servicesRoot = Bun.env.ATLAS_SUPPORT_ROOT ?? "/opt/atlas/services";
const atlasEnvironmentPath = Bun.env.ATLAS_ENV_PATH ?? "/etc/atlas/atlas.env";
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
    const environment = readAtlasHealthEnvironment();
    const child = Bun.spawn([join(supportRoot, "check-activation-health.sh")], {
      env: {
        ...process.env,
        ATLAS_SHARED_TOKEN: environment.token,
        ATLAS_HEALTH_URL: `http://127.0.0.1:${environment.port}/health?activation=1`,
        ATLAS_EXPECTED_RELEASE_TAG: candidate.identity.tag,
        ATLAS_EXPECTED_RELEASE_SHA: candidate.identity.gitSha,
      },
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    return await child.exited === 0;
  } catch {
    return false;
  }
};
const reportsVersion = (command: string, expected: string) => {
  try {
    const result = Bun.spawnSync([command, "--version"], { stdout: "pipe", stderr: "ignore" });
    return result.exitCode === 0 && result.stdout.toString().includes(expected) ? expected : null;
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
  updateSupportServices: (releasePath, metadata) => {
    installShippedSupportServices(releasePath, metadata, servicesRoot);
  },
  hostRuntime: (candidate) => {
    return {
      bun: Bun.version,
      git: reportsVersion(join(toolsRoot, "git", candidate.runtime.git, "bin", "git"), candidate.runtime.git),
      gh: reportsVersion(join(toolsRoot, "gh", candidate.runtime.gh, "bin", "gh"), candidate.runtime.gh),
    };
  },
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
