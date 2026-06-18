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

  // ponytail: a brand-new tween captures position only — bundling opacity made it
  // a mixed group that the position-only drag intercept couldn't resolve.
  const props = anim ? Object.keys(anim.properties) : ["x", "y"];
  for (const prop of props) {
    const val = Number(gsap.getProperty(element, prop));
    if (!Number.isFinite(val)) continue;
    result[prop] = POSITION_PROPS.has(prop) ? Math.round(val) : roundTo3(val);
  }

  return result;
}

/**
 * Range for a brand-new keyframe tween created via "Enable keyframes" on an element
 * with no existing animation. "Add a keyframe" must land at the PLAYHEAD.
 *
 * The runtime auto-stamps `data-start="0"` + `data-duration=<rootDuration>` on every
 * timeline element, so we can't treat `data-start` as authored timing (doing so put
 * the keyframe at 0). Instead, clamp the playhead into the element's [start, end]
 * range: the auto-stamp's full-composition range passes the playhead through
 * unchanged, while a genuinely narrow authored clip still clamps sensibly.
 */
export function resolveNewTweenRange(
  authoredStart: string | undefined,
  authoredDuration: string | undefined,
  currentTime: number,
): { start: number; duration: number } {
  const t = Math.max(0, roundTo3(currentTime));
  const start = authoredStart != null ? Number.parseFloat(authoredStart) : Number.NaN;
  const duration = authoredDuration != null ? Number.parseFloat(authoredDuration) : Number.NaN;
  if (!Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0) {
    return { start: t, duration: 1 };
  }
  const end = start + duration;
  const clampedStart = Math.min(Math.max(t, start), end);
  return { start: clampedStart, duration: Math.max(0.5, roundTo3(end - clampedStart)) };
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
      const { start: elStart, duration: elDuration } = resolveNewTweenRange(
        sel.dataAttributes?.start,
        sel.dataAttributes?.duration,
        t,
      );
      const selector = selectorFromSelection(sel);

      if (!selector) {
        session.handleGsapAddAnimation("to");
        return;
      }

      if (Object.keys(position).length === 0) {
        position.x = 0;
        position.y = 0;
      }

      // One keyframe at the playhead — a single diamond capturing the current
      // value. Motion comes from the user adding/dragging more keyframes later;
      // creating 0%+100% up front showed two diamonds for a single "add keyframe".
      const keyframes: Array<{ percentage: number; properties: Record<string, number | string> }> =
        [{ percentage: 0, properties: { ...position } }];

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
