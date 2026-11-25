import { stampHfIdsInPlace } from "@hyperframes/parsers/hf-ids";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { replaceFileAtomically } from "@hyperframes/core/atomic-file";
import { isInHiddenOrVendorDir, mkdirOwnedWithinProject, walkDir } from "./safePath.js";

const COMPOSITION_ID_TEXT = /data-composition-id\s*=/i;
// HTML's whitespace set, not `\s`: a browser keeps other space characters inside an attribute name.
const TAG_NAME = /<[a-zA-Z][^\t\n\f\r />]*/y;
const TAG_ATTRIBUTE =
  /[\t\n\f\r /]*([^\t\n\f\r />][^\t\n\f\r />=]*)([\t\n\f\r ]*=[\t\n\f\r ]*(?:"[^"]*"?|'[^']*'?|[^\t\n\f\r >]*))?/y;
const TAG_END = /[\t\n\f\r /]*>/y;

/** True when a closed start tag of `html` has an attribute named exactly `data-composition-id` with a
 * value. The marker's text alone is not enough, since Studio runs a composition's scripts on its own
 * origin: `<div data-x-data-composition-id="a">` must be refused. Script and style text is read as
 * markup, because skipping it by tag name hid a real root after an empty `<style/>` in inline SVG. */
export function isCompositionSource(html: string): boolean {
  if (!COMPOSITION_ID_TEXT.test(html)) return false;
  for (let at = html.indexOf("<"); at !== -1; at = html.indexOf("<", at)) {
    if (html.startsWith("<!--", at)) {
      const end = html.indexOf("-->", at + 4);
      if (end === -1) return false;
      at = end + 3;
      continue;
    }
    TAG_NAME.lastIndex = at;
    if (!TAG_NAME.test(html)) {
      at += 1;
      continue;
    }
    TAG_ATTRIBUTE.lastIndex = TAG_NAME.lastIndex;
    at = TAG_NAME.lastIndex;
    let named = false;
    for (let match = TAG_ATTRIBUTE.exec(html); match; match = TAG_ATTRIBUTE.exec(html)) {
      named ||= match[2] !== undefined && match[1]!.toLowerCase() === "data-composition-id";
      at = TAG_ATTRIBUTE.lastIndex;
    }
    TAG_END.lastIndex = at;
    if (named && TAG_END.test(html)) return true;
  }
  return false;
}

export const isCompositionPath = (relPath: string): boolean =>
  /\.html?$/i.test(relPath) && !isInHiddenOrVendorDir(relPath);

const STAMP_RECORD = join(".hyperframes", "hf-ids-stamped.json");

const contentHash = (text: string): string => createHash("sha1").update(text).digest("base64url");

/** Pins hf-ids into every composition in the project. A host runs it once before it serves or
 * watches the project: an id write during a session reaches Studio as an outside edit and reloads it.
 * A file whose content hash matches the last run's (kept in `.hyperframes`) is not parsed again. */
export function stampProjectHfIds(projectDir: string): void {
  const pass = stampPass(projectDir);
  while (!pass.next().done);
}

/** stampProjectHfIds for a host whose event loop must keep answering: it yields to the loop after each file. */
export async function stampProjectHfIdsAsync(projectDir: string): Promise<void> {
  const pass = stampPass(projectDir);
  while (!pass.next().done) await new Promise<void>((resolve) => setImmediate(resolve));
}

function* stampPass(projectDir: string): Generator<void> {
  const recordPath = join(projectDir, STAMP_RECORD);
  const last = readStampRecord(recordPath);
  const next: Record<string, string> = {};
  for (const file of walkDir(projectDir)) {
    if (!file.endsWith(".html") || isInHiddenOrVendorDir(file)) continue;
    const hash = hashAfterStamp(join(projectDir, file), last[file]);
    if (hash !== null) next[file] = hash;
    yield;
  }
  writeStampRecord(projectDir, recordPath, next);
}

function readStampRecord(recordPath: string): Record<string, string> {
  try {
    return JSON.parse(readFileSync(recordPath, "utf-8"));
  } catch {
    return {}; // first run, or an unreadable record: parse everything
  }
}

function writeStampRecord(projectDir: string, recordPath: string, next: Record<string, string>) {
  try {
    mkdirOwnedWithinProject(projectDir, dirname(recordPath));
    replaceFileAtomically(recordPath, JSON.stringify(next));
  } catch {
    // read-only project: the next start parses again
  }
}

/** The hash to record for a file after its stamp, or null when it is unreadable now and the preview route stamps it. */
function hashAfterStamp(absPath: string, recorded: string | undefined): string | null {
  let html: string;
  try {
    html = readFileSync(absPath, "utf-8");
  } catch {
    return null;
  }
  const hash = contentHash(html);
  if (recorded === hash || !isCompositionSource(html)) return hash;
  const stamped = stampFileHfIds(absPath);
  return stamped === null ? null : contentHash(stamped);
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
    const normalized = stampHfIdsInPlace(html);
    // Attribute count, not string equality — linkedom serialization normalizes
    // quote style/whitespace even when no ids were minted.
    const idsBefore = (html.match(/\bdata-hf-id=/g) ?? []).length;
    const idsAfter = (normalized.match(/\bdata-hf-id=/g) ?? []).length;
    if (writable && idsAfter > idsBefore) {
      const mode = fstatSync(fd).mode;
      closeSync(fd);
      fd = null;
      if (isUnchanged(filePath, html)) replaceFileAtomically(filePath, normalized, mode);
    }
    return normalized;
  } catch (err) {
    console.warn("[hyperframes] stampFileHfIds: failed to stamp ids:", err);
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}
