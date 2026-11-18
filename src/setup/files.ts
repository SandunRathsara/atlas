// File helpers for `atlas setup`. Every path is a host path; `at(host, path)`
// adds the `--root` prefix. Writes are atomic (temp file, fsync, rename) and
// never follow a symlink at the destination.
import { randomBytes } from "node:crypto";
import {
  chmodSync, closeSync, copyFileSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync,
  symlinkSync, unlinkSync, writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { SetupHost } from "./host.ts";

export type Owner = { uid: number; gid: number };
export const ROOT_OWNER: Owner = { uid: 0, gid: 0 };

export const at = (host: Pick<SetupHost, "root">, path: string) => `${host.root}${path}`;

export const lstat = (host: Pick<SetupHost, "root">, path: string) => lstatSync(at(host, path), { throwIfNoEntry: false });

export const readText = (host: Pick<SetupHost, "root">, path: string) => {
  const stat = lstat(host, path);
  return stat?.isFile() ? readFileSync(at(host, path), "utf8") : null;
};

const fsyncDirectory = (path: string) => {
  try {
    const descriptor = openSync(path, "r");
    try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
  } catch { /* best effort */ }
};

/** Creates (or fixes) a real directory with this mode and owner. Refuses a symlink. */
export const ensureDirectory = (host: SetupHost, path: string, mode: number, owner: Owner) => {
  const target = at(host, path);
  const stat = lstatSync(target, { throwIfNoEntry: false });
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error(`${path} exists but is not a folder`);
  if (!stat) mkdirSync(target, { recursive: true, mode });
  chmodSync(target, mode);
  host.chown(target, owner.uid, owner.gid);
};

/** Atomically writes `text` with this mode and owner (owner set before the rename). */
export const writeFileAtomic = (host: SetupHost, path: string, text: string | Uint8Array, mode: number, owner: Owner) => {
  const target = at(host, path);
  const existing = lstatSync(target, { throwIfNoEntry: false });
  if (existing && !existing.isFile()) throw new Error(`${path} exists but is not a regular file`);
  // Only system folders such as /etc/systemd/system can be missing here; a
  // fresh prefix (tests) gets them root-owned 0755.
  mkdirSync(dirname(target), { recursive: true, mode: 0o755 });
  const temporary = join(dirname(target), `.${randomBytes(6).toString("hex")}.atlas-setup.tmp`);
  try {
    writeFileSync(temporary, text, { mode: 0o600, flag: "wx" });
    chmodSync(temporary, mode);
    host.chown(temporary, owner.uid, owner.gid);
    const descriptor = openSync(temporary, "r");
    try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
    renameSync(temporary, target);
    fsyncDirectory(dirname(target));
  } finally {
    if (lstatSync(temporary, { throwIfNoEntry: false })) unlinkSync(temporary);
  }
};

/** Points `path` at `target` atomically (a symlink only; refuses to replace anything else). */
export const replaceSymlink = (host: SetupHost, path: string, target: string) => {
  const full = at(host, path);
  const existing = lstatSync(full, { throwIfNoEntry: false });
  if (existing && !existing.isSymbolicLink()) throw new Error(`${path} exists and is not a symlink`);
  const temporary = join(dirname(full), `.${randomBytes(6).toString("hex")}.atlas-link.tmp`);
  symlinkSync(target, temporary);
  try {
    host.chown(temporary, 0, 0);
    renameSync(temporary, full);
  } finally {
    if (lstatSync(temporary, { throwIfNoEntry: false })) unlinkSync(temporary);
  }
};

/** Copies a file into a backup folder, keeping its mode. */
export const backupFile = (host: SetupHost, path: string, backupDir: string) => {
  const source = at(host, path);
  const stat = lstatSync(source, { throwIfNoEntry: false });
  if (!stat?.isFile()) return false;
  const destination = at(host, `${backupDir}${path}`);
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  copyFileSync(source, destination);
  chmodSync(destination, stat.mode & 0o777);
  // Same owner as the original, so `cp -a` restores it exactly.
  host.chown(destination, stat.uid, stat.gid);
  return true;
};

// ---- env files (KEY=value lines; comments and order are kept) ----

const KEY_LINE = /^\s*([A-Z_][A-Z0-9_]*)\s*=(.*)$/u;

export const parseEnv = (text: string) => {
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/u)) {
    const match = KEY_LINE.exec(line);
    if (!match) continue;
    let value = match[2]!.trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    values.set(match[1]!, value);
  }
  return values;
};

const ENV_VALUE = /^[A-Za-z0-9._~:/@+=,-]*$/u;

export const assertEnvValue = (key: string, value: string) => {
  if (!ENV_VALUE.test(value)) throw new Error(`${key} has characters an env file cannot hold safely`);
  return value;
};

/**
 * Updates `text` so each key in `updates` has that value (undefined removes the
 * key). Existing lines are edited in place; new keys are appended.
 */
export const updateEnv = (text: string, updates: Record<string, string | undefined>) => {
  const pending = new Map(Object.entries(updates));
  const out: string[] = [];
  const lines = text.length ? text.replace(/\n$/u, "").split("\n") : [];
  for (const line of lines) {
    const match = KEY_LINE.exec(line);
    if (match && pending.has(match[1]!)) {
      const value = pending.get(match[1]!);
      pending.delete(match[1]!);
      // An unchanged value keeps its original line byte for byte.
      if (value !== undefined) out.push(parseEnv(line).get(match[1]!) === value ? line : `${match[1]}=${assertEnvValue(match[1]!, value)}`);
      continue;
    }
    out.push(line);
  }
  for (const [key, value] of pending) if (value !== undefined) out.push(`${key}=${assertEnvValue(key, value)}`);
  return `${out.join("\n")}\n`;
};
