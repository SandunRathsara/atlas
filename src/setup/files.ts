// File helpers for `atlas setup`. Every path is a host path; `at(host, path)`
// adds the `--root` prefix.
//
// Root never changes a file or folder by path. Folders are opened with
// O_NOFOLLOW|O_DIRECTORY and fixed through the descriptor; files are written
// to a fresh temp file (O_EXCL|O_NOFOLLOW), fixed through the descriptor, then
// renamed into place. Every folder above a write must be root-owned and not
// writable by anyone else, so nobody can swap a path component underneath.
import { randomBytes } from "node:crypto";
import {
  closeSync, constants as fs, fchmodSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, realpathSync,
  renameSync, symlinkSync, unlinkSync, writeSync, type Stats,
} from "node:fs";
import { dirname, join } from "node:path";
import type { SetupHost } from "./host.ts";

export type Owner = { uid: number; gid: number };
export const ROOT_OWNER: Owner = { uid: 0, gid: 0 };

/** A path setup refuses to touch as root. */
export class UnsafePathError extends Error {}

export const at = (host: Pick<SetupHost, "root">, path: string) => `${host.root}${path}`;

export const lstat = (host: Pick<SetupHost, "root">, path: string) => lstatSync(at(host, path), { throwIfNoEntry: false });

const MAX_READ = 1024 * 1024;

/** Reads a regular file through an O_NOFOLLOW descriptor (never a symlink, FIFO, or device). */
export const readFileSafe = (full: string, limit = MAX_READ): { bytes: Buffer; stat: Stats } | null => {
  let descriptor: number;
  try {
    descriptor = openSync(full, fs.O_RDONLY | fs.O_NOFOLLOW | fs.O_NONBLOCK);
  } catch {
    return null;
  }
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile()) return null;
    if (stat.size > limit) throw new UnsafePathError(`${full} is larger than ${limit} bytes`);
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (read === 0) break;
      offset += read;
    }
    return { bytes: bytes.subarray(0, offset), stat };
  } finally {
    closeSync(descriptor);
  }
};

export const readText = (host: Pick<SetupHost, "root">, path: string) => readFileSafe(at(host, path))?.bytes.toString("utf8") ?? null;

/** True when only root can change this: root-owned and not group/other writable (sticky folders allowed). */
export const rootOnly = (host: Pick<SetupHost, "owner">, stat: Stats) =>
  host.owner(stat).uid === 0 && ((stat.mode & 0o022) === 0 || (stat.isDirectory() && (stat.mode & 0o1000) !== 0));

/**
 * Refuses unless every folder above `full` (a real path, root prefix included)
 * is a real folder only root can change. Symlinked folders are checked along
 * their resolved path too.
 */
export const assertSafeParents = (host: Pick<SetupHost, "owner">, full: string) => {
  const checked = new Set<string>();
  const checkReal = (real: string) => {
    for (let current = real; ; current = dirname(current)) {
      if (!checked.has(current)) {
        const stat = lstatSync(current);
        if (!stat.isDirectory() || !rootOnly(host, stat)) {
          throw new UnsafePathError(`${current} must be a root-owned folder that no other account can write`);
        }
        checked.add(current);
      }
      if (current === "/") return;
    }
  };
  const parents: string[] = [];
  for (let current = dirname(full); ; current = dirname(current)) {
    parents.unshift(current);
    if (current === "/") break;
  }
  for (const parent of parents) {
    let real: string;
    try {
      real = realpathSync(parent);
    } catch {
      return; // the rest is missing and will be created by root under a safe folder
    }
    checkReal(real);
  }
};

const fsyncDirectory = (path: string) => {
  try {
    const descriptor = openSync(path, fs.O_RDONLY | fs.O_DIRECTORY);
    try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
  } catch { /* best effort */ }
};

/**
 * Creates (or fixes) a real folder with this mode and owner, through a
 * descriptor opened with O_NOFOLLOW. The folders above must be root-only.
 */
