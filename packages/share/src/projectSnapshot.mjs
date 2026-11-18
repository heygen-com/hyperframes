// @ts-check
// A project's files as change detection sees them: every file the film can use (isOutsideFilm), keyed by mtime and
// size, except html, keyed by content without the data-hf-id stamps. A run's change set and the watcher both read it.
import { readChangeIgnore, readSourceIgnore } from "./sourceIgnore.mjs";
import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { isOutsideFilm } from "./appOwnedPaths.mjs";

export const HF_ID_ATTRIBUTE = /\sdata-hf-id\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/g;

const sha256 = (/** @type {import("node:crypto").BinaryLike} */ data) =>
  createHash("sha256").update(data).digest("hex");

// A write that only adds data-hf-id stamps must not count as a change, or reload -> stamp -> reload never ends (KTD4).
/** @param {string} html */
export function contentKey(html) {
  return sha256(html.replace(HF_ID_ATTRIBUTE, ""));
}

/** A file renamed away between readdir and stat (atomic writes), or one the app may not read, is simply not there
 * (undefined): one unreadable entry must not blind the whole scan. @param {string} full @param {boolean} byContent */
async function snapshotKey(full, byContent) {
  const resolved = await fs.realpath(full).catch(() => null);
  if (!resolved) return undefined;
  const handle = await fs
    .open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW)
    .catch(() => null);
  if (!handle) return undefined;
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) return undefined;
    if (full.endsWith(".html")) return contentKey(await handle.readFile("utf8"));
    if (byContent) return await hashFile(handle);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return undefined;
  } finally {
    await handle.close();
  }
}

/** @param {import("node:fs/promises").FileHandle} handle */
async function hashFile(handle) {
  const hash = createHash("sha256");
  for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
  return hash.digest("hex");
}

/** @param {import("node:fs").Dirent} entry @param {string} full @param {boolean} followSymlinks */
async function entryKind(entry, full, followSymlinks) {
  if (!entry.isSymbolicLink()) return entry;
  return followSymlinks ? fs.stat(full).catch(() => null) : null;
}

// What a run is judged against: each file's mtime and size, except html, whose key ignores the data-hf-id stamps an
// open or a save writes. Files the film cannot use are not part of the snapshot.
/** @typedef {Map<string, unknown>} Snapshot */
// A `.hyperframesignore` this package can't read makes the snapshot throw, so a caller that picks files to send never
// sends one the file meant to exclude. Change detection passes `lenientIgnore`: it then sees more files, never fewer.
/** @typedef {{ lenientIgnore?: boolean }} IgnoreOptions */
/** @param {string} dir @param {{ byContent?: boolean, followSymlinks?: boolean } & IgnoreOptions} [options]
 * @returns {Promise<Snapshot>} */
export async function snapshotProject(
  dir,
  { byContent = false, followSymlinks = false, lenientIgnore = false } = {},
) {
  /** @type {Snapshot} */
  const result = new Map();
  const ignored = await ignoreFor(dir, lenientIgnore);
  /** @param {string} current @param {Set<string>} ancestors */
  async function walk(current, ancestors) {
    const real = await fs.realpath(current).catch(() => null);
    if (!real || ancestors.has(real)) return;
    const parents = new Set([...ancestors, real]);
    /** @type {import("node:fs").Dirent[]} */
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (excludedFromSnapshot(dir, full, ignored)) continue;
      const kind = await entryKind(entry, full, followSymlinks);
      if (kind?.isDirectory()) await walk(full, parents);
      else if (kind?.isFile()) {
        const key = await snapshotKey(full, byContent);
        if (key !== undefined) result.set(path.relative(dir, full), key);
      }
    }
  }
  await walk(dir, new Set());
  return result;
}

/** What an export's sidecar records of the project, from a snapshot already taken.
 * @param {Snapshot} snapshot */
export function snapshotFingerprint(snapshot) {
  const files = [...snapshot].sort(([a], [b]) => (a < b ? -1 : 1));
  return createHash("sha256").update(JSON.stringify(files)).digest("hex");
}

/** Just these project files, keyed as snapshotProject keys them (undefined: not a file the snapshot holds); null when
 * one is a folder, which only a whole snapshot covers. @param {string} dir @param {Iterable<string>} files
 * @param {IgnoreOptions} [options] @returns {Promise<Map<string, unknown> | null>} */
export async function snapshotFiles(dir, files, { lenientIgnore = false } = {}) {
  /** @type {Map<string, unknown>} */
  const result = new Map();
  const ignored = await ignoreFor(dir, lenientIgnore);
  for (const file of files) {
    const full = path.join(dir, file);
    const stat = await fs.lstat(full).catch(() => null);
    if (stat?.isDirectory()) return null;
    const holds = stat?.isFile() && !excludedFromSnapshot(dir, full, ignored);
    result.set(file, holds ? await snapshotKey(full, false) : undefined);
  }
  return result;
}

/** @param {Snapshot} before @param {Snapshot} after */
export function diffChangedFiles(before, after) {
  /** @type {string[]} */
  const changed = [];
  for (const [file, key] of after) {
    if (before.get(file) !== key) changed.push(file);
  }
  // A file gone after the run was changed by it too, as the project watcher counts it.
  for (const file of before.keys()) if (!after.has(file)) changed.push(file);
  return changed;
}

/** Change detection only: a fingerprint names no files to send, so it reads the ignore file leniently.
 * @param {string} projectPath @param {{ byContent?: boolean }} [options] */
export const projectFingerprint = async (projectPath, options) =>
  snapshotFingerprint(
    await snapshotProject(projectPath, { ...options, followSymlinks: true, lenientIgnore: true }),
  );

/** @param {string} dir @param {boolean} lenient */
const ignoreFor = (dir, lenient) => (lenient ? readChangeIgnore(dir) : readSourceIgnore(dir));

/** @param {string} dir @param {string} full @param {(path: string) => boolean} ignored */
function excludedFromSnapshot(dir, full, ignored) {
  const relative = path.relative(dir, full);
  return isOutsideFilm(relative) || ignored(relative.split(path.sep).join("/"));
}
