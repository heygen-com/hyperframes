/**
 * Shared helpers for the composition variable JSON model
 * (`data-composition-variables` on `document.documentElement`).
 *
 * Single source for the parse → find-by-id → read/write/clear logic so the
 * forward-mutation path (engine/mutate.ts) and the patch-replay path
 * (engine/apply-patches.ts) can never disagree on the model's shape.
 */

type VariableDecl = { id: string; default?: unknown; [key: string]: unknown };

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
