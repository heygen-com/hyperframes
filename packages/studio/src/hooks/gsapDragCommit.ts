/**
 * Low-level drag commit helpers for GSAP position mutations.
 * Extracted from gsapRuntimeBridge.ts to keep file sizes under the 600-line limit.
 */
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import {
  STUDIO_ORIGINAL_WIDTH_ATTR,
  STUDIO_ORIGINAL_HEIGHT_ATTR,
} from "../components/editor/manualEditsTypes";
import { usePlayerStore } from "../player/store/playerStore";
import { readRuntimeKeyframes, scanAllRuntimeKeyframes } from "./gsapRuntimeKeyframes";
import { resolveTweenStart, resolveTweenDuration } from "../utils/globalTimeCompiler";
import { roundTo3 } from "../utils/rounding";
import { computeElementPercentage } from "./gsapShared";
import { computeDraggedGsapPosition } from "./draggedGsapPosition";
import type { RuntimeTweenChange } from "./gsapRuntimePatch";
import { isGestureTransactionCommit, runGestureTransaction } from "./gestureTransaction";
import { setPatchFromUpdateProperty } from "./gsapDragStaticSetHelpers";
export {
  findExistingPositionWrite,
  findRotationSetAnimation,
  findSizeSetAnimation,
} from "./gsapDragStaticSetHelpers";
export interface GsapDragCommitCallbacks {
  commitMutation: (
    selection: DomEditSelection,
    mutation: Record<string, unknown>,
    options: {
      label: string;
      coalesceKey?: string;
      softReload?: boolean;
      skipReload?: boolean;
      beforeReload?: () => void;
      /**
       * Value-only fast path: when set, `runCommit` patches the changed tween in
       * the preview runtime in place (instant, no re-run) and only falls back to
       * the soft reload if the patch can't be safely applied. Attached only to
       * value-only `set` commits; structural/keyframe commits omit it.
       */
      instantPatch?: { selector: string; change: RuntimeTweenChange };
    },
  ) => Promise<void>;
  fetchAnimations?: () => Promise<GsapAnimation[]>;
}

// Re-export for backward compatibility with existing imports.
export function computeCurrentPercentage(
  selection: DomEditSelection,
  animation?: GsapAnimation,
): number {
  return computeElementPercentage(usePlayerStore.getState().currentTime, selection, animation);
}

// When a drag edits a SELECTED keyframe, park the playhead on that keyframe's exact
// time. Otherwise the playhead can sit a frame outside the tween (e.g. 1.1666 vs a
// 1.2 start), so the post-commit reseek renders the element's base pose and the edit
// looks like it snapped away. Keeping the playhead on the edited keyframe avoids that.
export function parkPlayheadOnKeyframe(anim: GsapAnimation, pct: number): void {
  const ts = resolveTweenStart(anim);
  const td = resolveTweenDuration(anim);
  if (ts == null || !td || td <= 0) return;
  usePlayerStore.getState().requestSeek(roundTo3(ts + (pct / 100) * td));
}

async function replaceKeyframedPositionHold(
  selection: DomEditSelection,
  selector: string,
  existingSet: GsapAnimation,
  properties: { x: number; y: number },
  commitMutation: GsapDragCommitCallbacks["commitMutation"],
): Promise<void> {
  const persist = async (commit: GsapDragCommitCallbacks["commitMutation"]) => {
    await commit(
      selection,
      {
        type: "add",
        targetSelector: selector,
        method: "set",
        position: 0,
        properties,
        global: true,
      },
      { label: "Move layer", skipReload: true },
    );
    await commit(
      selection,
      { type: "delete", animationId: existingSet.id },
      { label: "Move layer", softReload: true },
    );
  };

  if (isGestureTransactionCommit(commitMutation)) {
    await persist(commitMutation);
    return;
  }
  await runGestureTransaction({
    element: selection.element,
    label: "Move layer",
    settle: () => undefined,
    persist: async (commit) => persist(commit(commitMutation)),
    restore: () => undefined,
  });
}

// ── Dynamic keyframe materialization ──────────────────────────────────────

