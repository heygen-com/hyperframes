/**
 * Op handlers for Phase 3a (non-parser ops).
 *
 * Each handler: mutates the linkedom Document, returns {forward, inverse} RFC 6902 patches.
 * Pure with respect to events — callers emit events from the patches.
 *
 * Phase 3b (parser-backed) will add setClassStyle + 7 GSAP ops as additional handlers.
 */

import type { CanResult, EditOp, GsapTweenSpec, HfId, JsonPatchOp } from "../types.js";
import type { ParsedDocument } from "./model.js";
import {
  resolveScoped,
  findRoot,
  getElementStyles,
  setElementStyles,
  getOwnText,
  setOwnText,
  getSiblingIndex,
  getGsapScript,
  setGsapScript,
  getStyleSheet,
  setStyleSheet,
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
  gsapScriptPath,
  styleSheetPath,
  scalarChange,
  scalarDelete,
  patchAdd,
  patchRemove,
} from "./patches.js";
import { upsertCssRule } from "./cssWriter.js";
import { parseGsapScriptAcornForWrite } from "@hyperframes/core/gsap-parser-acorn";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import {
  addAnimationToScript,
  updateAnimationInScript,
  removeAnimationFromScript,
  addKeyframeToScript,
  removeKeyframeFromScript,
  updateKeyframeInScript,
  addLabelToScript,
  removeLabelFromScript,
} from "@hyperframes/core/gsap-writer-acorn";

export interface MutationResult {
  forward: JsonPatchOp[];
  inverse: JsonPatchOp[];
  meta?: { animationId?: string };
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
    case "addGsapTween":
      return handleAddGsapTween(parsed, op.target, op.tween);
    case "setGsapTween":
      return handleSetGsapTween(parsed, op.animationId, op.properties);
    case "removeGsapTween":
      return handleRemoveGsapTween(parsed, op.animationId);
    case "setGsapKeyframe":
      return handleSetGsapKeyframe(
        parsed,
        op.animationId,
        op.keyframeIndex,
        op.position,
        op.value,
        op.ease,
      );
    case "addGsapKeyframe":
      return handleAddGsapKeyframe(parsed, op.animationId, op.position, op.value);
    case "removeGsapKeyframe":
      return handleRemoveGsapKeyframe(parsed, op.animationId, op.keyframeIndex);
    case "addLabel":
      return handleAddLabel(parsed, op.name, op.position);
    case "removeLabel":
      return handleRemoveLabel(parsed, op.name);
    case "setClassStyle":
      return handleSetClassStyle(parsed, op.selector, op.styles);
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
    const el = resolveScoped(parsed.document, id);
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
    const el = resolveScoped(parsed.document, id);
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
    const el = resolveScoped(parsed.document, id);
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

  // Parse GSAP script once; updateAnimationInScript re-parses internally per call but
  // we avoid re-fetching the script element on every iteration.
  const origScript = getGsapScript(parsed.document);
  const parsedGsap = origScript ? parseGsapScriptAcornForWrite(origScript) : null;
  let currentScript = origScript;

  for (const id of ids) {
    const el = resolveScoped(parsed.document, id);
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

    // Sync GSAP tween positions: the GSAP script is the source of truth at play time —
    // the timeline rebuilds from it on every seek. Without this, DOM attribute edits
    // have zero playback effect; the script's position/duration silently overrides them.
    if (parsedGsap && currentScript) {
      for (const { id: animId, animation } of parsedGsap.located) {
        if (!selectorMatchesId(animation.targetSelector, id)) continue;
        const updates: Partial<GsapAnimation> = {};
        if (timing.start !== undefined && newStart !== null) updates.position = newStart;
        if (timing.duration !== undefined && newDuration !== null) updates.duration = newDuration;
        if (Object.keys(updates).length === 0) continue;
        currentScript = updateAnimationInScript(currentScript, animId, updates);
      }
    }
  }

