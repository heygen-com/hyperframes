/**
 * Low-level drag commit helpers for GSAP position mutations.
 * Extracted from gsapRuntimeBridge.ts to keep file sizes under the 600-line limit.
 */
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { usePlayerStore } from "../player/store/playerStore";
import { readRuntimeKeyframes, scanAllRuntimeKeyframes } from "./gsapRuntimeKeyframes";
import {
  absoluteToPercentage,
  resolveTweenStart,
  resolveTweenDuration,
} from "../utils/globalTimeCompiler";
import { readAllAnimatedProperties } from "./gsapRuntimeReaders";

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
}

// ── Percentage computation ─────────────────────────────────────────────────

export function computeCurrentPercentage(
  selection: DomEditSelection,
  animation?: GsapAnimation,
): number {
  const currentTime = usePlayerStore.getState().currentTime;
  if (animation) {
    const start = resolveTweenStart(animation);
    const duration = resolveTweenDuration(animation);
    if (start !== null) {
      return absoluteToPercentage(currentTime, start, duration);
    }
  }
  const elStart = Number.parseFloat(selection.dataAttributes?.start ?? "0") || 0;
  const elDuration = Number.parseFloat(selection.dataAttributes?.duration ?? "1") || 1;
  return elDuration > 0
    ? Math.max(0, Math.min(100, Math.round(((currentTime - elStart) / elDuration) * 1000) / 10))
    : 0;
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
    { type: "delete", animationId: anim.id },
    { label: "Extend tween range", skipReload: true },
  );

  const selector = anim.targetSelector;
  await callbacks.commitMutation(
    selection,
    {
      type: "add-with-keyframes",
      targetSelector: selector,
      position: Math.round(newStart * 1000) / 1000,
      duration: Math.round(newDuration * 1000) / 1000,
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
  const pct = computeCurrentPercentage(selection, anim);

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
): Promise<void> {
  await callbacks.commitMutation(
    selection,
    { type: "convert-to-keyframes", animationId: anim.id },
    { label: "Convert to keyframes for drag", skipReload: true },
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
    { label: `Move layer (keyframe ${pct}%)`, softReload: true, beforeReload },
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

  if (anim.keyframes) {
    const newId = await materializeIfDynamic(anim, iframe, callbacks.commitMutation, selection);
    const effectiveAnim = newId ? { ...anim, id: newId } : anim;
    const runtimeProps = readAllAnimatedProperties(iframe, selector, anim);

    const ct = usePlayerStore.getState().currentTime;
    const ts = resolveTweenStart(effectiveAnim);
    const td = resolveTweenDuration(effectiveAnim);
    if (ts !== null && td > 0 && (ct < ts - 0.01 || ct > ts + td + 0.01)) {
      await extendTweenAndAddKeyframe(
        selection,
        effectiveAnim,
        { ...runtimeProps, x: newX, y: newY },
        ct,
        ts,
        td,
        callbacks,
        restoreOffset,
      );
    } else {
      await commitKeyframedPosition(
        selection,
        effectiveAnim,
        { ...runtimeProps, x: newX, y: newY },
        callbacks,
        restoreOffset,
      );
    }
  } else if (anim.method === "from" || anim.method === "fromTo") {
    await callbacks.commitMutation(
      selection,
      {
        type: "convert-to-keyframes",
        animationId: anim.id,
        resolvedFromValues: { x: newX, y: newY },
      },
      { label: "Move layer (keyframe rest)", softReload: true, beforeReload: restoreOffset },
    );
  } else {
    const runtimeProps = readAllAnimatedProperties(iframe, selector, anim);
    await commitFlatViaKeyframes(
      selection,
      anim,
      { ...runtimeProps, x: newX, y: newY },
      callbacks,
      restoreOffset,
    );
  }
}
