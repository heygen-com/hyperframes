import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { usePlayerStore } from "../player/store/playerStore";
import { resolveTweenStart, resolveTweenDuration } from "../utils/globalTimeCompiler";
import { roundTo3 } from "../utils/rounding";
import { computeDraggedGsapPosition } from "./draggedGsapPosition";
import {
  type GsapDragCommitCallbacks,
  computeCurrentPercentage,
  parkPlayheadOnKeyframe,
  materializeIfDynamic,
} from "./gsapDragCommit";

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
      ...(backfillDefaults ? { backfillDefaults } : {}),
    },
    { label: `Move layer (keyframe ${pct}%)`, softReload: true, beforeReload },
  );
  if (activeKeyframePct != null) {
    setActiveKeyframePct(null);
    parkPlayheadOnKeyframe(anim, pct);
  }
}

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
    return null;
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
  const { activeKeyframePct, setActiveKeyframePct } = usePlayerStore.getState();
  const outsideRange =
    activeKeyframePct == null && ts !== null && td > 0 && (ct < ts - 0.01 || ct > ts + td + 0.01);

  const resolvedFromValues: Record<string, number | string> = {};
  const runtime = resolveDragRuntime(iframe, selector);
  if (runtime && ts !== null) {
    const { gsapLib, el, mainTl } = runtime;
    const draggedValues: Record<string, number> = {};
    for (const key of Object.keys(properties)) {
      const v = Number(gsapLib.getProperty(el, key));
      if (Number.isFinite(v)) draggedValues[key] = v;
    }
    try {
      gsapLib.set(el, { clearProps: Object.keys(properties).join(",") });
      mainTl.seek(ts);
      for (const key of Object.keys(properties)) {
        const v = Number(gsapLib.getProperty(el, key));
        if (Number.isFinite(v)) resolvedFromValues[key] = roundTo3(v);
      }
      mainTl.seek(ct);
    } catch {
      for (const key of Object.keys(resolvedFromValues)) delete resolvedFromValues[key];
    } finally {
      if (Object.keys(draggedValues).length > 0) gsapLib.set(el, draggedValues);
    }
  }

  if (outsideRange && ts !== null) {
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

  const coalesceKey = `gsap:convert-drag:${anim.id}`;
  // fallow-ignore-next-line code-duplication
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

// fallow-ignore-next-line code-duplication
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
  // fallow-ignore-next-line code-duplication
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

  const backfillDefaults: Record<string, number> = { x: baseGsapX, y: baseGsapY };
  const ct = usePlayerStore.getState().currentTime;
  if (anim.keyframes) {
    const newId = await materializeIfDynamic(anim, iframe, callbacks.commitMutation, selection);
    const effectiveAnim = newId ? { ...anim, id: newId } : anim;
    const dragProps: Record<string, number> = { x: newX, y: newY };

    const ts = resolveTweenStart(effectiveAnim);
    const td = resolveTweenDuration(effectiveAnim);
    const outsideRange = ts !== null && td > 0 && (ct < ts - 0.01 || ct > ts + td + 0.01);
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
    const hasSelectedKeyframe = usePlayerStore.getState().activeKeyframePct != null;
    const outsideRange =
      !hasSelectedKeyframe && ts !== null && td > 0 && (ct < ts - 0.01 || ct > ts + td + 0.01);
    const dragProps: Record<string, number> = { x: newX, y: newY };

    if (outsideRange && ts !== null) {
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
