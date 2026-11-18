// `atlas setup`: fresh install, safe re-run, or adoption of an older
// /opt/atlas install (Bun + source-tree units). Order:
//   1. read the Release to install and what is already on the host (no changes)
//   2. preflight (no changes; stops with fix-it hints)
//   3. answers: flags > answers file > existing config > terminal prompt
//   4. plan; `--dry-run` prints it and stops
//   5. adopt only: Session check, backup, stop the old services
//   6. write config, Release folder, `current`, support bundle, units
//   7. start, wait for /health, then optionally Tailscale Serve
// Re-runs keep secrets and config unless a flag or answer says otherwise; a
// changed file is backed up first.
//
// Trust boundary: the service user is assumed hostile. Root never follows a
// path that account can change: config lives in root-only /etc/atlas, the
// GitHub App key has a fixed path, and everything inside the data folder is
// created or read by the service user itself (`host.runAs`).
import { createHash, createPrivateKey, randomBytes } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import journaldConfig from "../../deploy/journald/atlas.conf" with { type: "text" };
import { materializeOps, type SessionSummary } from "../commands/ops.ts";
import { compareReleaseTags, assertReleaseMetadata, MAX_RELEASE_ASSET_BYTES, RELEASE_ASSET_NAME, type ReleaseMetadata } from "../release.ts";
import { buildReleaseFolder, releaseFolderIntact, releaseFolderName } from "../release-layout.ts";
import { installShippedSupportServices } from "../updater.ts";
import { checkActivationHealth } from "../updater-server.ts";
import { MAINTENANCE_UNIT_NAMES, renderMaintenanceUnits, renderUnits, UNIT_NAMES } from "../units.ts";
import { parseSetupArgs, SETUP_USAGE, UsageError, type Answers, type SetupOptions } from "./answers.ts";
import {
  assertSafeParents, at, backupFile, ensureDirectory, fileMatches, lstat, parseEnv, readFileSafe, readText, replaceSymlink,
  rootOnly, ROOT_OWNER, UnsafePathError, updateEnv, writeFileAtomic, type Owner,
} from "./files.ts";
import { realHost, type Account, type RunAs, type SetupHost } from "./host.ts";
import { DEFAULT_OPENCODE, preflight, printFindings } from "./preflight.ts";
import { funnelHint, setUpTailscale } from "./tailscale.ts";

const PREFIX = "/opt/atlas";
const CONFIG = "/etc/atlas";
/** Fixed: never taken from an env file. */
const KEY_PATH = `${CONFIG}/github-app.pem`;
const DEFAULT_USER = "atlas";
/** Groups that can become root (or as good as). */
const PRIVILEGED_GROUPS = ["root", "sudo", "wheel", "admin", "adm", "docker", "lxd", "incus", "libvirt", "disk"];
/** atlas.env keys that name paths; trusted only from a root-only atlas.env. */
const PATH_KEYS = [
  "ATLAS_DATABASE_PATH", "ATLAS_SESSION_ROOT", "ATLAS_CREDENTIAL_REGISTRY_PATH", "ATLAS_RECOVERY_CONFIG_ROOT", "OPENCODE_SERVICE_FILE",
  "ATLAS_RECOVERY_STATUS_PATH", "ATLAS_GITHUB_ENV_PATH", "ATLAS_SUPPLIER_KEY_PATH", "ATLAS_UPDATER_KEY_PATH", "ATLAS_SUPPLIER_SOCKET",
  "ATLAS_UPDATER_SOCKET",
];
const UNIT_DIR = "/etc/systemd/system";
const BACKUP_ROOT = "/var/backups/atlas";
const BIN_LINK = "/usr/local/bin/atlas";
const JOURNALD = "/etc/systemd/journald@atlas.conf";
const START_ORDER = ["atlas-credentials.service", "atlas-updater.service", "atlas.service"] as const;
const STOP_ORDER = ["atlas.service", "atlas-updater.service", "atlas-credentials.service"] as const;

/** A planned stop: the message is already user-facing. */
export class SetupStop extends Error {}

type Mode = "fresh" | "rerun" | "adopt";

type Existing = {
  layout: "none" | "current" | "old";
  atlasEnvText: string | null;
  githubEnvText: string | null;
  atlasEnv: Map<string, string>;
  githubEnv: Map<string, string>;
  unitUser?: string;
  unitGroup?: string;
  realGit?: string;
  realGh?: string;
  openCode?: string;
};

type Config = {
  /** uid/gid are -1 until a new account is created. */
  user: Account;
  group: string;
  gid: number;
  /** Create the service account (consented). */
  createUser: boolean;
  /** Why this account can become root; empty when it cannot. */
  privileged: string[];
  organization: string;
  appId: string;
  installationId: string;
  /** PEM to install at KEY_PATH; null keeps the installed key. */
  privateKey: { bytes: Buffer; from: string } | null;
  origin: string | undefined;
  port: number;
  webhookPort: number;
  dataDir: string;
  git: string;
  gh: string;
  openCode: string;
  openCodePresent: boolean;
  btrfs: boolean;
};

// ---------- reading ----------

type Source = { binary: string; metadata: ReleaseMetadata; stage: string };

/** Root-owned parent for the staged copy of the Release (on disk, not tmpfs). */
const STAGE_PARENT = "/var/tmp";

/**
 * Copies the Release to install into a new root-owned folder and reads it only
 * from there, so nobody can change it between the checks and the install.
 * As root, the source folder, its parents, and each file must be root-only.
 */
const loadSource = (host: SetupHost, options: SetupOptions): Source => {
  const fromExec = !options.sourceDir;
  let directory: string;
  try {
    directory = fromExec ? dirname(realpathSync(host.execPath)) : realpathSync(resolve(options.sourceDir!));
  } catch {
    throw new SetupStop(fromExec ? "No Release to install was found next to this binary. Use install.sh, or pass --source-dir <folder>." : `${options.sourceDir} does not exist`);
  }
  const names = fromExec
    ? { binary: "atlas", metadata: "RELEASE_METADATA.json", checksum: null }
    : { binary: RELEASE_ASSET_NAME, metadata: "atlas-release.json", checksum: `${RELEASE_ASSET_NAME}.sha256` };
  const unsafe = (what: string) => new SetupStop(
    `${what} must be owned by root and not writable by any other account. Download the Release into a root-only folder (install.sh does this) and run setup again.`,
  );
  if (host.isRoot) {
    const stat = readdirStat(directory);
    if (!stat || !rootOnly(host, stat)) throw unsafe(directory);
    try {
      assertSafeParents(host, directory);
    } catch (error) {
      if (error instanceof UnsafePathError) throw unsafe(`Every folder above ${directory}`);
      throw error;
    }
  }
  const stage = mkdtempSync(join(STAGE_PARENT, "atlas-setup-"));
  try {
    // Readable and executable by the service user (it runs `atlas ops session-summary`), writable only by root.
    chmodSync(stage, 0o755);
    const copy = (name: string, target: string, mode: number, limit: number, optional = false) => {
      const file = readFileSafe(join(directory, name), limit);
      if (!file) {
        if (optional && !lstat({ root: "" }, join(directory, name))) return null;
        throw new SetupStop(`${join(directory, name)} is missing or not a regular file`);
      }
      if (host.isRoot && !rootOnly(host, file.stat)) throw unsafe(join(directory, name));
      writeFileSync(join(stage, target), file.bytes, { mode, flag: "wx" });
      chmodSync(join(stage, target), mode);
      return file.bytes;
    };
    const binary = copy(names.binary, "atlas", 0o555, MAX_RELEASE_ASSET_BYTES)!;
    const metadataBytes = copy(names.metadata, "atlas-release.json", 0o444, 64 * 1024)!;
    const checksum = names.checksum ? copy(names.checksum, "atlas-linux-x64.sha256", 0o444, 4096, true) : null;
    let metadata: ReleaseMetadata;
    try {
      metadata = assertReleaseMetadata(JSON.parse(metadataBytes.toString("utf8")));
    } catch (error) {
      throw new SetupStop(`${join(directory, names.metadata)} is invalid: ${(error as Error).message}`);
    }
    if (checksum && checksum.toString("utf8").trim().split(/\s+/u)[0] !== metadata.asset.sha256) {
      throw new SetupStop(`${join(directory, names.checksum!)} does not match ${names.metadata}`);
    }
    if (binary.byteLength !== metadata.asset.size || createHash("sha256").update(binary).digest("hex") !== metadata.asset.sha256) {
      throw new SetupStop(`${join(directory, names.binary)} does not match the SHA-256 in ${names.metadata}`);
    }
    return { binary: join(stage, "atlas"), metadata, stage };
  } catch (error) {
    rmSync(stage, { recursive: true, force: true });
    throw error;
  }
};

