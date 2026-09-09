import { lstatSync, readFileSync } from "node:fs";

const MAX_STATUS_BYTES = 8 * 1024;
const DEFAULT_SPACE_MAX_AGE_MS = 15 * 60 * 1000;
const BACKUP_MAX_AGE_MS = 36 * 60 * 60 * 1000;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;
const snapshotPattern = /^atlas-v1-\d{8}T\d{6}Z$/u;

export type SpaceRecoveryStatus = {
  state: "healthy" | "warning" | "paused" | "unknown";
  checkedAt?: string;
  availableBytes?: number;
  metadataPercent?: number;
};

export type BackupRecoveryStatus = {
  state: "success" | "failure" | "unknown";
  checkedAt?: string;
  lastSuccessAt?: string;
  lastSnapshot?: string;
};

export type RecoveryStatus = {
  space: SpaceRecoveryStatus;
  backup: BackupRecoveryStatus;
};

const unknownStatus = (): RecoveryStatus => ({
  space: { state: "unknown" },
  backup: { state: "unknown" },
});

const validTimestamp = (value: string, now: number, maxAge: number) => {
  if (!timestampPattern.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && time <= now + 5 * 60 * 1000 && now - time <= maxAge;
};

const optionalInteger = (value: string, maximum = Number.MAX_SAFE_INTEGER) => {
  if (value === "unknown") return undefined;
  if (!/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= maximum ? parsed : null;
};

export const readRecoveryStatus = (
  path = process.env.ATLAS_RECOVERY_STATUS_PATH ?? "/var/lib/atlas/recovery-status",
  now = Date.now(),
): RecoveryStatus => {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_STATUS_BYTES) return unknownStatus();
    const entries = new Map<string, string>();
    for (const line of readFileSync(path, "utf8").trimEnd().split("\n")) {
      const separator = line.indexOf("=");
      if (separator <= 0) return unknownStatus();
      const key = line.slice(0, separator);
      const value = line.slice(separator + 1);
      if (entries.has(key) || !/^[a-z_]+$/u.test(key) || !/^[A-Za-z0-9:._+-]+$/u.test(value)) return unknownStatus();
      entries.set(key, value);
    }

    const expectedKeys = new Set([
      "version",
      "space_checked_at",
      "space_state",
      "space_available_bytes",
      "space_metadata_percent",
      "space_reason",
      "backup_checked_at",
      "backup_state",
      "backup_last_success_at",
      "backup_last_snapshot",
      "backup_reason",
    ]);
    if (entries.size !== expectedKeys.size || [...entries.keys()].some((key) => !expectedKeys.has(key)) || entries.get("version") !== "1") {
      return unknownStatus();
    }

    const spaceState = entries.get("space_state")!;
    const backupState = entries.get("backup_state")!;
    const availableBytes = optionalInteger(entries.get("space_available_bytes")!);
    const metadataPercent = optionalInteger(entries.get("space_metadata_percent")!, 100);
    const spaceReason = entries.get("space_reason")!;
    const backupReason = entries.get("backup_reason")!;
    if (!new Set(["healthy", "warning", "paused", "unknown"]).has(spaceState) ||
      !new Set(["success", "failure", "unknown"]).has(backupState) ||
      !new Set(["none", "free_bytes", "metadata", "free_bytes_and_metadata", "metadata_unavailable", "unavailable"]).has(spaceReason) ||
      !new Set(["none", "source_invalid", "scope_incomplete", "snapshot_failed", "snapshot_invalid", "retention_failed", "status_failed", "unavailable"]).has(backupReason) ||
      availableBytes === null || metadataPercent === null) return unknownStatus();

    const spaceCheckedAt = entries.get("space_checked_at")!;
    const backupCheckedAt = entries.get("backup_checked_at")!;
    const configuredSpaceAge = Number(process.env.ATLAS_RECOVERY_STATUS_MAX_AGE_MS ?? DEFAULT_SPACE_MAX_AGE_MS);
    const spaceMaxAge = Number.isSafeInteger(configuredSpaceAge) && configuredSpaceAge >= 60_000
      ? configuredSpaceAge
      : DEFAULT_SPACE_MAX_AGE_MS;
    const spaceCurrent = spaceState !== "unknown" && availableBytes !== undefined && validTimestamp(spaceCheckedAt, now, spaceMaxAge);
    const backupCurrent = backupState !== "unknown" && validTimestamp(backupCheckedAt, now, BACKUP_MAX_AGE_MS);

    const lastSuccessAt = entries.get("backup_last_success_at")!;
    const lastSnapshot = entries.get("backup_last_snapshot")!;
    const validLastSuccess = lastSuccessAt !== "unknown" && snapshotPattern.test(lastSnapshot) && validTimestamp(lastSuccessAt, now, Number.MAX_SAFE_INTEGER);
    if (backupState === "success" && !validLastSuccess || (lastSuccessAt === "unknown") !== (lastSnapshot === "unknown")) return unknownStatus();

    return {
      space: spaceCurrent
        ? {
          state: spaceState as Exclude<SpaceRecoveryStatus["state"], "unknown">,
          checkedAt: spaceCheckedAt,
          ...(availableBytes === undefined ? {} : { availableBytes }),
          ...(metadataPercent === undefined ? {} : { metadataPercent }),
        }
        : { state: "unknown" },
      backup: backupCurrent
        ? {
          state: backupState as Exclude<BackupRecoveryStatus["state"], "unknown">,
          checkedAt: backupCheckedAt,
          ...(validLastSuccess ? { lastSuccessAt, lastSnapshot } : {}),
        }
        : { state: "unknown" },
    };
  } catch {
    return unknownStatus();
  }
};
