/**
 * Op handlers for Phase 3a (non-parser ops).
 *
 * Each handler: mutates the linkedom Document, returns {forward, inverse} RFC 6902 patches.
 * Pure with respect to events — callers emit events from the patches.
 *
 * Phase 3b (parser-backed) will add setClassStyle + 7 GSAP ops as additional handlers.
 */

import type { EditOp, HfId, JsonPatchOp } from "../types.js";
import type { ParsedDocument } from "./model.js";
import {
  findById,
  findRoot,
  getElementStyles,
  setElementStyles,
  getOwnText,
  setOwnText,
  getSiblingIndex,
} from "./model.js";
import {
  stylePath,
  textPath,
  attrPath,
  timingPath,
  holdPath,
  elementPath,
  variablePath,
  metaPath,
  scalarChange,
  scalarDelete,
  patchAdd,
  patchRemove,
} from "./patches.js";

export interface MutationResult {
  forward: JsonPatchOp[];
  inverse: JsonPatchOp[];
}

const EMPTY: MutationResult = { forward: [], inverse: [] };

// ─── setAttribute safety ────────────────────────────────────────────────────

// Composition-reserved attributes — changing these breaks element identity or
// the core/studio data model. Reject before mutating.
const RESERVED_ATTRS = new Set([
  "data-hf-id",
  "data-composition-id",
  "data-width",
  "data-height",
  "data-start",
  "data-end",
  "data-track-index",
  "data-hold-start",
  "data-hold-end",
  "data-hold-fill",
]);

const DANGEROUS_URI_SCHEMES = /^(?:javascript|vbscript):/i;
const DANGEROUS_DATA_URI = /^data\s*:\s*text\/html/i;
const URI_BEARING_ATTRS = new Set([
  "src",
  "href",
  "action",
  "formaction",
  "poster",
  "srcset",
  "xlink:href",
]);

function validateSetAttribute(name: string, value: string | null): void {
  const lower = name.toLowerCase();
  if (RESERVED_ATTRS.has(lower)) {
    throw new Error(
      `setAttribute: "${name}" is a reserved composition attribute and cannot be reassigned. ` +
        `Use the appropriate typed method (setTiming, setHold, etc.) instead.`,
    );
  }
  if (lower.startsWith("on")) {
    throw new Error(
      `setAttribute: event-handler attributes ("${name}") are not permitted — ` +
        `they produce executable HTML that cannot be safely serialized.`,
    );
  }
  if (value !== null && URI_BEARING_ATTRS.has(lower)) {
    const trimmed = value.trim();
    if (DANGEROUS_URI_SCHEMES.test(trimmed) || DANGEROUS_DATA_URI.test(trimmed)) {
      throw new Error(`setAttribute: unsafe URI value for "${name}".`);
    }
  }
}

export class UnsupportedOpError extends Error {
  // Stable error code — part of the public API contract (F7); hosts switch on
  // err.code rather than the message.
  // fallow-ignore-next-line unused-class-member
  readonly code = "E_UNSUPPORTED_OP";
  constructor(opType: string) {
    super(
      `Op '${opType}' requires the Phase 3b parser-backed engine and is not available yet. ` +
        `Use can(op) to feature-detect before dispatching.`,
    );
    this.name = "UnsupportedOpError";
  }
}

// ─── Target normalization ────────────────────────────────────────────────────

function targets(target: HfId | HfId[]): HfId[] {
  return Array.isArray(target) ? target : [target];
}

// ─── Op dispatch ────────────────────────────────────────────────────────────

