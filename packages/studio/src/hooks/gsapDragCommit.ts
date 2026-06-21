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

// ── Extend tween ──────────────────────────────────────────────────────────

/**
 * Extend a tween's time range to cover `targetTime`, remap all existing
 * keyframe percentages to preserve their absolute positions, then add
 * a new keyframe at the target time.
 */
async function extendTweenAndAddKeyframe(
  selection: DomEditSelection,
  anim: GsapAnimation,
  properties: Record<string, number>,
  targetTime: number,
  tweenStart: number,
  tweenDuration: number,
  callbacks: GsapDragCommitCallbacks,
  beforeReload?: () => void,
  backfillDefaults?: Record<string, number>,
): Promise<void> {
  const tweenEnd = tweenStart + tweenDuration;
  const newStart = Math.min(targetTime, tweenStart);
  const newEnd = Math.max(targetTime, tweenEnd);
  const newDuration = Math.max(0.01, newEnd - newStart);
  const existingKfs = anim.keyframes?.keyframes ?? [];
  const remappedKfs: Array<{ percentage: number; properties: Record<string, number | string> }> =
    [];
  for (const kf of existingKfs) {
    const absTime = tweenStart + (kf.percentage / 100) * tweenDuration;
    const newPct = Math.round(((absTime - newStart) / newDuration) * 1000) / 10;
    const props: Record<string, number | string> = { ...kf.properties };
    // Backfill props the new keyframe introduces but this one lacks, so GSAP
    // doesn't hold the new prop's value across keyframes that omit it.
    for (const k of Object.keys(properties)) {
      if (!(k in props) && backfillDefaults?.[k] != null) props[k] = backfillDefaults[k];
    }
    remappedKfs.push({ percentage: newPct, properties: props });
  }

  const targetPct = Math.round(((targetTime - newStart) / newDuration) * 1000) / 10;
  remappedKfs.push({ percentage: targetPct, properties });

  remappedKfs.sort((a, b) => a.percentage - b.percentage);

  await callbacks.commitMutation(
    selection,
    {
      type: "replace-with-keyframes",
      animationId: anim.id,
      targetSelector: anim.targetSelector,
      position: roundTo3(newStart),
      duration: roundTo3(newDuration),
      keyframes: remappedKfs,
    },
    { label: `Move layer (extended keyframe)`, softReload: true, beforeReload },
  );
}

// fallow-ignore-next-line complexity
async function commitKeyframedPosition(
  selection: DomEditSelection,
  anim: GsapAnimation,
  properties: Record<string, number>,
  callbacks: GsapDragCommitCallbacks,
  beforeReload?: () => void,
  backfillDefaults?: Record<string, number>,
): Promise<void> {
  const { activeKeyframePct, setActiveKeyframePct } = usePlayerStore.getState();
  const computedPct = computeCurrentPercentage(selection, anim);
  const pct = activeKeyframePct ?? computedPct;
  await callbacks.commitMutation(
    selection,
    {
      type: "add-keyframe",
      animationId: anim.id,
      percentage: pct,
      properties,
      // Backfill any newly-introduced prop (e.g. `y` on an x-only tween) into the
      // OTHER keyframes at the element's base value. Without it, GSAP holds the new
      // prop's value across keyframes that omit it — so editing one keyframe drags
      // the others to the same position.
      ...(backfillDefaults ? { backfillDefaults } : {}),
    },
    { label: `Move layer (keyframe ${pct}%)`, softReload: true, beforeReload },
  );
  if (activeKeyframePct != null) {
    setActiveKeyframePct(null);
    parkPlayheadOnKeyframe(anim, pct);
  }
}

// Minimal GSAP runtime surface the start-value read needs — narrowed from the
// iframe window so the read path isn't a blanket `as any` ladder.
interface DragRuntimeGsap {
  getProperty: (target: Element, key: string) => unknown;
  set: (target: Element, vars: Record<string, unknown>) => void;
}
interface DragRuntimeTimeline {
  seek: (time: number) => void;
}
interface DragRuntime {
  gsapLib: DragRuntimeGsap;
  el: Element;
  mainTl: DragRuntimeTimeline;
}

