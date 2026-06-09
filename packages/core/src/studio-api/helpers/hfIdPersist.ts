import { ensureHfIds } from "../../parsers/hfIds.js";
import { writeFileSync } from "node:fs";

export { ensureHfIds };

export function normalizeHfIds(html: string): { html: string; changed: boolean } {
  const normalized = ensureHfIds(html);
  return { html: normalized, changed: normalized !== html };
}

export function persistHfIdsIfNeeded(filePath: string, html: string): string {
  const { html: normalized, changed } = normalizeHfIds(html);
  if (changed) {
    try {
      writeFileSync(filePath, normalized, "utf-8");
    } catch {
      // non-fatal — serve with ids even if persist fails
    }
  }
  return normalized;
}
