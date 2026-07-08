/**
 * RFC 6902 patch path grammar (F2) and override-set key mapping (F2 item 7).
 *
 * Path grammar:
 *   /elements/{hfId}/inlineStyles/{camelCaseProp}
 *   /elements/{hfId}/text
 *   /elements/{hfId}/attributes/{name}
 *   /elements/{hfId}/timing/{start|end|duration|trackIndex}   ← end = computed absolute data-end
 *   /elements/{hfId}/hold/{start|end|fill}
 *   /elements/{hfId}                        ← whole subtree (removeElement)
 *   /variables/{variableId}                 ← declaration's default value
 *   /variableDeclarations/{variableId}      ← whole declaration object
 *   /metadata/{width|height|duration}
 *   /script/gsap                            ← GSAP inline script textContent
 *   /style/css                              ← <style> element textContent
 *
 * Override-set key mapping:
 *   /elements/hf-x/inlineStyles/fontSize    → "hf-x.style.fontSize"
 *   /elements/hf-x/text                     → "hf-x.text"
 *   /elements/hf-x/attributes/src           → "hf-x.attr.src"
 *   /elements/hf-x/timing/start             → "hf-x.timing.start"
 *   /elements/hf-x/hold/start               → "hf-x.hold.start"
 *   /elements/hf-x                          → "hf-x"  (null = removal marker)
 *   /variables/brand-color-primary          → "var.brand-color-primary"
 *   /variableDeclarations/brand-color-primary → "varDecl.brand-color-primary"
 *   /metadata/width                         → "meta.width"
 *   /script/gsap                            → "script.gsap"
 *   /style/css                              → "style.css"
 */

import type { JsonPatchOp, PatchEvent } from "../types.js";

// ─── Path builders ────────────────────────────────────────────────────────────

/**
 * RFC 6902 JSON Pointer escaping for an hf-id (bare or scoped).
 * Scoped ids contain "/" which must be encoded as "~1" in a path segment.
 * "~" must be encoded as "~0" first (order matters per RFC 6902 §3).
 */