/**
 * Resolve the iframe's GSAP lib, the target element, and the main timeline for a
 * drag start-value read. Returns null (caller falls back to identity values)
 * when any piece is missing — a legitimate "runtime not ready" case, distinct
 * from a read that throws mid-flight (which the caller surfaces).
 */
function resolveDragRuntime(
  iframe: HTMLIFrameElement | null | undefined,
  selector: string | undefined,
): DragRuntime | null {
  if (!iframe || !selector) return null;
  const win = iframe.contentWindow as
    | (Window & {
        gsap?: Partial<DragRuntimeGsap>;
        __timelines?: Record<string, Partial<DragRuntimeTimeline>>;
      })
    | null;
  const gsap = win?.gsap;
  if (typeof gsap?.getProperty !== "function" || typeof gsap.set !== "function") return null;
  let el: Element | null = null;
  try {
    el = iframe.contentDocument?.querySelector(selector) ?? null;
  } catch {
    return null; // cross-origin / detached document
  }
  if (!el) return null;
  const timelines = win?.__timelines;
  const mainTl = timelines ? Object.values(timelines)[0] : undefined;
  if (typeof mainTl?.seek !== "function") return null;
  return {
    gsapLib: gsap as DragRuntimeGsap,
    el,
    mainTl: mainTl as DragRuntimeTimeline,
  };
}

/**
 * For flat to()/set() tweens, convert to keyframes first so we can place the
 * drag position at the current percentage.
 */
