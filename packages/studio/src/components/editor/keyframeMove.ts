/**
 * Pure helpers for committing a keyframe-diamond drag: pick the tween the
 * dragged keyframe belongs to, and compute the GSAP mutations (tween
 * position/duration and/or keyframe add/remove) for the move. Kept free of
 * React/store so the timeline drag handler stays a thin orchestrator.
 */

interface TweenLike {
  id: string;
  targetSelector: string;
  position: number | string;
  duration?: number;
  resolvedStart?: number;
  propertyGroup?: string;
  keyframes?: { keyframes: { percentage: number; properties: Record<string, number | string> }[] };
}

interface ElementWindow {
  start: number;
  duration: number;
  domId?: string;
  selector?: string;
}

export interface KeyframeMovePlan {
  /** Tween timing change (start/end point drags). */
  meta?: { position: number; duration: number };
  /** Keyframe percentages to remove, then re-add (intermediate move / remap). */
  removes: number[];
  adds: { pct: number; properties: Record<string, number | string> }[];
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const clampPct = (n: number) => Math.max(0, Math.min(100, Math.round(n * 100) / 100));
const MIN_DUR = 0.05;

function tweenWindow(a: TweenLike): { start: number; dur: number } {
  return {
    start: a.resolvedStart ?? (typeof a.position === "number" ? a.position : 0),
    dur: a.duration ?? 0,
  };
}

type Kf = { percentage: number; properties: Record<string, number | string> };

/**
 * Remap every keyframe except `keepIdx` from the old tween window to the new one
 * so their absolute times stay fixed after a start/end resize. Returns the
 * remove/add ops (empty for flat tweens, which have no intermediates).
 */
function remapKeyframes(
  kfs: Kf[],
  keepIdx: number,
  oldStart: number,
  oldDur: number,
  newStart: number,
  newDur: number,
): Pick<KeyframeMovePlan, "removes" | "adds"> {
  const removes: number[] = [];
  const adds: KeyframeMovePlan["adds"] = [];
  if (newDur <= 0) return { removes, adds };
  for (let i = 0; i < kfs.length; i++) {
    if (i === keepIdx) continue;
    const k = kfs[i]!;
    const absT = oldStart + (k.percentage / 100) * oldDur;
    const remapped = clampPct(((absT - newStart) / newDur) * 100);
    if (Math.abs(remapped - k.percentage) < 0.05) continue;
    removes.push(k.percentage);
    adds.push({ pct: remapped, properties: k.properties });
  }
  return { removes, adds };
}

/**
 * Pick the tween the dragged keyframe belongs to: restrict to the element's
 * selector and (if known) the keyframe's property group, then choose the one
 * whose time window contains — or is nearest — the keyframe's original time.
 * An element can have several tweens in one group (e.g. fade-in + fade-out).
 */
export function pickKeyframeTween<T extends TweenLike>(
  anims: T[],
  el: ElementWindow,
  origAbsTime: number,
  group: string | undefined,
): T | undefined {
  const selectors = [el.domId ? `#${el.domId}` : null, el.selector].filter(Boolean);
  const forEl = anims.filter((a) => selectors.includes(a.targetSelector));
  // Only ever pick among THIS element's tweens. Don't fall back to all
  // animations — a selector mismatch (e.g. a class/compound-selector tween)
  // would otherwise edit a different element's keyframes. No match → no-op.
  if (forEl.length === 0) return undefined;
  const groupPool = group ? forEl.filter((a) => a.propertyGroup === group) : [];
  const candidates = groupPool.length > 0 ? groupPool : forEl;
  const dist = (a: T): number => {
    const { start, dur } = tweenWindow(a);
    if (origAbsTime >= start && origAbsTime <= start + dur) return 0;
    return Math.min(Math.abs(origAbsTime - start), Math.abs(origAbsTime - (start + dur)));
  };
  return candidates.reduce((best, a) => (dist(a) < dist(best) ? a : best), candidates[0]!);
}

/**
 * Compute the mutations for moving a keyframe to `newPct` (clip-relative):
 * - start point → trim front (position moves, end fixed),
 * - end point   → resize (duration changes, start fixed),
 * - intermediate → move only that keyframe; start/end moves remap the other
 *   keyframes so their absolute times stay put.
 */
// fallow-ignore-next-line complexity
export function computeKeyframeMovePlan(
  anim: TweenLike,
  tweenOldPct: number,
  el: ElementWindow,
  newPct: number,
): KeyframeMovePlan {
  const newAbsTime = el.start + (newPct / 100) * el.duration;
  const tweenStart = tweenWindow(anim).start;
  const tweenDur = anim.duration ?? el.duration;
  const kfs = anim.keyframes
    ? anim.keyframes.keyframes.slice().sort((a, b) => a.percentage - b.percentage)
    : null;
  const idx = kfs ? kfs.findIndex((k) => Math.abs(k.percentage - tweenOldPct) < 0.5) : -1;

  // Keyframe-array tween but the dragged keyframe couldn't be located (stale
  // cache / precision drift): no-op rather than falling through to an end-point
  // resize that would silently rescale the whole tween and re-time every key.
  if (kfs && idx === -1) return { removes: [], adds: [] };

  if (kfs && idx > 0 && idx < kfs.length - 1) {
    const movedPct = tweenDur > 0 ? clampPct(((newAbsTime - tweenStart) / tweenDur) * 100) : 0;
    return { removes: [tweenOldPct], adds: [{ pct: movedPct, properties: kfs[idx]!.properties }] };
  }

  const isStartPoint = kfs ? idx === 0 : tweenOldPct <= 50;
  let newStart = tweenStart;
  let newDur = tweenDur;
  if (isStartPoint) {
    const end = tweenStart + tweenDur;
    newStart = Math.max(0, Math.min(newAbsTime, end - MIN_DUR));
    newDur = end - newStart;
  } else {
    newDur = Math.max(MIN_DUR, newAbsTime - tweenStart);
  }

  const windowChanged = newStart !== tweenStart || newDur !== tweenDur;
  const remap =
    kfs && windowChanged
      ? remapKeyframes(kfs, idx, tweenStart, tweenDur, newStart, newDur)
      : { removes: [], adds: [] };
  return { meta: { position: round3(newStart), duration: round3(newDur) }, ...remap };
}
