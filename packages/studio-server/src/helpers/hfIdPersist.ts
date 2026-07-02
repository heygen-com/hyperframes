import { ensureHfIds } from "@hyperframes/parsers/hf-ids";
import { readFileSync, writeFileSync } from "node:fs";

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
