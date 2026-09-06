import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";

const allowedKeys = new Set([
  "ATLAS_GITHUB_API_URL",
  "ATLAS_GITHUB_ORGANIZATION",
  "ATLAS_GITHUB_INSTALLATION_ID",
  "ATLAS_GITHUB_INSTALLATION_TOKEN",
  "ATLAS_GITHUB_WEBHOOK_SECRET",
]);

const value = (raw: string) => {
  const trimmed = raw.trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

export const loadGitHubEnv = (environment: NodeJS.ProcessEnv = process.env) => {
  const home = environment.HOME;
  if (!home) return;
  const path = join(home, ".config", "atlas", "github.env");

  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  if (!stat.isFile() || (stat.mode & 0o077) !== 0) {
    throw new Error("~/.config/atlas/github.env must be a private regular file");
  }

  const contents = readFileSync(path, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || match[0].trimStart().startsWith("#")) continue;
    const key = match[1]!;
    if (!allowedKeys.has(key)) continue;
    const parsed = value(match[2]!);
    if (parsed.includes("\u0000") || parsed.includes("\n") || parsed.length > 64 * 1024) {
      throw new Error(`Invalid value in ${path}`);
    }
    if (environment[key] === undefined) environment[key] = parsed;
  }
};
