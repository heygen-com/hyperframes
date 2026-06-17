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
    remappedKfs.push({ percentage: newPct, properties: { ...kf.properties } });
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
): Promise<void> {
  const { activeKeyframePct, setActiveKeyframePct } = usePlayerStore.getState();
  const pct = activeKeyframePct ?? computeCurrentPercentage(selection, anim);
  await callbacks.commitMutation(
    selection,
    {
      type: "add-keyframe",
      animationId: anim.id,
      percentage: pct,
      properties,
    },
    { label: `Move layer (keyframe ${pct}%)`, softReload: true, beforeReload },
  );
  if (activeKeyframePct != null) setActiveKeyframePct(null);
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
): Promise<void> {
  const ct = usePlayerStore.getState().currentTime;
  const ts = resolveTweenStart(anim);
  const td = resolveTweenDuration(anim);
  const outsideRange = ts !== null && td > 0 && (ct < ts - 0.01 || ct > ts + td + 0.01);

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
    // Outside the tween's range: add a brand new keyframed tween at the drag
    // time instead of extending/replacing the existing one. This keeps all
    // existing tweens untouched and creates a clean hold at the dragged position.
    const tweenEnd = ts + td;
    const holdStart = ct > tweenEnd ? tweenEnd : ct;
    const holdEnd = ct > tweenEnd ? ct : ts;
    const holdDur = Math.max(0.01, holdEnd - holdStart);
    const kfs =
      ct > tweenEnd
        ? [
            { percentage: 0, properties: resolvedFromValues },
            { percentage: 100, properties },
          ]
        : [
            { percentage: 0, properties },
            { percentage: 100, properties: resolvedFromValues },
          ];
    console.log(
      "[drag:5] outside range — adding new tween",
      JSON.stringify({
        ct,
        ts,
        td,
        holdStart: roundTo3(holdStart),
        holdDur: roundTo3(holdDur),
        from: resolvedFromValues,
        to: properties,
      }),
    );
    await callbacks.commitMutation(
      selection,
      {
        type: "add-with-keyframes",
        targetSelector: anim.targetSelector,
        position: roundTo3(holdStart),
        duration: roundTo3(holdDur),
        keyframes: kfs,
      },
      { label: "Move layer (new keyframe)", softReload: true, beforeReload },
    );
    return;
  }

  // Inside range: convert the flat tween to keyframes, then add at current %.
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
  const pct = computeCurrentPercentage(selection, anim);

  await callbacks.commitMutation(
    selection,
    {
      type: "add-keyframe",
      animationId: anim.id,
      percentage: pct,
      properties,
    },
    { label: `Move layer (keyframe ${pct}%)`, softReload: true, beforeReload, coalesceKey },
  );
}

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
  const rotStyle = selection.element.style.getPropertyValue("--hf-studio-rotation");
  const rotDeg = Number.parseFloat(rotStyle) || 0;
  const rad = (-rotDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const el = selection.element;
  const origX = Number.parseFloat(el.getAttribute("data-hf-drag-initial-offset-x") ?? "") || 0;
  const origY = Number.parseFloat(el.getAttribute("data-hf-drag-initial-offset-y") ?? "") || 0;
  const deltaX = studioOffset.x - origX;
  const deltaY = studioOffset.y - origY;
  const adjX = deltaX * cos - deltaY * sin;
  const adjY = deltaX * sin + deltaY * cos;
  const parsedBaseX = Number.parseFloat(el.getAttribute("data-hf-drag-gsap-base-x") ?? "");
  const parsedBaseY = Number.parseFloat(el.getAttribute("data-hf-drag-gsap-base-y") ?? "");
  const baseGsapX = Number.isFinite(parsedBaseX) ? parsedBaseX : gsapPos.x;
  const baseGsapY = Number.isFinite(parsedBaseY) ? parsedBaseY : gsapPos.y;
  const newX = Math.round(baseGsapX + adjX);
  const newY = Math.round(baseGsapY + adjY);
  const restoreOffset = () => {
    el.style.setProperty("--hf-studio-offset-x", `${origX}px`);
    el.style.setProperty("--hf-studio-offset-y", `${origY}px`);
    el.removeAttribute("data-hf-drag-initial-offset-x");
    el.removeAttribute("data-hf-drag-initial-offset-y");
  };

  const ct = usePlayerStore.getState().currentTime;
  if (anim.keyframes) {
    const newId = await materializeIfDynamic(anim, iframe, callbacks.commitMutation, selection);
    const effectiveAnim = newId ? { ...anim, id: newId } : anim;
    const dragProps: Record<string, number> = { x: newX, y: newY };

    const ts = resolveTweenStart(effectiveAnim);
    const td = resolveTweenDuration(effectiveAnim);
    const outsideRange = ts !== null && td > 0 && (ct < ts - 0.01 || ct > ts + td + 0.01);
    if (outsideRange) {
      await extendTweenAndAddKeyframe(
        selection,
        effectiveAnim,
        dragProps,
        ct,
        ts,
        td,
        callbacks,
        restoreOffset,
      );
    } else {
      await commitKeyframedPosition(selection, effectiveAnim, dragProps, callbacks, restoreOffset);
    }
  } else if (anim.method === "from" || anim.method === "fromTo") {
    const ct = usePlayerStore.getState().currentTime;
    const ts = resolveTweenStart(anim);
    const td = resolveTweenDuration(anim);
    const outsideRange = ts !== null && td > 0 && (ct < ts - 0.01 || ct > ts + td + 0.01);
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

      await callbacks.commitMutation(
        selection,
        {
          type: "add-with-keyframes",
          targetSelector: anim.targetSelector,
          position: roundTo3(newStart),
          duration: roundTo3(newDuration),
          keyframes,
        },
        { label: "Move layer (from extended)", softReload: true, beforeReload: restoreOffset },
      );
    } else {
      // Inside tween range: convert then add keyframe at current time
      const coalesceKey = `gsap:convert-drag:${anim.id}`;
      await callbacks.commitMutation(
        selection,
        {
          type: "convert-to-keyframes",
          animationId: anim.id,
        },
        { label: "Convert from() for drag", skipReload: true, coalesceKey },
      );
      const pct = computeCurrentPercentage(selection, anim);
      await callbacks.commitMutation(
        selection,
        {
          type: "add-keyframe",
          animationId: anim.id,
          percentage: pct,
          properties: dragProps,
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
    );
  }
}
