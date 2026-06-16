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

interface RuntimeTween {
  targets?: () => Element[];
  vars?: Record<string, unknown>;
  duration?: () => number;
  startTime?: () => number;
}

interface RuntimeTimeline {
  getChildren?: (deep: boolean) => RuntimeTween[];
  duration?: () => number;
}

type Pct = { percentage: number; properties: Record<string, number | string> };
type ReadTween = { keyframes: Pct[]; easeEach?: string; arcPath?: ArcPathConfig };

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
  const tlId = compositionId || Object.keys(timelines)[0];
  if (!tlId) return null;
  const timeline = timelines[tlId];
  if (!timeline?.getChildren) return null;

  let targetEl: Element | null = null;
  try {
    targetEl = iframe?.contentDocument?.querySelector(selector) ?? null;
  } catch {
    return null;
  }
  if (!targetEl) return null;

  for (const tween of timeline.getChildren(true)) {
    if (!tween.vars || !matchesElement(tween, targetEl)) continue;
    const read = readTween(tween.vars);
    if (read) return read;
  }
  return null;
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
  const read = readTween(tween.vars);
  if (!read) return;
  const { start, duration } = tweenTiming(tween);
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