export function applyOp(parsed: ParsedDocument, op: EditOp): MutationResult {
  switch (op.type) {
    case "setStyle":
      return handleSetStyle(parsed, targets(op.target), op.styles);
    case "setText":
      return handleSetText(parsed, targets(op.target), op.value);
    case "setAttribute":
      return handleSetAttribute(parsed, targets(op.target), op.name, op.value);
    case "setTiming":
      return handleSetTiming(parsed, targets(op.target), {
        start: op.start,
        duration: op.duration,
        trackIndex: op.trackIndex,
      });
    case "setHold":
      return handleSetHold(parsed, targets(op.target), op.hold);
    case "moveElement":
      return handleMoveElement(parsed, targets(op.target), op.x, op.y);
    case "removeElement":
      return handleRemoveElement(parsed, targets(op.target));
    case "setCompositionMetadata":
      return handleSetCompositionMetadata(parsed, op);
    case "setVariableValue":
      return handleSetVariableValue(parsed, op.id, op.value);
    // Phase 3b parser-backed ops — fail loudly rather than silently no-op:
    // a caller must never believe an animation edit succeeded when nothing
    // was mutated and no patch was emitted.
    case "setClassStyle":
    case "addGsapTween":
    case "setGsapTween":
    case "setGsapKeyframe":
    case "addGsapKeyframe":
    case "removeGsapKeyframe":
    case "removeGsapTween":
    case "addLabel":
    case "removeLabel":
      throw new UnsupportedOpError(op.type);
  }
}

// ─── Op handlers ────────────────────────────────────────────────────────────

function handleSetStyle(
  parsed: ParsedDocument,
  ids: HfId[],
  styles: Record<string, string | null>,
): MutationResult {
  const result: MutationResult = { forward: [], inverse: [] };
  for (const id of ids) {
    const el = findById(parsed.document, id);
    if (!el) continue;
    const old = getElementStyles(el);
    setElementStyles(el, styles);
    for (const [prop, value] of Object.entries(styles)) {
      const path = stylePath(id, prop);
      const oldValue = old[prop] ?? null;
      if (value !== null) {
        const p = scalarChange(path, oldValue, value);
        result.forward.push(p.forward);
        result.inverse.push(p.inverse);
      } else if (oldValue !== null) {
        const p = scalarDelete(path, oldValue);
        result.forward.push(p.forward);
        result.inverse.push(p.inverse);
      }
    }
  }
  return result;
}

function handleMoveElement(
  parsed: ParsedDocument,
  ids: HfId[],
  x: number,
  y: number,
): MutationResult {
  // HF elements are positioned via data-x / data-y (parsed by htmlParser.ts,
  // emitted by hyperframes generator). CSS left/top is not the convention.
  const rx = handleSetAttribute(parsed, ids, "data-x", String(x));
  const ry = handleSetAttribute(parsed, ids, "data-y", String(y));
  return {
    forward: [...rx.forward, ...ry.forward],
    inverse: [...ry.inverse, ...rx.inverse],
  };
}

function handleSetText(parsed: ParsedDocument, ids: HfId[], value: string): MutationResult {
  const result: MutationResult = { forward: [], inverse: [] };
  for (const id of ids) {
    const el = findById(parsed.document, id);
    if (!el) continue;
    const oldText = getOwnText(el);
    setOwnText(el, value);
    const path = textPath(id);
    // getOwnText always returns string ("" for empty) — use it directly so
    // the forward patch is always op:'replace', not op:'add'. An op:'add' on
    // a text path is semantically wrong for external JSON-patch consumers
    // (the path already exists; add would fail on strict appliers).
    const p = scalarChange(path, oldText, value);
    result.forward.push(p.forward);
    result.inverse.push(p.inverse);
  }
  return result;
}

function handleSetAttribute(
  parsed: ParsedDocument,
  ids: HfId[],
  name: string,
  value: string | null,
): MutationResult {
  validateSetAttribute(name, value);
  const result: MutationResult = { forward: [], inverse: [] };
  for (const id of ids) {
    const el = findById(parsed.document, id);
    if (!el) continue;
    const oldValue = el.getAttribute(name);
    const path = attrPath(id, name);
    if (value !== null) {
      el.setAttribute(name, value);
      const p = scalarChange(path, oldValue, value);
      result.forward.push(p.forward);
      result.inverse.push(p.inverse);
    } else if (oldValue !== null) {
      el.removeAttribute(name);
      const p = scalarDelete(path, oldValue);
      result.forward.push(p.forward);
      result.inverse.push(p.inverse);
    }
  }
  return result;
}

