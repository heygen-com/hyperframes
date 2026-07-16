/**
 * Op handlers for Phase 3a (non-parser ops).
 *
 * Each handler: mutates the linkedom Document, returns {forward, inverse} RFC 6902 patches.
 * Pure with respect to events — callers emit events from the patches.
 *
 * Phase 3b (parser-backed) will add setClassStyle + 7 GSAP ops as additional handlers.
 */

import type {
  CanResult,
  EditOp,
  FontValue,
  GsapTweenSpec,
  HfId,
  ImageValue,
  JsonPatchOp,
} from "../types.js";
import type { ParsedDocument } from "./model.js";
import {
  resolveScoped,
  escapeHfId,
  findRoot,
  declarationElement,
  getElementStyles,
  setElementStyles,
  toCamel,
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
  variableDeclPath,
  metaPath,
  gsapScriptPath,
  styleSheetPath,
  scalarChange,
  scalarDelete,
  valueChange,
  patchAdd,
  patchRemove,
} from "./patches.js";
import { upsertCssRule } from "./cssWriter.js";
import { mintHfId, EXCLUDED_TAGS } from "@hyperframes/core/hf-ids";
import { EDIT_BASE_X_ATTR, EDIT_BASE_Y_ATTR } from "@hyperframes/core/runtime/position-edits";
import { readClipTiming, writeClipTiming } from "@hyperframes/core/composition-contract";
import { parseGsapScriptAcornForWrite } from "@hyperframes/core/gsap-parser-acorn";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import {
  addAnimationToScript,
  addAnimationWithKeyframesToScript,
  updateAnimationInScript,
  removeAnimationFromScript,
  removePropertyFromAnimation,
  addKeyframeToScript,
  removeKeyframeFromScript,
  removeAllKeyframesFromScript,
  convertToKeyframesFromScript,
  materializeKeyframesFromScript,
  splitIntoPropertyGroupsFromScript,
  splitAnimationsInScript,
  updateKeyframeInScript,
  addLabelToScript,
  removeLabelFromScript,
  setArcPathInScript,
  updateArcSegmentInScript,
  removeArcPathFromScript,
  unrollDynamicAnimations,
} from "@hyperframes/core/gsap-writer-acorn";
import { deriveKeyframeBackfillDefaults } from "./keyframeBackfill.js";
import {
  readVariableDefault,
  writeVariableDefault,
  findVariableDeclaration,
  writeVariableDeclaration,
  removeVariableDeclarationEntry,
} from "./variableModel.js";
import {
  isCompositionVariable,
  isScalarVariableValue as isScalar,
} from "@hyperframes/core/variables";
import type { CompositionVariable } from "@hyperframes/core/variables";
import {
  URI_BEARING_ATTRS,
  DANGEROUS_URI_SCHEMES,
  DANGEROUS_DATA_URI,
} from "@hyperframes/core/html-attr-safety";