export async function materializeIfDynamic(
  anim: GsapAnimation,
  iframe: HTMLIFrameElement | null,
  commitMutation: GsapDragCommitCallbacks["commitMutation"],
  selection: DomEditSelection,
): Promise<string | void> {
  if (!anim.hasUnresolvedKeyframes && !anim.hasUnresolvedSelector) return;

  if (anim.hasUnresolvedSelector) {
    const allScanned = scanAllRuntimeKeyframes(iframe);
    if (allScanned.size === 0) return;
    const allElements = Array.from(allScanned.entries()).map(([id, data]) => ({
      selector: `#${id}`,
      keyframes: data.keyframes,
      easeEach: data.easeEach,
    }));
    await commitMutation(
      selection,
      {
        type: "materialize-keyframes",
        animationId: anim.id,
        keyframes: allScanned.get(selection.id ?? "")?.keyframes ?? [],
        allElements,
      },
      { label: "Unroll dynamic animations", skipReload: true },
    );
    return `${anim.targetSelector}-to-0`;
  }

  const runtime = readRuntimeKeyframes(iframe, anim.targetSelector);
  if (!runtime || runtime.keyframes.length === 0) return;
  await commitMutation(
    selection,
    {
      type: "materialize-keyframes",
      animationId: anim.id,
      keyframes: runtime.keyframes,
      easeEach: runtime.easeEach,
    },
    { label: "Materialize dynamic keyframes", skipReload: true },
  );
}

// ── Drag → GSAP position math ──────────────────────────────────────────────

/**
 * Commit a STATIC element drag as a `tl.set("#el",{x,y})` — the single-source
 * position channel for elements with no position animation. Idempotent: a
 * re-nudge of an element that already has a `set` UPDATES that set's x/y
 * in one `update-properties` mutation rather than stacking a second set or
 * converting it to keyframes (plan R2 / KTD3). New elements get one `add`
 * mutation with `method:"set"` at position 0.
 */
export async function commitStaticGsapPosition(
  selection: DomEditSelection,
  studioOffset: { x: number; y: number },
  gsapPos: { x: number; y: number },
  selector: string,
  existingSet: GsapAnimation | null,
  callbacks: GsapDragCommitCallbacks,
): Promise<void> {
  const { newX, newY } = computeDraggedGsapPosition(selection.element, studioOffset, gsapPos);
  if (existingSet) {
    if (existingSet.keyframes) {
      // Keyframed zero-duration hold (drag-path corruption): can't update-property
      // into keyframes. Add the replacement first so either failure leaves at
      // least one hold on disk, then delete the corrupt tween in one transaction.
      await replaceKeyframedPositionHold(
        selection,
        selector,
        existingSet,
        { x: newX, y: newY },
        callbacks.commitMutation,
      );
      return;
    }
    const mutation = {
      type: "update-properties",
      animationId: existingSet.id,
      properties: { x: newX, y: newY },
    } as const;
    const global = !!existingSet.global;
    await callbacks.commitMutation(selection, mutation, {
      label: "Move layer",
      softReload: true,
      instantPatch: {
        selector,
        change: { kind: global ? "global-set" : "set", props: mutation.properties },
      },
    });
    return;
  }
  // New static hold → a base `gsap.set` (off-timeline, no 0% keyframe marker), with
  // an instant patch so the first nudge shows immediately (no soft-reload flash).
  await callbacks.commitMutation(
    selection,
    {
      type: "add",
      targetSelector: selector,
      method: "set",
      position: 0,
      properties: { x: newX, y: newY },
      global: true,
    },
    {
      label: "Move layer",
      softReload: true,
      instantPatch: { selector, change: { kind: "global-set", props: { x: newX, y: newY } } },
    },
  );
}

/**
 * Commit a STATIC element rotation as a `tl.set("#el",{rotation})` — the single-
 * source rotation channel for elements with no rotation animation (mirrors
 * `commitStaticGsapPosition`). `newRotation` is the already-resolved absolute angle
 * (current runtime rotation + drag delta). Idempotent: re-rotating an element that
 * already has a rotation `set` UPDATES it in place (one `update-property`, rotation
 * is a single value unlike x/y); a new element gets one `add` with `method:"set"`.
 */
export async function commitStaticGsapRotation(
  selection: DomEditSelection,
  newRotation: number,
  selector: string,
  existingSet: GsapAnimation | null,
  callbacks: GsapDragCommitCallbacks,
): Promise<void> {
  if (existingSet) {
    // Derive the instantPatch from the SAME mutation object that's POSTed (single
    // source of truth — see commitStaticGsapPosition), so the validated `value`
    // flows into the patch and the two can't drift.
    const rotationMutation = {
      type: "update-property",
      animationId: existingSet.id,
      property: "rotation",
      value: newRotation,
    } as const;
    await callbacks.commitMutation(selection, rotationMutation, {
      label: "Rotate layer",
      softReload: true,
      // Value-only rotation set — patch the runtime in place (off-timeline gsap.set
      // applies to the element directly; on-timeline tl.set patches its tween).
      instantPatch: setPatchFromUpdateProperty(selector, rotationMutation, !!existingSet.global),
    });
    return;
  }
  // New static hold → off-timeline `gsap.set` (no 0% keyframe marker) + instant patch.
  await callbacks.commitMutation(
    selection,
    {
      type: "add",
      targetSelector: selector,
      method: "set",
      position: 0,
      properties: { rotation: newRotation },
      global: true,
    },
    {
      label: "Rotate layer",
      softReload: true,
      instantPatch: { selector, change: { kind: "global-set", props: { rotation: newRotation } } },
    },
  );
}