const readdirStat = (directory: string) => {
  const stat = lstat({ root: "" }, directory);
  return stat?.isDirectory() ? stat : null;
};

const unitValue = (text: string, pattern: RegExp) => pattern.exec(text)?.[1]?.trim();

/** Text of a file only root can have written (root-owned, not group/other writable), else null. */
const readTrusted = (host: SetupHost, path: string) => {
  const file = readFileSafe(at(host, path));
  return file && rootOnly(host, file.stat) ? file.bytes.toString("utf8") : null;
};

const readExisting = (host: SetupHost): Existing => {
  for (const name of ["atlas.service", "opencode.service"]) {
    const path = `${UNIT_DIR}/${name}`;
    if (lstat(host, path) && readTrusted(host, path) === null) {
      throw new SetupStop(`${path} is not a regular file owned by root and writable only by root, so systemd may already run something another account controls. Check it, then fix it: chown root:root ${path} && chmod 0644 ${path}`);
    }
  }
  const unit = readTrusted(host, `${UNIT_DIR}/atlas.service`);
  const openCodeUnit = readTrusted(host, `${UNIT_DIR}/opencode.service`) ?? "";
  const atlasEnvText = readText(host, `${CONFIG}/atlas.env`);
  const atlasEnv = parseEnv(atlasEnvText ?? "");
  const atlasEnvTrusted = atlasEnvText !== null && readTrusted(host, `${CONFIG}/atlas.env`) !== null;
  if (atlasEnvText !== null && !atlasEnvTrusted) {
    // Another account could have written it: keep its secrets, never its paths.
    host.out(`! ${CONFIG}/atlas.env is not root-only; its paths are ignored and it is rewritten root:root 0600.`);
    for (const key of PATH_KEYS) atlasEnv.delete(key);
  }
  // github.env may still be service-owned (older installs): only its IDs are used, never a path.
  const githubEnvText = readText(host, `${CONFIG}/github.env`);
  const githubEnvTrusted = githubEnvText !== null && readTrusted(host, `${CONFIG}/github.env`) !== null;
  const layout = unit === null
    ? (atlasEnvText !== null ? "current" : "none")
    : /\/bun\b|src\/server\.ts/u.test(unit) ? "old" : "current";
  const units = `${unit ?? ""}\n${openCodeUnit}`;
  return {
    layout,
    // Rewritten from a fresh header unless only root could have written them.
    atlasEnvText: atlasEnvTrusted ? atlasEnvText : null,
    githubEnvText: githubEnvTrusted ? githubEnvText : null,
    atlasEnv,
    githubEnv: parseEnv(githubEnvText ?? ""),
    unitUser: unitValue(units, /^User=(\S+)$/mu),
    unitGroup: unitValue(units, /^Group=(\S+)$/mu),
    realGit: unitValue(units, /^Environment=ATLAS_REAL_GIT=(\S+)$/mu) ?? unitValue(units, /^ExecStartPre=\/usr\/bin\/test -x (\S+\/bin\/git)$/mu),
    realGh: unitValue(units, /^Environment=ATLAS_REAL_GH=(\S+)$/mu),
    openCode: unitValue(openCodeUnit, /^ExecStart=(\S+) --log-level/mu),
  };
};

const usable = (host: SetupHost, path: string | undefined) => (path && host.executable(path) ? path : undefined);

const stamp = (host: SetupHost) => host.now().toISOString().replace(/[-:]/gu, "").replace(/\.\d+Z$/u, "Z");

const nearestExisting = (host: SetupHost, path: string) => {
  let current = path;
  while (current !== "/" && !lstat(host, current)) current = dirname(current);
  return current;
};

const isBtrfs = async (host: SetupHost, dataDir: string) => {
  const result = await host.run(["stat", "-f", "-c", "%T", at(host, nearestExisting(host, dataDir))], { timeoutMs: 10_000 });
  return result.code === 0 && result.stdout.trim() === "btrfs";
};

type SessionCheck = SessionSummary;

/** Active Sessions, read by the service user through the staged binary (root never opens the database). */
const readSessions = async (host: SetupHost, binary: string, reader: RunAs | undefined, dataDir: string): Promise<SessionCheck> => {
  const path = `${dataDir}/atlas.sqlite`;
  if (!lstat(host, path)) return { active: {}, schema: null, readable: true };
  if (!reader) return { active: {}, schema: null, readable: false };
  const result = await host.runAs(reader, [binary, "ops", "session-summary", at(host, path)], { timeoutMs: 30_000 });
  try {
    const parsed = JSON.parse(result.stdout) as SessionSummary;
    const counts = Object.values(parsed.active ?? {});
    if (result.code !== 0 || typeof parsed.readable !== "boolean" || !counts.every((count) => Number.isSafeInteger(count) && count >= 0) ||
        !(parsed.schema === null || Number.isSafeInteger(parsed.schema))) throw new Error();
    return { active: parsed.active, schema: parsed.schema, readable: parsed.readable };
  } catch {
    return { active: {}, schema: null, readable: false };
  }
};

// ---------- answers ----------

const ORG = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u;
const DIGITS = /^[1-9]\d{0,19}$/u;
const PLAIN_PATH = /^\/[A-Za-z0-9._/@+-]*[^/]$/u;
const USER_NAME = /^[a-z_][a-z0-9_-]{0,30}$/u;
/** Folders the data folder must not be (or be inside). */
const SYSTEM_FOLDERS = ["/bin", "/boot", "/dev", "/etc", "/lib", "/lib64", "/opt/atlas", "/proc", "/root", "/run", "/sbin", "/sys", "/usr", "/var/backups/atlas"];
const SYSTEM_EXACT = ["/home", "/opt", "/srv", "/tmp", "/var", "/var/lib", "/var/tmp", "/mnt", "/media"];

