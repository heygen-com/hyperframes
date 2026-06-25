/**
 * Read GSAP keyframe data from the live runtime in the preview iframe.
 * Used to discover dynamic keyframes that the AST parser can't resolve
 * (data-driven loops, fetched values, computed selectors).
 *
 * Keyframe percentages returned here are TWEEN-RELATIVE (0–100 within the
 * tween), matching the static parser. Callers convert to clip-relative via
 * `toAbsoluteTime` + the element's clip start/duration. `scanAllRuntimeKeyframes`
 * does that conversion itself when given a `clipById` map.
 */
import { buildArcPath, type ArcPathConfig } from "@hyperframes/core/gsap-parser-acorn";
import { parsePercentageKeyframes, toAbsoluteTime } from "./gsapShared";
import { roundTo3 } from "../utils/rounding";

export interface RuntimeTween {
  targets?: () => Element[];
  vars?: Record<string, unknown>;
  duration?: () => number;
  startTime?: () => number;
  invalidate?: () => RuntimeTween;
}

export interface RuntimeTimeline {
  getChildren?: (deep: boolean) => RuntimeTween[];
  duration?: () => number;
  time?: () => number;
  invalidate?: () => RuntimeTimeline;
}

type Pct = { percentage: number; properties: Record<string, number | string> };
export type ReadTween = { keyframes: Pct[]; easeEach?: string; arcPath?: ArcPathConfig };

export interface RuntimeKeyframeEntry {
  keyframes: Pct[];
  easeEach?: string;
  /** Present when the live tween uses motionPath — drives the Arc Motion panel. */
  arcPath?: ArcPathConfig;
  /** Absolute start time of the source tween (seconds). */
  tweenStart: number;
  /** Duration of the source tween (seconds). */
  tweenDuration: number;
}

/** Clip start/duration per element id, to convert tween-relative % to clip-relative. */
export type ClipDims = Map<string, { start: number; duration: number }>;

const FLAT_SKIP_KEYS = new Set([
  "ease",
  "duration",
  "delay",
  "stagger",
  "motionPath",
  "overwrite",
  "immediateRender",
  "onComplete",
  "onUpdate",
  "onStart",
  "keyframes",
]);

function timelinesOf(iframe: HTMLIFrameElement | null): Record<string, RuntimeTimeline> | null {
  if (!iframe?.contentWindow) return null;
  try {
    return (
      (iframe.contentWindow as unknown as { __timelines?: Record<string, RuntimeTimeline> })
        .__timelines ?? null
    );
  } catch {
    return null;
  }
}

function isXY(p: unknown): p is { x: number; y: number } {
  return !!p && typeof (p as any).x === "number" && typeof (p as any).y === "number";
}

/**
 * A tween we must skip when reading keyframes: a zero-duration `set`/hold (incl.
 * the studio pre-keyframe position hold, tagged `data: STUDIO_HOLD_MARKER`).
 * These sit before the real keyframed tween and otherwise shadow it — `readTween`
 * would fall back to a degenerate 2-point flat path from the set's values, hiding
 * the actual multi-keyframe motion. `!(duration > 0)` also rejects NaN durations.
 */
function isZeroDurationSet(duration: number): boolean {
  return !(duration > 0);
}

/** Coordinates + curviness from a live `vars.motionPath` value (object or array form), or null. */
function coordsFromMotionPath(mp: unknown): {
  coords: Array<{ x: number; y: number }>;
  curviness: number;
  autoRotate: boolean | number;
  isCubic: boolean;
} | null {
  if (!mp || typeof mp !== "object") return null;
  const obj = mp as Record<string, unknown>;
  const pathVal = Array.isArray(mp) ? mp : obj.path;
  if (!Array.isArray(pathVal)) return null;
  const coords = pathVal.filter(isXY).map((p) => ({ x: p.x, y: p.y }));
  if (coords.length < 2) return null;
  const curviness = typeof obj.curviness === "number" ? obj.curviness : 1;
  const autoRotate = typeof obj.autoRotate === "number" ? obj.autoRotate : obj.autoRotate === true;
  return { coords, curviness, autoRotate, isCubic: obj.type === "cubic" };
}