// fallow-ignore-next-line complexity
async function commitFlatViaKeyframes(
  selection: DomEditSelection,
  anim: GsapAnimation,
  properties: Record<string, number>,
  callbacks: GsapDragCommitCallbacks,
  beforeReload?: () => void,
  iframe?: HTMLIFrameElement | null,
  selector?: string,
  backfillDefaults?: Record<string, number>,
): Promise<void> {
  const ct = usePlayerStore.getState().currentTime;
  const ts = resolveTweenStart(anim);
  const td = resolveTweenDuration(anim);
  // A flat tween shows two diamonds (0% / 100%). If the user selected one and then
  // dragged, modify THAT endpoint — don't extend or place at the drifted playhead.
  const { activeKeyframePct, setActiveKeyframePct } = usePlayerStore.getState();
  const outsideRange =
    activeKeyframePct == null && ts !== null && td > 0 && (ct < ts - 0.01 || ct > ts + td + 0.01);

  // Read the runtime position at the tween's start time so the 0% keyframe
  // captures the actual interpolated value (e.g. x=300 after a preceding slide),
  // not the identity value (x=0) that a blind convert would produce.
  const resolvedFromValues: Record<string, number | string> = {};
  const runtime = resolveDragRuntime(iframe, selector);
  if (runtime && ts !== null) {
    const { gsapLib, el, mainTl } = runtime;
    // Snapshot the live drag's gsap overrides BEFORE clearing them. The clear
    // below is only needed to read the tween's start values cleanly; if the
    // commit that follows later fails, we must put the dragged pose back so the
    // element isn't left with its overrides cleared and nothing applied (a
    // visible snap to the base pose with the drag silently lost).
    const draggedValues: Record<string, number> = {};
    for (const key of Object.keys(properties)) {
      const v = Number(gsapLib.getProperty(el, key));
      if (Number.isFinite(v)) draggedValues[key] = v;
    }
    try {
      // Clear the live drag's gsap overrides first. Otherwise a property the
      // tween doesn't animate (e.g. `y` on a flat `to({x})`) keeps the dragged
      // value through the seek and pollutes the 0% keyframe (it would start at
      // the dropped position instead of animating there). After clearing, the
      // seek reapplies the timeline's real interpolated values for animated
      // props, and untweened props fall back to their base (0).
      gsapLib.set(el, { clearProps: Object.keys(properties).join(",") });
      mainTl.seek(ts);
      for (const key of Object.keys(properties)) {
        const v = Number(gsapLib.getProperty(el, key));
        if (Number.isFinite(v)) resolvedFromValues[key] = roundTo3(v);
      }
      mainTl.seek(ct);
    } catch (err) {
      // A read/seek failure here is NOT routine — it means resolvedFromValues is
      // incomplete and the 0% keyframe would silently capture identity (x=0)
      // instead of the real interpolated start. Drop the partial reads so the
      // caller falls back to identity deliberately (not on a phantom value), and
      // surface the failure rather than swallowing it.
      console.warn("[gsap-drag] start-value read failed; using identity from values", err);
      for (const key of Object.keys(resolvedFromValues)) delete resolvedFromValues[key];
    } finally {
      // Re-apply the dragged overrides. On a successful commit the soft-reload
      // re-seek overwrites these with the persisted keyframe values; on a failed
      // commit they keep the element showing where the user dropped it. Runs even
      // if the seek threw, so a partial clear doesn't leave the element snapped to
      // its base pose with the drag lost.
      if (Object.keys(draggedValues).length > 0) gsapLib.set(el, draggedValues);
    }
  }

  if (outsideRange && ts !== null) {
    // Outside the tween's range: EXTEND the existing tween to reach the playhead
    // instead of spawning a parallel tween (which left the element with two
    // competing tweens, so edits hit one while the selected keyframe lived on the
    // other). Convert the flat tween to keyframes, then extend + add at the
    // playhead — existing keyframes keep their absolute times.
    const coalesceKey = `gsap:convert-drag:${anim.id}`;
    await callbacks.commitMutation(
      selection,
      {
        type: "convert-to-keyframes",
        animationId: anim.id,
        ...(Object.keys(resolvedFromValues).length > 0 ? { resolvedFromValues } : {}),
      },
      { label: "Convert to keyframes for drag", skipReload: true, coalesceKey },
    );
    const fresh = callbacks.fetchAnimations ? await callbacks.fetchAnimations() : [];
    const converted =
      fresh.find((a) => a.targetSelector === anim.targetSelector && a.keyframes) ?? anim;
    const convertedStart = resolveTweenStart(converted) ?? ts;
    const convertedDur = resolveTweenDuration(converted) || td;
    await extendTweenAndAddKeyframe(
      selection,
      converted,
      properties,
      ct,
      convertedStart,
      convertedDur,
      callbacks,
      beforeReload,
    );
    return;
  }

  // Inside range (or a selected endpoint): convert the flat tween to keyframes,
  // then add/modify at the target %. A selected diamond pins the % to that endpoint
  // (0 / 100) so the drag edits it exactly; otherwise use the playhead %.
  const coalesceKey = `gsap:convert-drag:${anim.id}`;
  await callbacks.commitMutation(
    selection,
    {
      type: "convert-to-keyframes",
      animationId: anim.id,
      ...(Object.keys(resolvedFromValues).length > 0 ? { resolvedFromValues } : {}),
    },
    { label: "Convert to keyframes for drag", skipReload: true, coalesceKey },
  );
  const pct = activeKeyframePct ?? computeCurrentPercentage(selection, anim);
  const editedSelected = activeKeyframePct != null;
  if (editedSelected) setActiveKeyframePct(null);

  await callbacks.commitMutation(
    selection,
    {
      type: "add-keyframe",
      animationId: anim.id,
      percentage: pct,
      properties,
      ...(backfillDefaults ? { backfillDefaults } : {}),
    },
    { label: `Move layer (keyframe ${pct}%)`, softReload: true, beforeReload, coalesceKey },
  );
  if (editedSelected) parkPlayheadOnKeyframe(anim, pct);
}

// ── Drag → GSAP position math ──────────────────────────────────────────────

