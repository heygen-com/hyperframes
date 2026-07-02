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
import type { GsapAnimation, GsapPercentageKeyframe } from "@hyperframes/core/gsap-parser";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { usePlayerStore } from "../player/store/playerStore";
import { fetchParsedAnimations, getAnimationsForElement } from "./useGsapTweenCache";
import { selectorFromSelection, computeElementPercentage } from "./gsapShared";
import {
  resolveTweenStart,
  resolveTweenDuration,
  isTimeWithinTween,
} from "../utils/globalTimeCompiler";
import { POSITION_PROPS } from "./gsapRuntimeReaders";
import { roundTo3 } from "../utils/rounding";
import { nearestPointOnPath } from "../components/editor/motionPathGeometry";

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

/**
 * Which animated properties to capture from the live element. Array-form keyframe
 * tweens (`keyframes: [{x,y},…]`) leave `anim.properties` empty — the props live in
 * the keyframe stops — so fall back to the union of the stops' keys, then to x/y.
 */
export function animatedProps(anim: GsapAnimation | null): string[] {
  if (!anim) return ["x", "y"];
  const own = Object.keys(anim.properties ?? {});
  if (own.length > 0) return own;
  const stops = anim.keyframes?.keyframes;
  if (stops?.length) {
    const keys = new Set<string>();
    for (const stop of stops) for (const k of Object.keys(stop.properties ?? {})) keys.add(k);
    if (keys.size > 0) return [...keys];
  }
  return ["x", "y"];
}

/**
 * Whether the playhead sits inside an animation's tween range. When the tween's
 * start can't be resolved we don't block (the percentage falls back to clip range,
 * preserving prior behavior for elements without explicit timing).
 */
export function isPlayheadWithinTween(anim: GsapAnimation, currentTime: number): boolean {
  const start = resolveTweenStart(anim);
  if (start === null) return true;
  return isTimeWithinTween(currentTime, start, resolveTweenDuration(anim));
}

/**
 * Grow a keyframe tween's range to reach a playhead that sits outside it, and add a
 * keyframe there. Existing keyframes keep their *absolute* timing (percentages
 * rescale into the new range), so the current motion is preserved — the playhead
 * just becomes a new hold at the start or end. Used when "add keyframe at playhead"
 * fires beyond the tween instead of disabling the action.
 */
export function buildExtendedKeyframes(
  anim: GsapAnimation,
  currentTime: number,
  position: Record<string, number>,
): { position: number; duration: number; keyframes: GsapPercentageKeyframe[] } {
  const oldStart = resolveTweenStart(anim) ?? 0;
  const oldDuration = resolveTweenDuration(anim);
  const newStart = Math.min(oldStart, currentTime);
  const newEnd = Math.max(oldStart + oldDuration, currentTime);
  const newDuration = roundTo3(newEnd - newStart);
  const toPct = (absoluteTime: number) =>
    newDuration > 0
      ? Math.max(
          0,
          Math.min(100, Math.round(((absoluteTime - newStart) / newDuration) * 1000) / 10),
        )
      : 0;
  const stops = anim.keyframes?.keyframes ?? [];
  const rescaled: GsapPercentageKeyframe[] = stops.map((stop) => ({
    percentage: toPct(oldStart + (stop.percentage / 100) * oldDuration),
    properties: stop.properties,
    ...(stop.ease ? { ease: stop.ease } : {}),
  }));
  const added: GsapPercentageKeyframe = { percentage: toPct(currentTime), properties: position };
  const keyframes = [...rescaled, added].sort((a, b) => a.percentage - b.percentage);
  return { position: roundTo3(newStart), duration: newDuration, keyframes };
}

// fallow-ignore-next-line complexity
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
  const props = animatedProps(anim);
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

// Authoritative parse of the current source for `sel`. Returns `null` when the
// fetch can't run (no projectId / request failed) so callers can distinguish
// "unavailable" from a genuine empty result (e.g. after a delete-all). An empty
// array means the source was read and the element has no animations.
async function tryFetchAnimationsForElement(
  sel: DomEditSelection,
): Promise<GsapAnimation[] | null> {
  const projectId = window.location.hash.match(/project\/([^?/]+)/)?.[1];
  if (!projectId) return null;
  const sourceFile = sel.sourceFile || "index.html";
  const parsed = await fetchParsedAnimations(projectId, sourceFile);
  if (!parsed) return null;
  return getAnimationsForElement(parsed.animations, {
    id: sel.id,
    selector: sel.selector,
  });
}

async function fetchAnimationsForElement(sel: DomEditSelection): Promise<GsapAnimation[]> {
  return (await tryFetchAnimationsForElement(sel)) ?? [];
}