/** Build an arcPath config from a live `vars.motionPath` value. */
export function arcPathFromMotionPathValue(mp: unknown): ArcPathConfig | undefined {
  const parsed = coordsFromMotionPath(mp);
  if (!parsed) return undefined;
  return buildArcPath(parsed.coords, parsed.curviness, parsed.autoRotate, parsed.isCubic)?.arcPath;
}

function flatTweenKeyframes(vars: Record<string, unknown>): Pct[] | null {
  const properties: Record<string, number | string> = {};
  for (const [k, v] of Object.entries(vars)) {
    if (FLAT_SKIP_KEYS.has(k)) continue;
    if (typeof v === "number") properties[k] = roundTo3(v);
    else if (typeof v === "string") properties[k] = v;
  }
  if (Object.keys(properties).length === 0) return null;
  return [
    { percentage: 0, properties },
    { percentage: 100, properties },
  ];
}

/** Tween-relative keyframes + optional arcPath for one live tween, or null. */
function readTween(vars: Record<string, unknown>): ReadTween | null {
  if (vars.keyframes && typeof vars.keyframes === "object") {
    const parsed = parsePercentageKeyframes(vars.keyframes as Record<string, unknown>);
    if (parsed) return parsed;
  }
  const mp = coordsFromMotionPath(vars.motionPath);
  if (mp) {
    const shape = buildArcPath(mp.coords, mp.curviness, mp.autoRotate, mp.isCubic);
    if (shape) {
      const n = shape.waypoints.length;
      const keyframes = shape.waypoints.map((wp, i) => ({
        percentage: n > 1 ? Math.round((i / (n - 1)) * 100) : 0,
        properties: { x: wp.x, y: wp.y },
      }));
      return { keyframes, arcPath: shape.arcPath };
    }
  }
  const flat = flatTweenKeyframes(vars);
  return flat ? { keyframes: flat } : null;
}

function matchesElement(tween: RuntimeTween, el: Element): boolean {
  if (!tween.targets) return false;
  for (const t of tween.targets()) {
    if (t === el || (el.id && (t as Element).id === el.id)) return true;
  }
  return false;
}

function tweenTiming(tween: RuntimeTween): { start: number; duration: number } {
  const rawStart = typeof tween.startTime === "function" ? tween.startTime() : 0;
  const rawDur = typeof tween.duration === "function" ? tween.duration() : 0;
  return {
    start: Number.isFinite(rawStart) ? rawStart : 0,
    duration: Number.isFinite(rawDur) ? rawDur : 0,
  };
}

export interface ResolvedRuntimeTween {
  /** The live GSAP tween targeting the selector. */
  tween: RuntimeTween;
  /** The composition timeline that owns it. */
  timeline: RuntimeTimeline;
}

/**
 * Whether a tween's `vars` carry at least one of `channels` as an OWN property.
 * Used to disambiguate co-located `set`s: an element can have separate
 * `tl.set("#el",{x,y})` and `tl.set("#el",{rotation})` tweens, and a position
 * patch must land on the {x,y} set — never the rotation-only one.
 */
function varsCarryChannel(vars: Record<string, unknown> | undefined, channels: string[]): boolean {
  if (!vars) return false;
  for (const ch of channels) {
    if (Object.prototype.hasOwnProperty.call(vars, ch)) return true;
  }
  return false;
}

/**
 * Resolve the live tween targeting `selector` using the SAME all-timelines scan
 * `readRuntimeKeyframes` uses, so read and write agree on "which tween". With
 * `kind: "keyframe"` it skips zero-duration `set`s and prefers the tween whose
 * range contains the playhead (matching the reader). With `kind: "set"` it picks
 * the zero-duration `set`/hold instead. Returns null when none matches.
 *
 * `channels` disambiguates co-located `set`s (CHANNEL-BLIND otherwise): when
 * provided with `kind: "set"`, a set carrying ONE of those channels wins, and a
 * set carrying ONLY disjoint channels is skipped (so patching {x,y} never lands
 * on a rotation-only set). With no channel-matching set, it falls back to the
 * first matching set (back-compat). `channels` is ignored for `kind: "keyframe"`.
 */
