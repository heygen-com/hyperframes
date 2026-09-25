import { ensureHfIds } from "@hyperframes/parsers/hf-ids";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { replaceFileAtomically } from "./atomicFile.js";
import { isInHiddenOrVendorDir, walkDir } from "./safePath.js";

export const isCompositionSource = (html: string): boolean => /data-composition-id\s*=/.test(html);

const STAMP_RECORD = join(".hyperframes", "hf-ids-stamped.json");

const contentHash = (text: string): string => createHash("sha1").update(text).digest("base64url");

/** Pins hf-ids into every composition in the project. A host runs it once before it serves or
 * watches the project: an id write during a session reaches Studio as an outside edit and reloads it.
 * A file whose content hash matches the last run's (kept in `.hyperframes`) is not parsed again. */
export function stampProjectHfIds(projectDir: string): void {
  const recordPath = join(projectDir, STAMP_RECORD);
  let last: Record<string, string> = {};
  try {
    last = JSON.parse(readFileSync(recordPath, "utf-8"));
  } catch {
    // first run, or an unreadable record: parse everything
  }
  const next: Record<string, string> = {};
  for (const file of walkDir(projectDir)) {
    if (!file.endsWith(".html") || isInHiddenOrVendorDir(file)) continue;
    const absPath = join(projectDir, file);
    let html: string;
    try {
      html = readFileSync(absPath, "utf-8");
    } catch {
      continue; // unreadable now; the preview route stamps it when it is served
    }
    let hash = contentHash(html);
    if (last[file] !== hash && isCompositionSource(html)) {
      const stamped = stampFileHfIds(absPath);
      if (stamped === null) continue;
      hash = contentHash(stamped);
    }
    next[file] = hash;
  }
  try {
    mkdirSync(dirname(recordPath), { recursive: true });
    writeFileSync(recordPath, JSON.stringify(next));
  } catch {
    // read-only project: the next start parses again
  }
}

function openNoFollow(filePath: string, flags: number): number | null {
  // O_NOFOLLOW is undefined on Windows; opening without it is the platform norm there.
  const noFollow = constants.O_NOFOLLOW ?? 0;
  try {
    return openSync(filePath, flags | noFollow);
  } catch {
    return null;
  }
}

/**
 * Read `filePath`, mint any missing `data-hf-id`s, write the stamped content
 * back if new ids were added, and return the stamped content — all through ONE
 * file descriptor. Unlike the check-path / read-path / write-path sequence a
 * route handler would otherwise do, the validation (fstat), read, and write
 * all target the same open inode, so the path cannot be swapped (e.g. for a
 * symlink) between validation and write (CodeQL js/file-system-race).
 *
 * Falls back to read-only stamping when the file isn't writable (read-only
 * fs, sandbox) — serving stamped content without persisting is still correct;
 * ids are content-keyed so the SDK mints the same ones from the same bytes.
 *
 * Returns null when the file is missing, unreadable, or not a regular file.
 *
 * Best-effort on concurrent saves: a user save landing between the read and
 * the write below can still be overwritten — the next save simply re-persists.
 */
export function stampFileHfIds(filePath: string): string | null {
  let fd: number | null = openNoFollow(filePath, constants.O_RDWR);
  let writable = true;
  if (fd === null) {
    fd = openNoFollow(filePath, constants.O_RDONLY);
    writable = false;
  }
  if (fd === null) return null;
  try {
    if (!fstatSync(fd).isFile()) return null;
    const html = readFileSync(fd, "utf-8");
    const normalized = ensureHfIds(html);
    // Attribute count, not string equality — linkedom serialization normalizes
    // quote style/whitespace even when no ids were minted.
    const idsBefore = (html.match(/\bdata-hf-id=/g) ?? []).length;
    const idsAfter = (normalized.match(/\bdata-hf-id=/g) ?? []).length;
    if (writable && idsAfter > idsBefore) {
      const mode = fstatSync(fd).mode;
      closeSync(fd);
      fd = null;
      replaceFileAtomically(filePath, normalized, mode);
    }
    return normalized;
  } catch (err) {
    console.warn("[hyperframes] stampFileHfIds: failed to stamp ids:", err);
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}