export interface MutationResult {
  forward: JsonPatchOp[];
  inverse: JsonPatchOp[];
  meta?: { animationId?: string; newId?: string };
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

function dispatchRemoveGsapKeyframe(
  parsed: ParsedDocument,
  op: Extract<EditOp, { type: "removeGsapKeyframe" }>,
): MutationResult {
  return handleRemoveGsapKeyframeByPercentage(parsed, op.animationId, op.percentage);
}

function applyGsapKeyframeOp(parsed: ParsedDocument, op: EditOp): MutationResult | undefined {
  switch (op.type) {
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
      return dispatchRemoveGsapKeyframe(parsed, op);
    case "removeAllKeyframes":
      return handleRemoveAllKeyframes(parsed, op.animationId);
    case "convertToKeyframes":
      return handleConvertToKeyframes(parsed, op.animationId, op.resolvedFromValues);
    case "materializeKeyframes":
      return handleMaterializeKeyframes(
        parsed,
        op.animationId,
        op.keyframes,
        op.easeEach,
        op.resolvedSelector,
      );
    case "splitIntoPropertyGroups":
      return handleSplitIntoPropertyGroups(parsed, op.animationId);
    case "splitAnimations":
      return handleSplitAnimations(parsed, op);
    default:
      return undefined;
  }
}

function applyArcPathOp(parsed: ParsedDocument, op: EditOp): MutationResult | undefined {
  const s = getGsapScript(parsed.document) ?? "";
  switch (op.type) {
    case "setArcPath": {
      const cfg = {
        ...op.config,
        segments: op.config.segments.map((seg) => ({ ...seg, curviness: seg.curviness ?? 1 })),
      };
      return handleArcPathScript(parsed, s, setArcPathInScript(s, op.animationId, cfg));
    }
    case "updateArcSegment":
      return handleArcPathScript(
        parsed,
        s,
        updateArcSegmentInScript(s, op.animationId, op.segmentIndex, op.update),
      );
    case "removeArcPath":
      return handleArcPathScript(parsed, s, removeArcPathFromScript(s, op.animationId));
    case "unrollDynamicAnimations":
      return handleArcPathScript(
        parsed,
        s,
        unrollDynamicAnimations(s, op.animationId, op.elements),
      );
    default:
      return undefined;
  }
}

function applyGsapWithKeyframesOp(parsed: ParsedDocument, op: EditOp): MutationResult | undefined {
  switch (op.type) {
    case "addWithKeyframes":
      return handleAddWithKeyframes(parsed, op);
    case "replaceWithKeyframes":
      return handleReplaceWithKeyframes(parsed, op);
    default:
      return undefined;
  }
}

function applyGsapOp(parsed: ParsedDocument, op: EditOp): MutationResult | undefined {
  const kf = applyGsapKeyframeOp(parsed, op);
  if (kf !== undefined) return kf;
  const arc = applyArcPathOp(parsed, op);
  if (arc !== undefined) return arc;
  const wkf = applyGsapWithKeyframesOp(parsed, op);
  if (wkf !== undefined) return wkf;
  switch (op.type) {
    case "addGsapTween":
      return handleAddGsapTween(parsed, op.target, op.tween);
    case "setGsapTween":
      return handleSetGsapTween(parsed, op.animationId, op.properties);
    case "removeGsapProperty":
      return handleRemoveGsapProperty(parsed, op.animationId, op.property, op.from);
    case "removeGsapTween":
      return handleRemoveGsapTween(parsed, op.animationId);
    case "deleteAllForSelector":
      return handleDeleteAllForSelector(parsed, op.selector);
    default:
      return undefined;
  }
}

export function applyOp(parsed: ParsedDocument, op: EditOp): MutationResult {
  const gsap = applyGsapOp(parsed, op);
  if (gsap !== undefined) return gsap;
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
    case "addElement":
      return handleAddElement(parsed, op.parent, op.index, op.html);
    case "reorderElements":
      return handleReorderElements(parsed, op.entries);
    case "setCompositionMetadata":
      return handleSetCompositionMetadata(parsed, op);
    case "setVariableValue":
      return handleSetVariableValue(parsed, op.id, op.value);
    case "declareVariable":
      return handleDeclareVariable(parsed, op.declaration);
    case "updateVariableDeclaration":
      return handleUpdateVariableDeclaration(parsed, op.id, op.declaration);
    case "removeVariableDeclaration":
      return handleRemoveVariableDeclaration(parsed, op.id);
    case "removeVariable":
      // #2098 alias — delegate to the canonical handler so its patch grammar
      // and undo inverse match the rest of the variable-declaration ops.
      return handleRemoveVariableDeclaration(parsed, op.id);
    case "setClassStyle":
      return handleSetClassStyle(parsed, op.selector, op.styles);
    case "addLabel":
      return handleAddLabel(parsed, op.name, op.position);
    case "removeLabel":
      return handleRemoveLabel(parsed, op.name);
    default:
      throw new UnsupportedOpError((op as EditOp).type);
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
      // Normalize to the camelCase key the style map + patch grammar use. A
      // hyphenated op key ("transform-origin") otherwise misses the camelCase
      // store, so oldValue is always null → undo deletes/loses the prior value,
      // a removal skips its inverse patch entirely (DOM/patch-log desync), and
      // the patch path/override-set key diverge from the camelCase grammar.
      const key = toCamel(prop);
      const path = stylePath(id, key);
      const oldValue = old[key] ?? null;
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
  //
  // The pre-edit values are captured once per element into
  // data-hf-edit-base-x/y. The runtime (core runtime/positionEdits.ts) renders
  // the edit as translate(data-x − base, data-y − base), which composes with
  // GSAP-animated transforms instead of being overwritten per-axis.
  const parts: MutationResult[] = [];
  for (const id of ids) {
    const el = resolveScoped(parsed.document, id);
    if (!el) continue;
    if (el.getAttribute(EDIT_BASE_X_ATTR) === null) {
      parts.push(
        handleSetAttribute(parsed, [id], EDIT_BASE_X_ATTR, el.getAttribute("data-x") ?? "0"),
      );
    }
    if (el.getAttribute(EDIT_BASE_Y_ATTR) === null) {
      parts.push(
        handleSetAttribute(parsed, [id], EDIT_BASE_Y_ATTR, el.getAttribute("data-y") ?? "0"),
      );
    }
  }
  parts.push(handleSetAttribute(parsed, ids, "data-x", String(x)));
  parts.push(handleSetAttribute(parsed, ids, "data-y", String(y)));
  return {
    forward: parts.flatMap((p) => p.forward),
    inverse: parts
      .slice()
      .reverse()
      .flatMap((p) => p.inverse),
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

    const beforeAttributes = {
      start: el.getAttribute("data-start"),
      duration: el.getAttribute("data-duration"),
      end: el.getAttribute("data-end"),
      trackIndex: el.getAttribute("data-track-index"),
      layer: el.getAttribute("data-layer"),
    };
    const oldTiming = readClipTiming(el);
    const oldStart = oldTiming.start;
    const oldDuration = oldTiming.duration;

    const newStart = timing.start ?? oldStart;
    const newDuration = timing.duration ?? oldDuration;

    writeClipTiming(el, timing);
    const afterAttributes = {
      start: el.getAttribute("data-start"),
      duration: el.getAttribute("data-duration"),
      end: el.getAttribute("data-end"),
      trackIndex: el.getAttribute("data-track-index"),
      layer: el.getAttribute("data-layer"),
    };

    const recordAttributeChange = (
      path: string,
      before: string | null,
      after: string | null,
      numeric: boolean,
    ) => {
      if (before === after) return;
      const toPatchValue = (value: string): string | number => {
        if (!numeric) return value;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : value;
      };
      if (after === null) {
        if (before === null) return;
        const patch = scalarDelete(path, toPatchValue(before));
        result.forward.push(patch.forward);
        result.inverse.push(patch.inverse);
        return;
      }
      const oldValue = before === null ? null : toPatchValue(before);
      const newValue = toPatchValue(after);
      const patch = scalarChange(path, oldValue, newValue);
      result.forward.push(patch.forward);
      result.inverse.push(patch.inverse);
    };

    recordAttributeChange(
      timingPath(id, "start"),
      beforeAttributes.start,
      afterAttributes.start,
      true,
    );
    recordAttributeChange(
      timingPath(id, "duration"),
      beforeAttributes.duration,
      afterAttributes.duration,
      true,
    );
    recordAttributeChange(timingPath(id, "end"), beforeAttributes.end, afterAttributes.end, true);
    recordAttributeChange(
      timingPath(id, "trackIndex"),
      beforeAttributes.trackIndex,
      afterAttributes.trackIndex,
      true,
    );
    recordAttributeChange(
      attrPath(id, "data-layer"),
      beforeAttributes.layer,
      afterAttributes.layer,
      false,
    );

    // Sync GSAP tween positions: the GSAP script is the source of truth at play time —
    // the timeline rebuilds from it on every seek. Without this, DOM attribute edits
    // have zero playback effect; the script's position/duration silently overrides them.
    // Match against BOTH the element's data-hf-id (the canonical form) AND its DOM
    // id: the Studio GSAP panel / ensureElementAddressable author tweens as
    // `#domId`, which selectorMatchesId(hfId) never matched — so moving/resizing
    // those clips left their tweens unsynced.
    const matchHfId = el.getAttribute("data-hf-id") ?? id;
    const matchDomId = el.getAttribute("id");
    if (parsedGsap && currentScript) {
      // A missing data-start means an implicit start of 0 (matching the server
      // shiftGsapPositions path); a malformed attr parses to NaN. Sanitize to a
      // finite number so a start-less/blank clip still shifts and never feeds
      // NaN into the tween positions.
      const oldStartNum = oldStart !== null && Number.isFinite(oldStart) ? oldStart : 0;
      // Per-tween shift/scale (mirrors shiftGsapPositions/scaleGsapPositions): a
      // multi-tween stagger maps each tween's own intra-clip position by the
      // start DELTA and scales its duration by the clip-duration RATIO. Writing
      // the absolute newStart/newDuration onto every tween would collapse the
      // stagger onto one point and blow each tween's duration to the full clip.
      const startChanged = timing.start !== undefined && newStart !== null;
      const durChanged = timing.duration !== undefined && newDuration !== null;
      const ratio =
        durChanged && oldDuration !== null && oldDuration > 0 && newDuration !== null
          ? newDuration / oldDuration
          : 1;
      const remapStart = startChanged && newStart !== null ? newStart : oldStartNum;
      for (const { id: animId, animation } of parsedGsap.located) {
        const matches =
          selectorMatchesId(animation.targetSelector, matchHfId) ||
          (matchDomId !== null && selectorMatchesId(animation.targetSelector, matchDomId));
        if (!matches) continue;
        // Skip tweens whose position is a label or relative string ("+=0.5",
        // "<", ">"): relative positions already track their neighbours, and a
        // string position can't be safely shifted by the clip delta here.
        // ponytail: known ceiling — string positions are not re-synced on
        // move/resize; numeric positions only.
        if (typeof animation.position !== "number") continue;
        const updates: Partial<GsapAnimation> = {};
        // Don't write an absolute position onto an auto-sequenced tween (no
        // explicit position arg → parsed as implicitPosition): the writer would
        // APPEND a position arg, collapsing the stagger onto one point. Duration
        // still scales below.
        if ((startChanged || durChanged) && animation.implicitPosition !== true) {
          const shifted = remapStart + (animation.position - oldStartNum) * ratio;
          updates.position = Math.max(0, Math.round(shifted * 1000) / 1000);
        }
        if (durChanged && typeof animation.duration === "number" && animation.duration > 0) {
          updates.duration = Math.max(0.001, Math.round(animation.duration * ratio * 1000) / 1000);
        }
        if (Object.keys(updates).length === 0) continue;
        currentScript = updateAnimationInScript(currentScript, animId, updates);
      }
    }
  }

  // Flush accumulated GSAP script changes as a single patch pair.
  // fallow-ignore-next-line code-duplication
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

  // fallow-ignore-next-line code-duplication
  if (origScript && currentScript && currentScript !== origScript) {
    setGsapScript(parsed.document, currentScript);
    const gsapResult = gsapScriptChange(origScript, currentScript);
    result.forward.push(...gsapResult.forward);
    result.inverse.push(...gsapResult.inverse);
  }

  return result;
}

// ─── addElement handler ───────────────────────────────────────────────────────

/**
 * Resolve all existing hf-ids in the document into `assigned` so that
 * mintHfId cannot issue an id that already exists in the composition.
 */
function collectDocumentHfIds(document: Document): Set<string> {
  const assigned = new Set<string>();
  for (const el of Array.from(document.querySelectorAll("[data-hf-id]"))) {
    const id = el.getAttribute("data-hf-id");
    if (id) assigned.add(id);
  }
  return assigned;
}

/**
 * Stamp data-hf-id onto every un-stamped element in `root` and its
 * descendants, minting ids against `assigned` (the live document's id set).
 * Returns the minted id of `root` (or its existing id if already stamped).
 */
function mintFragmentIds(root: Element, assigned: Set<string>): string {
  if (!root.getAttribute("data-hf-id") && !EXCLUDED_TAGS.has(root.tagName.toLowerCase())) {
    root.setAttribute("data-hf-id", mintHfId(root, assigned));
  }
  for (const el of Array.from(root.querySelectorAll("*"))) {
    if (EXCLUDED_TAGS.has(el.tagName.toLowerCase())) continue;
    if (el.getAttribute("data-hf-id")) continue; // pinned
    el.setAttribute("data-hf-id", mintHfId(el, assigned));
  }
  return root.getAttribute("data-hf-id") ?? "";
}

/**
 * Insert an HTML fragment (single-root) as a child of `parent` at `index`.
 * Mints ids against the LIVE document's existing id set so new ids can never
 * collide with elements already in the composition. Returns the minted root id
 * via result.meta.newId — mirrors the `animationId` pattern in addGsapTween.
 *
 * Inverse = patchRemove of the new element's path; mirrors handleRemoveElement's
 * inverse = patchAdd. Forward/inverse are thus symmetric with that handler.
 */
/**
 * Parse an HTML fragment in the target document and return its single root
 * element, or null when it is empty, multi-root, or contains a <script>.
 * The dispatch path skips validateOp, so these guards are re-enforced here:
 * never insert raw <script>, never silently drop extra roots.
 */
function parseInsertableFragment(document: Document, html: string): Element | null {
  // Same temp-div approach as apply-patches.ts to avoid cross-document issues.
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  if (tmp.querySelector("script")) return null;
  const node = tmp.firstElementChild;
  if (!node || node.nextElementSibling) return null;
  return node;
}

function handleAddElement(
  parsed: ParsedDocument,
  parent: HfId | null,
  index: number,
  html: string,
): MutationResult {
  // Resolve parent element (null → document body). Narrow rather than assert:
  // _dispatch does not run validateOp, so a bad parent id must not crash here.
  const parentEl =
    parent === null
      ? ((parsed.document as Document & { body?: Element | null }).body ?? null)
      : resolveScoped(parsed.document, parent);
  if (!parentEl) return EMPTY;

  const node = parseInsertableFragment(parsed.document, html);
  if (!node) return EMPTY;

  // Mint ids against the LIVE doc's existing id set (the #1 landmine — a fresh
  // ensureHfIds(fragment) is blind to existing doc ids and can collide).
  // Order: mint → capture outerHTML → insert → build patch (id needed for path).
  const assigned = collectDocumentHfIds(parsed.document);
  const newId = mintFragmentIds(node, assigned);
  const stampedHtml = node.outerHTML;

  // Insert at `index` — append if index >= childCount (RFC-6902 insert semantics).
  const ref = Array.from(parentEl.children)[index] ?? null;
  parentEl.insertBefore(node, ref);

  // parentId for the inverse/replay patch: preserve the caller's id verbatim
  // (scoped "hf-host/hf-leaf" path or composition id), not the bare data-hf-id —
  // apply-patches resolves it via findById→resolveScoped, so dropping the host
  // prefix would re-insert under the wrong (canonical) parent on redo/replay.
  const parentId = parent;

  const path = elementPath(newId);
  return {
    forward: [patchAdd(path, { html: stampedHtml, parentId, siblingIndex: index })],
    inverse: [patchRemove(path)],
    meta: { newId },
  };
}

function handleReorderElements(
  parsed: ParsedDocument,
  entries: Array<{ target: HfId; zIndex: number }>,
): MutationResult {
  const result: MutationResult = { forward: [], inverse: [] };
  // Last write wins per target — a duplicated target collapses to one zIndex
  // patch instead of emitting redundant same-path patches in one dispatch.
  const lastByTarget = new Map<HfId, number>();
  for (const { target, zIndex } of entries) lastByTarget.set(target, zIndex);
  for (const [target, zIndex] of lastByTarget) {
    const sub = handleSetStyle(parsed, [target], { zIndex: String(zIndex) });
    result.forward.push(...sub.forward);
    result.inverse.push(...sub.inverse);
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

// ─── Variable JSON model helpers ─────────────────────────────────────────────
// readVariableDefault / writeVariableDefault now live in ./variableModel.ts,
// shared with the patch-replay path (apply-patches.ts) so the model shape can't
// diverge between forward mutation and replay.

/**
 * True when the value is a FontValue or ImageValue object
 * (object-valued; must NOT be written as a CSS custom property).
 */
function isObjectVariableValue(
  value: string | number | boolean | FontValue | ImageValue,
): value is FontValue | ImageValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function handleSetVariableValue(
  parsed: ParsedDocument,
  id: string,
  value: string | number | boolean | FontValue | ImageValue,
): MutationResult {
  const root = findRoot(parsed.document);
  if (!root) return EMPTY;
  const declEl = declarationElement(parsed.document, parsed.wrapped);

  const modelPath = variablePath(id);
  const oldVarDefault = readVariableDefault(declEl, id);

  // Update the JSON model (B1 — drives the runtime) and keep the CSS custom
  // prop as secondary / compat for compositions that CSS-bind directly to
  // --{id}. Object values (font / image) are not valid CSS custom property
  // values (LOCKED §7) — cssCompatChange clears any stale scalar prop instead.
  // Emitting separate model + style patches keeps apply-patches.ts pure per
  // path type, so inverse patches restore the exact pre-call state.
  writeVariableDefault(declEl, id, value);
  const modelP = valueChange(modelPath, oldVarDefault ?? null, value);
  const forward: JsonPatchOp[] = [modelP.forward];
  const inverse: JsonPatchOp[] = [modelP.inverse];

  const css = cssCompatChange(parsed, id, isObjectVariableValue(value) ? null : String(value));
  if (css) {
    forward.push(css.forward);
    inverse.push(css.inverse);
  }

  return { forward, inverse };
}

/**
 * Keep the `--{id}` CSS compat custom property on the root in sync with a
 * scalar default (same secondary channel handleSetVariableValue maintains).
 * Pass null to clear. Returns the patch pair, or null when there is no root
 * or nothing to change.
 */
function cssCompatChange(
  parsed: ParsedDocument,
  id: string,
  newVal: string | null,
): { forward: JsonPatchOp; inverse: JsonPatchOp } | null {
  const root = findRoot(parsed.document);
  const rootId = root?.getAttribute("data-hf-id");
  if (!root || !rootId) return null;
  const cssVar = `--${id}`;
  const oldCssValue = getElementStyles(root)[cssVar] ?? null;
  if (newVal !== null) {
    if (oldCssValue === newVal) return null;
    setElementStyles(root, { [cssVar]: newVal });
    return scalarChange(stylePath(rootId, cssVar), oldCssValue, newVal);
  }
  if (oldCssValue === null) return null;
  setElementStyles(root, { [cssVar]: null });
  return scalarDelete(stylePath(rootId, cssVar), oldCssValue);
}

/**
 * Declaration ops need an element that survives serialize() to carry
 * `data-composition-variables`. Full-document comps use `<html>`; wrapped
 * template/fragment comps use their composition root div (the synthetic
 * `<html>` is stripped on save). Only a wrapped input with no root element at
 * all (an empty body) has nowhere durable to write.
 */
function fragmentCompositionErr(parsed: ParsedDocument): CanResult | null {
  if (declarationElement(parsed.document, parsed.wrapped)) return null;
  return canErr(
    "E_FRAGMENT_COMPOSITION",
    "Fragment compositions cannot carry variable declarations.",
    "The composition has no root element to hold data-composition-variables — add a composition root or convert to a full HTML document.",
  );
}

function invalidDeclarationErr(): CanResult {
  return canErr(
    "E_INVALID_ARGS",
    "Not a valid variable declaration.",
    "Requires id, label, type (string|number|color|boolean|enum|font|image), and a default matching the type; enum also requires options[].",
  );
}

// A variable id becomes a CSS custom-property name (`--{id}`), a `data-var-*`
// attribute value, and a CLI `--variables` key. isCompositionVariable only
// checks it is a non-empty string, so the SDK — the last gate before Studio /
// CSS / CLI make those assumptions — enforces a safe identifier shape here.
const VALID_VARIABLE_ID = /^[A-Za-z_][A-Za-z0-9_-]*$/;

function isValidVariableId(id: string): boolean {
  return VALID_VARIABLE_ID.test(id);
}

function invalidVariableIdErr(id: string): CanResult {
  return canErr(
    "E_INVALID_VARIABLE_ID",
    `Variable id ${JSON.stringify(id)} is not a valid identifier.`,
    "Ids must match /^[A-Za-z_][A-Za-z0-9_-]*$/ — they become CSS custom-property names (--id), data-var-* attribute values, and CLI --variables keys.",
  );
}

/**
 * Shared can() precondition for declareVariable/updateVariableDeclaration:
 * refuse fragment compositions, non-declaration shapes, and malformed ids.
 * Returns the CanResult to surface, or null when the declaration is well-formed.
 * The shape check runs before the id access so a null/non-object declaration
 * yields a CanResult, not a TypeError.
 */
function declarationPreconditionErr(
  parsed: ParsedDocument,
  declaration: CompositionVariable,
): CanResult | null {
  const fragmentErr = fragmentCompositionErr(parsed);
  if (fragmentErr) return fragmentErr;
  if (!isCompositionVariable(declaration)) return invalidDeclarationErr();
  if (!isValidVariableId(declaration.id)) return invalidVariableIdErr(declaration.id);
  return null;
}

function handleDeclareVariable(
  parsed: ParsedDocument,
  declaration: CompositionVariable,
): MutationResult {
  // Defensive re-check of can(): never write an invalid or duplicate
  // declaration into the schema. Resolve the element that survives serialize
  // (root div for wrapped template comps, <html> otherwise); no element = a
  // bare fragment where a declaration would be lost on save.
  const declEl = declarationElement(parsed.document, parsed.wrapped);
  if (!declEl) return EMPTY;
  if (!isCompositionVariable(declaration)) return EMPTY;
  if (!isValidVariableId(declaration.id)) return EMPTY;
  if (findVariableDeclaration(declEl, declaration.id) !== undefined) return EMPTY;
  if (!writeVariableDeclaration(declEl, declaration)) return EMPTY;
  const path = variableDeclPath(declaration.id);
  const result: MutationResult = {
    forward: [patchAdd(path, declaration)],
    inverse: [patchRemove(path)],
  };
  // Same CSS compat channel every other variable op maintains — a composition
  // CSS-bound to var(--id) must resolve regardless of which op set the value.
  if (isScalar(declaration.default)) {
    const css = cssCompatChange(parsed, declaration.id, String(declaration.default));
    if (css) {
      result.forward.push(css.forward);
      result.inverse.push(css.inverse);
    }
  }
  return result;
}

function handleUpdateVariableDeclaration(
  parsed: ParsedDocument,
  id: string,
  declaration: CompositionVariable,
): MutationResult {
  const declEl = declarationElement(parsed.document, parsed.wrapped);
  if (!declEl) return EMPTY;
  if (!isCompositionVariable(declaration) || declaration.id !== id) return EMPTY;
  const old = findVariableDeclaration(declEl, id);
  if (old === undefined) return EMPTY;
  writeVariableDeclaration(declEl, declaration);
  const p = valueChange(variableDeclPath(id), old, declaration);
  const result: MutationResult = { forward: [p.forward], inverse: [p.inverse] };

  // Default changed → keep the CSS compat prop in sync (set for scalars,
  // clear when the new default is object-valued font/image), and emit the
  // paired /variables value patch so the T3 override-set's var.{id} entry
  // agrees with the varDecl.{id} snapshot regardless of replay order.
  const oldDefault = old.default;
  const newDefault = declaration.default;
  if (JSON.stringify(oldDefault) !== JSON.stringify(newDefault)) {
    const valueP = valueChange(variablePath(id), oldDefault ?? null, newDefault);
    result.forward.push(valueP.forward);
    result.inverse.push(valueP.inverse);
    const css = cssCompatChange(parsed, id, isScalar(newDefault) ? String(newDefault) : null);
    if (css) {
      result.forward.push(css.forward);
      result.inverse.push(css.inverse);
    }
  }
  return result;
}

function handleRemoveVariableDeclaration(parsed: ParsedDocument, id: string): MutationResult {
  const declEl = declarationElement(parsed.document, parsed.wrapped);
  if (!declEl) return EMPTY;
  const old = findVariableDeclaration(declEl, id);
  if (old === undefined) return EMPTY;
  removeVariableDeclarationEntry(declEl, id);
  const path = variableDeclPath(id);
  const result: MutationResult = {
    forward: [patchRemove(path)],
    inverse: [patchAdd(path, old)],
  };
  const css = cssCompatChange(parsed, id, null);
  if (css) {
    result.forward.push(css.forward);
    result.inverse.push(css.inverse);
  }
  return result;
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
  // Re-parse after each removal: animation ids are positional, so removing one
  // tween renumbers the survivors — ids from a single up-front parse go stale and
  // no-op, orphaning later tweens on the removed element. Same fix as
  // stripGsapForId in htmlParser.ts (R3 #3); this is its SDK-side twin.
  let current = script;
  for (;;) {
    const parsedGsap = parseGsapScriptAcornForWrite(current);
    if (!parsedGsap) return current;
    const match = parsedGsap.located.find((l) => selectorMatchesId(l.animation.targetSelector, id));
    if (!match) return current;
    const next = removeAnimationFromScript(current, match.id);
    if (next === current) return current; // guard against a non-removing match
    current = next;
  }
}

// ─── addWithKeyframes / replaceWithKeyframes handlers ────────────────────────

function handleAddWithKeyframes(
  parsed: ParsedDocument,
  op: Extract<EditOp, { type: "addWithKeyframes" }>,
): MutationResult {
  const script = getGsapScript(parsed.document);
  if (!script) throw new Error("No GSAP script block found in the composition.");
  // Dispatch skips validateOp — re-enforce the empty-keyframes guard here so we
  // never emit a degenerate `keyframes: {}` tween.
  if (op.keyframes.length === 0) return EMPTY;
  const { script: newScript, id: animationId } = addAnimationWithKeyframesToScript(
    script,
    op.targetSelector,
    op.position,
    op.duration,
    op.keyframes,
    op.ease,
  );
  if (!animationId) return EMPTY;
  setGsapScript(parsed.document, newScript);
  return { ...gsapScriptChange(script, newScript), meta: { animationId } };
}

function handleReplaceWithKeyframes(
  parsed: ParsedDocument,
  op: Extract<EditOp, { type: "replaceWithKeyframes" }>,
): MutationResult {
  const script = getGsapScript(parsed.document);
  if (!script) throw new Error("No GSAP script block found in the composition.");
  if (op.keyframes.length === 0) return EMPTY;
  // #11: tween IDs are position-derived and re-point after any structural edit,
  // so a stale `animationId` can resolve to a DIFFERENT tween. Require the
  // located animation to still target the selector the caller expects; if it is
  // absent or now points at another element, bail rather than silently replace
  // the wrong tween. (validateOp's gsapAnimationMissing only catches absent ids.)
  const located = locateGsapAnimation(parsed, op.animationId);
  if (!located || located.animation.targetSelector !== op.targetSelector) return EMPTY;
  // Step 1: remove the existing tween. Position-derived IDs renumber, so the
  // inverse patch restores the full GSAP script rather than trying to re-insert
  // by ID (handled by the coarse gsapScriptChange patch pair).
  const afterRemove = removeAnimationFromScript(script, op.animationId);
  // Defense in depth: if the id resolved to nothing the script is unchanged —
  // bail rather than degrade the replace into a plain add (duplicate tween).
  if (afterRemove === script) return EMPTY;
  // Step 2: insert the replacement keyframed tween.
  const { script: newScript, id: animationId } = addAnimationWithKeyframesToScript(
    afterRemove,
    op.targetSelector,
    op.position,
    op.duration,
    op.keyframes,
    op.ease,
  );
  if (!animationId) return EMPTY;
  setGsapScript(parsed.document, newScript);
  return { ...gsapScriptChange(script, newScript), meta: { animationId } };
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

// Build the GSAP target selector for an add op. The SDK's whole element↔tween
// attribution is data-hf-id based (selectorMatchesId, cascadeRemoveAnimations,
// buildAnimationIdMap), so ALWAYS emit the canonical [data-hf-id="…"] form.
//
// Resolve the target first: a normal element resolves to itself (hf-id ==
// target). A sub-composition ROOT addressed by its composition id resolves —
// via resolveScoped's comp-id fallback — to the host element, whose own
// data-hf-id we then emit. The fidelity resolver unifies this with the server
// writer's [data-composition-id="…"] form because both querySelector to the
// same host node.
function gsapTargetSelector(
  document: Parameters<typeof resolveScoped>[0],
  bareTarget: string,
): string {
  const el = resolveScoped(document, bareTarget);
  if (!el) return `[data-hf-id="${escapeHfId(bareTarget)}"]`;
  const hfId = el.getAttribute("data-hf-id");
  if (hfId) return `[data-hf-id="${escapeHfId(hfId)}"]`;
  // Resolved a sub-comp root that carries data-composition-id but no own
  // data-hf-id (rare/defensive) — address it by its composition id.
  const compId = el.getAttribute("data-composition-id");
  if (compId) return `[data-composition-id="${escapeHfId(compId)}"]`;
  return `[data-hf-id="${escapeHfId(bareTarget)}"]`;
}

// fallow-ignore-next-line complexity
function handleAddGsapTween(
  parsed: ParsedDocument,
  target: HfId,
  tween: GsapTweenSpec,
): MutationResult {
  const script = getGsapScript(parsed.document);
  if (!script) throw new Error("No GSAP script block found in the composition.");

  const extras: Record<string, unknown> = {};
  if (tween.repeat !== undefined) extras.repeat = tween.repeat;
  if (tween.yoyo !== undefined) extras.yoyo = tween.yoyo;
  if (tween.stagger !== undefined) extras.stagger = tween.stagger;

  // A fromTo's destination may arrive as either `toProperties` or `properties`
  // (the Studio add path sets `properties`). Fall back the same way for every
  // method — the old fromTo-only branch read `toProperties` alone and wrote an
  // empty to-vars object, so fromTo animations added via cutover animated to {}.
  const toProps = (tween.toProperties ?? tween.properties ?? {}) as Record<string, number | string>;

  // Scoped ids like "hf-host/hf-leaf" must use the bare leaf id in the GSAP
  // selector — only the leaf part is written as data-hf-id on the DOM element.
  const bareTarget = target.includes("/") ? (target.split("/").at(-1) ?? target) : target;
  const animation: Omit<GsapAnimation, "id"> = {
    targetSelector: gsapTargetSelector(parsed.document, bareTarget),
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
  if (!script) throw new Error("No GSAP script block found in the composition.");

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

function handleRemoveGsapProperty(
  parsed: ParsedDocument,
  animationId: string,
  property: string,
  from: boolean | undefined,
): MutationResult {
  const script = getGsapScript(parsed.document);
  if (!script) return EMPTY;
  const newScript = removePropertyFromAnimation(script, animationId, property, from ?? false);
  if (newScript === script) return EMPTY;
  setGsapScript(parsed.document, newScript);
  return gsapScriptChange(script, newScript);
}

function handleRemoveGsapTween(parsed: ParsedDocument, animationId: string): MutationResult {
  const script = getGsapScript(parsed.document);
  if (!script) throw new Error("No GSAP script block found in the composition.");
  const newScript = removeAnimationFromScript(script, animationId);
  if (newScript === script) return EMPTY;
  setGsapScript(parsed.document, newScript);
  return gsapScriptChange(script, newScript);
}

function handleRemoveAllKeyframes(parsed: ParsedDocument, animationId: string): MutationResult {
  const script = getGsapScript(parsed.document);
  if (!script) return EMPTY;
  const newScript = removeAllKeyframesFromScript(script, animationId);
  if (newScript === script) return EMPTY;
  setGsapScript(parsed.document, newScript);
  return gsapScriptChange(script, newScript);
}

function handleConvertToKeyframes(
  parsed: ParsedDocument,
  animationId: string,
  resolvedFromValues?: Record<string, number | string>,
): MutationResult {
  const script = getGsapScript(parsed.document);
  if (!script) return EMPTY;
  const newScript = convertToKeyframesFromScript(script, animationId, resolvedFromValues);
  if (newScript === script) return EMPTY;
  setGsapScript(parsed.document, newScript);
  return gsapScriptChange(script, newScript);
}

function handleMaterializeKeyframes(
  parsed: ParsedDocument,
  animationId: string,
  keyframes: Array<{
    percentage: number;
    properties: Record<string, number | string>;
    ease?: string;
  }>,
  easeEach?: string,
  resolvedSelector?: string,
): MutationResult {
  const script = getGsapScript(parsed.document);
  if (!script) return EMPTY;
  const newScript = materializeKeyframesFromScript(
    script,
    animationId,
    keyframes,
    easeEach,
    resolvedSelector,
  );
  if (newScript === script) return EMPTY;
  setGsapScript(parsed.document, newScript);
  return gsapScriptChange(script, newScript);
}

function handleSplitIntoPropertyGroups(
  parsed: ParsedDocument,
  animationId: string,
): MutationResult {
  const script = getGsapScript(parsed.document);
  if (!script) return EMPTY;
  const { script: newScript } = splitIntoPropertyGroupsFromScript(script, animationId);
  if (newScript === script) return EMPTY;
  setGsapScript(parsed.document, newScript);
  return gsapScriptChange(script, newScript);
}

function handleSplitAnimations(
  parsed: ParsedDocument,
  op: Extract<EditOp, { type: "splitAnimations" }>,
): MutationResult {
  const script = getGsapScript(parsed.document);
  if (!script) return EMPTY;
  const { script: newScript } = splitAnimationsInScript(script, {
    originalId: op.originalId,
    newId: op.newId,
    splitTime: op.splitTime,
    elementStart: op.elementStart,
    elementDuration: op.elementDuration,
  });
  if (newScript === script) return EMPTY;
  setGsapScript(parsed.document, newScript);
  return gsapScriptChange(script, newScript);
}

function handleArcPathScript(
  parsed: ParsedDocument,
  oldScript: string,
  newScript: string,
): MutationResult {
  if (newScript === oldScript) return EMPTY;
  setGsapScript(parsed.document, newScript);
  return gsapScriptChange(oldScript, newScript);
}

function handleDeleteAllForSelector(parsed: ParsedDocument, selector: string): MutationResult {
  const script = getGsapScript(parsed.document);
  if (!script) return EMPTY;
  const parsedForWrite = parseGsapScriptAcornForWrite(script);
  if (!parsedForWrite) return EMPTY;
  // Compare quote-insensitively: [data-hf-id='x'] and [data-hf-id="x"] are the
  // same selector. A strict === missed the alternate quote style and matched
  // nothing while can() reported ok.
  const wanted = selector.replace(/'/g, '"');
  const matching = parsedForWrite.located.filter(
    (l) => l.animation.targetSelector.replace(/'/g, '"') === wanted,
  );
  if (matching.length === 0) return EMPTY;
  let newScript = script;
  for (const m of [...matching].reverse()) {
    newScript = removeAnimationFromScript(newScript, m.id);
  }
  if (newScript === script) return EMPTY;
  setGsapScript(parsed.document, newScript);
  // ponytail: skips stripStudioEditsFromTarget (data-hf-studio-path-offset cleanup) —
  // studio path offset is cosmetic once all animations are gone; session reloads after write
  return gsapScriptChange(script, newScript);
}

function resolveKeyframe(parsed: ParsedDocument, animationId: string, keyframeIndex: number) {
  const script = getGsapScript(parsed.document);
  if (!script) return null;
  const parsedForWrite = parseGsapScriptAcornForWrite(script);
  const located = parsedForWrite?.located.find((l) => l.id === animationId);
  const kfs = located?.animation.keyframes?.keyframes;
  const kf = kfs?.[keyframeIndex];
  if (!kfs || !kf || keyframeIndex < 0) return null;
  return { script, kf, kfs };
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
    // Thread the same backfill defaults the add path uses so a move (remove +
    // re-add at a new percentage) seeds new props into sibling keyframes the same
    // way, keeping both entry points behaviorally identical.
    newScript = addKeyframeToScript(
      newScript,
      animationId,
      targetPct,
      props,
      resolvedEase,
      deriveKeyframeBackfillDefaults(props),
    );
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
  if (!script) throw new Error("No GSAP script block found in the composition.");
  const props = value as Record<string, number | string>;
  const newScript = addKeyframeToScript(
    script,
    animationId,
    percentage,
    props,
    undefined,
    deriveKeyframeBackfillDefaults(props),
  );
  if (newScript === script) return EMPTY;
  setGsapScript(parsed.document, newScript);
  return gsapScriptChange(script, newScript);
}

function handleRemoveGsapKeyframeByPercentage(
  parsed: ParsedDocument,
  animationId: string,
  percentage: number,
): MutationResult {
  const script = getGsapScript(parsed.document);
  if (!script) return EMPTY;
  const parsedForWrite = parseGsapScriptAcornForWrite(script);
  const located = parsedForWrite?.located.find((l) => l.id === animationId);
  const kfs = located?.animation.keyframes?.keyframes;
  if (!kfs) return EMPTY;
  // No-op on ambiguity: duplicate-percentage keyframes can't be disambiguated.
  const TOLERANCE = 0.001;
  const matches = kfs.filter((k) => Math.abs(k.percentage - percentage) <= TOLERANCE);
  const sole = matches[0];
  if (matches.length !== 1 || !sole) return EMPTY;
  const pct = sole.percentage;
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

/** E_NO_GSAP_SCRIPT CanResult when the composition has no GSAP script, else null. */
function gsapScriptMissing(parsed: ParsedDocument): CanResult | null {
  return getGsapScript(parsed.document) === null
    ? canErr(
        "E_NO_GSAP_SCRIPT",
        "No GSAP script block found in the composition.",
        "This composition does not use GSAP animations.",
      )
    : null;
}

/** The located GSAP animation for `animationId`, or undefined. */
function locateGsapAnimation(parsed: ParsedDocument, animationId: string) {
  const script = getGsapScript(parsed.document);
  if (!script) return undefined;
  return parseGsapScriptAcornForWrite(script)?.located.find((l) => l.id === animationId);
}

/**
 * E_TARGET_NOT_FOUND CanResult when no GSAP animation resolves to `animationId`,
 * else null. Without this, can() returned ok for stale/positional ids that then
 * no-op'd at apply — the caller believed the edit would land.
 */
function gsapAnimationMissing(parsed: ParsedDocument, animationId: string): CanResult | null {
  if (getGsapScript(parsed.document) === null) return null; // reported by gsapScriptMissing
  return locateGsapAnimation(parsed, animationId)
    ? null
    : canErr(
        "E_TARGET_NOT_FOUND",
        `No GSAP animation found with id "${animationId}".`,
        "Animation ids are positional and shift after edits — re-read them from comp before dispatching.",
      );
}

/** Validate updateArcSegment: the tween must have an enabled arc with that segment. */
function validateArcSegment(
  parsed: ParsedDocument,
  op: Extract<EditOp, { type: "updateArcSegment" }>,
): CanResult {
  const arc = locateGsapAnimation(parsed, op.animationId)?.animation.arcPath;
  if (!arc?.enabled)
    return canErr(
      "E_ARC_NOT_ENABLED",
      `Animation "${op.animationId}" has no enabled arc path.`,
      "Call setArcPath({ enabled: true }) before updating a segment.",
    );
  if (op.segmentIndex < 0 || op.segmentIndex >= arc.segments.length)
    return canErr(
      "E_INVALID_ARGS",
      `Segment index ${op.segmentIndex} is out of range (0..${arc.segments.length - 1}).`,
    );
  return CAN_OK;
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
      // fallow-ignore-next-line code-duplication
      const missing = ids.filter((id) => resolveScoped(parsed.document, id) === null);
      if (missing.length > 0)
        return canErr(
          "E_TARGET_NOT_FOUND",
          `Element(s) not found: ${missing.join(", ")}.`,
          "Verify the id against comp.getElements() or comp.find().",
        );
      return CAN_OK;
    }
    case "addElement": {
      if (op.parent !== null && resolveScoped(parsed.document, op.parent) === null)
        return canErr(
          "E_TARGET_NOT_FOUND",
          `Parent element not found: "${op.parent}".`,
          "Verify the parent id against comp.getElements() or comp.find().",
        );
      if (op.index < 0) return canErr("E_INVALID_ARGS", `index must be >= 0 (got ${op.index}).`);
      if (!op.html || op.html.trim().length === 0)
        return canErr("E_INVALID_HTML", "html must not be empty.");
      // Parse to check for <script> and zero-element fragments.
      // Use the same temp-div pattern as apply-patches.ts for consistency.
      const tmp = parsed.document.createElement("div");
      tmp.innerHTML = op.html;
      if (tmp.firstElementChild === null)
        return canErr("E_INVALID_HTML", "html parses to zero element nodes.");
      if (tmp.querySelector("script") !== null)
        return canErr(
          "E_INVALID_HTML",
          "<script> elements are not permitted in addElement html.",
          "GSAP is managed by the composition's single script block; add tweens via addGsapTween.",
        );
      return CAN_OK;
    }
    case "reorderElements": {
      if (op.entries.length === 0) return CAN_OK;
      // fallow-ignore-next-line code-duplication
      const missing = op.entries
        .map((e) => e.target)
        .filter((id) => resolveScoped(parsed.document, id) === null);
      if (missing.length > 0)
        return canErr(
          "E_TARGET_NOT_FOUND",
          `Element(s) not found: ${missing.join(", ")}.`,
          "Verify the id against comp.getElements() or comp.find().",
        );
      return CAN_OK;
    }
    case "setVariableValue":
    case "removeVariable":
      if (findRoot(parsed.document) === null)
        return canErr("E_NO_ROOT", "Composition root element not found.");
      return CAN_OK;
    case "declareVariable": {
      const preErr = declarationPreconditionErr(parsed, op.declaration);
      if (preErr) return preErr;
      if (
        findVariableDeclaration(
          declarationElement(parsed.document, parsed.wrapped),
          op.declaration.id,
        ) !== undefined
      )
        return canErr(
          "E_DUPLICATE_VARIABLE",
          `Variable "${op.declaration.id}" is already declared.`,
          "Use updateVariableDeclaration to change it, or setVariableValue to change its default.",
        );
      return CAN_OK;
    }
    case "updateVariableDeclaration": {
      const preErr = declarationPreconditionErr(parsed, op.declaration);
      if (preErr) return preErr;
      if (op.declaration.id !== op.id)
        return canErr(
          "E_INVALID_ARGS",
          `declaration.id ("${op.declaration.id}") must match id ("${op.id}").`,
          "Variable ids are immutable — rename via removeVariableDeclaration + declareVariable.",
        );
      if (
        findVariableDeclaration(declarationElement(parsed.document, parsed.wrapped), op.id) ===
        undefined
      )
        return canErr(
          "E_VARIABLE_NOT_FOUND",
          `Variable "${op.id}" is not declared.`,
          "Check comp.getVariableDeclarations(), or add it with declareVariable.",
        );
      return CAN_OK;
    }
    case "removeVariableDeclaration": {
      const fragmentErr = fragmentCompositionErr(parsed);
      if (fragmentErr) return fragmentErr;
      if (
        findVariableDeclaration(declarationElement(parsed.document, parsed.wrapped), op.id) ===
        undefined
      )
        return canErr(
          "E_VARIABLE_NOT_FOUND",
          `Variable "${op.id}" is not declared.`,
          "Check comp.getVariableDeclarations().",
        );
      return CAN_OK;
    }
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
    case "removeGsapProperty":
    case "removeGsapTween":
    case "removeAllKeyframes":
    case "convertToKeyframes":
    case "splitIntoPropertyGroups":
    case "setArcPath":
    case "removeArcPath":
      return gsapScriptMissing(parsed) ?? gsapAnimationMissing(parsed, op.animationId) ?? CAN_OK;
    case "updateArcSegment":
      return (
        gsapScriptMissing(parsed) ??
        gsapAnimationMissing(parsed, op.animationId) ??
        validateArcSegment(parsed, op)
      );
    case "splitAnimations":
    case "deleteAllForSelector":
    case "removeLabel":
      return gsapScriptMissing(parsed) ?? CAN_OK;
    case "addWithKeyframes":
      return (
        gsapScriptMissing(parsed) ??
        (op.keyframes.length === 0
          ? canErr(
              "E_INVALID_ARGS",
              "addWithKeyframes requires at least one keyframe.",
              "An empty keyframe list would create an animation with no keyframes.",
            )
          : CAN_OK)
      );
    case "replaceWithKeyframes":
      return (
        gsapScriptMissing(parsed) ??
        gsapAnimationMissing(parsed, op.animationId) ??
        (op.keyframes.length === 0
          ? canErr(
              "E_INVALID_ARGS",
              "replaceWithKeyframes requires at least one keyframe.",
              "An empty keyframe list would create an animation with no keyframes.",
            )
          : CAN_OK)
      );
    case "unrollDynamicAnimations":
      return (
        gsapScriptMissing(parsed) ??
        gsapAnimationMissing(parsed, op.animationId) ??
        (op.elements.length === 0
          ? canErr(
              "E_INVALID_ARGS",
              "unrollDynamicAnimations requires at least one element.",
              "An empty element list would delete the animation; pass the resolved element list.",
            )
          : CAN_OK)
      );
    case "materializeKeyframes":
      return (
        gsapScriptMissing(parsed) ??
        gsapAnimationMissing(parsed, op.animationId) ??
        (op.keyframes.length === 0
          ? canErr(
              "E_INVALID_ARGS",
              "materializeKeyframes requires at least one keyframe.",
              "An empty keyframe list would empty the animation; pass the resolved keyframes.",
            )
          : CAN_OK)
      );
    default:
      return canErr("E_UNKNOWN_OP", `Unknown op type: "${(op as EditOp).type}".`);
  }
}
