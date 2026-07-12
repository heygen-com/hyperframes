import { ensureHfIds } from "@hyperframes/parsers/hf-ids";
import {
  closeSync,
  constants,
  fstatSync,
  ftruncateSync,
  openSync,
  readFileSync,
  writeFileSync,
  writeSync,
} from "node:fs";

/**
 * Ensure `html` has `data-hf-id` attributes minted, and write the result back
 * to `filePath` if new ids were added.
 *
 * **Invariant:** `html` must be the raw file content read from `filePath` just
 * before this call. If `html` is constructed or transformed HTML the TOCTOU
 * guard (`current === html`) will never match and writes will silently be
 * skipped — no ids will reach disk.
 */
export function persistHfIdsIfNeeded(filePath: string, html: string): string {
  const normalized = ensureHfIds(html);
  // Use attribute count instead of string equality: linkedom serialization may
  // normalize quote style and whitespace even when no ids were actually minted,
  // which would cause spurious writes on every request.
  const idsBefore = (html.match(/\bdata-hf-id=/g) ?? []).length;
  const idsAfter = (normalized.match(/\bdata-hf-id=/g) ?? []).length;
  if (idsAfter > idsBefore) {
    try {
      // Re-read before writing to guard against concurrent user saves. If the
      // file changed since we read it, skip the write — serving with ids is
      // still correct; the next request will re-persist. Best-effort only: a
      // user save landing between readFileSync and writeFileSync below can
      // still be overwritten (microsecond window).
      const current = readFileSync(filePath, "utf-8");
      if (current === html) {
        writeFileSync(filePath, normalized, "utf-8");
      }
    } catch (err) {
      // Non-fatal — serve with ids even if the disk write fails (e.g. read-only
      // filesystem, sandboxed environment). Log so the failure is diagnosable.
      console.warn("[hyperframes] persistHfIdsIfNeeded: failed to write ids to disk:", err);
    }
  }
  return normalized;
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
 * the write below can still be overwritten (same microsecond window
 * persistHfIdsIfNeeded documents) — the next save simply re-persists.
 */
export function stampFileHfIds(filePath: string): string | null {
  let fd = openNoFollow(filePath, constants.O_RDWR);
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
    // quote style/whitespace even when no ids were minted (see persistHfIdsIfNeeded).
    const idsBefore = (html.match(/\bdata-hf-id=/g) ?? []).length;
    const idsAfter = (normalized.match(/\bdata-hf-id=/g) ?? []).length;
    if (writable && idsAfter > idsBefore) {
      ftruncateSync(fd, 0);
      writeSync(fd, normalized, 0, "utf-8");
    }
    return normalized;
  } catch (err) {
    console.warn("[hyperframes] stampFileHfIds: failed to stamp ids:", err);
    return null;
  } finally {
    closeSync(fd);
  }
}
