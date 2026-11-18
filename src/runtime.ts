import { dirname, join } from "node:path";

// One place that knows whether Atlas runs as the compiled `atlas` binary or
// from source under Bun. Inside `bun build --compile` every bundled module
// lives under Bun's virtual `/$bunfs/` root.
export const isCompiledBinary = Bun.main.startsWith("/$bunfs/");

const cliEntry = join(import.meta.dir, "cli.ts");

/** argv that runs this same Atlas build with `args`: the binary itself, or Bun plus `src/cli.ts` from source. */
export const selfCommand = (...args: string[]) =>
  isCompiledBinary ? [process.execPath, ...args] : [process.execPath, cliEntry, ...args];

/** Files a Session helper reference keeps alive for Release retention. */
export const selfHelperPaths = () => isCompiledBinary ? [process.execPath] : [process.execPath, cliEntry];

/** The Release folder: next to the binary when compiled, the repository root from source. */
export const defaultReleaseRoot = () => isCompiledBinary ? dirname(process.execPath) : join(import.meta.dir, "..");