// fallow-ignore-next-line complexity
function handleSetTiming(
  parsed: ParsedDocument,
  ids: HfId[],
  timing: { start?: number; duration?: number; trackIndex?: number },
): MutationResult {
  const result: MutationResult = { forward: [], inverse: [] };
  for (const id of ids) {
    const el = findById(parsed.document, id);
    if (!el) continue;

    const oldStartStr = el.getAttribute("data-start");
    const oldEndStr = el.getAttribute("data-end");
    const oldTrackStr = el.getAttribute("data-track-index");

    const oldStart = oldStartStr !== null ? parseFloat(oldStartStr) : null;
    const oldEnd = oldEndStr !== null ? parseFloat(oldEndStr) : null;
    const oldDuration = oldStart !== null && oldEnd !== null ? oldEnd - oldStart : null;
    const oldTrack = oldTrackStr !== null ? parseInt(oldTrackStr, 10) : null;

    const newStart = timing.start ?? oldStart;
    const newDuration = timing.duration ?? oldDuration;

    if (timing.start !== undefined && newStart !== null) {
      const path = timingPath(id, "start");
      const p = scalarChange(path, oldStart, newStart);
      result.forward.push(p.forward);
      result.inverse.push(p.inverse);
      el.setAttribute("data-start", String(newStart));
    }

    if (
      (timing.duration !== undefined || timing.start !== undefined) &&
      newStart !== null &&
      newDuration !== null
    ) {
      const newEnd = newStart + newDuration;
      // Store the computed end value directly (not the logical duration) so the inverse
      // patch is self-contained and doesn't require data-start to be restored first.
      const path = timingPath(id, "end");
      const p = scalarChange(path, oldEnd, newEnd);
      result.forward.push(p.forward);
      result.inverse.push(p.inverse);
      el.setAttribute("data-end", String(newEnd));
    }

    if (timing.trackIndex !== undefined) {
      const newTrack = timing.trackIndex;
      const path = timingPath(id, "trackIndex");
      const p = scalarChange(path, oldTrack, newTrack);
      result.forward.push(p.forward);
      result.inverse.push(p.inverse);
      el.setAttribute("data-track-index", String(newTrack));
    }
  }
  return result;
}

function handleSetHold(
  parsed: ParsedDocument,
  ids: HfId[],
  hold: { start: number; end: number; fill: "freeze" | "loop" },
): MutationResult {
  const result: MutationResult = { forward: [], inverse: [] };
  for (const id of ids) {
    const el = findById(parsed.document, id);
    if (!el) continue;

    const fields: Array<["start" | "end" | "fill", string]> = [
      ["start", String(hold.start)],
      ["end", String(hold.end)],
      ["fill", hold.fill],
    ];

    for (const [field, newVal] of fields) {
      const attrName = `data-hold-${field}`;
      const oldVal = el.getAttribute(attrName);
      const path = holdPath(id, field);
      el.setAttribute(attrName, newVal);
      const p = scalarChange(path, oldVal, newVal);
      result.forward.push(p.forward);
      result.inverse.push(p.inverse);
    }
  }
  return result;
}

function handleRemoveElement(parsed: ParsedDocument, ids: HfId[]): MutationResult {
  const result: MutationResult = { forward: [], inverse: [] };
  for (const id of ids) {
    const el = findById(parsed.document, id);
    if (!el) continue;
    const parentEl = el.parentElement;
    const parentId = parentEl?.getAttribute("data-hf-id") ?? null;
    const siblingIndex = getSiblingIndex(el);
    const html = el.outerHTML;

    el.remove();

    const path = elementPath(id);
    result.forward.push(patchRemove(path));
    result.inverse.push(patchAdd(path, { html, parentId, siblingIndex }));
  }
  return result;
}

