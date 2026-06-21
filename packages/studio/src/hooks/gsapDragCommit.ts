/**
 * Low-level drag commit helpers for GSAP position mutations.
 * Extracted from gsapRuntimeBridge.ts to keep file sizes under the 600-line limit.
 */
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { usePlayerStore } from "../player/store/playerStore";
import { readRuntimeKeyframes, scanAllRuntimeKeyframes } from "./gsapRuntimeKeyframes";
import { resolveTweenStart, resolveTweenDuration } from "../utils/globalTimeCompiler";
import { roundTo3 } from "../utils/rounding";
import { computeElementPercentage } from "./gsapShared";
import { computeDraggedGsapPosition } from "./draggedGsapPosition";
import type { RuntimeTweenChange, SetPatchProps } from "./gsapRuntimePatch";
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

/** The shape of an `update-property` mutation a static-set nudge POSTs. */
interface UpdatePropertyMutation {
  type: "update-property";
  animationId: string;
  property: string;
  value: number;
}

/**
 * Build the `instantPatch` for a value-only `tl.set` from the SAME
 * `update-property` mutation(s) that are POSTed — so the patch can never carry a
 * value the source write didn't (one source of truth). Each mutation contributes
 * its `{property: value}` channel to the patch's props.
 */
function setPatchFromUpdateProperties(
  selector: string,
  mutations: UpdatePropertyMutation[],
): { selector: string; change: RuntimeTweenChange } {
  const props: SetPatchProps = {};
  for (const m of mutations) props[m.property as keyof SetPatchProps] = m.value;
  return { selector, change: { kind: "set", props } };
}

/** Single-mutation convenience over {@link setPatchFromUpdateProperties}. */
function setPatchFromUpdateProperty(
  selector: string,
  mutation: UpdatePropertyMutation,
): { selector: string; change: RuntimeTweenChange } {
  return setPatchFromUpdateProperties(selector, [mutation]);
}

/**
 * Find the studio position-hold `set` for a selector — a `tl.set("#el",{x,y})`
 * with no duration. This is what a static-element nudge writes/updates.
 */
function findPositionSetAnimation(
  animations: GsapAnimation[],
  selector: string,
): GsapAnimation | null {
  return (
    animations.find(
      (a) =>
        a.method === "set" &&
        a.targetSelector === selector &&
        ("x" in a.properties || "y" in a.properties),
    ) ?? null
  );
}

/**
 * Commit a STATIC element drag as a `tl.set("#el",{x,y})` — the single-source
 * position channel for elements with no position animation. Idempotent: a
 * re-nudge of an element that already has a `set` UPDATES that set's x/y
 * (two `update-property` mutations) rather than stacking a second set or
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
    // Update in place — two single-property mutations (the API updates one prop
    // per call). Coalesce them and reload only after the second lands.
    const coalesceKey = `gsap:set-nudge:${existingSet.id}`;
    // Build each mutation FIRST, then derive its instantPatch from the SAME
    // object that's POSTed — so a future caller can't ship a clean mutation with
    // a stale/malformed patch (the validated `value` flows straight into the
    // patch). `findUnsafeMutationValues` validates the mutation upstream.
    const xMutation = {
      type: "update-property",
      animationId: existingSet.id,
      property: "x",
      value: newX,
    } as const;
    const yMutation = {
      type: "update-property",
      animationId: existingSet.id,
      property: "y",
      value: newY,
    } as const;
    // Patch BOTH coalesced commits. If the SECOND POST fails server-side, the
    // first (x) already persisted — patching its commit too means the live
    // preview still reflects what DID persist. The x commit carries skipReload
    // (no reload), so its instantPatch gives instant feedback without a reload;
    // the y commit triggers the soft reload (skipped when the patch applies).
    await callbacks.commitMutation(selection, xMutation, {
      label: "Move layer",
      skipReload: true,
      coalesceKey,
      instantPatch: setPatchFromUpdateProperty(selector, xMutation),
    });
    await callbacks.commitMutation(selection, yMutation, {
      label: "Move layer",
      softReload: true,
      coalesceKey,
      // Final commit of the coalesced x/y pair: carry both channels so the
      // runtime `tl.set` lands the complete {x,y} pose in place.
      instantPatch: setPatchFromUpdateProperties(selector, [xMutation, yMutation]),
    });
    return;
  }
  await callbacks.commitMutation(
    selection,
    {
      type: "add",
      targetSelector: selector,
      method: "set",
      position: 0,
      properties: { x: newX, y: newY },
    },
    { label: "Move layer", softReload: true },
  );
}

export { findPositionSetAnimation };

function findRotationSetAnimation(
  animations: GsapAnimation[],
  selector: string,
): GsapAnimation | null {
  return (
    animations.find(
      (a) => a.method === "set" && a.targetSelector === selector && "rotation" in a.properties,
    ) ?? null
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
      // Value-only rotation set: patch the runtime `tl.set` rotation in place.
      instantPatch: setPatchFromUpdateProperty(selector, rotationMutation),
    });
    return;
  }
  await callbacks.commitMutation(
    selection,
    {
      type: "add",
      targetSelector: selector,
      method: "set",
      position: 0,
      properties: { rotation: newRotation },
    },
    { label: "Rotate layer", softReload: true },
  );
}

export { findRotationSetAnimation };

function findSizeSetAnimation(animations: GsapAnimation[], selector: string): GsapAnimation | null {
  return (
    animations.find(
      (a) =>
        a.method === "set" &&
        a.targetSelector === selector &&
        ("width" in a.properties || "height" in a.properties),
    ) ?? null
  );
}

/**
 * Commit a STATIC element resize as a `tl.set("#el",{width,height})` — the
 * single-source size channel for elements with no size animation (mirrors
 * `commitStaticGsapPosition`). Use this instead of a single-stop `keyframes`
 * tween: one keyframe at the playhead % renders NaN/0 at every other frame, so
 * the element collapses/disappears (worst when resized off the 0% mark). A `set`
 * holds the size at all times. Re-resizing an element that already has a size
 * `set` UPDATES it in place (two `update-property`, like x/y); a new element
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
      { type: "delete", animationId: existingSet.id },
      { label: "Resize layer", skipReload: true },
    );
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

export { findSizeSetAnimation };

// ── Whole-path offset (plain drag on animated element) ──────────────────

/**
 * Offset the entire animation path by the drag delta — every keyframe's x/y
 * shifts together so the animation shape is preserved and the element can't
 * dart off-screen. For flat tweens (no keyframes), convert first then shift.
 */
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
  const deltaY = newY - baseGsapY;
  const origX = Number.parseFloat(el.getAttribute("data-hf-drag-initial-offset-x") ?? "") || 0;
  const origY = Number.parseFloat(el.getAttribute("data-hf-drag-initial-offset-y") ?? "") || 0;
  const restoreOffset = () => {
    el.style.setProperty("--hf-studio-offset-x", `${origX}px`);
    el.style.setProperty("--hf-studio-offset-y", `${origY}px`);
    el.removeAttribute("data-hf-drag-initial-offset-x");
    el.removeAttribute("data-hf-drag-initial-offset-y");
  };

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
