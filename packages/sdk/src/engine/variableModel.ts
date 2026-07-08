/**
 * Shared helpers for the composition variable JSON model
 * (`data-composition-variables` on `document.documentElement`).
 *
 * Single source for the parse → find-by-id → read/write/clear logic so the
 * forward-mutation path (engine/mutate.ts) and the patch-replay path
 * (engine/apply-patches.ts) can never disagree on the model's shape.
 */

// Browser-safe subpath — the core/parsers root entries pull Node-only modules
// and would break browser bundles that include the SDK (e.g. Studio).
import { parseCompositionVariables } from "@hyperframes/core/variables";
import type { CompositionVariable } from "@hyperframes/core/variables";

// Exported so the SDK index can re-export it (kept from #2098's surface).
export type VariableDecl = { id: string; default?: unknown; [key: string]: unknown };

function getHtmlEl(document: Document): Element | null {
  return (document as Document & { documentElement?: Element }).documentElement ?? null;
}

/** Parse the variable declaration array, or null when absent/invalid. */
function readDecls(document: Document): { htmlEl: Element; arr: VariableDecl[] } | null {
  const htmlEl = getHtmlEl(document);
  if (!htmlEl) return null;
  const raw = htmlEl.getAttribute("data-composition-variables");
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  return { htmlEl, arr: parsed as VariableDecl[] };
}

function indexOfId(arr: VariableDecl[], id: string): number {
  return arr.findIndex((v) => typeof v === "object" && v !== null && v.id === id);
}

/**
 * Read the typed variable declarations from `data-composition-variables`.
 * Delegates to the canonical parser (same filter the render pipeline uses),
 * so malformed entries are dropped rather than surfaced. Returns `[]` when
 * the document has no root element or no declarations.
 */
export function readVariableDeclarations(document: Document): CompositionVariable[] {
  const htmlEl = getHtmlEl(document);
  if (!htmlEl) return [];
  return parseCompositionVariables(htmlEl);
}

/**
 * Read the current `default` value for a variable id. Returns undefined when
 * the attribute is absent, the JSON is invalid, or no entry matches the id.
 */
export function readVariableDefault(document: Document, id: string): unknown {
  const decls = readDecls(document);
  if (!decls) return undefined;
  const idx = indexOfId(decls.arr, id);
  return idx < 0 ? undefined : decls.arr[idx]?.default;
}

/**
 * Upsert a variable's `default`. No-ops (returns false) when the attribute is
 * absent or contains no declaration for the id — we never auto-add declarations
 * for undeclared variables, keeping the schema authoritative. Returns true when
 * the attribute was updated.
 */
export function writeVariableDefault(document: Document, id: string, newDefault: unknown): boolean {
  const decls = readDecls(document);
  if (!decls) return false;
  const idx = indexOfId(decls.arr, id);
  if (idx < 0) return false; // variable not declared — don't auto-add
  decls.arr[idx] = { ...decls.arr[idx]!, default: newDefault };
  decls.htmlEl.setAttribute("data-composition-variables", JSON.stringify(decls.arr));
  return true;
}

/**
 * Remove the `default` key from a variable declaration, restoring its
 * "no authored default" state. This is the exact inverse of writeVariableDefault
 * adding a default to a decl that had none, so undo of a first-set on a
 * default-less variable round-trips. No-ops when the decl or key is absent.
 * Returns true when the attribute was updated.
 */
export function clearVariableDefault(document: Document, id: string): boolean {
  const decls = readDecls(document);
  if (!decls) return false;
  const idx = indexOfId(decls.arr, id);
  if (idx < 0 || !(decls.arr[idx]! && "default" in decls.arr[idx]!)) return false;
  const { default: _drop, ...rest } = decls.arr[idx]!;
  decls.arr[idx] = rest as VariableDecl;
  decls.htmlEl.setAttribute("data-composition-variables", JSON.stringify(decls.arr));
  return true;
}

/** All declared variables, or [] when the attribute is absent/invalid. */
export function listVariableDecls(document: Document): VariableDecl[] {
  return readDecls(document)?.arr ?? [];
}

/**
 * Upsert a full variable declaration (id/type/label/default/…), unlike
 * writeVariableDefault which only ever touches the `default` field of an
 * ALREADY-declared variable and refuses to create new ones. This is the
 * "let someone add a variable" path a declarations panel needs — creates the
 * `data-composition-variables` attribute from scratch when absent.
 *
 * Replaces the whole existing decl when `decl.id` is already declared (so
 * editing a variable's type/label/options goes through the same call as
 * creating one). Returns the previous decl (for inverse-patch capture) or
 * null when this was a fresh create.
 */
export function declareVariableDecl(
  document: Document,
  decl: VariableDecl,
  opts?: { atIndex?: number },
): VariableDecl | null {
  const htmlEl = getHtmlEl(document);
  if (!htmlEl) return null;
  const existing = readDecls(document);
  const arr = existing?.arr ?? [];
  const idx = indexOfId(arr, decl.id);
  const previous = idx < 0 ? null : arr[idx]!;
  if (idx >= 0) {
    arr[idx] = decl; // edit in place — position is already preserved
  } else if (opts?.atIndex !== undefined) {
    // Undo of removeVariable: reinsert at the exact index it was removed
    // from, so a remove-then-undo round-trips the array order, not just
    // set-membership (mirrors handleRemoveElement's siblingIndex).
    arr.splice(opts.atIndex, 0, decl);
  } else {
    arr.push(decl); // a genuinely new declaration goes to the end of the list
  }
  htmlEl.setAttribute("data-composition-variables", JSON.stringify(arr));
  return previous;
}

/**
 * Remove a variable's declaration entirely (not just its default — the whole
 * schema entry). Live `var.{id}` overrides and any data-var-* DOM references
 * are left untouched; removing the declaration doesn't reach into either.
 * Returns the removed decl AND its array index (for inverse-patch capture, so
 * undo can reinsert at the original position — mirrors handleRemoveElement's
 * siblingIndex), or null when the attribute/decl was absent.
 */
export function removeVariableDecl(
  document: Document,
  id: string,
): { decl: VariableDecl; index: number } | null {
  const decls = readDecls(document);
  if (!decls) return null;
  const idx = indexOfId(decls.arr, id);
  if (idx < 0) return null;
  const [removed] = decls.arr.splice(idx, 1);
  decls.htmlEl.setAttribute("data-composition-variables", JSON.stringify(decls.arr));
  return removed ? { decl: removed, index: idx } : null;
}