// Math lives in its own leaf module so the live-preview file can reuse it
// without importing the GSAP commit graph (store/runtime/core).
export { computeDraggedGsapPosition };

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
    const coalesceKey = `gsap:set-resize:${existingSet.id}`;
    const wMutation = {
      type: "update-property",
      animationId: existingSet.id,
      property: "width",
      value: width,
    } as const;
    const hMutation = {
      type: "update-property",
      animationId: existingSet.id,
      property: "height",
      value: height,
    } as const;
    await callbacks.commitMutation(selection, wMutation, {
      label: "Resize layer",
      skipReload: true,
      coalesceKey,
      instantPatch: setPatchFromUpdateProperty(selector, wMutation),
    });
    await callbacks.commitMutation(selection, hMutation, {
      label: "Resize layer",
      softReload: true,
      coalesceKey,
      instantPatch: setPatchFromUpdateProperties(selector, [wMutation, hMutation]),
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
      properties: { width, height },
    },
    { label: "Resize layer", softReload: true },
  );
}

export { findSizeSetAnimation };

// ── Main drag commit ──────────────────────────────────────────────────────

/**
 * Compute the new GSAP position values from runtime-read positions + drag
 * offset, then commit the mutation to the GSAP script.
 */
// fallow-ignore-next-line complexity
export async function commitGsapPositionFromDrag(
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
  const origX = Number.parseFloat(el.getAttribute("data-hf-drag-initial-offset-x") ?? "") || 0;
  const origY = Number.parseFloat(el.getAttribute("data-hf-drag-initial-offset-y") ?? "") || 0;
  const restoreOffset = () => {
    el.style.setProperty("--hf-studio-offset-x", `${origX}px`);
    el.style.setProperty("--hf-studio-offset-y", `${origY}px`);
    el.removeAttribute("data-hf-drag-initial-offset-x");
    el.removeAttribute("data-hf-drag-initial-offset-y");
  };

  // The element's base (un-animated) pose — used to backfill any prop the drag
  // newly introduces (e.g. `y` on an x-only tween) into the other keyframes.
  const backfillDefaults: Record<string, number> = { x: baseGsapX, y: baseGsapY };
  const ct = usePlayerStore.getState().currentTime;
  if (anim.keyframes) {
    const newId = await materializeIfDynamic(anim, iframe, callbacks.commitMutation, selection);
    const effectiveAnim = newId ? { ...anim, id: newId } : anim;
    const dragProps: Record<string, number> = { x: newX, y: newY };

    const ts = resolveTweenStart(effectiveAnim);
    const td = resolveTweenDuration(effectiveAnim);
    const outsideRange = ts !== null && td > 0 && (ct < ts - 0.01 || ct > ts + td + 0.01);
    // A selected keyframe (clicked diamond) means "modify THIS keyframe" — never
    // extend, even if the playhead drifted a frame past the tween's end.
    const hasSelectedKeyframe = usePlayerStore.getState().activeKeyframePct != null;
    if (outsideRange && !hasSelectedKeyframe) {
      await extendTweenAndAddKeyframe(
        selection,
        effectiveAnim,
        dragProps,
        ct,
        ts,
        td,
        callbacks,
        restoreOffset,
        backfillDefaults,
      );
    } else {
      await commitKeyframedPosition(
        selection,
        effectiveAnim,
        dragProps,
        callbacks,
        restoreOffset,
        backfillDefaults,
      );
    }
  } else if (anim.method === "from" || anim.method === "fromTo") {
    const ct = usePlayerStore.getState().currentTime;
    const ts = resolveTweenStart(anim);
    const td = resolveTweenDuration(anim);
    // A selected keyframe means "modify it" — skip the extend/split branch.
    const hasSelectedKeyframe = usePlayerStore.getState().activeKeyframePct != null;
    const outsideRange =
      !hasSelectedKeyframe && ts !== null && td > 0 && (ct < ts - 0.01 || ct > ts + td + 0.01);
    const dragProps: Record<string, number> = { x: newX, y: newY };

    if (outsideRange && ts !== null) {
      // Split the original from() tween into property groups first.
      await callbacks.commitMutation(
        selection,
        { type: "split-into-property-groups", animationId: anim.id },
        { label: "Split from() for drag", skipReload: true },
      );

      const allAnims = callbacks.fetchAnimations ? await callbacks.fetchAnimations() : [];
      const existingPosAnim = allAnims.find(
        (a) => a.propertyGroup === "position" && a.targetSelector === anim.targetSelector,
      );

      if (existingPosAnim?.keyframes) {
        // Extend the existing position tween
        const posTs = resolveTweenStart(existingPosAnim);
        const posTd = resolveTweenDuration(existingPosAnim);
        if (posTs !== null) {
          await extendTweenAndAddKeyframe(
            selection,
            existingPosAnim,
            { x: newX, y: newY },
            ct,
            posTs,
            posTd,
            callbacks,
            restoreOffset,
            backfillDefaults,
          );
          return;
        }
      }

      // No existing position tween — create one
      const newStart = Math.min(ct, ts);
      const newEnd = Math.max(ct, ts + td);
      const newDuration = Math.max(0.01, newEnd - newStart);
      const dragBefore = ct < ts;
      const origStartPct = Math.round(((ts - newStart) / newDuration) * 1000) / 10;
      const origEndPct = Math.round(((ts + td - newStart) / newDuration) * 1000) / 10;

      const keyframes: Array<{ percentage: number; properties: Record<string, number | string> }> =
        [];
      if (dragBefore) {
        keyframes.push({ percentage: 0, properties: { x: newX, y: newY } });
        if (origStartPct > 0.5 && origStartPct < 99.5) {
          keyframes.push({ percentage: origStartPct, properties: { x: 0, y: 0 } });
        }
        keyframes.push({ percentage: 100, properties: { x: 0, y: 0 } });
      } else {
        keyframes.push({ percentage: 0, properties: { x: 0, y: 0 } });
        if (origEndPct > 0.5 && origEndPct < 99.5) {
          keyframes.push({ percentage: origEndPct, properties: { x: 0, y: 0 } });
        }
        keyframes.push({ percentage: 100, properties: { x: newX, y: newY } });
      }
      keyframes.sort((a, b) => a.percentage - b.percentage);

      // REPLACE the split position `from()` tween with the keyframed one (same id)
      // instead of adding a parallel tween. Two position tweens on the same element
      // fight on the shared axis — the leftover `from()` snaps to its natural state
      // on the soft-reload re-seek, which is the visible "jump" after dropping.
      const baseKf = {
        targetSelector: anim.targetSelector,
        position: roundTo3(newStart),
        duration: roundTo3(newDuration),
        keyframes,
      };
      await callbacks.commitMutation(
        selection,
        existingPosAnim
          ? { type: "replace-with-keyframes", animationId: existingPosAnim.id, ...baseKf }
          : { type: "add-with-keyframes", ...baseKf },
        { label: "Move layer (from extended)", softReload: true, beforeReload: restoreOffset },
      );
    } else {
      // Inside tween range (or a selected keyframe): convert then add/modify at
      // the selected endpoint % if one is active, else the playhead %.
      const coalesceKey = `gsap:convert-drag:${anim.id}`;
      await callbacks.commitMutation(
        selection,
        {
          type: "convert-to-keyframes",
          animationId: anim.id,
        },
        { label: "Convert from() for drag", skipReload: true, coalesceKey },
      );
      const { activeKeyframePct, setActiveKeyframePct } = usePlayerStore.getState();
      const pct = activeKeyframePct ?? computeCurrentPercentage(selection, anim);
      if (activeKeyframePct != null) setActiveKeyframePct(null);
      await callbacks.commitMutation(
        selection,
        {
          type: "add-keyframe",
          animationId: anim.id,
          percentage: pct,
          properties: dragProps,
          ...(backfillDefaults ? { backfillDefaults } : {}),
        },
        {
          label: `Move layer (keyframe ${pct}%)`,
          softReload: true,
          beforeReload: restoreOffset,
          coalesceKey,
        },
      );
    }
  } else {
    await commitFlatViaKeyframes(
      selection,
      anim,
      { x: newX, y: newY },
      callbacks,
      restoreOffset,
      iframe,
      selector,
      backfillDefaults,
    );
  }
}
