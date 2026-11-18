// Host tools a Release needs. Atlas does not ship git or gh; it needs at least
// these versions on the host. One source of truth for the release metadata,
// the `bin/git` wrapper, and the updater's host check. OpenCode is not here:
// its version is diagnostic only (ADR-0001, ADR-0002).

export const MINIMUM_HOST_TOOLS = { git: "2.55.0", gh: "2.100.0" } as const;

export type HostToolName = keyof typeof MINIMUM_HOST_TOOLS;
export type HostTools = Record<HostToolName, string>;

const numericVersion = /^(\d{1,9})\.(\d{1,9})\.(\d{1,9})$/u;

export const isNumericVersion = (value: unknown): value is string =>
  typeof value === "string" && numericVersion.test(value);

/** First `X.Y.Z` in tool output such as `git version 2.55.0` or `gh version 2.100.0 (2026-01-01)`. */
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
