// @ts-check
// A project's files as change detection sees them: every file the film can use (isOutsideFilm), keyed by mtime and
// size, except html, keyed by content without the data-hf-id stamps. A run's change set and the watcher both read it.
import fs from "node:fs/promises";
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
  const stat = await fs.stat(full).catch(() => null);
  if (!stat) return undefined;
  const html = full.endsWith(".html") ? await fs.readFile(full, "utf8").catch(() => null) : null;
  if (html !== null) return contentKey(html);
  if (byContent) return fs.readFile(full).then(sha256, () => undefined);
  // A file's clock ticks coarsely (Linux: a few ms), so two quick writes can share an mtime; the size tells most apart.
  return `${stat.mtimeMs}:${stat.size}`;
}

// What a run is judged against: each file's mtime and size, except html, whose key ignores the data-hf-id stamps an
// open or a save writes. Files the film cannot use are not part of the snapshot.
/** @typedef {Map<string, unknown>} Snapshot */
/** @param {string} dir @param {{ byContent?: boolean }} [options] @returns {Promise<Snapshot>} */
export async function snapshotProject(dir, { byContent = false } = {}) {
  /** @type {Snapshot} */
  const result = new Map();
  /** @param {string} current */
  async function walk(current) {
    /** @type {import("node:fs").Dirent[]} */
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (isOutsideFilm(path.relative(dir, full))) continue;
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        const key = await snapshotKey(full, byContent);
        if (key !== undefined) result.set(path.relative(dir, full), key);
      }
    }
  }
  await walk(dir);
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
 * @returns {Promise<Map<string, unknown> | null>} */
export async function snapshotFiles(dir, files) {
  /** @type {Map<string, unknown>} */
  const result = new Map();
  for (const file of files) {
    const full = path.join(dir, file);
    const stat = await fs.lstat(full).catch(() => null);
    if (stat?.isDirectory()) return null;
    const holds = stat?.isFile() && !isOutsideFilm(path.relative(dir, full));
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

/** @param {string} projectPath */
export const projectFingerprint = async (projectPath) =>
  snapshotFingerprint(await snapshotProject(projectPath));