const validateOrigin = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value ? null : "must look like https://host (no path, no trailing slash)";
  } catch {
    return "must be an https:// URL";
  }
};

const pemError = (text: string) => {
  try {
    const key = createPrivateKey(text);
    return key.asymmetricKeyType === "rsa" ? null : "is not an RSA private key (GitHub App keys are RSA)";
  } catch {
    return "is not a readable PEM private key";
  }
};

/** The operator named this file, so root reads it. */
const validatePem = (path: string) => {
  try {
    return pemError(readFileSync(path, "utf8"));
  } catch {
    return "is not a readable PEM private key";
  }
};

const validatePort = (value: number) => (Number.isInteger(value) && value >= 1 && value <= 65535 ? null : "must be a port 1-65535");

const askYesNo = async (host: SetupHost, question: string) => {
  for (;;) {
    const answer = (await host.prompter!.ask(`${question} [y/n] `)).trim().toLowerCase();
    if (answer === "y" || answer === "yes") return true;
    if (answer === "n" || answer === "no") return false;
  }
};

/** Explicit answer (validated), else existing value, else a prompt (or a stop without a terminal). */
const resolveAnswer = async (
  host: SetupHost,
  spec: { label: string; flag: string; explicit?: string; existing?: string; fallback?: string; optional?: boolean; validate: (value: string) => string | null },
) => {
  if (spec.explicit !== undefined) {
    const error = spec.explicit === "" && spec.optional ? null : spec.validate(spec.explicit);
    if (error) throw new SetupStop(`${spec.flag} ${spec.explicit}: ${spec.label} ${error}`);
    return spec.explicit;
  }
  // A stored value is used only while it is still valid; otherwise it counts as missing.
  if (spec.existing !== undefined && spec.validate(spec.existing) === null) return spec.existing;
  if (!host.prompter) {
    if (spec.fallback !== undefined || spec.optional) return spec.fallback ?? "";
    throw new SetupStop(`Missing answer: ${spec.label}. Pass ${spec.flag} or put it in --answers.`);
  }
  for (;;) {
    const hint = spec.fallback !== undefined ? ` [${spec.fallback}]` : spec.optional ? " (Enter to skip)" : "";
    const value = (await host.prompter.ask(`${spec.label}${hint}: `)).trim() || spec.fallback || "";
    if (!value && spec.optional) return "";
    const error = spec.validate(value);
    if (!error) return value;
    host.out(`  ${spec.label} ${error}`);
  }
};

/** Why `account` (or `group`) can become root; best effort. Empty when it cannot. */
const privilegeReasons = async (host: SetupHost, account: Account, group: string) => {
  const reasons: string[] = [];
  if (account.uid === 0 || account.gid === 0) reasons.push("it is root");
  const groups = (await host.run(["id", "-nG", "--", account.name], { timeoutMs: 10_000 })).stdout.trim().split(/\s+/u).filter(Boolean);
  for (const name of new Set([...groups, group])) if (PRIVILEGED_GROUPS.includes(name)) reasons.push(`group ${name}`);
  const sudo = await host.run(["sudo", "-n", "-l", "-U", account.name], { timeoutMs: 10_000 });
  if (sudo.code === 0 && /may run the following commands/iu.test(sudo.stdout)) reasons.push("sudo rules");
  return reasons;
};

const riskText = (name: string, reasons: string[]) => [
  `${name} can become root (${reasons.join(", ")}).`,
  "Atlas runs AI coding Sessions as this account, so anything that takes over a Session could take over this whole machine.",
];

