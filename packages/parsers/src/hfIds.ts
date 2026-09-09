/**
 * Stable hf- element id minting (R1). Node-safe (linkedom only, not browser DOM).
 *
 * Two surfaces share these helpers:
 *  - ensureHfIds(html): node-id surface — mints data-hf-id on every element.
 *  - mintHfId(el, assigned): shared by htmlParser for clip ids.
 *
 * Hash is CONTENT ONLY (tag + sorted attrs + own text) — no sibling position,
 * so inserting a non-identical sibling never shifts another element's id.
 */
import { parseHTML } from "linkedom";
import { assignHfIds } from "./hfIdAssignment.js";
export {
  EXCLUDED_TAGS,
  mintHfId,
  isCompositionTemplate,
  walkCompositionDescendants,
} from "./hfIdAssignment.js";

export function ensureHfIds(html: string): string {
  // Wrap fragments so every body element participates in stable ID assignment.
  const wrapped = !/<!doctype|<html[\s>]/i.test(html);
  const { document } = wrapped
    ? parseHTML(`<!DOCTYPE html><html><head></head><body>${html}</body></html>`)
    : parseHTML(html);
  if (!document.body) return html;
  assignHfIds(document.body);
  return wrapped ? document.body.innerHTML || "" : document.toString();
}
