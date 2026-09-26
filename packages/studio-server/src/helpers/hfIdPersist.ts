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

function isUnchanged(filePath: string, expected: string): boolean {
  const fd = openNoFollow(filePath, constants.O_RDONLY);
  if (fd === null) return false;
  try {
    return readFileSync(fd, "utf-8") === expected;
  } finally {
    closeSync(fd);
  }
}

/**
 * Read `filePath`, mint any missing `data-hf-id`s, write the stamped content
 * back if new ids were added, and return the stamped content. Every open of the path is
 * no-follow (POSIX) and the write renames a sibling temp file over it, so a symlink swapped
 * in at the path is never read or written through (CodeQL js/file-system-race).
 *
 * Falls back to read-only stamping when the file isn't writable (read-only
 * fs, sandbox) — serving stamped content without persisting is still correct;
 * ids are content-keyed so the SDK mints the same ones from the same bytes.
 *
 * Returns null when the file is missing, unreadable, or not a regular file.
 *
 * A write that lands while ids are minted is kept: the file is replaced only if
 * it still holds the bytes that were stamped, else it is left for the next open or save.
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
      if (isUnchanged(filePath, html))
        replaceFileAtomically(filePath, normalized, mode, undefined, { followLinks: false });
    }
    return normalized;
  } catch (err) {
    console.warn("[hyperframes] stampFileHfIds: failed to stamp ids:", err);
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}
