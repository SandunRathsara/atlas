// Host tools a Release needs. Atlas does not ship git or gh; it needs at least
// these versions on the host. One source of truth for the release metadata,
// the `bin/git` wrapper, and the updater's host check. OpenCode is not here:
// its version is diagnostic only (ADR-0001, ADR-0002).
//
// Each minimum is the newest version that one feature Atlas relies on needs:
//   git 2.36.0  github/gh-stack (Sessions track stacks in `.git/gh-stack`)
//               documents "Git 2.36+". Atlas's own git calls need less:
//               `branch --show-current` 2.22, `rev-parse
//               --is-shallow-repository` 2.15, empty `credential.helper=`
//               resets the helper list 2.9, `remote get-url` 2.7.
//   gh  2.3.0   gh-stack is a precompiled (Go) extension; gh 2.3.0 shipped
//               precompiled extensions. GH_TOKEN/GH_HOST/GH_CONFIG_DIR, used
//               by `atlas gh`, are older.
// Stock Debian 12 (git 2.39, gh 2.23) and Ubuntu 24.04 (git 2.43, gh 2.45) pass.

export const MINIMUM_HOST_TOOLS = { git: "2.36.0", gh: "2.3.0" } as const;

export type HostToolName = keyof typeof MINIMUM_HOST_TOOLS;
export type HostTools = Record<HostToolName, string>;

const numericVersion = /^(\d{1,9})\.(\d{1,9})\.(\d{1,9})$/u;

export const isNumericVersion = (value: unknown): value is string =>
  typeof value === "string" && numericVersion.test(value);

/** First `X.Y.Z` in tool output such as `git version 2.43.0` or `gh version 2.45.0 (2024-03-04)`. */
export const parseToolVersion = (output: string) => /\b(\d{1,9}\.\d{1,9}\.\d{1,9})\b/u.exec(output)?.[1] ?? null;

/** Numeric `X.Y.Z` comparison: -1, 0, or 1. */
export const compareVersions = (left: string, right: string) => {
  const parse = (value: string) => {
    const match = numericVersion.exec(value);
    if (!match) throw new Error(`Not a numeric X.Y.Z version: ${value}`);
    return match.slice(1).map(Number);
  };
  const [a, b] = [parse(left), parse(right)];
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index]! < b[index]! ? -1 : 1;
  }
  return 0;
};

export const meetsMinimum = (available: string | null, minimum: string) =>
  available !== null && isNumericVersion(available) && compareVersions(available, minimum) >= 0;