const gatherConfig = async (
  host: SetupHost,
  answers: Answers,
  existing: Existing,
  tools: { git: string; gh: string; openCode: string; openCodePresent: boolean },
  mode: Mode,
): Promise<Config> => {
  const fresh = mode === "fresh";
  // An installed host keeps its service user unless --user says otherwise.
  const kept = answers.user === undefined && existing.unitUser !== undefined && USER_NAME.test(existing.unitUser) &&
    (host.user(existing.unitUser)?.uid ?? 0) !== 0 ? existing.unitUser : undefined;
  const userName = kept ?? await resolveAnswer(host, {
    label: "Service user (runs Atlas; a dedicated account is safest)", flag: "--user", explicit: answers.user, fallback: DEFAULT_USER,
    validate: (value) => (!USER_NAME.test(value) ? "is not a valid account name" : host.user(value)?.uid === 0 ? "must not be root" : null),
  });
  const account = host.user(userName);
  if (account?.uid === 0) throw new SetupStop(`Service user ${userName} must not be root.`);
  let group: string;
  if (account) {
    group = await resolveAnswer(host, {
      label: "Service group", flag: "--group", explicit: answers.group, existing: kept ? existing.unitGroup : undefined,
      fallback: host.group(account.name) !== null ? account.name : undefined,
      validate: (value) => (host.group(value) === null ? "does not exist" : host.group(value) === 0 ? "must not be root" : null),
    });
  } else {
    // A new account gets its own group.
    if (answers.group !== undefined && answers.group !== userName) throw new SetupStop(`--group: a new account ${userName} gets its own group ${userName}.`);
    group = userName;
  }
  const gid = account ? host.group(group) : -1;
  if (gid === null || gid === 0) throw new SetupStop(`Service group ${group} does not exist or is root.`);

  // Never run as an account that can become root without an explicit yes.
  const privileged = account ? await privilegeReasons(host, account, group) : [];
  if (privileged.length > 0) {
    const [risk, impact] = riskText(userName, privileged);
    if (kept) {
      host.out(`! ${risk} ${impact}`);
      host.out(`  Kept, because this install already runs as ${userName}. To move: atlas setup --user atlas --create-user`);
    } else if (answers.allowPrivilegedUser) {
      host.out(`! ${risk} Allowed by --allow-privileged-user.`);
    } else if (host.prompter) {
      host.out(`! ${risk}`);
      host.out(`  ${impact}`);
      if (!await askYesNo(host, `Run Atlas as ${userName} anyway?`)) {
        throw new SetupStop("Nothing was changed. Use a dedicated account instead: --user atlas --create-user");
      }
    } else {
      throw new SetupStop(`${risk} ${impact} Use a dedicated account (--user atlas --create-user), or pass --allow-privileged-user.`);
    }
  }

  const organization = await resolveAnswer(host, {
    label: "GitHub organization", flag: "--org", explicit: answers.organization, existing: existing.githubEnv.get("ATLAS_GITHUB_ORGANIZATION"),
    validate: (value) => (ORG.test(value) ? null : "is not a GitHub login"),
  });
  const appId = await resolveAnswer(host, {
    label: "GitHub App ID", flag: "--app-id", explicit: answers.appId, existing: existing.githubEnv.get("ATLAS_GITHUB_APP_ID"),
    validate: (value) => (DIGITS.test(value) ? null : "must be a number"),
  });
  const installationId = await resolveAnswer(host, {
    label: "GitHub App installation ID", flag: "--installation-id", explicit: answers.installationId,
    existing: existing.githubEnv.get("ATLAS_GITHUB_INSTALLATION_ID"),
    validate: (value) => (DIGITS.test(value) ? null : "must be a number"),
  });

  // The key always lives at KEY_PATH. A path from github.env (which older
  // installs let the service user write) is read only as that user.
  const askForKey = async () => {
    const source = await resolveAnswer(host, {
      label: "GitHub App private key file (.pem)", flag: "--private-key", explicit: answers.privateKeyPath, validate: validatePem,
    });
    return { bytes: readFileSync(source), from: source };
  };
  let privateKey: Config["privateKey"] = null;
  if (answers.privateKeyPath !== undefined) {
    privateKey = await askForKey();
  } else if (!readFileSafe(at(host, KEY_PATH))) {
    const legacy = existing.githubEnv.get("ATLAS_GITHUB_APP_PRIVATE_KEY_PATH");
    if (legacy && legacy !== KEY_PATH && PLAIN_PATH.test(legacy) && account) {
      const read = await host.runAs({ user: account.name, group }, ["cat", "--", at(host, legacy)], { timeoutMs: 10_000 });
      if (read.code === 0 && read.stdout.length <= 64 * 1024 && pemError(read.stdout) === null) {
        privateKey = { bytes: Buffer.from(read.stdout), from: `${legacy} (read as ${account.name})` };
      } else {
        host.out(`! The GitHub App key named in github.env (${legacy}) could not be read as ${account.name}.`);
      }
    }
    privateKey ??= await askForKey();
  }

  const originAnswer = await resolveAnswer(host, {
    label: "Browser URL for Atlas, https://… (Enter: use Tailscale or set later)", flag: "--origin",
    explicit: answers.origin, existing: existing.atlasEnv.get("ATLAS_ORIGIN"), optional: true,
    ...(fresh ? {} : { fallback: "" }),
    validate: (value) => validateOrigin(value),
  });
  const portText = (key: "port" | "webhookPort", envKey: string, label: string, fallback: string) => resolveAnswer(host, {
    label, flag: key === "port" ? "--port" : "--webhook-port", explicit: answers[key]?.toString(), existing: existing.atlasEnv.get(envKey),
    fallback, validate: (value) => validatePort(Number(value)),
  });
  const port = Number(await portText("port", "ATLAS_PORT", "UI port (localhost only)", "3000"));
  const webhookPort = Number(await portText("webhookPort", "ATLAS_WEBHOOK_PORT", "Webhook port (localhost only)", "3001"));
  if (port === webhookPort) throw new SetupStop("The UI port and the webhook port must differ.");
  if (port === 49475 || webhookPort === 49475) throw new SetupStop("Port 49475 is OpenCode's; pick another port.");
  const existingDatabase = existing.atlasEnv.get("ATLAS_DATABASE_PATH");
  const dataDir = await resolveAnswer(host, {
    label: "Data folder", flag: "--data-dir", explicit: answers.dataDir,
    existing: existingDatabase ? dirname(existingDatabase) : undefined, fallback: "/var/lib/atlas",
    validate: (value) => {
      if (!PLAIN_PATH.test(value) || value.split("/").includes("..") || value === "/") return "must be a plain absolute path";
      if (SYSTEM_EXACT.includes(value) || SYSTEM_FOLDERS.some((folder) => value === folder || value.startsWith(`${folder}/`))) {
        return "must be a folder of its own, not a system folder";
      }
      return null;
    },
  });

  let createUser = false;
  if (!account) {
    const question = `Create the system account ${userName} (no password, no login shell, home ${dataDir}/home)?`;
    if (answers.createUser) createUser = true;
    else if (host.prompter) createUser = await askYesNo(host, question);
    if (!createUser) {
      throw new SetupStop(`Service user ${userName} does not exist. Re-run with --create-user to create it, or pass --user <existing account>.`);
    }
  }
  return {
    user: account ?? { name: userName, uid: -1, gid: -1, home: `${dataDir}/home` },
    group, gid, createUser, privileged, organization, appId, installationId, privateKey,
    origin: originAnswer || undefined, port, webhookPort, dataDir,
    ...tools, btrfs: await isBtrfs(host, dataDir),
  };
};

// ---------- applying ----------

type Context = {
  host: SetupHost;
  options: SetupOptions;
  mode: Mode;
  plan: string[];
  /** Files changed on this run (host paths). */
  changed: Set<string>;
  /** Files that did not exist before this run. */
  created: string[];
  backupDir: string;
};

const step = async (context: Context, description: string, action: () => unknown) => {
  context.plan.push(description);
  if (!context.options.dryRun) await action();
};

/**
 * Makes `path` a single-link file with exactly this text, mode, and owner.
 * Anything else is replaced by a fresh file (never chmod/chown in place); a
 * changed text is backed up first.
 */
const writeManaged = (context: Context, path: string, text: string | Uint8Array, mode: number, owner: Owner) => {
  const { host } = context;
  if (fileMatches(host, path, text, mode, owner)) return;
  const before = readFileSafe(at(host, path));
  const sameText = before?.bytes.equals(Buffer.from(text)) === true;
  if (!sameText) {
    if (lstat(host, path)) {
      ensureDirectory(host, BACKUP_ROOT, 0o700, ROOT_OWNER);
      backupFile(host, path, context.backupDir);
    } else {
      context.created.push(path);
    }
    context.changed.add(path);
  }
  writeFileAtomic(host, path, text, mode, owner);
};

const secret = () => randomBytes(32).toString("base64url");
const hexKey = () => `${randomBytes(32).toString("hex")}\n`;