/**
 * Apply "add keyframe at playhead" to a tween that already has x/y keyframes:
 * toggle off an existing stop, add one at the playhead's tween-relative %, or —
 * when the playhead sits outside the tween — extend the range to reach it (see
 * buildExtendedKeyframes). Shared by native keyframe tweens and flat tweens that
 * were just converted, so both behave identically.
 */
async function applyKeyframeAtPlayhead(
  session: EnableKeyframesSession,
  sel: DomEditSelection,
  kfAnim: GsapAnimation,
  t: number,
  iframe: HTMLIFrameElement | null,
): Promise<void> {
  if (!isPlayheadWithinTween(kfAnim, t)) {
    const position = readElementPosition(iframe, sel, kfAnim);
    const selector = selectorFromSelection(sel);
    if (selector && Object.keys(position).length > 0 && session.commitMutation) {
      const extended = buildExtendedKeyframes(kfAnim, t, position);
      await session.commitMutation(
        {
          type: "replace-with-keyframes",
          animationId: kfAnim.id,
          targetSelector: selector,
          position: extended.position,
          duration: extended.duration,
          keyframes: extended.keyframes,
          ease: kfAnim.ease,
        },
        { label: "Add keyframe", softReload: true },
      );
    }
    return;
  }
  const pct = computeElementPercentage(t, sel, kfAnim);
  const existing = kfAnim.keyframes?.keyframes.find((k) => Math.abs(k.percentage - pct) <= 1);
  if (existing) {
    session.handleGsapRemoveKeyframe(kfAnim.id, existing.percentage);
    return;
  }
  if (session.handleGsapAddKeyframeBatch) {
    const position = readElementPosition(iframe, sel, kfAnim);
    if (Object.keys(position).length > 0) {
      await session.handleGsapAddKeyframeBatch(kfAnim.id, pct, position);
    }
  }
}

/**
 * A set() is an instantaneous hold. "Add keyframe at playhead" promotes it to a
 * two-stop tween from the set's time to the playhead — the held value at 0%, the
 * live value at 100% — giving the user something to animate. No-op if the playhead
 * is at or before the set.
 *
 * The 0% endpoint is the held start, which the user didn't choose — mark it `auto`
 * so it tracks the nearest keyframe until edited directly. The 100% is the real
 * keyframe being placed at the playhead, so it stays fixed.
 */
export async function promoteSetToKeyframes(
  session: EnableKeyframesSession,
  sel: DomEditSelection,
  setAnim: GsapAnimation,
  t: number,
  iframe: HTMLIFrameElement | null,
): Promise<void> {
  const selector = selectorFromSelection(sel);
  const setStart = resolveTweenStart(setAnim) ?? 0;
  if (!selector || !session.commitMutation) return;
  // Playhead at or before the set → there's no forward range to promote into.
  // Instead of doing nothing (which read as "can't add a keyframe at 0"), replace
  // the set with a single keyframe at the playhead holding its value, matching the
  // no-animation branch: one diamond the user can build motion from.
  if (t <= setStart) {
    const position = readElementPosition(iframe, sel, setAnim);
    if (Object.keys(position).length === 0) {
      for (const key of Object.keys(setAnim.properties ?? {})) {
        const held = setAnim.properties?.[key];
        if (typeof held === "number") position[key] = held;
      }
    }
    if (Object.keys(position).length === 0) return;
    const range = resolveNewTweenRange(sel.dataAttributes?.start, sel.dataAttributes?.duration, t);
    await session.commitMutation(
      {
        type: "replace-with-keyframes",
        animationId: setAnim.id,
        targetSelector: selector,
        position: roundTo3(range.start),
        duration: roundTo3(range.duration),
        keyframes: [{ percentage: 0, properties: position }],
        ease: setAnim.ease,
      },
      { label: "Enable keyframes", softReload: true },
    );
    return;
  }
  const endPosition = readElementPosition(iframe, sel, setAnim);
  if (Object.keys(endPosition).length === 0) return;
  const startPosition: Record<string, number> = {};
  for (const key of Object.keys(endPosition)) {
    const held = setAnim.properties?.[key];
    if (typeof held === "number") startPosition[key] = held;
  }
  await session.commitMutation(
    {
      type: "replace-with-keyframes",
      animationId: setAnim.id,
      targetSelector: selector,
      position: roundTo3(setStart),
      duration: roundTo3(t - setStart),
      keyframes: [
        {
          percentage: 0,
          properties: Object.keys(startPosition).length > 0 ? startPosition : endPosition,
          auto: true,
        },
        { percentage: 100, properties: endPosition },
      ],
      ease: setAnim.ease,
    },
    { label: "Add keyframe", softReload: true },
  );
}