function escapeIdForPath(id: string): string {
  return id.replace(/~/g, "~0").replace(/\//g, "~1");
}

/** Decode a path segment that may contain RFC 6902-escaped characters back to an hf-id. */
function decodePathSegment(segment: string): string {
  // RFC 6902 §3: unescape ~1 → /, then ~0 → ~ (reverse order)
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

export function stylePath(id: string, prop: string): string {
  return `/elements/${escapeIdForPath(id)}/inlineStyles/${prop}`;
}

export function textPath(id: string): string {
  return `/elements/${escapeIdForPath(id)}/text`;
}

export function attrPath(id: string, name: string): string {
  // RFC 6902 JSON Pointer: ~ → ~0, / → ~1
  const escapedName = name.replace(/~/g, "~0").replace(/\//g, "~1");
  return `/elements/${escapeIdForPath(id)}/attributes/${escapedName}`;
}

export function timingPath(id: string, field: "start" | "end" | "duration" | "trackIndex"): string {
  return `/elements/${escapeIdForPath(id)}/timing/${field}`;
}

export function holdPath(id: string, field: "start" | "end" | "fill"): string {
  return `/elements/${escapeIdForPath(id)}/hold/${field}`;
}

export function elementPath(id: string): string {
  return `/elements/${escapeIdForPath(id)}`;
}

export function variablePath(id: string): string {
  return `/variables/${id}`;
}

/** Whole-declaration path — distinct from /variables/{id}, which is the default *value*. */
export function variableDeclPath(id: string): string {
  return `/variableDeclarations/${id}`;
}

export function metaPath(field: "width" | "height" | "duration"): string {
  return `/metadata/${field}`;
}

export function gsapScriptPath(): string {
  return "/script/gsap";
}

export function styleSheetPath(): string {
  return "/style/css";
}

// ─── Override-set key mapping ─────────────────────────────────────────────────

/**
 * Maps an RFC 6902 patch path to its override-set key.
 * Returns null for paths that don't correspond to override-set entries.
 */
export function pathToKey(path: string): string | null {
  // /elements/{id}/inlineStyles/{prop} → "{id}.style.{prop}"
  // id segment may contain ~1 (RFC 6902-escaped "/") for scoped ids
  const styleMatch = /^\/elements\/([^/]+)\/inlineStyles\/(.+)$/.exec(path);
  if (styleMatch) return `${decodePathSegment(styleMatch[1]!)}.style.${styleMatch[2]}`;

  // /elements/{id}/text → "{id}.text"
  const textMatch = /^\/elements\/([^/]+)\/text$/.exec(path);
  if (textMatch) return `${decodePathSegment(textMatch[1]!)}.text`;

  // /elements/{id}/attributes/{name} → "{id}.attr.{name}"
  const attrMatch = /^\/elements\/([^/]+)\/attributes\/(.+)$/.exec(path);
  if (attrMatch) return `${decodePathSegment(attrMatch[1]!)}.attr.${attrMatch[2]}`;

  // /elements/{id}/timing/{field} → "{id}.timing.{field}"
  // Note: field "end" maps to the computed data-end attribute value.
  const timingMatch = /^\/elements\/([^/]+)\/timing\/(.+)$/.exec(path);
  if (timingMatch) return `${decodePathSegment(timingMatch[1]!)}.timing.${timingMatch[2]}`;

  // /elements/{id}/hold/{field} → "{id}.hold.{field}"
  const holdMatch = /^\/elements\/([^/]+)\/hold\/(.+)$/.exec(path);
  if (holdMatch) return `${decodePathSegment(holdMatch[1]!)}.hold.${holdMatch[2]}`;

  // /elements/{id} (whole element) → "{id}"
  const elemMatch = /^\/elements\/([^/]+)$/.exec(path);
  if (elemMatch) return decodePathSegment(elemMatch[1]!);

  // /variableDeclarations/{id} → "varDecl.{id}" (checked before /variables/)
  const varDeclMatch = /^\/variableDeclarations\/(.+)$/.exec(path);
  if (varDeclMatch) return `varDecl.${varDeclMatch[1]}`;

  // /variables/{id} → "var.{id}"
  const varMatch = /^\/variables\/(.+)$/.exec(path);
  if (varMatch) return `var.${varMatch[1]}`;

  // /metadata/{field} → "meta.{field}"
  const metaMatch = /^\/metadata\/(.+)$/.exec(path);
  if (metaMatch) return `meta.${metaMatch[1]}`;

  // /script/gsap → "script.gsap"
  if (path === "/script/gsap") return "script.gsap";

  // /style/css → "style.css"
  if (path === "/style/css") return "style.css";

  return null;
}

/**
 * Inverse of pathToKey — maps an override-set key back to its RFC 6902 path.
 * Used to replay a stored override-set onto a fresh base document (T3 init).
 */
// Exhaustive key-family dispatcher — same shape as apply-patches.ts parsePath.
// fallow-ignore-next-line complexity
export function keyToPath(key: string): string | null {
  const style = /^([^.]+)\.style\.(.+)$/.exec(key);
  if (style?.[1] && style[2]) return stylePath(style[1], style[2]);

  const text = /^([^.]+)\.text$/.exec(key);
  if (text?.[1]) return textPath(text[1]);

  const attr = /^([^.]+)\.attr\.(.+)$/.exec(key);
  // The attr name segment in the key is already RFC 6902-encoded (pathToKey stored it verbatim).
  // The id may be a scoped id (contains "/") so we must escape it, but must NOT re-escape
  // the already-encoded attr segment. Reconstruct manually.
  if (attr?.[1] && attr[2]) return `/elements/${escapeIdForPath(attr[1])}/attributes/${attr[2]}`;

  const timing = /^([^.]+)\.timing\.(start|end|duration|trackIndex)$/.exec(key);
  if (timing?.[1])
    return timingPath(timing[1], timing[2] as "start" | "end" | "duration" | "trackIndex");

  const hold = /^([^.]+)\.hold\.(start|end|fill)$/.exec(key);
  if (hold?.[1]) return holdPath(hold[1], hold[2] as "start" | "end" | "fill");

  const varDecl = /^varDecl\.(.+)$/.exec(key);
  if (varDecl?.[1]) return variableDeclPath(varDecl[1]);

  const variable = /^var\.(.+)$/.exec(key);
  if (variable?.[1]) return variablePath(variable[1]);

  const meta = /^meta\.(width|height|duration)$/.exec(key);
  if (meta) return metaPath(meta[1] as "width" | "height" | "duration");

  if (key === "script.gsap") return gsapScriptPath();
  if (key === "style.css") return styleSheetPath();

  // Bare element id — removal marker key.
  if (!key.includes(".")) return elementPath(key);

  return null;
}

// ─── Patch event builder ──────────────────────────────────────────────────────

export function buildPatchEvent(
  forward: readonly JsonPatchOp[],
  inverse: readonly JsonPatchOp[],
  origin: unknown,
  opTypes: readonly string[],
): PatchEvent {
  return { formatVersion: 1, patches: forward, inversePatches: inverse, origin, opTypes };
}

// ─── Replace/add/remove helpers ───────────────────────────────────────────────

function patchReplace(path: string, value: unknown): JsonPatchOp {
  return { op: "replace", path, value };
}

export function patchAdd(path: string, value: unknown): JsonPatchOp {
  return { op: "add", path, value };
}

export function patchRemove(path: string): JsonPatchOp {
  return { op: "remove", path };
}

/** Emit forward (replace or add) + inverse (replace or remove) for a scalar change. */
export function scalarChange(
  path: string,
  oldValue: string | number | boolean | null | undefined,
  newValue: string | number | boolean,
): { forward: JsonPatchOp; inverse: JsonPatchOp } {
  const forward = oldValue == null ? patchAdd(path, newValue) : patchReplace(path, newValue);
  const inverse = oldValue == null ? patchRemove(path) : patchReplace(path, oldValue ?? null);
  return { forward, inverse };
}

/**
 * Emit forward (replace or add) + inverse (replace or remove) for any JSON-serializable value.
 * Use instead of scalarChange when the value may be an object (e.g. font/image variable).
 * The old value is captured whole — no sub-key diffing.
 */
export function valueChange(
  path: string,
  oldValue: unknown,
  newValue: unknown,
): { forward: JsonPatchOp; inverse: JsonPatchOp } {
  const forward = oldValue == null ? patchAdd(path, newValue) : patchReplace(path, newValue);
  const inverse = oldValue == null ? patchRemove(path) : patchReplace(path, oldValue);
  return { forward, inverse };
}

/** Emit forward remove + inverse add for a deletion. */
export function scalarDelete(
  path: string,
  oldValue: string | number | boolean,
): { forward: JsonPatchOp; inverse: JsonPatchOp } {
  return {
    forward: patchRemove(path),
    inverse: patchAdd(path, oldValue),
  };
}
