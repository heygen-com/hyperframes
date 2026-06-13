/**
 * Centralized "Enable keyframes" logic that handles ALL scenarios:
 * - Element has explicit keyframes → add/remove at seeked time
 * - Element has a flat tween → convert + add at seeked time + propagate to end
 * - Element has no animation (deleted) → create new tween with correct position + keyframes
 *
 * Always fetches fresh animation data to avoid stale session state.
 * Reads GSAP runtime values only (no CSS offset — it applies separately via translate).
 */
import { useCallback } from "react";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { usePlayerStore } from "../player/store/playerStore";
import { fetchParsedAnimations, getAnimationsForElement } from "./useGsapTweenCache";
import { selectorFromSelection, computeElementPercentage } from "./gsapShared";
import { POSITION_PROPS } from "./gsapRuntimeReaders";
import { roundTo3 } from "../utils/rounding";

export interface EnableKeyframesSession {
  domEditSelection: DomEditSelection | null;
  selectedGsapAnimations: GsapAnimation[];
  previewIframeRef?: React.RefObject<HTMLIFrameElement | null>;
  handleGsapAddAnimation: (method: "to" | "from" | "set" | "fromTo") => void;
  handleGsapConvertToKeyframes: (
    animId: string,
    resolvedFromValues?: Record<string, number | string>,
  ) => void | Promise<void>;
  handleGsapRemoveKeyframe: (animId: string, pct: number) => void;
  handleGsapAddKeyframeBatch?: (
    animId: string,
    pct: number,
    properties: Record<string, number | string>,
  ) => Promise<void>;
  commitMutation?: (
    mutation: Record<string, unknown>,
    options: { label: string; softReload?: boolean },
  ) => Promise<void>;
}

function readElementPosition(
  iframe: HTMLIFrameElement | null,
  sel: DomEditSelection,
  anim: GsapAnimation | null,
): Record<string, number> {
  const result: Record<string, number> = {};
  if (!iframe?.contentWindow) return result;

  let gsap: { getProperty?: (el: Element, prop: string) => number } | undefined;
  try {
    gsap = (iframe.contentWindow as Window & { gsap?: typeof gsap }).gsap;
  } catch {
    return result;
  }

  const element = sel.element;
  if (!element?.isConnected || !gsap?.getProperty) return result;

  const props = anim ? Object.keys(anim.properties) : ["x", "y", "opacity"];
  for (const prop of props) {
    const val = Number(gsap.getProperty(element, prop));
    if (!Number.isFinite(val)) continue;
    result[prop] = POSITION_PROPS.has(prop) ? Math.round(val) : roundTo3(val);
  }

  return result;
}

async function fetchAnimationsForElement(sel: DomEditSelection): Promise<GsapAnimation[]> {
  const projectId = window.location.hash.match(/project\/([^?/]+)/)?.[1];
  if (!projectId) return [];
  const sourceFile = sel.sourceFile || "index.html";
  const parsed = await fetchParsedAnimations(projectId, sourceFile);
  if (!parsed) return [];
  return getAnimationsForElement(parsed.animations, {
    id: sel.id,
    selector: sel.selector,
  });
}

// fallow-ignore-next-line complexity
export function useEnableKeyframes(
  sessionRef: React.RefObject<EnableKeyframesSession | undefined>,
) {
  return useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    const sel = session.domEditSelection;
    if (!sel) return;

    const t = usePlayerStore.getState().currentTime;
    const iframe = session.previewIframeRef?.current ?? null;

    let anims = session.selectedGsapAnimations;
    if (anims.length === 0) {
      anims = await fetchAnimationsForElement(sel);
    }

    const kfAnim = anims.find((a) => a.keyframes);
    const flatAnim = anims.find((a) => !a.keyframes);

    if (kfAnim?.keyframes) {
      const pct = computeElementPercentage(t, sel);
      const existing = kfAnim.keyframes.keyframes.find((k) => Math.abs(k.percentage - pct) <= 1);
      if (existing) {
        session.handleGsapRemoveKeyframe(kfAnim.id, existing.percentage);
      } else if (session.handleGsapAddKeyframeBatch) {
        const position = readElementPosition(iframe, sel, kfAnim);
        if (Object.keys(position).length > 0) {
          await session.handleGsapAddKeyframeBatch(kfAnim.id, pct, position);
        }
      }
    } else if (flatAnim) {
      const position = readElementPosition(iframe, sel, flatAnim);
      const hasPosition = Object.keys(position).length > 0;

      await session.handleGsapConvertToKeyframes(flatAnim.id, hasPosition ? position : undefined);

      const pct = computeElementPercentage(t, sel);
      if (pct > 1 && pct < 99 && hasPosition && session.handleGsapAddKeyframeBatch) {
        await session.handleGsapAddKeyframeBatch(flatAnim.id, pct, position);
        await session.handleGsapAddKeyframeBatch(flatAnim.id, 100, position);
      }
    } else {
      const position = readElementPosition(iframe, sel, null);
      const pct = computeElementPercentage(t, sel);
      const elStart = Number.parseFloat(sel.dataAttributes?.start ?? "0") || 0;
      const elDuration = Number.parseFloat(sel.dataAttributes?.duration ?? "1") || 1;
      const selector = selectorFromSelection(sel);

      if (!selector) {
        session.handleGsapAddAnimation("to");
        return;
      }

      if (Object.keys(position).length === 0) {
        position.x = 0;
        position.y = 0;
        position.opacity = 1;
      }

      const keyframes: Array<{ percentage: number; properties: Record<string, number | string> }> =
        [{ percentage: 0, properties: { ...position } }];
      if (pct > 1 && pct < 99) {
        keyframes.push({ percentage: pct, properties: { ...position } });
      }
      keyframes.push({
        percentage: 100,
        properties: { ...position },
        auto: true,
      } as (typeof keyframes)[number]);

      if (session.commitMutation) {
        await session.commitMutation(
          {
            type: "add-with-keyframes",
            targetSelector: selector,
            position: roundTo3(elStart),
            duration: roundTo3(elDuration),
            keyframes,
          },
          { label: "Enable keyframes", softReload: true },
        );
      } else {
        session.handleGsapAddAnimation("to");
      }
    }
  }, [sessionRef]);
}
