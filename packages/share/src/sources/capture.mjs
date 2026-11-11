// @ts-check
// Captures a project folder as the canonical manifest the server accepts: every portable regular file with its
// SHA-256 and length. A file that cannot be read, a link, a special file or a name no client can store fails the
// capture with a list of them; it never becomes a deletion. Limits are checked from sizes alone, before any hashing.
import { readSourceIgnore } from "../sourceIgnore.mjs";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";

import { ENTRYPOINT, ManifestInvalid, canonicalBytes, parseManifest } from "./manifest.mjs";
import { V1_LIMITS, overLimit } from "./limits.mjs";
import {
  PathViolation,
  checkInventoryPaths,
  classifyPath,
  excludedFolder,
  prefiltered,
  skippedSymlink,
  validatePath,
} from "./pathPolicy.mjs";
import { readRenderOutputs, settledState } from "./projectState.mjs";

/** @typedef {import("./types.js").CaptureProblem} CaptureProblem @typedef {import("./types.js").Found} Found
 * @typedef {import("./types.js").Walk} Walk @typedef {import("./types.js").Capture} Capture */

/** Files up to this size use one bounded buffer; larger files stream from the verified handle. */
const INLINE_HASH_BYTES = 4 * 1024 * 1024;
const HASHING_AT_ONCE = 4;

/** @param {string} root @param {string} rel @param {import("node:fs").Dirent} entry @param {Walk} walk
 * @param {string[]} dirs */
async function visit(root, rel, entry, walk, dirs) {
  if (entry.isDirectory()) {
    if (!excludedFolder(rel)) dirs.push(rel);
    return;
  }
  const action = classifyPath(rel).client_action;
  if (action === "exclude") return;
  if (action === "wait_then_exclude") return void walk.waiting.push(rel);
  if (entry.isSymbolicLink()) {
    if (skippedSymlink(rel)) walk.skippedLinks.push(rel);
    else walk.problems.push({ path: rel, problem: "symlink" });
    return;
  }
  if (!entry.isFile()) return void walk.problems.push({ path: rel, problem: "special-file" });
  await visitFile(root, rel, walk);
}
/** @param {string} root @param {string} rel @param {Walk} walk */
async function visitFile(root, rel, walk) {
  try {
    validatePath(rel);
  } catch (error) {
    if (!(error instanceof PathViolation)) throw error;
    return void walk.problems.push({ path: rel, problem: "invalid-name", code: error.code });
  }
  const full = join(root, rel);
  try {
    const { size, mtimeMs, ino, dev } = await lstat(full);
    walk.files.push({ path: rel, full, size, mtimeMs, ino, dev });
  } catch {
    walk.problems.push({ path: rel, problem: "unreadable" });
  }
}

/** A folder that was a link, or another folder, by the time it was read. */
class FolderMoved extends Error {}

/** A folder's entries, read only while the same real folder stands at its path before and after: one swapped for a
 * link to somewhere else is never listed. @param {string} root @param {string} dir */
async function listFolder(root, dir) {
  const full = join(root, dir);
  const before = await lstat(full);
  if (!before.isDirectory()) throw new FolderMoved();
  const entries = await readdir(full, { withFileTypes: true });
  const after = await lstat(full);
  if (!after.isDirectory() || after.ino !== before.ino || after.dev !== before.dev)
    throw new FolderMoved();
  return entries;
}

/** Every file a capture would list, and what keeps one from being listed. @param {string} root
 * @param {(rel: string) => boolean} renderOutput @returns {Promise<Walk>} */
async function walkProject(root, renderOutput) {
  /** @type {Walk} */
  const walk = { files: [], problems: [], waiting: [], skippedLinks: [] };
  const ignored = await readSourceIgnore(root);
  const dirs = [""];
  for (let dir = dirs.pop(); dir !== undefined; dir = dirs.pop()) {
    let entries;
    try {
      entries = await listFolder(root, dir);
    } catch (error) {
      const changed = error instanceof FolderMoved;
      walk.problems.push({ path: dir, problem: changed ? "changed" : "unreadable" });
      continue;
    }
    for (const entry of entries) {
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (prefiltered(entry.name) || renderOutput(rel) || ignored(rel)) continue;
      await visit(root, rel, entry, walk, dirs);
    }
  }
  return walk;
}

/** The manifest's canonical length, from paths and sizes alone: every SHA-256 is 64 characters.
 * @param {Found[]} files */
const manifestBytes = (files) =>
  canonicalBytes({
    format_version: 1,
    entrypoint: ENTRYPOINT,
    files: files.map(({ path, size }) => ({ path, sha256: "0".repeat(64), size })),
  }).length;

/** A file changed this recently can be written again within its time's granularity, keeping its size and time. */
const SETTLED_MS = 2_000;

/** A file's SHA-256 by path, size, time and inode, kept for the launch so a check after a focus reads no bytes.
 * Only a settled file's hash is kept. */
export function hashMemo(now = Date.now) {
  /** @type {Map<string, { size: number, mtimeMs: number, ino: number, sha256: string }>} */
  const known = new Map();
  return {
    /** @param {Found} file */
    get: (file) => {
      const kept = known.get(file.full);
      const same =
        kept?.size === file.size && kept.mtimeMs === file.mtimeMs && kept.ino === file.ino;
      return same ? kept.sha256 : null;
    },
    /** @param {Found} file @param {string} sha256 */
    set: (file, sha256) => {
      if (now() - file.mtimeMs > SETTLED_MS) known.set(file.full, { ...file, sha256 });
    },
  };
}