const atlasEnvText = (context: Context, config: Config, existing: Existing, secrets: { token: string; webhook: string }) => {
  const explicitData = context.options.answers.dataDir !== undefined;
  const keep = (key: string, value: string, explicit = false) => (explicit ? value : existing.atlasEnv.get(key) ?? value);
  const data = config.dataDir;
  const header = existing.atlasEnvText ?? "# Written by `atlas setup`. root:root 0600. Secrets: never share this file.\n";
  const answers = context.options.answers;
  return updateEnv(header, {
    ATLAS_SHARED_TOKEN: secrets.token,
    ATLAS_GITHUB_WEBHOOK_SECRET: secrets.webhook,
    ATLAS_ORIGIN: config.origin ?? (answers.origin === "" ? undefined : existing.atlasEnv.get("ATLAS_ORIGIN")),
    ATLAS_PORT: keep("ATLAS_PORT", String(config.port), answers.port !== undefined),
    ATLAS_WEBHOOK_PORT: keep("ATLAS_WEBHOOK_PORT", String(config.webhookPort), answers.webhookPort !== undefined),
    // Fixed: root-only files in a root-only folder.
    ATLAS_GITHUB_ENV_PATH: `${CONFIG}/github.env`,
    ATLAS_DATABASE_PATH: keep("ATLAS_DATABASE_PATH", `${data}/atlas.sqlite`, explicitData),
    ATLAS_SESSION_ROOT: keep("ATLAS_SESSION_ROOT", `${data}/sessions`, explicitData),
    ATLAS_CREDENTIAL_REGISTRY_PATH: keep("ATLAS_CREDENTIAL_REGISTRY_PATH", `${data}/session-scopes.json`, explicitData),
    ATLAS_SUPPLIER_SOCKET: keep("ATLAS_SUPPLIER_SOCKET", "/run/atlas/supplier.sock"),
    ATLAS_SUPPLIER_KEY_PATH: `${CONFIG}/supplier.key`,
    ATLAS_UPDATER_SOCKET: keep("ATLAS_UPDATER_SOCKET", "/run/atlas-updater/updater.sock"),
    ATLAS_UPDATER_KEY_PATH: `${CONFIG}/updater.key`,
    // Always the current Release's wrapper (older installs pointed into the source tree).
    ATLAS_GIT_BINARY: `${PREFIX}/current/bin/git`,
    ATLAS_RECOVERY_CONFIG_ROOT: keep("ATLAS_RECOVERY_CONFIG_ROOT", `${data}/recovery-config`, explicitData),
    OPENCODE_SERVICE_FILE: keep("OPENCODE_SERVICE_FILE", `${data}/opencode-state/opencode/service.json`, explicitData),
    // Without the Btrfs space check nothing writes this status, and preparation would wait forever.
    ATLAS_RECOVERY_STATUS_PATH: config.btrfs ? keep("ATLAS_RECOVERY_STATUS_PATH", `${data}/recovery-status`, explicitData) : undefined,
    ATLAS_ADMISSION_PAUSED: existing.atlasEnv.get("ATLAS_ADMISSION_PAUSED") ?? "0",
  });
};

const GITHUB_ENV_HEADER = "# Written by `atlas setup`. root:<service group> 0640.\n";

const githubEnvText = (config: Config, existing: Existing) =>
  updateEnv((existing.githubEnvText ?? GITHUB_ENV_HEADER).replace("# Written by `atlas setup`. Owned by the service user, 0600.\n", GITHUB_ENV_HEADER), {
    ATLAS_GITHUB_ORGANIZATION: config.organization,
    ATLAS_GITHUB_INSTALLATION_ID: config.installationId,
    ATLAS_GITHUB_APP_ID: config.appId,
    ATLAS_GITHUB_APP_PRIVATE_KEY_PATH: KEY_PATH,
  });

