import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isNumericVersion, MINIMUM_HOST_TOOLS, type HostTools } from "./host-tools.ts";

declare const releaseTagBrand: unique symbol;
export type ReleaseTag = string & { readonly [releaseTagBrand]: true };

export type PublishedReleaseIdentity = {
  published: true;
  tag: ReleaseTag;
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

/** The one downloadable Release asset. */
export const RELEASE_ASSET_NAME = "atlas-linux-x64";
export const RELEASE_CHECKSUM_NAME = `${RELEASE_ASSET_NAME}.sha256`;
/** Upper bound on the binary size Atlas accepts (also the download cap). */
export const MAX_RELEASE_ASSET_BYTES = 1024 * 1024 * 1024;

/**
 * `atlas-release.json` (published next to the asset) and `RELEASE_METADATA.json`
 * (inside each Release folder). Schema 2 describes one compiled binary.
 */
export type ReleaseMetadata = {
  schemaVersion: 2;
  identity: PublishedReleaseIdentity;
  asset: {
    name: typeof RELEASE_ASSET_NAME;
    checksum: typeof RELEASE_CHECKSUM_NAME;
    sha256: string;
    size: number;
    os: "linux";
    architecture: "x64";
  };
  /** Lowest host git/gh versions this Release supports (numeric X.Y.Z). */
  minimumHostTools: HostTools;
  /** OpenCode client package compiled in. Diagnostic only; never a gate. */
  openCodeClient: string;
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
const runtimeVersionPattern = /^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$/;

export const parseReleaseTag = (tag: string) => {
  const match = tagPattern.exec(tag);
  if (!match) throw new Error(`Malformed Atlas release tag: ${tag}`);
  const [major, minor, patch, build] = match.slice(1).map(Number) as [number, number, number, number];
  if (![major, minor, patch, build].every(Number.isSafeInteger)) {
    throw new Error(`Atlas release tag contains an unsafe integer: ${tag}`);
  }
  return { tag: tag as ReleaseTag, semver: `${major}.${minor}.${patch}`, major, minor, patch, build };
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
  asset: { sha256: string; size: number },
  openCodeClient: string,
): ReleaseMetadata => {
  const parsed = parseReleaseTag(tag);
  return assertReleaseMetadata({
    schemaVersion: 2,
    identity: { published: true, tag: parsed.tag, semver: parsed.semver, build: parsed.build, gitSha },
    asset: {
      name: RELEASE_ASSET_NAME,
      checksum: RELEASE_CHECKSUM_NAME,
      sha256: asset.sha256,
      size: asset.size,
      os: "linux",
      architecture: "x64",
    },
    minimumHostTools: { ...MINIMUM_HOST_TOOLS },
    openCodeClient,
    rollback: { codeOnlyCompatible: true, manualMaintenanceInstructions: null },
  });
};

export const assertReleaseMetadata = (value: unknown): ReleaseMetadata => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Release metadata must be an object");
  const schemaVersion = (value as { schemaVersion?: unknown }).schemaVersion;
  if (schemaVersion === 1) {
    throw new Error("Release metadata schema 1 (tarball Releases) is no longer supported; this Atlas only installs schema 2 single-binary Releases");
  }
  if (schemaVersion !== 2) {
    throw new Error(`Release metadata schema ${JSON.stringify(schemaVersion ?? null)} is not supported; expected schema 2`);
  }
  const metadata = value as Partial<ReleaseMetadata>;
  const identity = metadata.identity as Partial<PublishedReleaseIdentity> | undefined;
  const asset = metadata.asset as Partial<ReleaseMetadata["asset"]> | undefined;
  const hostTools = metadata.minimumHostTools as Partial<HostTools> | undefined;
  const rollback = metadata.rollback as Partial<ReleaseMetadata["rollback"]> | undefined;
  if (identity?.published !== true || typeof identity.tag !== "string" ||
      typeof identity.semver !== "string" || typeof identity.build !== "number" || typeof identity.gitSha !== "string") {
    throw new Error("Release metadata identity is invalid");
  }
  const parsed = parseReleaseTag(identity.tag);
  if (identity.semver !== parsed.semver || identity.build !== parsed.build || !/^[0-9a-f]{40}$/.test(identity.gitSha)) {
    throw new Error("Release metadata does not agree with its tag");
  }
  if (asset?.name !== RELEASE_ASSET_NAME || asset.checksum !== RELEASE_CHECKSUM_NAME || asset.os !== "linux" ||
      asset.architecture !== "x64" || typeof asset.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(asset.sha256) ||
      typeof asset.size !== "number" || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_RELEASE_ASSET_BYTES) {
    throw new Error("Release asset metadata is invalid");
  }
  if (!hostTools || !isNumericVersion(hostTools.git) || !isNumericVersion(hostTools.gh) || Object.keys(hostTools).length !== 2) {
    throw new Error("Release minimum host tool versions are invalid");
  }
  if (typeof metadata.openCodeClient !== "string" || !runtimeVersionPattern.test(metadata.openCodeClient)) {
    throw new Error("Release OpenCode client version is invalid");
  }
  if (typeof rollback?.codeOnlyCompatible !== "boolean" ||
      (rollback.codeOnlyCompatible && rollback.manualMaintenanceInstructions !== null) ||
      (!rollback.codeOnlyCompatible && (typeof rollback.manualMaintenanceInstructions !== "string" || !rollback.manualMaintenanceInstructions))) {
    throw new Error("Release rollback metadata is invalid");
  }
  return metadata as ReleaseMetadata;
};

// Replaced at compile time by `scripts/build-binary.ts` (`--define`). Empty
// strings mean an unpublished development build; undefined means source.
declare const __ATLAS_RELEASE_TAG__: string | undefined;
declare const __ATLAS_RELEASE_SHA__: string | undefined;

/** Identity compiled into the `atlas` binary, or `null` when running from source. */
export const embeddedReleaseIdentity = (): ReleaseIdentity | null => {
  if (typeof __ATLAS_RELEASE_TAG__ !== "string") return null;
  if (!__ATLAS_RELEASE_TAG__) return DEVELOPMENT_RELEASE_IDENTITY;
  const gitSha = typeof __ATLAS_RELEASE_SHA__ === "string" ? __ATLAS_RELEASE_SHA__ : "";
  if (!/^[0-9a-f]{40}$/.test(gitSha)) throw new Error("Embedded release Git SHA is invalid");
  const parsed = parseReleaseTag(__ATLAS_RELEASE_TAG__);
  return { published: true, tag: parsed.tag, semver: parsed.semver, build: parsed.build, gitSha };
};

const readMetadataIdentity = (releaseRoot: string) => {
  try {
    return assertReleaseMetadata(JSON.parse(readFileSync(join(releaseRoot, "RELEASE_METADATA.json"), "utf8"))).identity;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
};

/**
 * The compiled binary's embedded identity wins. A `RELEASE_METADATA.json` next
 * to it must agree (an unpublished build beside published metadata fails too).
 * From source, the metadata file decides and its absence means development.
 */
export const loadReleaseIdentity = (releaseRoot: string): ReleaseIdentity => {
  const embedded = embeddedReleaseIdentity();
  const metadata = readMetadataIdentity(releaseRoot);
  if (!embedded) return metadata ?? DEVELOPMENT_RELEASE_IDENTITY;
  if (metadata && (metadata.tag !== embedded.tag || metadata.gitSha !== embedded.gitSha)) {
    throw new Error("RELEASE_METADATA.json does not match the release identity built into this binary");
  }
  return embedded;
};
