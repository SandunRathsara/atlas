import { join } from "node:path";
import { createUpdaterService } from "./updater.ts";

const toolsRoot = Bun.env.ATLAS_TOOLS_ROOT ?? "/opt/atlas/tools";
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
  downloadBaseUrl: Bun.env.ATLAS_RELEASE_DOWNLOAD_BASE_URL,
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
