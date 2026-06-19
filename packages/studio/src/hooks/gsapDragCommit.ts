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
  if (iframe && selector && ts !== null) {
    try {
      const iframeWin = iframe.contentWindow as any;
      const gsapLib = iframeWin?.gsap;
      const el = iframe.contentDocument?.querySelector(selector);
      const timelines = iframeWin?.__timelines;
      const mainTl = timelines ? (Object.values(timelines)[0] as any) : null;
      if (gsapLib && el && mainTl?.seek) {
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
      }
    } catch {
      /* iframe access failed — fall back to identity values */
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
    await callbacks.commitMutation(
      selection,
      { type: "update-property", animationId: existingSet.id, property: "x", value: newX },
      { label: "Move layer", skipReload: true, coalesceKey },
    );
    await callbacks.commitMutation(
      selection,
      { type: "update-property", animationId: existingSet.id, property: "y", value: newY },
      { label: "Move layer", softReload: true, coalesceKey },
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
      properties: { x: newX, y: newY },
    },
    { label: "Move layer", softReload: true },
  );
}

export { findPositionSetAnimation };

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