/**
 * An arc (motionPath) tween — its waypoints are reconstructed onto `keyframes`, so
 * it must be edited as waypoints (not x/y keyframes, which would break the curve).
 * "Add keyframe at playhead" drops a waypoint where the element currently sits on
 * the path, inserted at the matching segment so the curve is preserved. Outside the
 * range, extend the duration so the motion reaches the playhead.
 */
// fallow-ignore-next-line complexity
async function applyArcWaypointAtPlayhead(
  session: EnableKeyframesSession,
  sel: DomEditSelection,
  arcAnim: GsapAnimation,
  t: number,
  iframe: HTMLIFrameElement | null,
): Promise<void> {
  if (!session.commitMutation) return;
  if (!isPlayheadWithinTween(arcAnim, t)) {
    const start = resolveTweenStart(arcAnim) ?? 0;
    if (t > start) {
      await session.commitMutation(
        {
          type: "update-meta",
          animationId: arcAnim.id,
          updates: { duration: roundTo3(t - start) },
        },
        { label: "Extend motion path", softReload: true },
      );
    }
    return;
  }
  const live = readElementPosition(iframe, sel, arcAnim);
  if (typeof live.x !== "number" || typeof live.y !== "number") return;
  const liveX = live.x;
  const liveY = live.y;
  const nodes = (arcAnim.keyframes?.keyframes ?? [])
    .map((k) => ({ x: k.properties.x, y: k.properties.y }))
    .filter(
      (p): p is { x: number; y: number } => typeof p.x === "number" && typeof p.y === "number",
    );
  // Don't duplicate a waypoint that already sits where the element is (e.g. at the
  // path endpoints).
  const WAYPOINT_MERGE_PX = 6;
  if (nodes.some((n) => Math.hypot(n.x - liveX, n.y - liveY) <= WAYPOINT_MERGE_PX)) return;
  const proj = nearestPointOnPath(liveX, liveY, nodes);
  if (!proj) return;
  await session.commitMutation(
    {
      type: "add-motion-path-point",
      animationId: arcAnim.id,
      index: proj.segIndex + 1,
      x: liveX,
      y: liveY,
    },
    { label: "Add waypoint", softReload: true },
  );
}

export function useEnableKeyframes(
  sessionRef: React.RefObject<EnableKeyframesSession | undefined>,
) {
  // fallow-ignore-next-line complexity
  return useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    const sel = session.domEditSelection;
    if (!sel) return;

    const t = usePlayerStore.getState().currentTime;
    const iframe = session.previewIframeRef?.current ?? null;

    // `selectedGsapAnimations` is a studio-side selection cache that can lag a
    // mutation — e.g. right after a delete-all it may still hold the just-removed
    // tween, which would route us into the wrong branch below (editing a tween
    // that no longer exists in source). Prefer the authoritative parse of the
    // current source; an empty parse is a valid "no animations" result and is
    // honored. Fall back to the cache only when the fetch couldn't run at all
    // (no projectId / request failed), preserving prior behavior offline.
    const fetched = await tryFetchAnimationsForElement(sel);
    const anims = fetched ?? session.selectedGsapAnimations;

    // An arc/motionPath tween carries reconstructed x/y keyframes too, so match it
    // first and edit it as waypoints — treating it as plain keyframes would break
    // the curve.
    const arcAnim = anims.find((a) => a.arcPath);
    const kfAnim = anims.find((a) => a.keyframes && !a.arcPath);
    const setAnim = anims.find((a) => a.method === "set" && !a.keyframes && !a.arcPath);
    const flatAnim = anims.find((a) => !a.keyframes && !a.arcPath && a.method !== "set");

    if (arcAnim) {
      await applyArcWaypointAtPlayhead(session, sel, arcAnim, t, iframe);
    } else if (kfAnim) {
      await applyKeyframeAtPlayhead(session, sel, kfAnim, t, iframe);
    } else if (setAnim) {
      await promoteSetToKeyframes(session, sel, setAnim, t, iframe);
    } else if (flatAnim) {
      // Convert the flat tween (to/from/fromTo) to its natural keyframes — no
      // resolvedFromValues, so the 0%/100% stops keep the real start→end motion
      // (passing the playhead value would flatten it). Then apply uniformly so an
      // out-of-range playhead extends the range just like a keyframe tween.
      await session.handleGsapConvertToKeyframes(flatAnim.id);
      const converted = (await fetchAnimationsForElement(sel)).find((a) => a.keyframes);
      if (converted) await applyKeyframeAtPlayhead(session, sel, converted, t, iframe);
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
