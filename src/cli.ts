// The single `atlas` entry point (compiled binary and `bun src/cli.ts`).
// Each subcommand loads lazily so one never runs another's side effects; the
// literal `import()` paths let `bun build --compile` bundle every module.
// A subcommand's `run` returns an exit code, or nothing for long-running
// processes that exit through their own signal handlers.

export {};

type Run = (args: string[]) => Promise<number | void>;

const commands: Record<string, { summary: string; load: () => Promise<Run> }> = {
  serve: { summary: "Run the Atlas UI and webhook listener", load: async () => (await import("./server.ts")).run },
  credentials: { summary: "Run the credential supplier", load: async () => (await import("./credential-server.ts")).run },
  updater: { summary: "Run the release updater", load: async () => (await import("./updater-server.ts")).run },
  gh: { summary: "Scoped gh wrapper for Sessions", load: async () => (await import("./commands/gh.ts")).run },
  "git-credential": { summary: "Git credential helper for Sessions", load: async () => (await import("./commands/git-credential.ts")).run },
  setup: { summary: "Set up Atlas on this host (not implemented yet)", load: async () => (await import("./commands/setup.ts")).run },
  version: { summary: "Print the release identity (--json for JSON)", load: async () => (await import("./commands/version.ts")).run },
};

const usage = () => [
  "usage: atlas <command> [args]",
  "",
  ...Object.entries(commands).map(([name, command]) => `  ${name.padEnd(16)}${command.summary}`),
  "",
].join("\n");

const [name, ...args] = process.argv.slice(2);
if (name === "--help" || name === "-h" || name === "help") {
  process.stdout.write(usage());
} else {
  const command = name === undefined ? undefined : commands[name];
  if (!command) {
    if (name !== undefined) process.stderr.write(`atlas: unknown command "${name}"\n`);
    process.stderr.write(usage());
    process.exitCode = 2;
  } else {
    const code = await (await command.load())(args);
    if (typeof code === "number") process.exitCode = code;
  }
}
