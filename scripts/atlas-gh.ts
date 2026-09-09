#!/usr/bin/env bun

import { chmodSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { requestCredential, CredentialError } from "../src/credentials.ts";

const args = process.argv.slice(2);
const sessionDirectory = process.env.ATLAS_SESSION_DIRECTORY ?? process.cwd();
const rejectAccess = () => {
  process.stderr.write("Atlas gh access was rejected.\n");
  process.exit(1);
};

const requestedRepositories: string[] = [];
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index]!;
  if (argument === "--repo" || argument === "-R") {
    const value = args[index + 1];
    if (!value) throw new CredentialError("gh Repository argument is missing");
    requestedRepositories.push(value);
    index += 1;
  } else if (argument.startsWith("--repo=")) {
    requestedRepositories.push(argument.slice("--repo=".length));
  }
}

const forbidden = args.some((argument, index) =>
  argument === "--debug" || argument.startsWith("--debug=") ||
  (args[index - 1] === "auth" && (argument === "token" || argument === "login" || argument === "refresh" || argument === "setup-git")),
);
if (forbidden) rejectAccess();

const requestedRepository = requestedRepositories.length > 0 ? requestedRepositories[0] : undefined;
if (requestedRepositories.some((value) => value !== requestedRepository)) {
  throw new CredentialError("Conflicting gh Repository arguments are not allowed");
}

const response = await requestCredential({
  operation: "gh",
  sessionDirectory,
  requestedRepository,
}).catch(() => rejectAccess());

const realBinary = process.env.ATLAS_REAL_GH ?? Bun.which("gh");
if (!realBinary || resolve(realBinary) === resolve(process.argv[1] ?? "")) throw new CredentialError("The real gh binary is not configured");

const configDirectory = mkdtempSync(join(tmpdir(), "atlas-gh-"));
chmodSync(configDirectory, 0o700);
try {
  const environment: Record<string, string> = { ...(process.env as Record<string, string>) };
  for (const name of [
    "ATLAS_SHARED_TOKEN",
    "ATLAS_GITHUB_INSTALLATION_TOKEN",
    "ATLAS_GITHUB_APP_PRIVATE_KEY",
    "ATLAS_GITHUB_APP_PRIVATE_KEY_PATH",
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "GH_ENTERPRISE_TOKEN",
    "GITHUB_ENTERPRISE_TOKEN",
    "GH_REPO",
    "GH_DEBUG",
    "GH_CONFIG_DIR",
    "GIT_ASKPASS",
    "SSH_ASKPASS",
    "GIT_SSH",
    "GIT_SSH_COMMAND",
    "GIT_SSH_VARIANT",
    "GIT_CONFIG_SYSTEM",
    "GIT_CONFIG_GLOBAL",
    "GIT_CONFIG_COUNT",
    "GIT_CONFIG_PARAMETERS",
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_COMMON_DIR",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_QUARANTINE_PATH",
    "GIT_SSL_NO_VERIFY",
    "GIT_CURL_VERBOSE",
    "GIT_TRACE",
    "GIT_TRACE_PACKET",
    "GIT_TRACE_CURL",
    "GIT_TRACE2",
    "GIT_TRACE2_EVENT",
    "GIT_TRACE2_PERF",
    "GIT_TERMINAL_PROMPT",
  ]) delete environment[name];
  for (const name of Object.keys(environment)) {
    if (/^GIT_CONFIG_(?:KEY|VALUE)_\d+$/u.test(name)) delete environment[name];
  }
  environment.GH_TOKEN = response.password;
  environment.GH_HOST = "github.com";
  environment.GH_CONFIG_DIR = configDirectory;
  environment.GH_PROMPT_DISABLED = "1";
  environment.GIT_CONFIG_NOSYSTEM = "1";
  environment.GIT_CONFIG_GLOBAL = "/dev/null";
  environment.GIT_TERMINAL_PROMPT = "0";
  environment.GIT_ASKPASS = "/bin/false";
  environment.SSH_ASKPASS = "/bin/false";
  environment.GIT_SSH_COMMAND = "/bin/false";
  environment.ATLAS_SESSION_DIRECTORY = sessionDirectory;

  const child = Bun.spawn([realBinary, ...args], {
    cwd: process.cwd(),
    env: environment,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exitCode = await child.exited;
} finally {
  rmSync(configDirectory, { recursive: true, force: true });
}
