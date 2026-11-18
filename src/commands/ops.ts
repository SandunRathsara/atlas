// `atlas ops <tool> [args]`: the operator maintenance tools, shipped inside the
// binary so an installed host needs no Bun and no source tree.
//
// Shell tools (deploy/*.sh) are embedded as text. Each run writes them into a
// fresh private (0700) temp folder in their source layout, runs the one asked
// for with bash, and removes the folder. ATLAS_BIN is set to this binary so
// the scripts can call back into `atlas ops` (scrub, restored-state check,
// SQLite version). The TypeScript tools run in-process.
import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import snapshot from "../../deploy/atlas-snapshot.sh" with { type: "text" };
import snapshotMarker from "../../deploy/atlas-snapshot.marker" with { type: "text" };
import captureRecoveryConfig from "../../deploy/capture-recovery-config.sh" with { type: "text" };
import checkHealth from "../../deploy/check-health.sh" with { type: "text" };
import checkSpace from "../../deploy/check-space.sh" with { type: "text" };
import installOpenCodeConfig from "../../deploy/install-opencode-config.sh" with { type: "text" };
import recoveryStatus from "../../deploy/lib/recovery-status.sh" with { type: "text" };
import openCodeConfig from "../../deploy/opencode/opencode.json" with { type: "text" };
import restoreRehearsal from "../../deploy/restore-rehearsal.sh" with { type: "text" };
import stageOpenCode from "../../deploy/stage-opencode.sh" with { type: "text" };
import verifySqliteWal from "../../deploy/verify-sqlite-wal.sh" with { type: "text" };

/** Relative path → text, as laid out under deploy/. */
export const EMBEDDED_OPS_FILES: Record<string, string> = {
  "atlas-snapshot.sh": snapshot,
  "atlas-snapshot.marker": snapshotMarker,
  "capture-recovery-config.sh": captureRecoveryConfig,
  "check-health.sh": checkHealth,
  "check-space.sh": checkSpace,
  "install-opencode-config.sh": installOpenCodeConfig,
  "lib/recovery-status.sh": recoveryStatus,
  // Imported as text; the JSON type is only TypeScript's view.
  "opencode/opencode.json": openCodeConfig as unknown as string,
  "restore-rehearsal.sh": restoreRehearsal,
  "stage-opencode.sh": stageOpenCode,
  "verify-sqlite-wal.sh": verifySqliteWal,
};

const SCRIPT_TOOLS: Record<string, string> = {
  snapshot: "atlas-snapshot.sh",
  "check-space": "check-space.sh",
  "capture-recovery-config": "capture-recovery-config.sh",
  "restore-rehearsal": "restore-rehearsal.sh",
  "verify-sqlite-wal": "verify-sqlite-wal.sh",
  "install-opencode-config": "install-opencode-config.sh",
  "check-health": "check-health.sh",
  "stage-opencode": "stage-opencode.sh",
};

const sqliteVersion = () => {
  const db = new Database(":memory:");
  try {
    const row = db.query("SELECT sqlite_version() AS version").get() as { version: string };
    process.stdout.write(`bun=${Bun.version}\nsqlite=${row.version}\n`);
    return 0;
  } finally {
    db.close();
  }
};

const IN_PROCESS: Record<string, (args: string[]) => number | Promise<number>> = {
  "scrub-opencode-credentials": async (args) => (await import("../ops/scrub-opencode-credentials.ts")).run(args),
  "check-restored-state": async (args) => (await import("../ops/check-restored-state.ts")).run(args),
  "sqlite-version": () => sqliteVersion(),
};

const usage = () => {
  process.stderr.write(`usage: atlas ops <tool> [args]\ntools: ${[...Object.keys(SCRIPT_TOOLS), ...Object.keys(IN_PROCESS)].join(", ")}\n`);
  return 2;
};

/** Writes the embedded tools into a new private folder and returns it. */
export const materializeOps = () => {
  const folder = mkdtempSync(join(tmpdir(), "atlas-ops-"));
  chmodSync(folder, 0o700);
  for (const [path, text] of Object.entries(EMBEDDED_OPS_FILES)) {
    const target = join(folder, path);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(target, text, { mode: 0o600, flag: "wx" });
    chmodSync(target, path.endsWith(".sh") ? 0o500 : 0o400);
  }
  return folder;
};

/** The binary scripts call back into. A development checkout (`bun src/cli.ts`) must set ATLAS_BIN itself. */
const atlasBinary = () => process.env.ATLAS_BIN ?? process.execPath;

export const run = async (args: string[]) => {
  const [tool, ...rest] = args;
  if (!tool || tool === "--help" || tool === "-h") return usage();
  const inProcess = IN_PROCESS[tool];
  if (inProcess) return await inProcess(rest);
  const script = SCRIPT_TOOLS[tool];
  if (!script) return usage();

  const folder = materializeOps();
  try {
    const child = Bun.spawn(["bash", join(folder, script), ...rest], {
      env: { ...process.env, ATLAS_BIN: atlasBinary() },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    return await child.exited;
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
};