export function resolveRuntimeTween(
  iframe: HTMLIFrameElement | null,
  selector: string,
  kind: "keyframe" | "set",
  compositionId?: string,
  channels?: string[],
): ResolvedRuntimeTween | null {
  const timelines = timelinesOf(iframe);
  if (!timelines) return null;

  let targetEl: Element | null = null;
  try {
    targetEl = iframe?.contentDocument?.querySelector(selector) ?? null;
  } catch {
    return null;
  }
  if (!targetEl) return null;

  const tlIds = compositionId
    ? [compositionId]
    : Object.keys(timelines).filter((k) => typeof timelines[k]?.getChildren === "function");

  const wantChannels = kind === "set" && channels && channels.length > 0 ? channels : null;

  let first: ResolvedRuntimeTween | null = null;
  let channelMatch: ResolvedRuntimeTween | null = null;
  for (const tlId of tlIds) {
    const timeline = timelines[tlId];
    if (!timeline?.getChildren) continue;
    const now = typeof timeline.time === "function" ? timeline.time() : null;
    for (const tween of timeline.getChildren(true)) {
      if (!tween.vars || !matchesElement(tween, targetEl)) continue;
      const dur = typeof tween.duration === "function" ? tween.duration() : 0;
      const isSet = !(dur > 0);
      if (kind === "set" ? !isSet : isSet) continue;
      if (wantChannels) {
        if (varsCarryChannel(tween.vars, wantChannels)) {
          if (channelMatch === null) channelMatch = { tween, timeline };
        } else if (first === null) {
          // A set carrying only disjoint channels: remember as last-resort
          // fallback, but never prefer it over a channel-matching set.
          first = { tween, timeline };
        }
        continue;
      }
      if (first === null) first = { tween, timeline };
      if (kind === "keyframe" && now != null) {
        const start = typeof tween.startTime === "function" ? tween.startTime() : 0;
        if (now >= start - 1e-3 && now <= start + dur + 1e-3) return { tween, timeline };
      }
    }
  }
  return channelMatch ?? first;
}

/**
 * Read keyframes (incl. motionPath arcs) for one selector from the live timeline.
 * Returns tween-relative percentages; callers convert to clip-relative.
 */
export function readRuntimeKeyframes(
  iframe: HTMLIFrameElement | null,
  selector: string,
  compositionId?: string,
): ReadTween | null {
  const timelines = timelinesOf(iframe);
  if (!timelines) return null;

  let targetEl: Element | null = null;
  try {
    targetEl = iframe?.contentDocument?.querySelector(selector) ?? null;
  } catch {
    return null;
  }
  if (!targetEl) return null;

  // Search the element's OWN composition timeline. With inlined subcompositions the
  // preview has multiple timelines (one per composition), and the element belongs to
  // exactly one — so we can't assume the first key (order isn't stable across soft
  // reloads, which delete+re-add the rebuilt key). Scan every timeline for tweens
  // targeting this element; only its composition's timeline matches. An explicit
  // compositionId still pins the search. (`__proxied` and other non-timeline markers
  // are skipped by the getChildren guard.)
  const tlIds = compositionId
    ? [compositionId]
    : Object.keys(timelines).filter((k) => typeof timelines[k]?.getChildren === "function");
  if (tlIds.length === 0) return null;

  // The element can have MORE THAN ONE keyframed tween at disjoint time ranges
  // (e.g. two non-overlapping gesture recordings → two separate `to()`s). The
  // overlay must draw the segment under the PLAYHEAD, not blindly the first one
  // — otherwise recording a second gesture leaves the path stuck on the first.
  let firstRead: ReadTween | null = null;
  for (const tlId of tlIds) {
    const timeline = timelines[tlId];
    if (!timeline?.getChildren) continue;
    const now = typeof timeline.time === "function" ? timeline.time() : null;
    for (const tween of timeline.getChildren(true)) {
      if (!tween.vars || !matchesElement(tween, targetEl)) continue;
      const dur = typeof tween.duration === "function" ? tween.duration() : 0;
      if (isZeroDurationSet(dur)) continue; // skip hold/set tweens (see isZeroDurationSet)
      const read = readTween(tween.vars);
      if (!read) continue;
      if (firstRead === null) firstRead = read;
      // Prefer the tween whose [start, start+dur] contains the playhead.
      if (now != null) {
        const start = typeof tween.startTime === "function" ? tween.startTime() : 0;
        if (now >= start - 1e-3 && now <= start + dur + 1e-3) return read;
      }
    }
  }
  // Playhead outside every tween's range (or timeline has no clock): the element
  // still has motion, so fall back to the first keyframed tween.
  return firstRead;
}