// fallow-ignore-next-line complexity
function handleSetCompositionMetadata(
  parsed: ParsedDocument,
  op: { width?: number; height?: number; duration?: number },
): MutationResult {
  const result: MutationResult = { forward: [], inverse: [] };
  const root = findRoot(parsed.document);
  if (!root) return result;

  // The runtime treats data-width/data-height as a FORCED override of inline
  // style when present (core/runtime/init.ts applyCompositionSizing). So:
  // style is always written; the data-* attribute is updated only when the
  // composition already carries it — otherwise a style-only write would be
  // clobbered on load. Absent attributes stay absent (keeps inverses exact).
  if (op.width !== undefined) {
    const styles = getElementStyles(root);
    const oldAttr = root.getAttribute("data-width");
    const oldWidth = oldAttr ?? styles["width"] ?? null;
    const newVal = `${op.width}px`;
    setElementStyles(root, { width: newVal });
    if (oldAttr !== null) root.setAttribute("data-width", String(op.width));
    const path = metaPath("width");
    const p = scalarChange(path, oldWidth !== null ? parseFloat(oldWidth) : null, op.width);
    result.forward.push(p.forward);
    result.inverse.push(p.inverse);
  }

  if (op.height !== undefined) {
    const styles = getElementStyles(root);
    const oldAttr = root.getAttribute("data-height");
    const oldHeight = oldAttr ?? styles["height"] ?? null;
    const newVal = `${op.height}px`;
    setElementStyles(root, { height: newVal });
    if (oldAttr !== null) root.setAttribute("data-height", String(op.height));
    const path = metaPath("height");
    const p = scalarChange(path, oldHeight !== null ? parseFloat(oldHeight) : null, op.height);
    result.forward.push(p.forward);
    result.inverse.push(p.inverse);
  }

  if (op.duration !== undefined) {
    const oldDur = root.getAttribute("data-duration");
    const oldVal = oldDur !== null ? parseFloat(oldDur) : null;
    root.setAttribute("data-duration", String(op.duration));
    const path = metaPath("duration");
    const p = scalarChange(path, oldVal, op.duration);
    result.forward.push(p.forward);
    result.inverse.push(p.inverse);
  }

  return result;
}

function handleSetVariableValue(
  parsed: ParsedDocument,
  id: string,
  value: string | number | boolean,
): MutationResult {
  const root = findRoot(parsed.document);
  if (!root) return EMPTY;

  const cssVar = `--${id}`;
  const oldStyles = getElementStyles(root);
  const oldValue = oldStyles[cssVar] ?? null;
  const newVal = String(value);
  setElementStyles(root, { [cssVar]: newVal });

  const path = variablePath(id);
  const p = scalarChange(path, oldValue, newVal);
  return { forward: [p.forward], inverse: [p.inverse] };
}

// ─── Validation (can(op)) ────────────────────────────────────────────────────

/** Returns true if the op can be applied to the current document state. */
export function validateOp(parsed: ParsedDocument, op: EditOp): boolean {
  switch (op.type) {
    case "setStyle":
    case "setText":
    case "setAttribute":
    case "setTiming":
    case "setHold":
    case "moveElement":
    case "removeElement": {
      const ids = targets(op.target);
      return ids.length > 0 && ids.every((id) => findById(parsed.document, id) !== null);
    }
    case "setVariableValue":
      return findRoot(parsed.document) !== null;
    case "setCompositionMetadata":
      return true;
    // Phase 3b and unknown ops — report false so callers can feature-detect.
    // An unknown op type must never silently pass validation only to no-op
    // or throw in applyOp (which would violate the can() contract).
    default:
      return false;
  }
}
