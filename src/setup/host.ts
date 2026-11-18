// Everything `atlas setup` asks of the host goes through `SetupHost`, so the
// checks can run setup unprivileged in a temp folder with fake commands.
//
// Filesystem paths: setup always works on `host.root + <absolute path>`; the
// real host uses root "". Host tools (git, gh, tailscale, systemctl) are
// never prefixed: they run through `run`.
import { accessSync, constants, existsSync, fchownSync, lchownSync, lstatSync, openSync, realpathSync, readSync, statSync, writeSync } from "node:fs";
import { delimiter, join } from "node:path";
import { unprivilegedCommandPrefix } from "../release-layout.ts";
import { assertSafeParents, rootOnly } from "./files.ts";

export type RunResult = { code: number; stdout: string; stderr: string; timedOut: boolean };
export type Account = { name: string; uid: number; gid: number; home: string };
/** An unprivileged account to run a command as; null means `nobody` (uid/gid 65534). */
export type RunAs = { user: string; group: string } | null;

export type Prompter = {
  /** Shows `question` and returns the typed line (without newline). */
  ask: (question: string) => Promise<string>;
};

export type SetupHost = {
  /** Filesystem prefix; "" on the real host. */
  root: string;
  platform: string;
  arch: string;
  isRoot: boolean;
  /** The account that ran sudo, if any. */
  invokingUser: string | undefined;
  /** Path of the running `atlas` binary. */
  execPath: string;
  run: (argv: string[], options?: { timeoutMs?: number }) => Promise<RunResult>;
  /** Absolute path of an executable on the host PATH, or null. */
  which: (name: string) => string | null;
  /** True when a host (unprefixed) path is an executable file. */
  executable: (path: string) => boolean;
  /**
   * Why root must not run this host tool (it or a folder above it could be
   * changed by another account, or it lives in a home folder), or null.
   */
  toolProblem: (path: string) => string | null;
  /** True when systemd is PID 1 on this host. */
  systemdBooted: () => boolean;
  user: (name: string) => Account | null;
  group: (name: string) => number | null;
  /** lchown: only for symlinks setup itself just created. */
  chown: (path: string, uid: number, gid: number) => void;
  /** fchown on an open file or folder (never a path). */
  fchown: (descriptor: number, uid: number, gid: number) => void;
  /** Owner of an lstat/fstat result. */
  owner: (stat: { ino: number; uid: number; gid: number }) => { uid: number; gid: number };
  /**
   * Runs argv as `account` (or nobody) with an empty environment and cwd "/",
   * so nothing it touches is done with root's rights. Runs directly when this
   * process is not root.
   */
  runAs: (account: RunAs, argv: string[], options?: { timeoutMs?: number; env?: Record<string, string> }) => Promise<RunResult>;
  fetch: typeof fetch;
  sleep: (milliseconds: number) => Promise<void>;
  now: () => Date;
  /** null when there is no terminal to ask on. */
  prompter: Prompter | null;
  out: (line: string) => void;
};

const runReal = async (argv: string[], options: { timeoutMs?: number; cwd?: string } = {}): Promise<RunResult> => {
  try {
    const child = Bun.spawn(argv, {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: options.timeoutMs ?? 60_000,
      killSignal: "SIGKILL",
    });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { code, stdout, stderr, timedOut: child.signalCode === "SIGKILL" };
  } catch {
    return { code: 127, stdout: "", stderr: `${argv[0]}: not found`, timedOut: false };
  }
};

const passwd = (name: string, database: "passwd" | "group") => {
  const result = Bun.spawnSync(["getent", database, "--", name], { stdout: "pipe", stderr: "ignore", env: { PATH: "/usr/bin:/bin" } });
  return result.exitCode === 0 ? result.stdout.toString().trim().split(":") : null;
};

/** Reads one line from /dev/tty, so prompts work under `curl … | sh`. */
const ttyPrompter = (): Prompter | null => {
  let descriptor: number;
  try {
    descriptor = openSync("/dev/tty", "r+");
  } catch {
    return null;
  }
  return {
    ask: async (question) => {
      writeSync(descriptor, question);
      const bytes: number[] = [];
      const buffer = Buffer.alloc(1);
      while (readSync(descriptor, buffer, 0, 1, null) === 1 && buffer[0] !== 0x0a) bytes.push(buffer[0]!);
      return Buffer.from(bytes).toString("utf8").replace(/\r$/u, "");
    },
  };
};

export const realHost = (options: { root?: string; interactive: boolean }): SetupHost => {
  const searchPath = [...(process.env.PATH ?? "").split(delimiter), "/usr/local/sbin", "/usr/local/bin", "/usr/sbin", "/usr/bin", "/sbin", "/bin"]
    .filter((entry) => entry.startsWith("/"));
  const executable = (path: string) => {
    try {
      if (!statSync(path).isFile()) return false;
      accessSync(path, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  };
  const prompter = options.interactive ? ttyPrompter() : null;
  return {
    root: options.root ?? "",
    platform: process.platform,
    arch: process.arch,
    isRoot: process.getuid?.() === 0,
    invokingUser: process.env.SUDO_USER || undefined,
    execPath: process.execPath,
    run: runReal,
    which: (name) => {
      for (const directory of searchPath) {
        const candidate = join(directory, name);
        if (executable(candidate)) return candidate;
      }
      return null;
    },
    executable,
    toolProblem: (path) => {
      const owner = (stat: { uid: number; gid: number }) => ({ uid: stat.uid, gid: stat.gid });
      let real: string;
      try {
        real = realpathSync(path);
      } catch {
        return "cannot be resolved";
      }
      if (/^\/(home|root)(\/|$)/u.test(real)) return `resolves into a home folder (${real})`;
      const stat = lstatSync(real);
      if (!stat.isFile()) return `${real} is not a regular file`;
      if (!rootOnly({ owner }, stat)) return `${real} must be owned by root and not writable by group or others`;
      try {
        assertSafeParents({ owner }, path);
        assertSafeParents({ owner }, real);
      } catch (error) {
        return (error as Error).message;
      }
      return null;
    },
    systemdBooted: () => existsSync("/run/systemd/system"),
    user: (name) => {
      const fields = passwd(name, "passwd");
      if (!fields || fields.length < 7) return null;
      return { name: fields[0]!, uid: Number(fields[2]), gid: Number(fields[3]), home: fields[5]! };
    },
    group: (name) => {
      const fields = passwd(name, "group");
      return fields && fields.length >= 3 ? Number(fields[2]) : null;
    },
    chown: (path, uid, gid) => lchownSync(path, uid, gid),
    fchown: (descriptor, uid, gid) => fchownSync(descriptor, uid, gid),
    owner: (stat) => ({ uid: stat.uid, gid: stat.gid }),
    runAs: async (account, argv, runOptions = {}) => {
      const prefix = process.getuid?.() !== 0
        ? []
        : account
          ? unprivilegedCommandPrefix(account)
          : ["setpriv", "--reuid=65534", "--regid=65534", "--clear-groups", "--inh-caps=-all", "--"];
      const env = Object.entries({ PATH: "/usr/bin:/bin", LANG: "C", ...runOptions.env }).map(([key, value]) => `${key}=${value}`);
      return await runReal([...prefix, "/usr/bin/env", "-i", ...env, ...argv], { timeoutMs: runOptions.timeoutMs, cwd: "/" });
    },
    fetch,
    sleep: (milliseconds) => Bun.sleep(milliseconds),
    now: () => new Date(),
    prompter,
    out: (line) => process.stdout.write(`${line}\n`),
  };
};