/** The file the walk listed, as an open handle: never through a link at its own name (O_NOFOLLOW), and only when the
 * opened file is the same regular file (inode, device, size) found inside the project, so a file or folder swapped
 * for a link after the walk is refused rather than followed. Null when it is not. @param {string} root
 * @param {Found} file @param {typeof realpath} [resolve] */
async function openListed(root, file, resolve = realpath) {
  const handle = await open(file.full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch(
    (/** @type {NodeJS.ErrnoException} */ error) => {
      if (error.code === "ELOOP" || error.code === "EMLINK") return null;
      throw error;
    },
  );
  if (!handle) return null;
  try {
    const opened = await handle.stat();
    const same =
      opened.isFile() &&
      opened.ino === file.ino &&
      opened.dev === file.dev &&
      opened.size === file.size &&
      (await resolve(dirname(file.full))) === join(root, dirname(file.path));
    if (same) return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
  await handle.close();
  return null;
}

/** The file's SHA-256, read through the handle `openListed` checked; null when the file is not the one listed, or its
 * bytes changed while being read. `root` is the project's real path; `resolve` finds a folder's real path.
 * @param {string} root @param {Found} file @param {typeof realpath} [resolve] */
export async function hashListedFile(root, file, resolve = realpath) {
  const handle = await openListed(root, file, resolve);
  if (!handle) return null;
  try {
    const sha256 =
      file.size <= INLINE_HASH_BYTES
        ? await handle
            .readFile()
            .then((bytes) =>
              bytes.length === file.size ? createHash("sha256").update(bytes).digest("hex") : null,
            )
        : await hashHandle(handle);
    const after = await handle.stat();
    return after.size === file.size && after.mtimeMs === file.mtimeMs ? sha256 : null;
  } finally {
    await handle.close();
  }
}

/** @param {string} root @param {Found[]} files @param {ReturnType<typeof hashMemo>} memo
 * @returns {Promise<{ hashed: import("./types.js").ManifestFile[], problems: CaptureProblem[] }>} */
async function hashAll(root, files, memo) {
  /** @type {import("./types.js").ManifestFile[]} */
  const hashed = [];
  /** @type {CaptureProblem[]} */
  const problems = [];
  const queue = [...files];
  const worker = async () => {
    for (let file = queue.shift(); file; file = queue.shift()) {
      const sha256 = memo.get(file) ?? (await hashListedFile(root, file).catch(() => undefined));
      if (sha256 === undefined) problems.push({ path: file.path, problem: "unreadable" });
      else if (sha256 === null) problems.push({ path: file.path, problem: "changed" });
      else {
        memo.set(file, sha256);
        hashed.push({ path: file.path, sha256, size: file.size });
      }
    }
  };
  await Promise.all(Array.from({ length: HASHING_AT_ONCE }, worker));
  return { hashed, problems };
}

/** Problems that keep the files found from being one manifest: two names one disk stores as one, no index.html.
 * @param {Found[]} files @returns {CaptureProblem[]} */
function inventoryProblems(files) {
  if (!files.some((file) => file.path === ENTRYPOINT))
    return [{ path: ENTRYPOINT, problem: "no-entrypoint" }];
  try {
    checkInventoryPaths(files.map((file) => file.path));
    return [];
  } catch (error) {
    if (!(error instanceof PathViolation)) throw error;
    return [{ path: error.path, problem: "invalid-name", code: error.code }];
  }
}

/** Captures `root` (a project's real path). `memo` reuses hashes of unchanged files; a send should pass a fresh one.
 * @param {string} root @param {{ memo?: ReturnType<typeof hashMemo>, limits?: import("./types.js").Limits }} [options]
 * @returns {Promise<Capture>} */
export async function captureProject(root, { memo = hashMemo(), limits = V1_LIMITS } = {}) {
  const renderOutput = await readRenderOutputs(root);
  const walk = await walkProject(root, renderOutput);
  const problems = walk.problems.length ? walk.problems : inventoryProblems(walk.files);
  if (problems.length) return { at: "problems", problems };
  const over = overLimit(walk.files, manifestBytes(walk.files), limits);
  if (over) return { at: "too-big", over };
  const { hashed, problems: unhashed } = await hashAll(await realpath(root), walk.files, memo);
  if (unhashed.length) return { at: "problems", problems: unhashed };
  try {
    const manifest = parseManifest({ format_version: 1, entrypoint: ENTRYPOINT, files: hashed });
    const settled = await settledState(root);
    return {
      at: "captured",
      manifest,
      settled,
      waiting: walk.waiting,
      skippedLinks: walk.skippedLinks,
    };
  } catch (error) {
    if (!(error instanceof ManifestInvalid)) throw error;
    const first = error.violations[0];
    return {
      at: "problems",
      problems: [{ path: first?.path ?? "", problem: "invalid-name", code: error.code }],
    };
  }
}

/** @param {import("node:fs/promises").FileHandle} handle */
async function hashHandle(handle) {
  const hash = createHash("sha256");
  for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
  return hash.digest("hex");
}
