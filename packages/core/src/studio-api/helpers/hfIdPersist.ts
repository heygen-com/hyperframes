import { ensureHfIds } from "../../parsers/hfIds.js";
import { readFileSync, writeFileSync } from "node:fs";

export { ensureHfIds };

export function persistHfIdsIfNeeded(filePath: string, html: string): string {
  const normalized = ensureHfIds(html);
  // Use attribute count instead of string equality: linkedom serialization may
  // normalize quote style and whitespace even when no ids were actually minted,
  // which would cause spurious writes on every request.
  const idsBefore = (html.match(/\bdata-hf-id=/g) ?? []).length;
  const idsAfter = (normalized.match(/\bdata-hf-id=/g) ?? []).length;
  if (idsAfter > idsBefore) {
    try {
      // Re-read before writing: if the file was modified concurrently (user
      // saved while we were processing), skip the write to avoid overwriting
      // their changes with stale content.
      const current = readFileSync(filePath, "utf-8");
      if (current === html) {
        writeFileSync(filePath, normalized, "utf-8");
      }
    } catch {
      // non-fatal — serve with ids even if persist fails
    }
  }
  return normalized;
}