/**
 * Whether the live timeline has at least one NON-HOLD tween (non-zero duration,
 * not the studio position-hold `set`) targeting `selector`. Stricter than a
 * truthy `readRuntimeKeyframes`: that returns a flat read for any property-bearing
 * tween, so it can't distinguish a real animation from a leftover hold/marker.
 * The drag's stale-parse guard needs this exact distinction — after a delete-all
 * only a hold may remain, and resurrecting the deleted tween from the stale parse
 * must be avoided.
 */
export function hasNonHoldTweenForElement(
  iframe: HTMLIFrameElement | null,
  selector: string,
  compositionId?: string,
): boolean {
  const timelines = timelinesOf(iframe);
  if (!timelines) return false;
  const tlId =
    compositionId ||
    Object.keys(timelines).find((k) => typeof timelines[k]?.getChildren === "function");
  if (!tlId) return false;
  const timeline = timelines[tlId];
  if (!timeline?.getChildren) return false;

  let targetEl: Element | null = null;
  try {
    targetEl = iframe?.contentDocument?.querySelector(selector) ?? null;
  } catch {
    return false;
  }
  if (!targetEl) return false;

  for (const tween of timeline.getChildren(true)) {
    if (!tween.vars || !matchesElement(tween, targetEl)) continue;
    const dur = typeof tween.duration === "function" ? tween.duration() : 0;
    if (isZeroDurationSet(dur)) continue; // skip hold/set tweens (see isZeroDurationSet)
    if (readTween(tween.vars)) return true;
  }
  return false;
}

/** Convert tween-relative keyframes to clip-relative % using the element's clip dims. */
function toClipRelative(
  keyframes: Pct[],
  tweenStart: number,
  tweenDuration: number,
  clip: { start: number; duration: number } | undefined,
): Pct[] {
  if (!clip || clip.duration <= 0) return keyframes;
  return keyframes.map((kf) => {
    const abs = toAbsoluteTime(tweenStart, tweenDuration, kf.percentage);
    return { ...kf, percentage: Math.round(((abs - clip.start) / clip.duration) * 100000) / 1000 };
  });
}

function buildEntry(
  read: ReadTween,
  start: number,
  duration: number,
  clip: { start: number; duration: number } | undefined,
): RuntimeKeyframeEntry {
  return {
    keyframes: toClipRelative(read.keyframes, start, duration, clip),
    tweenStart: start,
    tweenDuration: duration,
    ...(read.easeEach ? { easeEach: read.easeEach } : {}),
    ...(read.arcPath ? { arcPath: read.arcPath } : {}),
  };
}

/** Record one tween's keyframes under each target id (first-tween-per-id wins). */
function addScanEntry(
  result: Map<string, RuntimeKeyframeEntry>,
  tween: RuntimeTween,
  clipById?: ClipDims,
): void {
  if (!tween.targets || !tween.vars) return;
  const { start, duration } = tweenTiming(tween);
  if (isZeroDurationSet(duration)) return; // skip hold/set tweens (see isZeroDurationSet)
  const read = readTween(tween.vars);
  if (!read) return;
  for (const target of tween.targets()) {
    const id = (target as HTMLElement).id;
    if (id && !result.has(id)) result.set(id, buildEntry(read, start, duration, clipById?.get(id)));
  }
}

/**
 * Scan every live tween, grouping keyframes by element id. Percentages are
 * tween-relative unless `clipById` is supplied, in which case each entry's
 * keyframes are converted to clip-relative. First keyframe-bearing tween per
 * element wins (the common single-primary-tween case).
 */
export function scanAllRuntimeKeyframes(
  iframe: HTMLIFrameElement | null,
  clipById?: ClipDims,
): Map<string, RuntimeKeyframeEntry> {
  const result = new Map<string, RuntimeKeyframeEntry>();
  const timelines = timelinesOf(iframe);
  if (!timelines) return result;
  for (const timeline of Object.values(timelines)) {
    if (!timeline?.getChildren) continue;
    for (const tween of timeline.getChildren(true)) addScanEntry(result, tween, clipById);
  }
  return result;
}
