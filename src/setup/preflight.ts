// Checks that change nothing. Every failure carries a fix-it hint; setup stops
// before any change when one fails. A missing OpenCode is only a warning.
import { closeSync, openSync, readSync } from "node:fs";
import { compareVersions, parseToolVersion, type HostTools } from "../host-tools.ts";
import { RELEASE_SHIM_MARKER } from "../shims.ts";
import type { SetupHost } from "./host.ts";

export type Finding = { problem: string; fix: string };
export type ToolInfo = { path: string; version: string };
export type PreflightResult = {
  failures: Finding[];
  warnings: Finding[];
  git: ToolInfo | null;
  gh: ToolInfo | null;
  openCode: string | null;
};

export const DEFAULT_OPENCODE = "/opt/atlas/tools/opencode/current/bin/opencode";

const GH_INSTALL = "https://github.com/cli/cli/blob/trunk/docs/install_linux.md";

const isReleaseShim = (path: string) => {
  try {
    const descriptor = openSync(path, "r");
    try {
      const head = Buffer.alloc(256);
      const length = readSync(descriptor, head, 0, head.length, 0);
      return head.subarray(0, length).toString("utf8").includes(RELEASE_SHIM_MARKER);
    } finally {
      closeSync(descriptor);
    }
  } catch {
    return false;
  }
};

const checkTool = async (
  host: SetupHost,
  name: "git" | "gh",
  given: string | undefined,
  minimum: string,
  result: PreflightResult,
) => {
  const install = name === "git" ? "apt install git" : `install gh from ${GH_INSTALL}`;
  const path = given ?? host.which(name);
  if (!path || !path.startsWith("/") || !host.executable(path) || isReleaseShim(path)) {
    result.failures.push({
      problem: given ? `${name} not found at ${given}` : `${name} is not installed`,
      fix: given ? `pass the full path with --${name}` : `${install} (needs ${minimum} or newer), or pass --${name} <path>`,
    });
    return null;
  }
  // Root runs this tool through the units, so it must be a system tool only
  // root can change. Even then setup only probes it as `nobody`.
  const problem = /^\/(home|root)(\/|$)/u.test(path) ? `is under a home folder` : host.toolProblem(path);
  if (problem) {
    result.failures.push({
      problem: `${name} at ${path} is not safe to run from root-owned services: ${problem}`,
      fix: `install ${name} system-wide, owned by root (for example /usr/bin/${name}), or pass --${name} <path>`,
    });
    return null;
  }
  const output = await host.runAs(null, [path, "--version"], { timeoutMs: 15_000 });
  const version = output.code === 0 ? parseToolVersion(output.stdout) : null;
  if (!version) {
    result.failures.push({ problem: `${path} --version failed`, fix: `check that ${path} runs, or pass --${name} <path>` });
    return null;
  }
  if (compareVersions(version, minimum) < 0) {
    result.failures.push({ problem: `${name} ${version} is too old (Atlas needs ${minimum}+)`, fix: `upgrade ${name}: ${install}` });
    return null;
  }
  return { path, version };
};

export const preflight = async (
  host: SetupHost,
  options: { git?: string; gh?: string; openCode?: string; minimums: HostTools; dryRun: boolean },
): Promise<PreflightResult> => {
  const result: PreflightResult = { failures: [], warnings: [], git: null, gh: null, openCode: null };
  if (host.platform !== "linux" || host.arch !== "x64") {
    result.failures.push({ problem: `this is ${host.platform}/${host.arch}`, fix: "Atlas runs only on Linux x86_64" });
  }
  if (!host.isRoot) {
    (options.dryRun ? result.warnings : result.failures).push({ problem: "setup is not running as root", fix: "run it with sudo" });
  }
  if (!host.systemdBooted() || !host.which("systemctl")) {
    result.failures.push({ problem: "systemd is not running this host", fix: "Atlas needs a systemd host (not a plain container or WSL1)" });
  }
  for (const tool of ["setpriv", "getent"]) {
    if (!host.which(tool)) result.failures.push({ problem: `${tool} is missing`, fix: tool === "setpriv" ? "apt install util-linux" : "apt install libc-bin" });
  }
  result.git = await checkTool(host, "git", options.git, options.minimums.git, result);
  result.gh = await checkTool(host, "gh", options.gh, options.minimums.gh, result);
  const openCode = options.openCode ?? DEFAULT_OPENCODE;
  if (host.executable(openCode)) {
    result.openCode = openCode;
  } else {
    result.warnings.push({
      problem: `OpenCode not found at ${openCode}; Atlas will run but cannot start Sessions`,
      fix: "install OpenCode there (atlas ops stage-opencode) or pass --opencode <path>, then: systemctl enable --now opencode.service",
    });
  }
  return result;
};

export const printFindings = (host: SetupHost, label: string, findings: Finding[]) => {
  for (const finding of findings) {
    host.out(`${label} ${finding.problem}`);
    host.out(`   fix: ${finding.fix}`);
  }
};