export const ensureDirectory = (host: SetupHost, path: string, mode: number, owner: Owner) => {
  const target = at(host, path);
  assertSafeParents(host, target);
  const stat = lstatSync(target, { throwIfNoEntry: false });
  if (stat && !stat.isDirectory()) throw new UnsafePathError(`${path} exists but is not a folder`);
  if (!stat) mkdirSync(target, { recursive: true, mode: 0o700 });
  let descriptor: number;
  try {
    descriptor = openSync(target, fs.O_RDONLY | fs.O_NOFOLLOW | fs.O_DIRECTORY | fs.O_NONBLOCK);
  } catch {
    throw new UnsafePathError(`${path} is not a real folder`);
  }
  try {
    host.fchown(descriptor, owner.uid, owner.gid);
    fchmodSync(descriptor, mode);
  } finally {
    closeSync(descriptor);
  }
};

const writeAll = (descriptor: number, bytes: Uint8Array) => {
  let offset = 0;
  while (offset < bytes.byteLength) offset += writeSync(descriptor, bytes, offset);
};

/** Creates `full` exclusively (never follows or reuses a path) with this content, mode, and owner. */
const createFile = (host: SetupHost, full: string, bytes: Uint8Array, mode: number, owner: Owner) => {
  const descriptor = openSync(full, fs.O_WRONLY | fs.O_CREAT | fs.O_EXCL | fs.O_NOFOLLOW, 0o600);
  try {
    writeAll(descriptor, bytes);
    host.fchown(descriptor, owner.uid, owner.gid);
    fchmodSync(descriptor, mode);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
};

/** Atomically writes `text` with this mode and owner (a fresh inode, renamed into place). */
export const writeFileAtomic = (host: SetupHost, path: string, text: string | Uint8Array, mode: number, owner: Owner) => {
  const target = at(host, path);
  const existing = lstatSync(target, { throwIfNoEntry: false });
  if (existing && !existing.isFile()) throw new UnsafePathError(`${path} exists but is not a regular file`);
  assertSafeParents(host, target);
  // Only system folders such as /etc/systemd/system can be missing here; a
  // fresh prefix (tests) gets them root-owned 0755.
  mkdirSync(dirname(target), { recursive: true, mode: 0o755 });
  const temporary = join(dirname(target), `.${randomBytes(6).toString("hex")}.atlas-setup.tmp`);
  try {
    createFile(host, temporary, typeof text === "string" ? Buffer.from(text) : text, mode, owner);
    renameSync(temporary, target);
    fsyncDirectory(dirname(target));
  } finally {
    if (lstatSync(temporary, { throwIfNoEntry: false })) unlinkSync(temporary);
  }
};

/** True when `path` already is a single-link regular file with exactly this content, mode, and owner. */
export const fileMatches = (host: SetupHost, path: string, text: string | Uint8Array, mode: number, owner: Owner) => {
  const current = readFileSafe(at(host, path));
  if (!current) return false;
  const actual = host.owner(current.stat);
  return current.bytes.equals(Buffer.from(text)) && (current.stat.mode & 0o7777) === mode &&
    actual.uid === owner.uid && actual.gid === owner.gid && current.stat.nlink === 1;
};

/** Points `path` at `target` atomically (a symlink only; refuses to replace anything else). */
export const replaceSymlink = (host: SetupHost, path: string, target: string) => {
  const full = at(host, path);
  const existing = lstatSync(full, { throwIfNoEntry: false });
  if (existing && !existing.isSymbolicLink()) throw new UnsafePathError(`${path} exists and is not a symlink`);
  assertSafeParents(host, full);
  const temporary = join(dirname(full), `.${randomBytes(6).toString("hex")}.atlas-link.tmp`);
  symlinkSync(target, temporary);
  try {
    host.chown(temporary, 0, 0);
    renameSync(temporary, full);
  } finally {
    if (lstatSync(temporary, { throwIfNoEntry: false })) unlinkSync(temporary);
  }
};

/**
 * Copies a regular file into a backup folder (root-only, 0700), keeping its
 * mode and owner so `cp -a` restores it exactly. The first backup of a run wins.
 */
export const backupFile = (host: SetupHost, path: string, backupDir: string) => {
  const source = readFileSafe(at(host, path), 64 * 1024 * 1024);
  if (!source) return false;
  const destination = at(host, `${backupDir}${path}`);
  if (lstatSync(destination, { throwIfNoEntry: false })) return true;
  assertSafeParents(host, at(host, backupDir));
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  createFile(host, destination, source.bytes, source.stat.mode & 0o7777, host.owner(source.stat));
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
