import { readFileSync } from "node:fs";
import { join } from "node:path";

export type PublishedReleaseIdentity = {
  published: true;
  tag: string;
  semver: string;
  build: number;
  gitSha: string;
};

export type ReleaseIdentity = PublishedReleaseIdentity | {
  published: false;
  tag: null;
  semver: null;
  build: null;
  gitSha: null;
};

export type ReleaseMetadata = {
  schemaVersion: 1;
  identity: PublishedReleaseIdentity;
  artifact: {
    name: string;
    checksum: string;
    os: "linux";
    architecture: "x64";
    format: "tar.gz";
  };
  runtime: { bun: string; git: string; gh: string };
  rollback: {
    codeOnlyCompatible: boolean;
    manualMaintenanceInstructions: string | null;
  };
};

export const DEVELOPMENT_RELEASE_IDENTITY: ReleaseIdentity = {
  published: false,
  tag: null,
  semver: null,
  build: null,
  gitSha: null,
};

const tagPattern = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\+build\.([1-9]\d*)$/;

export const parseReleaseTag = (tag: string) => {
  const match = tagPattern.exec(tag);
  if (!match) throw new Error(`Malformed Atlas release tag: ${tag}`);
  const [major, minor, patch, build] = match.slice(1).map(Number) as [number, number, number, number];
  if (![major, minor, patch, build].every(Number.isSafeInteger)) {
    throw new Error(`Atlas release tag contains an unsafe integer: ${tag}`);
  }
  return { tag, semver: `${major}.${minor}.${patch}`, major, minor, patch, build };
};

export const compareReleaseTags = (leftTag: string, rightTag: string) => {
  const left = parseReleaseTag(leftTag);
  const right = parseReleaseTag(rightTag);
  for (const key of ["major", "minor", "patch", "build"] as const) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  return 0;
};

export const validateReleaseSequence = (candidateTag: string, previousTags: readonly string[]) => {
  const candidate = parseReleaseTag(candidateTag);
  if (previousTags.length === 0) {
    if (candidateTag !== "v0.1.0+build.1") throw new Error("The first Atlas release must be v0.1.0+build.1");
    return candidate;
  }

  if (previousTags.includes(candidateTag)) throw new Error(`Atlas release ${candidateTag} already exists`);
  const previous = previousTags.map(parseReleaseTag);
  const highestBuild = Math.max(...previous.map((release) => release.build));
  if (candidate.build <= highestBuild) {
    throw new Error(`Build ${candidate.build} must be greater than published build ${highestBuild}`);
  }
  const latest = previous.reduce((left, right) => compareReleaseTags(left.tag, right.tag) >= 0 ? left : right);
  if (compareReleaseTags(candidateTag, latest.tag) <= 0) {
    throw new Error(`Release ${candidateTag} must be newer than ${latest.tag}`);
  }
  return candidate;
};

export const createReleaseMetadata = (
  tag: string,
  gitSha: string,
  runtime: ReleaseMetadata["runtime"],
): ReleaseMetadata => {
  const parsed = parseReleaseTag(tag);
  if (!/^[0-9a-f]{40}$/.test(gitSha)) throw new Error("Release Git SHA must be a full lowercase SHA-1");
  if (Object.values(runtime).some((version) => !version)) throw new Error("Release runtime versions must be present");
  const name = `atlas-linux-x64-${tag}.tar.gz`;
  return {
    schemaVersion: 1,
    identity: { published: true, tag, semver: parsed.semver, build: parsed.build, gitSha },
    artifact: { name, checksum: `${name}.sha256`, os: "linux", architecture: "x64", format: "tar.gz" },
    runtime,
    rollback: { codeOnlyCompatible: true, manualMaintenanceInstructions: null },
  };
};

export const assertReleaseMetadata = (value: unknown): ReleaseMetadata => {
  if (!value || typeof value !== "object") throw new Error("Release metadata must be an object");
  const metadata = value as Partial<ReleaseMetadata>;
  const identity = metadata.identity as Partial<PublishedReleaseIdentity> | undefined;
  const artifact = metadata.artifact as Partial<ReleaseMetadata["artifact"]> | undefined;
  const runtime = metadata.runtime as Partial<ReleaseMetadata["runtime"]> | undefined;
  const rollback = metadata.rollback as Partial<ReleaseMetadata["rollback"]> | undefined;
  if (metadata.schemaVersion !== 1 || identity?.published !== true || typeof identity.tag !== "string" ||
      typeof identity.semver !== "string" || typeof identity.build !== "number" || typeof identity.gitSha !== "string") {
    throw new Error("Release metadata identity is invalid");
  }
  const parsed = parseReleaseTag(identity.tag);
  if (identity.semver !== parsed.semver || identity.build !== parsed.build || !/^[0-9a-f]{40}$/.test(identity.gitSha)) {
    throw new Error("Release metadata does not agree with its tag");
  }
  const expectedName = `atlas-linux-x64-${identity.tag}.tar.gz`;
  if (artifact?.name !== expectedName || artifact.checksum !== `${expectedName}.sha256` || artifact.os !== "linux" ||
      artifact.architecture !== "x64" || artifact.format !== "tar.gz") {
    throw new Error("Release artifact metadata is invalid");
  }
  if (typeof runtime?.bun !== "string" || !runtime.bun || typeof runtime.git !== "string" || !runtime.git ||
      typeof runtime.gh !== "string" || !runtime.gh) {
    throw new Error("Release runtime metadata is invalid");
  }
  if (typeof rollback?.codeOnlyCompatible !== "boolean" ||
      (rollback.codeOnlyCompatible && rollback.manualMaintenanceInstructions !== null) ||
      (!rollback.codeOnlyCompatible && (typeof rollback.manualMaintenanceInstructions !== "string" || !rollback.manualMaintenanceInstructions))) {
    throw new Error("Release rollback metadata is invalid");
  }
  return metadata as ReleaseMetadata;
};

export const loadReleaseIdentity = (releaseRoot: string): ReleaseIdentity => {
  try {
    return assertReleaseMetadata(JSON.parse(readFileSync(join(releaseRoot, "RELEASE_METADATA.json"), "utf8"))).identity;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return DEVELOPMENT_RELEASE_IDENTITY;
    throw error;
  }
};