/**
 * Commit a STATIC element resize as a `tl.set("#el",{width,height})` — the
 * single-source size channel for elements with no size animation (mirrors
 * `commitStaticGsapPosition`). Use this instead of a single-stop `keyframes`
 * tween: one keyframe at the playhead % renders NaN/0 at every other frame, so
 * the element collapses/disappears (worst when resized off the 0% mark). A `set`
 * holds the size at all times. Re-resizing an element that already has a size
 * `set` UPDATES it in place with one `update-properties`; a new element
 * gets one `add` with `method:"set"`.
 */
export async function commitStaticGsapSize(
  selection: DomEditSelection,
  size: { width: number; height: number },
  selector: string,
  existingSet: GsapAnimation | null,
  callbacks: GsapDragCommitCallbacks,
): Promise<void> {
  const width = Math.round(size.width);
  const height = Math.round(size.height);
  if (existingSet) {
    await callbacks.commitMutation(
      selection,
      {
        type: "update-properties",
        animationId: existingSet.id,
        properties: { width, height },
      },
      { label: "Resize layer", softReload: true },
    );
    return;
  }
  await callbacks.commitMutation(
    selection,
    {
      type: "add",
      targetSelector: selector,
      method: "set",
      position: 0,
      properties: { width, height },
    },
    { label: "Resize layer", softReload: true },
  );
}