  // Flush accumulated GSAP script changes as a single patch pair.
  if (origScript && currentScript && currentScript !== origScript) {
    setGsapScript(parsed.document, currentScript);
    const gsapResult = gsapScriptChange(origScript, currentScript);
    result.forward.push(...gsapResult.forward);
    result.inverse.push(...gsapResult.inverse);
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
    const el = resolveScoped(parsed.document, id);
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
  const origScript = getGsapScript(parsed.document);
  let currentScript = origScript;

  for (const id of ids) {
    const el = resolveScoped(parsed.document, id);
    if (!el) continue;
    const parentEl = el.parentElement;
    const parentId = parentEl?.getAttribute("data-hf-id") ?? null;
    const siblingIndex = getSiblingIndex(el);
    const html = el.outerHTML;

    // Collect all bare hf-ids in the subtree BEFORE removal so GSAP cascade
    // removes animations targeting any sub-composition element, not just the host.
    const subtreeIds = collectSubtreeHfIds(el);

    el.remove();

    const path = elementPath(id);
    result.forward.push(patchRemove(path));
    result.inverse.push(patchAdd(path, { html, parentId, siblingIndex }));

    if (currentScript) {
      for (const subtreeId of subtreeIds) {
        currentScript = cascadeRemoveAnimations(currentScript, subtreeId);
      }
    }
  }

  if (origScript && currentScript && currentScript !== origScript) {
    setGsapScript(parsed.document, currentScript);
    const gsapResult = gsapScriptChange(origScript, currentScript);
    result.forward.push(...gsapResult.forward);
    result.inverse.push(...gsapResult.inverse);
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

// ─── GSAP selector helpers ───────────────────────────────────────────────────

function selectorMatchesId(selector: string, id: HfId): boolean {
  return (
    selector === `[data-hf-id="${id}"]` ||
    selector === `[data-hf-id='${id}']` ||
    selector === `#${id}`
  );
}

// v1 limitation: selectorMatchesId uses bare-id matching across the whole script, so a
// selector targeting "hf-leaf" will cascade-remove animations for both "hf-parent/hf-leaf"
// and any other element whose scoped or bare id matches "hf-leaf". Acceptable for typical
// single-comp use; sub-composition authors with leaf-id collisions should use
// fully-qualified selectors.

/** Collect all bare data-hf-id values from el and all its descendants. */
function collectSubtreeHfIds(el: Element): string[] {
  const ids: string[] = [];
  const own = el.getAttribute("data-hf-id");
  if (own) ids.push(own);
  for (const child of Array.from(el.querySelectorAll("[data-hf-id]"))) {
    const id = child.getAttribute("data-hf-id");
    if (id) ids.push(id);
  }
  return ids;
}

function cascadeRemoveAnimations(script: string, id: HfId): string {
  const parsedGsap = parseGsapScriptAcornForWrite(script);
  if (!parsedGsap) return script;
  let current = script;
  for (const { id: animId, animation } of parsedGsap.located) {
    if (selectorMatchesId(animation.targetSelector, id)) {
      current = removeAnimationFromScript(current, animId);
    }
  }
  return current;
}

// ─── setClassStyle handler ────────────────────────────────────────────────────

function handleSetClassStyle(
  parsed: ParsedDocument,
  selector: string,
  styles: Record<string, string | null>,
): MutationResult {
  const oldCss = getStyleSheet(parsed.document);
  const newCss = upsertCssRule(oldCss, selector, styles);
  if (newCss === oldCss) return EMPTY;
  setStyleSheet(parsed.document, newCss);
  const path = styleSheetPath();
  return {
    forward: [
      oldCss === "" ? { op: "add", path, value: newCss } : { op: "replace", path, value: newCss },
    ],
    inverse: [oldCss === "" ? { op: "remove", path } : { op: "replace", path, value: oldCss }],
  };
}

// ─── GSAP script patch helpers ───────────────────────────────────────────────

function gsapScriptChange(oldScript: string, newScript: string): MutationResult {
  const path = gsapScriptPath();
  return {
    forward: [{ op: "replace", path, value: newScript }],
    inverse: [{ op: "replace", path, value: oldScript }],
  };
}

// ─── Phase 3b handlers ───────────────────────────────────────────────────────

// fallow-ignore-next-line complexity
function handleAddGsapTween(
  parsed: ParsedDocument,
  target: HfId,
  tween: GsapTweenSpec,
): MutationResult {
  const script = getGsapScript(parsed.document);
  if (!script) return EMPTY;

  const extras: Record<string, unknown> = {};
  if (tween.repeat !== undefined) extras.repeat = tween.repeat;
  if (tween.yoyo !== undefined) extras.yoyo = tween.yoyo;
  if (tween.stagger !== undefined) extras.stagger = tween.stagger;

  const toProps =
    tween.method === "fromTo"
      ? ((tween.toProperties ?? {}) as Record<string, number | string>)
      : ((tween.toProperties ?? tween.properties ?? {}) as Record<string, number | string>);

  // Scoped ids like "hf-host/hf-leaf" must use the bare leaf id in the GSAP
  // selector — only the leaf part is written as data-hf-id on the DOM element.
  const bareTarget = target.includes("/") ? (target.split("/").at(-1) ?? target) : target;
  const animation: Omit<GsapAnimation, "id"> = {
    targetSelector: `[data-hf-id="${bareTarget}"]`,
    method: tween.method,
    position: tween.position ?? 0,
    ...(tween.duration !== undefined ? { duration: tween.duration } : {}),
    ...(tween.ease ? { ease: tween.ease } : {}),
    properties: toProps,
    ...(tween.fromProperties
      ? { fromProperties: tween.fromProperties as Record<string, number | string> }
      : {}),
    ...(Object.keys(extras).length > 0 ? { extras } : {}),
  };

  const { script: newScript, id: animationId } = addAnimationToScript(script, animation);
  if (!animationId) return EMPTY;
  setGsapScript(parsed.document, newScript);
  return { ...gsapScriptChange(script, newScript), meta: { animationId } };
}

// fallow-ignore-next-line complexity
function handleSetGsapTween(
  parsed: ParsedDocument,
  animationId: string,
  properties: Partial<GsapTweenSpec>,
): MutationResult {
  const script = getGsapScript(parsed.document);
  if (!script) return EMPTY;

  const updates: Partial<GsapAnimation> = {};
  if (properties.duration !== undefined) updates.duration = properties.duration;
  if (properties.ease !== undefined) updates.ease = properties.ease;
  if (properties.position !== undefined) updates.position = properties.position;

  const toProps = properties.toProperties ?? properties.properties;
  if (toProps) updates.properties = toProps as Record<string, number | string>;
  if (properties.fromProperties)
    updates.fromProperties = properties.fromProperties as Record<string, number | string>;

  const extras: Record<string, unknown> = {};
  if (properties.repeat !== undefined) extras.repeat = properties.repeat;
  if (properties.yoyo !== undefined) extras.yoyo = properties.yoyo;
  if (properties.stagger !== undefined) extras.stagger = properties.stagger;
  if (Object.keys(extras).length > 0) updates.extras = extras;

  const newScript = updateAnimationInScript(script, animationId, updates);
  if (newScript === script) return EMPTY;
  setGsapScript(parsed.document, newScript);
  return gsapScriptChange(script, newScript);
}

function handleRemoveGsapTween(parsed: ParsedDocument, animationId: string): MutationResult {
  const script = getGsapScript(parsed.document);
  if (!script) return EMPTY;
  const newScript = removeAnimationFromScript(script, animationId);
  if (newScript === script) return EMPTY;
  setGsapScript(parsed.document, newScript);
  return gsapScriptChange(script, newScript);
}

function resolveKeyframe(parsed: ParsedDocument, animationId: string, keyframeIndex: number) {
  const script = getGsapScript(parsed.document);
  if (!script) return null;
  const parsedForWrite = parseGsapScriptAcornForWrite(script);
  const located = parsedForWrite?.located.find((l) => l.id === animationId);
  const kfs = located?.animation.keyframes?.keyframes;
  if (!kfs || keyframeIndex < 0 || keyframeIndex >= kfs.length) return null;
  return { script, kf: kfs[keyframeIndex]!, kfs };
}

// fallow-ignore-next-line complexity
function handleSetGsapKeyframe(
  parsed: ParsedDocument,
  animationId: string,
  keyframeIndex: number,
  position: number | undefined,
  value: Record<string, unknown> | undefined,
  ease: string | undefined,
): MutationResult {
  const resolved = resolveKeyframe(parsed, animationId, keyframeIndex);
  if (!resolved) return EMPTY;
  const { script, kf: existingKf } = resolved;
  const currentPct = existingKf.percentage;
  const targetPct = position ?? currentPct;
  const props: Record<string, number | string> = value
    ? (value as Record<string, number | string>)
    : { ...existingKf.properties };
  const resolvedEase = ease ?? existingKf.ease;

  let newScript = script;
  if (targetPct !== currentPct) {
    newScript = removeKeyframeFromScript(newScript, animationId, currentPct);
    newScript = addKeyframeToScript(newScript, animationId, targetPct, props, resolvedEase);
  } else {
    newScript = updateKeyframeInScript(newScript, animationId, currentPct, props, resolvedEase);
  }

  if (newScript === script) return EMPTY;
  setGsapScript(parsed.document, newScript);
  return gsapScriptChange(script, newScript);
}

function handleAddGsapKeyframe(
  parsed: ParsedDocument,
  animationId: string,
  percentage: number,
  value: Record<string, unknown>,
): MutationResult {
  const script = getGsapScript(parsed.document);
  if (!script) return EMPTY;
  const newScript = addKeyframeToScript(
    script,
    animationId,
    percentage,
    value as Record<string, number | string>,
  );
  if (newScript === script) return EMPTY;
  setGsapScript(parsed.document, newScript);
  return gsapScriptChange(script, newScript);
}

function handleRemoveGsapKeyframe(
  parsed: ParsedDocument,
  animationId: string,
  keyframeIndex: number,
): MutationResult {
  const resolved = resolveKeyframe(parsed, animationId, keyframeIndex);
  if (!resolved) return EMPTY;
  const { script, kf, kfs } = resolved;
  const pct = kf.percentage;
  // removeKeyframeFromScript matches by percentage; bail if two keyframes share
  // the same percentage to avoid removing the wrong one.
  if (kfs.filter((k) => k.percentage === pct).length > 1) return EMPTY;
  const newScript = removeKeyframeFromScript(script, animationId, pct);
  if (newScript === script) return EMPTY;
  setGsapScript(parsed.document, newScript);
  return gsapScriptChange(script, newScript);
}

function handleAddLabel(parsed: ParsedDocument, name: string, position: number): MutationResult {
  const script = getGsapScript(parsed.document);
  if (!script) return EMPTY;
  const newScript = addLabelToScript(script, name, position);
  if (newScript === script) return EMPTY;
  setGsapScript(parsed.document, newScript);
  return gsapScriptChange(script, newScript);
}

function handleRemoveLabel(parsed: ParsedDocument, name: string): MutationResult {
  const script = getGsapScript(parsed.document);
  if (!script) return EMPTY;
  const newScript = removeLabelFromScript(script, name);
  if (newScript === script) return EMPTY;
  setGsapScript(parsed.document, newScript);
  return gsapScriptChange(script, newScript);
}

// ─── Validation (can(op)) ────────────────────────────────────────────────────

const CAN_OK: CanResult = { ok: true };

function canErr(code: string, message: string, hint?: string): CanResult {
  return hint ? { ok: false, code, message, hint } : { ok: false, code, message };
}

/** Dry-run validation — returns CanResult for the given op against current document state. */
// fallow-ignore-next-line complexity
export function validateOp(parsed: ParsedDocument, op: EditOp): CanResult {
  switch (op.type) {
    case "setStyle":
    case "setText":
    case "setAttribute":
    case "setTiming":
    case "setHold":
    case "moveElement":
    case "removeElement": {
      const ids = targets(op.target);
      if (ids.length === 0) return canErr("E_TARGET_NOT_FOUND", "No target ids provided.");
      const missing = ids.filter((id) => resolveScoped(parsed.document, id) === null);
      if (missing.length > 0)
        return canErr(
          "E_TARGET_NOT_FOUND",
          `Element(s) not found: ${missing.join(", ")}.`,
          "Verify the id against comp.getElements() or comp.find().",
        );
      return CAN_OK;
    }
    case "setVariableValue":
      if (findRoot(parsed.document) === null)
        return canErr("E_NO_ROOT", "Composition root element not found.");
      return CAN_OK;
    case "setCompositionMetadata":
    case "setClassStyle":
      return CAN_OK;
    case "addGsapTween":
    case "addLabel": {
      if (op.type === "addGsapTween" && resolveScoped(parsed.document, op.target) === null)
        return canErr(
          "E_TARGET_NOT_FOUND",
          `Element not found: ${op.target}.`,
          "Verify the id against comp.getElements() or comp.find().",
        );
      const script = getGsapScript(parsed.document);
      if (!script)
        return canErr(
          "E_NO_GSAP_SCRIPT",
          "No GSAP script block found in the composition.",
          "This composition does not use GSAP animations.",
        );
      const p = parseGsapScriptAcornForWrite(script);
      if (!p || !p.hasTimeline)
        return canErr(
          "E_NO_GSAP_TIMELINE",
          "No gsap.timeline() declaration found in the GSAP script.",
          "addGsapTween / addLabel require a timeline variable (e.g. var tl = gsap.timeline(...)).",
        );
      return CAN_OK;
    }
    case "setGsapTween":
    case "setGsapKeyframe":
    case "addGsapKeyframe":
    case "removeGsapKeyframe":
    case "removeGsapTween":
    case "removeLabel":
      if (getGsapScript(parsed.document) === null)
        return canErr(
          "E_NO_GSAP_SCRIPT",
          "No GSAP script block found in the composition.",
          "This composition does not use GSAP animations.",
        );
      return CAN_OK;
    default:
      return canErr("E_UNKNOWN_OP", `Unknown op type: "${(op as EditOp).type}".`);
  }
}