const systemctl = async (host: SetupHost, ...args: string[]) => {
  const result = await host.run(["systemctl", ...args], { timeoutMs: 120_000 });
  if (result.code !== 0) throw new Error(`systemctl ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
  return result;
};

const isActive = async (host: SetupHost, unit: string) => (await host.run(["systemctl", "is-active", "--quiet", unit], { timeoutMs: 30_000 })).code === 0;

const readLink = (host: SetupHost, path: string) => (lstat(host, path)?.isSymbolicLink() ? readlinkSync(at(host, path)) : null);

/** The Release `current` should select: the new one, or an installed newer one (never downgrade). */
const selectRelease = async (host: SetupHost, metadata: ReleaseMetadata) => {
  try {
    const path = realpathSync(at(host, `${PREFIX}/current`));
    const installed = assertReleaseMetadata(JSON.parse(readFileSync(join(path, "RELEASE_METADATA.json"), "utf8")));
    if (compareReleaseTags(installed.identity.tag, metadata.identity.tag) > 0 && await releaseFolderIntact(path, installed)) {
      return { path, metadata: installed, kept: true };
    }
  } catch { /* no usable current: install the new one */ }
  return { path: join(at(host, `${PREFIX}/releases`), releaseFolderName(metadata)), metadata, kept: false };
};

const pollHealth = async (host: SetupHost, metadata: ReleaseMetadata, port: number, token: string, timeoutMs: number) => {
  const deadline = host.now().getTime() + timeoutMs;
  for (;;) {
    if (await checkActivationHealth(metadata, { port, token }, host.fetch)) return true;
    if (host.now().getTime() >= deadline) return false;
    await host.sleep(1_000);
  }
};

const healthHints = async (host: SetupHost, units: readonly string[]) => {
  for (const unit of units) {
    const state = (await host.run(["systemctl", "is-active", unit], { timeoutMs: 30_000 })).stdout.trim() || "unknown";
    host.out(`   ${unit}: ${state}`);
  }
  host.out("   look: systemctl status atlas.service atlas-credentials.service atlas-updater.service");
  host.out("         journalctl --namespace=atlas -u atlas.service -n 50 --no-pager");
};

const rollbackText = (backupDir: string, links: Record<string, string | null>) => [
  "sudo systemctl stop atlas.service atlas-updater.service atlas-credentials.service",
  `sudo cp -a ${backupDir}${UNIT_DIR}/. ${UNIT_DIR}/`,
  `sudo cp -a ${backupDir}${CONFIG}/. ${CONFIG}/`,
  ...Object.entries(links).map(([path, target]) => (target ? `sudo ln -sfnT ${target} ${path}` : `sudo rm -f ${path}`)),
  "sudo systemctl daemon-reload",
  "sudo systemctl start atlas-credentials.service atlas-updater.service atlas.service",
];

/** Puts the backed-up files and links back and starts the old services. */
const restoreAdopt = async (context: Context, links: Record<string, string | null>, wasActive: string[]) => {
  const { host } = context;
  for (const unit of STOP_ORDER) await host.run(["systemctl", "stop", unit], { timeoutMs: 120_000 });
  for (const path of context.created) rmSync(at(host, path), { force: true });
  for (const path of context.changed) {
    const saved = readFileSafe(at(host, `${context.backupDir}${path}`), 64 * 1024 * 1024);
    if (!saved) continue;
    writeFileAtomic(host, path, saved.bytes, saved.stat.mode & 0o7777, host.owner(saved.stat));
  }
  for (const [path, target] of Object.entries(links)) {
    if (target) replaceSymlink(host, path, target);
    else if (lstat(host, path)?.isSymbolicLink()) unlinkSync(at(host, path));
  }
  await host.run(["systemctl", "daemon-reload"], { timeoutMs: 120_000 });
  for (const unit of START_ORDER) if (wasActive.includes(unit)) await host.run(["systemctl", "start", unit], { timeoutMs: 120_000 });
};

const confirmSessions = async (host: SetupHost, options: SetupOptions, sessions: SessionCheck, why: string) => {
  const total = Object.values(sessions.active).reduce((sum, count) => sum + count, 0);
  if (sessions.readable && total === 0) return;
  const detail = sessions.readable
    ? Object.entries(sessions.active).map(([state, count]) => `${count} ${state}`).join(", ")
    : "the Session database could not be read";
  host.out(`! Active Sessions: ${detail}.`);
  host.out(`  ${why} OpenCode is not restarted, so running Sessions keep their OpenCode work;`);
  host.out("  a Session that is preparing fails and must be started again.");
  if (options.confirmRunningSessions) return;
  if (host.prompter && await askYesNo(host, "Continue anyway?")) return;
  throw new SetupStop("Stopped: wait for Sessions to finish, or re-run with --confirm-running-sessions.");
};

/** Installs the OpenCode config as the service user (the folder is theirs). */
const writeOpenCodeConfig = async (host: SetupHost, account: RunAs, dataDir: string) => {
  const folder = materializeOps({ shared: true });
  try {
    const result = await host.runAs(account, ["bash", join(folder, "install-opencode-config.sh"), at(host, `${dataDir}/opencode-config`)], { timeoutMs: 60_000 });
    if (result.code !== 0) throw new Error(`OpenCode configuration install failed: ${result.stderr.trim()}`);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
};

// ---------- main ----------

export const runSetup = async (args: string[], hostOverride?: SetupHost): Promise<number> => {
  let options: SetupOptions;
  try {
    options = parseSetupArgs(args);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    process.stderr.write(`atlas setup: ${error.message}\n${SETUP_USAGE}`);
    return 2;
  }
  if (options.help) {
    process.stdout.write(SETUP_USAGE);
    return 0;
  }
  const host = hostOverride ?? realHost({ root: options.root, interactive: true });
  try {
    return await setup(host, options);
  } catch (error) {
    if (error instanceof SetupStop) {
      host.out(`✗ ${error.message}`);
      return 1;
    }
    host.out(`✗ Setup failed: ${(error as Error).message}`);
    return 1;
  }
};

const setup = async (host: SetupHost, options: SetupOptions): Promise<number> => {
  const source = loadSource(host, options);
  try {
    return await install(host, options, source);
  } finally {
    rmSync(source.stage, { recursive: true, force: true });
  }
};

const NOLOGIN = ["/usr/sbin/nologin", "/sbin/nologin", "/usr/bin/nologin"];
const DATA_SUBDIRS = ["/sessions", "/opencode-runtime", "/opencode-config", "/opencode-data", "/opencode-data/opencode",
  "/opencode-state", "/opencode-state/opencode", "/opencode-cache"];

/** Stops before any change when the data folder belongs to someone else. */
const checkDataDir = (host: SetupHost, config: Config) => {
  const stat = lstat(host, config.dataDir);
  if (!stat) return;
  if (!stat.isDirectory()) throw new SetupStop(`${config.dataDir} exists and is not a folder.`);
  const owner = host.owner(stat).uid;
  if (owner === 0) {
    if (readdirSync(at(host, config.dataDir)).length > 0) {
      throw new SetupStop(`${config.dataDir} is a root-owned folder that is not empty. Pick an empty or new data folder (--data-dir).`);
    }
  } else if (owner !== config.user.uid) {
    throw new SetupStop(`${config.dataDir} belongs to another account (uid ${owner}). Pick a new data folder (--data-dir).`);
  }
};

const install = async (host: SetupHost, options: SetupOptions, source: Source): Promise<number> => {
  const existing = readExisting(host);
  const mode: Mode = existing.layout === "old" ? "adopt" : existing.layout === "current" ? "rerun" : "fresh";
  const answers = options.answers;
  const tag = source.metadata.identity.tag;
  host.out(`Atlas setup: ${mode === "fresh" ? "new install" : mode === "rerun" ? "updating this install" : "adopting the older install"} of ${tag}${options.dryRun ? " (dry run)" : ""}`);

  // 2. preflight (no changes)
  const check = await preflight(host, {
    git: answers.git ?? usable(host, existing.realGit),
    gh: answers.gh ?? usable(host, existing.realGh),
    openCode: answers.openCode ?? existing.openCode,
    minimums: source.metadata.minimumHostTools,
    dryRun: options.dryRun,
  });
  printFindings(host, "!", check.warnings);
  if (check.failures.length > 0) {
    printFindings(host, "✗", check.failures);
    throw new SetupStop("Nothing was changed. Fix the items above and run setup again.");
  }
  if (mode === "adopt" && !options.adopt && !options.yes) {
    host.out(`Found an older Atlas install (Bun + source tree) run by ${existing.unitUser ?? "unknown user"}.`);
    host.out("Adopting keeps its data and secrets, backs up its units and env files, and switches it to the single binary.");
    if (!host.prompter) throw new SetupStop("Re-run with --adopt to adopt it.");
    if (!await askYesNo(host, "Adopt it now?")) throw new SetupStop("Nothing was changed.");
  }

  // 3. answers
  const config = await gatherConfig(host, answers, existing, {
    git: check.git!.path,
    gh: check.gh!.path,
    openCode: answers.openCode ?? existing.openCode ?? DEFAULT_OPENCODE,
    openCodePresent: check.openCode !== null,
  }, mode);

  const context: Context = {
    host, options, mode, plan: [], changed: new Set(), created: [],
    backupDir: `${BACKUP_ROOT}/${mode === "adopt" ? "" : "setup-"}${stamp(host)}`,
  };
  const selected = await selectRelease(host, source.metadata);
  const newFolder = join(at(host, `${PREFIX}/releases`), releaseFolderName(source.metadata));
  if (lstat(host, `${PREFIX}/releases/${releaseFolderName(source.metadata)}`) && !await releaseFolderIntact(newFolder, source.metadata)) {
    throw new SetupStop(`${PREFIX}/releases/${releaseFolderName(source.metadata)} exists but is not this Release. Move it aside and run setup again.`);
  }

  const token = !options.rotateToken && existing.atlasEnv.get("ATLAS_SHARED_TOKEN") || secret();
  const webhook = !options.rotateWebhookSecret && existing.atlasEnv.get("ATLAS_GITHUB_WEBHOOK_SECRET") || secret();
  const tokenIsNew = token !== existing.atlasEnv.get("ATLAS_SHARED_TOKEN");
  const runAs = { user: config.user.name, group: config.group };
  checkDataDir(host, config);
  // Owners are known once a new account exists (see the first step).
  const userOwner = (): Owner => ({ uid: config.user.uid, gid: config.gid });
  const groupOwner = (): Owner => ({ uid: 0, gid: config.gid });

  // 5. adopt: sessions, backup, stop (recorded so a failure can be undone)
  const links: Record<string, string | null> = {
    [`${PREFIX}/current`]: readLink(host, `${PREFIX}/current`),
    [`${PREFIX}/services/current`]: readLink(host, `${PREFIX}/services/current`),
    [BIN_LINK]: readLink(host, BIN_LINK),
  };
  const reader = config.createUser ? undefined : runAs;
  const sessionsBefore = await readSessions(host, source.binary, reader, config.dataDir);
  const wasActive: string[] = [];
  if (mode === "adopt") {
    await confirmSessions(host, options, sessionsBefore, "Adopting restarts Atlas.");
    await step(context, `back up units and env files to ${context.backupDir}`, () => {
      ensureDirectory(host, BACKUP_ROOT, 0o700, ROOT_OWNER);
      for (const name of [...UNIT_NAMES, ...MAINTENANCE_UNIT_NAMES]) backupFile(host, `${UNIT_DIR}/${name}`, context.backupDir);
      for (const name of ["atlas.env", "github.env"]) backupFile(host, `${CONFIG}/${name}`, context.backupDir);
      const text = rollbackText(context.backupDir, links).join("\n");
      ensureDirectory(host, context.backupDir, 0o700, ROOT_OWNER);
      writeFileAtomic(host, `${context.backupDir}/ROLLBACK.txt`, `${text}\n`, 0o600, ROOT_OWNER);
    });
    for (const unit of [...STOP_ORDER, "atlas-snapshot.timer", "atlas-space-check.timer"]) {
      if (!options.dryRun && await isActive(host, unit)) wasActive.push(unit);
    }
    await step(context, "stop atlas, atlas-updater, atlas-credentials (OpenCode keeps running)", async () => {
      for (const unit of STOP_ORDER) await systemctl(host, "stop", unit);
    });
  }

  const undo = async (reason: string) => {
    host.out(`✗ ${reason}`);
    if (mode !== "adopt") return;
    const sessionsAfter = await readSessions(host, source.binary, reader, config.dataDir);
    if (sessionsAfter.schema === sessionsBefore.schema) {
      host.out("Restoring the old install (the database was not changed)…");
      try {
        await restoreAdopt(context, links, wasActive);
        host.out(`Restored. Old units and env files are back; backup kept at ${context.backupDir}.`);
        return;
      } catch (error) {
        host.out(`✗ Automatic restore failed: ${(error as Error).message}`);
      }
    } else {
      host.out("! The new Atlas already upgraded the database; not restoring automatically.");
    }
    host.out("Roll back by hand:");
    for (const line of rollbackText(context.backupDir, links)) host.out(`   ${line}`);
  };

  try {
    // 6. files
    const unitText = renderUnits({
      user: config.user.name, group: config.group, home: config.user.home, prefix: PREFIX, dataDir: config.dataDir,
      realGit: config.git, realGh: config.gh, openCodeBinary: config.openCode,
    });
    const maintenance = config.btrfs ? renderMaintenanceUnits({ group: config.group, prefix: PREFIX, dataDir: config.dataDir }) : null;

    if (config.createUser) {
      const shell = NOLOGIN.find((candidate) => host.executable(candidate)) ?? NOLOGIN[0]!;
      await step(context, `create the system account ${config.user.name} (own group, no login, home ${config.user.home})`, async () => {
        const result = await host.run(["useradd", "--system", "--user-group", "--home-dir", config.user.home, "--no-create-home",
          "--shell", shell, config.user.name], { timeoutMs: 60_000 });
        const created = host.user(config.user.name);
        const gid = host.group(config.user.name);
        if (result.code !== 0 || !created || created.uid === 0 || gid === null || gid === 0) {
          throw new SetupStop(`Could not create the account ${config.user.name}: ${(result.stderr || result.stdout).trim() || "not found afterwards"}`);
        }
        config.user = created;
        config.gid = gid;
      });
    }
    const subdirs = [...DATA_SUBDIRS, ...(config.user.home.startsWith(`${config.dataDir}/`) ? [config.user.home.slice(config.dataDir.length)] : [])];
    await step(context, `folders: ${PREFIX} (root 0755), ${CONFIG} (root:${config.group} 0750), ${config.dataDir} (${config.user.name} 0700)`, async () => {
      for (const path of [PREFIX, `${PREFIX}/releases`, `${PREFIX}/services`, `${PREFIX}/services/releases`]) ensureDirectory(host, path, 0o755, ROOT_OWNER);
      ensureDirectory(host, CONFIG, 0o750, groupOwner());
      if (config.btrfs) ensureDirectory(host, BACKUP_ROOT, 0o700, ROOT_OWNER);
      checkDataDir(host, config);
      ensureDirectory(host, config.dataDir, 0o700, userOwner());
      // Inside the data folder only the service user creates anything.
      const missing = subdirs.map((path) => at(host, `${config.dataDir}${path}`));
      const result = await host.runAs(runAs, ["mkdir", "-p", "-m", "0700", "--", ...missing], { timeoutMs: 30_000 });
      if (result.code !== 0) throw new Error(`Could not create folders in ${config.dataDir} as ${config.user.name}: ${result.stderr.trim()}`);
    });
    await step(context, config.privateKey
      ? `install the GitHub App key from ${config.privateKey.from} at ${KEY_PATH} (root:${config.group} 0640)`
      : `keep the GitHub App key at ${KEY_PATH} (root:${config.group} 0640)`, () => {
      const bytes = config.privateKey?.bytes ?? readFileSafe(at(host, KEY_PATH))?.bytes;
      if (!bytes) throw new SetupStop(`${KEY_PATH} is missing; pass --private-key <file>.`);
      writeManaged(context, KEY_PATH, bytes, 0o640, groupOwner());
    });
    await step(context, `write ${CONFIG}/github.env (root:${config.group} 0640)`, () =>
      writeManaged(context, `${CONFIG}/github.env`, githubEnvText(config, existing), 0o640, groupOwner()));
    await step(context, `write ${CONFIG}/atlas.env (root 0600)${tokenIsNew ? " with a new sign-in token" : ""}`, () =>
      writeManaged(context, `${CONFIG}/atlas.env`, atlasEnvText(context, config, existing, { token, webhook }), 0o600, ROOT_OWNER));
    await step(context, `keys: ${CONFIG}/supplier.key and ${CONFIG}/updater.key (root:${config.group} 0640)`, () => {
      const supplier = readText(host, `${CONFIG}/supplier.key`);
      writeManaged(context, `${CONFIG}/supplier.key`, supplier && supplier.trim().length >= 32 ? supplier : hexKey(), 0o640, groupOwner());
      const updater = readText(host, `${CONFIG}/updater.key`);
      writeManaged(context, `${CONFIG}/updater.key`, updater && updater.trim().length >= 32 ? updater : hexKey(), 0o640, groupOwner());
    });
    await step(context, `Release folder ${PREFIX}/releases/${releaseFolderName(source.metadata)} (read-only)`, () =>
      buildReleaseFolder({ binaryPath: source.binary, metadata: source.metadata, releasesRoot: at(host, `${PREFIX}/releases`), runAs }));
    await step(context, selected.kept
      ? `keep ${PREFIX}/current at the newer ${selected.metadata.identity.tag}`
      : `point ${PREFIX}/current at ${tag}`, () => {
      if (selected.kept) return;
      if (readLink(host, `${PREFIX}/current`) !== selected.path) {
        replaceSymlink(host, `${PREFIX}/current`, selected.path);
        context.changed.add(`${PREFIX}/current`);
      }
    });
    await step(context, `support services bundle ${PREFIX}/services/current (credentials + updater)`, async () => {
      const before = readLink(host, `${PREFIX}/services/current`);
      await installShippedSupportServices(selected.path, selected.metadata, at(host, `${PREFIX}/services`), runAs);
      if (readLink(host, `${PREFIX}/services/current`) !== before) context.changed.add(`${PREFIX}/services/current`);
    });
    await step(context, `link ${BIN_LINK} -> ${PREFIX}/current/atlas`, () => {
      const linkStat = lstat(host, BIN_LINK);
      if (linkStat && !linkStat.isSymbolicLink()) {
        host.out(`! ${BIN_LINK} is not a symlink; left alone.`);
        return;
      }
      ensureDirectory(host, dirname(BIN_LINK), 0o755, ROOT_OWNER);
      const target = at(host, `${PREFIX}/current/atlas`);
      if (readLink(host, BIN_LINK) !== target) replaceSymlink(host, BIN_LINK, target);
    });
    await step(context, `units: ${UNIT_NAMES.join(", ")}`, () => {
      for (const [name, text] of Object.entries(unitText)) writeManaged(context, `${UNIT_DIR}/${name}`, text, 0o644, ROOT_OWNER);
    });
    if (maintenance) {
      await step(context, `Btrfs found: snapshot and space-check timers (${MAINTENANCE_UNIT_NAMES.join(", ")})`, () => {
        for (const [name, text] of Object.entries(maintenance)) writeManaged(context, `${UNIT_DIR}/${name}`, text, 0o644, ROOT_OWNER);
      });
    } else {
      const stale = MAINTENANCE_UNIT_NAMES.filter((name) => lstat(host, `${UNIT_DIR}/${name}`));
      context.plan.push(`${config.dataDir} is not on Btrfs: no snapshot or space-check timers (back it up yourself)`);
      if (stale.length > 0) {
        await step(context, `remove old maintenance units: ${stale.join(", ")}`, async () => {
          ensureDirectory(host, BACKUP_ROOT, 0o700, ROOT_OWNER);
          for (const name of stale.filter((entry) => entry.endsWith(".timer"))) await host.run(["systemctl", "disable", "--now", name], { timeoutMs: 120_000 });
          for (const name of stale) {
            backupFile(host, `${UNIT_DIR}/${name}`, context.backupDir);
            unlinkSync(at(host, `${UNIT_DIR}/${name}`));
            context.changed.add(`${UNIT_DIR}/${name}`);
          }
        });
      }
    }
    if (!lstat(host, JOURNALD)) {
      await step(context, `journal namespace config ${JOURNALD}`, () => writeManaged(context, JOURNALD, journaldConfig, 0o644, ROOT_OWNER));
    }
    await step(context, `OpenCode headless config in ${config.dataDir}/opencode-config/opencode`, () => writeOpenCodeConfig(host, runAs, config.dataDir));

    // 7. services
    const restart = mode !== "rerun" || context.changed.size > 0;
    if (restart && mode === "rerun") await confirmSessions(host, options, sessionsBefore, "Applying the changes restarts Atlas.");
    const toEnable = [...START_ORDER, ...(mode === "fresh" && config.openCodePresent ? ["opencode.service"] : [])];
    await step(context, `systemctl daemon-reload; enable ${toEnable.join(", ")}`, async () => {
      await systemctl(host, "daemon-reload");
      await systemctl(host, "enable", ...toEnable);
      if (maintenance) await systemctl(host, "enable", "--now", "atlas-snapshot.timer", "atlas-space-check.timer");
    });
    await step(context, `${restart ? "restart" : "start"} ${START_ORDER.join(", ")}${toEnable.includes("opencode.service") ? ", opencode.service" : ""}`, async () => {
      for (const unit of START_ORDER) await systemctl(host, restart ? "restart" : "start", unit);
      if (toEnable.includes("opencode.service")) await host.run(["systemctl", "start", "opencode.service"], { timeoutMs: 120_000 });
    });
    await step(context, `wait up to ${options.healthTimeoutMs / 1000}s for /health to report ${selected.metadata.identity.tag}`, async () => {
      if (!await pollHealth(host, selected.metadata, config.port, token, options.healthTimeoutMs)) {
        await healthHints(host, START_ORDER);
        throw new Error(`Atlas did not report healthy within ${options.healthTimeoutMs / 1000}s.`);
      }
    });
  } catch (error) {
    if (options.dryRun || error instanceof SetupStop) throw error;
    await undo((error as Error).message);
    return 1;
  }

  if (options.dryRun) {
    host.out("Plan (nothing was changed):");
    for (const line of context.plan) host.out(`  - ${line}`);
    return 0;
  }

  // Tailscale, after the services are healthy
  const tailscale = await setUpTailscale(host, { mode: answers.tailscale ?? "ask", port: config.port, webhookPort: config.webhookPort });
  let origin = config.origin ?? (answers.origin === "" ? undefined : existing.atlasEnv.get("ATLAS_ORIGIN"));
  if (tailscale.kind === "skipped") host.out(tailscale.reason);
  if (tailscale.kind === "served" && !origin) {
    origin = tailscale.url;
    const current = readText(host, `${CONFIG}/atlas.env`) ?? "";
    writeManaged(context, `${CONFIG}/atlas.env`, updateEnv(current, { ATLAS_ORIGIN: origin }), 0o600, ROOT_OWNER);
    await systemctl(host, "restart", "atlas.service");
    if (!await pollHealth(host, selected.metadata, config.port, token, options.healthTimeoutMs)) {
      await healthHints(host, ["atlas.service"]);
      host.out(`✗ Atlas did not come back after setting ATLAS_ORIGIN=${origin}.`);
      return 1;
    }
  }

  // summary
  const dns = tailscale.kind === "served" ? new URL(tailscale.url).hostname : null;
  host.out("");
  host.out(`✓ Atlas ${selected.metadata.identity.tag} is running.`);
  host.out(`  Runs as:  ${config.user.name}${config.createUser ? " (new system account)" : ""}${config.privileged.length > 0 ? ` ! can become root: ${config.privileged.join(", ")}` : ""}`);
  host.out(`  Open:     ${origin ? `${origin}/` : `nothing yet: sign-in needs HTTPS. Run setup with --origin or --tailscale=yes.`}`);
  host.out(tokenIsNew
    ? `  Sign-in token (shown once): ${token}`
    : `  Sign-in token: unchanged (ATLAS_SHARED_TOKEN in ${CONFIG}/atlas.env)`);
  host.out(`  Webhook:  http://127.0.0.1:${config.webhookPort}/webhooks/github (secret: ATLAS_GITHUB_WEBHOOK_SECRET in ${CONFIG}/atlas.env)`);
  host.out(`  ${funnelHint(config.webhookPort, dns)}`);
  if (!config.openCodePresent) host.out("  ! OpenCode is missing: Sessions cannot start until it is installed.");
  if (mode === "fresh" && config.openCodePresent) {
    const data = config.dataDir;
    host.out(`  OpenCode sign-in: sudo -u ${config.user.name} env HOME=${config.user.home} XDG_CONFIG_HOME=${data}/opencode-config \\`);
    host.out(`      XDG_DATA_HOME=${data}/opencode-data XDG_STATE_HOME=${data}/opencode-state XDG_CACHE_HOME=${data}/opencode-cache ${config.openCode} auth login`);
  }
  else if (mode !== "fresh" && context.changed.has(`${UNIT_DIR}/opencode.service`)) {
    host.out("  ! OpenCode was not restarted. When no Session is running: sudo systemctl restart opencode.service");
  }
  if (!config.btrfs) host.out(`  ! ${config.dataDir} is not on Btrfs: no automatic snapshots. Back it up yourself.`);
  if (context.changed.size > 0 && mode !== "fresh") host.out(`  Backups:  ${context.backupDir}`);
  if (mode === "adopt") host.out("  Old Release trees and Bun tools were left in place; remove them once you are happy.");
  return 0;
};