/** Rounded `n` when it's a positive finite number, else `fallback`. */
function positiveOr(n: number, fallback: number): number {
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

/**
 * Prior size for a keyframed resize: the existing global set's value, else the
 * element's pre-resize size (the draft saved it on the element before mutating
 * el.style.width/height). Falls back to the new size when neither is available.
 */
function resolvePriorSize(
  sizeSet: GsapAnimation | null,
  el: Element | null | undefined,
  fallbackW: number,
  fallbackH: number,
): { width: number; height: number } {
  if (sizeSet) {
    return {
      width: positiveOr(Number(sizeSet.properties.width), fallbackW),
      height: positiveOr(Number(sizeSet.properties.height), fallbackH),
    };
  }
  const ow = Number.parseFloat(el?.getAttribute(STUDIO_ORIGINAL_WIDTH_ATTR) ?? "");
  const oh = Number.parseFloat(el?.getAttribute(STUDIO_ORIGINAL_HEIGHT_ATTR) ?? "");
  return { width: positiveOr(ow, fallbackW), height: positiveOr(oh, fallbackH) };
}

/**
 * Resize an *animated* element by keyframing its size at the current playhead,
 * instead of a global `gsap.set` hold. Builds a width/height keyframe tween
 * aligned to the element's existing animation: every base keyframe keeps the
 * prior size, only the keyframe nearest the playhead gets the new size — so
 * resizing one keyframe leaves the others unchanged. Replaces any prior global
 * size set. Returns false when there's no usable range (caller falls back to the
 * static set).
 */
export async function commitKeyframedSizeFromResize(
  selection: DomEditSelection,
  size: { width: number; height: number },
  selector: string,
  sizeSet: GsapAnimation | null,
  animatedTween: GsapAnimation,
  callbacks: GsapDragCommitCallbacks,
): Promise<boolean> {
  const ts = resolveTweenStart(animatedTween) ?? 0;
  const td = resolveTweenDuration(animatedTween);
  if (!(td > 0)) return false;

  const newW = Math.round(size.width);
  const newH = Math.round(size.height);
  const prior = resolvePriorSize(sizeSet, selection.element, newW, newH);

  const ct = usePlayerStore.getState().currentTime;
  const pct = Math.max(0, Math.min(100, Math.round(((ct - ts) / td) * 1000) / 10));

  // Base keyframe percentages from the animated tween (flat tween → 0 & 100),
  // plus the endpoints and the playhead. Each keeps the prior size except the
  // keyframe at the playhead, which gets the new size.
  const pcts = new Set<number>(
    animatedTween.keyframes?.keyframes.map((k) => k.percentage) ?? [0, 100],
  );
  pcts.add(0);
  pcts.add(100);
  pcts.add(pct);
  const keyframes = Array.from(pcts)
    .sort((a, b) => a - b)
    .map((p) => ({
      percentage: p,
      properties: Math.abs(p - pct) < 0.05 ? { width: newW, height: newH } : { ...prior },
    }));

  // Add the size keyframe tween FIRST, then delete the old global hold. The gesture
  // transport applies both in one ordered batch; a plain commit fallback keeps the
  // same recoverable ordering. Only the transaction's result triggers the reload.
  const addLabel = `Resize (size keyframe ${pct.toFixed(0)}%)`;
  await callbacks.commitMutation(
    selection,
    {
      type: "add-with-keyframes",
      targetSelector: selector,
      position: roundTo3(ts),
      duration: roundTo3(td),
      keyframes,
    },
    sizeSet ? { label: addLabel, skipReload: true } : { label: addLabel, softReload: true },
  );
  if (sizeSet) {
    await callbacks.commitMutation(
      selection,
      { type: "delete", animationId: sizeSet.id },
      { label: "Resize layer", softReload: true },
    );
  }
  return true;
}

// ── Whole-path offset (plain drag on animated element) ──────────────────

/**
 * Offset the entire animation path by the drag delta — every keyframe's x/y
 * shifts together so the animation shape is preserved and the element can't
 * dart off-screen. For flat tweens (no keyframes), convert first then shift.
 */
// fallow-ignore-next-line code-duplication
// fallow-ignore-next-line complexity
export async function commitWholePathOffset(
  selection: DomEditSelection,
  anim: GsapAnimation,
  studioOffset: { x: number; y: number },
  gsapPos: { x: number; y: number },
  iframe: HTMLIFrameElement | null,
  selector: string,
  callbacks: GsapDragCommitCallbacks,
): Promise<void> {
  const el = selection.element;
  const { newX, newY, baseGsapX, baseGsapY } = computeDraggedGsapPosition(
    el,
    studioOffset,
    gsapPos,
  );
  const deltaX = newX - baseGsapX;
  // fallow-ignore-next-line code-duplication
  const deltaY = newY - baseGsapY;
  const origX = Number.parseFloat(el.getAttribute("data-hf-drag-initial-offset-x") ?? "") || 0;
  const origY = Number.parseFloat(el.getAttribute("data-hf-drag-initial-offset-y") ?? "") || 0;
  const restoreOffset = () => {
    el.style.setProperty("--hf-studio-offset-x", `${origX}px`);
    el.style.setProperty("--hf-studio-offset-y", `${origY}px`);
    el.removeAttribute("data-hf-drag-initial-offset-x");
    el.removeAttribute("data-hf-drag-initial-offset-y");
  };

  // fallow-ignore-next-line code-duplication
  let effectiveAnim = anim;
  if (anim.keyframes) {
    const newId = await materializeIfDynamic(anim, iframe, callbacks.commitMutation, selection);
    if (newId) effectiveAnim = { ...anim, id: newId };
  }

  const ts = resolveTweenStart(effectiveAnim);
  const td = resolveTweenDuration(effectiveAnim);
  const ease = effectiveAnim.keyframes?.easeEach ?? effectiveAnim.ease;

  let kfs = effectiveAnim.keyframes?.keyframes ?? [];
  if (kfs.length === 0) {
    const fromProps = effectiveAnim.fromProperties ?? {};
    const toProps = effectiveAnim.properties ?? {};
    const startX =
      typeof fromProps.x === "number" ? fromProps.x : typeof toProps.x === "number" ? 0 : 0;
    const startY =
      typeof fromProps.y === "number" ? fromProps.y : typeof toProps.y === "number" ? 0 : 0;
    const endX = typeof toProps.x === "number" ? toProps.x : startX;
    const endY = typeof toProps.y === "number" ? toProps.y : startY;
    kfs = [
      { percentage: 0, properties: { x: startX, y: startY } },
      { percentage: 100, properties: { x: endX, y: endY } },
    ];
  }

  const shifted = kfs.map((kf) => ({
    percentage: kf.percentage,
    properties: {
      ...kf.properties,
      x: roundTo3((typeof kf.properties.x === "number" ? kf.properties.x : 0) + deltaX),
      y: roundTo3((typeof kf.properties.y === "number" ? kf.properties.y : 0) + deltaY),
    },
    ...(kf.ease ? { ease: kf.ease } : {}),
  }));

  await callbacks.commitMutation(
    selection,
    {
      type: "replace-with-keyframes",
      animationId: effectiveAnim.id,
      targetSelector: effectiveAnim.targetSelector,
      position: roundTo3(ts ?? 0),
      duration: roundTo3(td || 1),
      keyframes: shifted,
      ease,
    },
    { label: "Move animation path", softReload: true, beforeReload: restoreOffset },
  );
}
