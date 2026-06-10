/**
 * HTML serializer — walks the live linkedom Document and generates clean HF HTML.
 *
 * Phase 3a: generates from the live DOM. The DOM IS the mutable state.
 * Phase 3b: GSAP script section will use the meriyah/offset-splice path once available.
 */

import type { ParsedDocument } from "./model.js";

/**
 * Serialize the live document back to HTML.
 *
 * If the original input was a fragment (wrapped=true), returns only body content.
 * If the original input had a full HTML shell (wrapped=false), returns the full document.
 */
export function serializeDocument(parsed: ParsedDocument): string {
  const doc = parsed.document;
  if (parsed.wrapped) {
    return (doc.body as HTMLBodyElement).innerHTML ?? "";
  }
  return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
}
