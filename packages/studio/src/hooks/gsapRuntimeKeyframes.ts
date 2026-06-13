/**
 * Read GSAP keyframe data from the live runtime in the preview iframe.
 * Used to discover dynamic keyframes that the AST parser can't resolve
 * (loops, variables, computed selectors).
 */
import { parsePercentageKeyframes } from "./gsapShared";
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

export function readRuntimeKeyframes(
  iframe: HTMLIFrameElement | null,
  selector: string,
  compositionId?: string,
): {
  keyframes: Array<{ percentage: number; properties: Record<string, number | string> }>;
  easeEach?: string;
} | null {
  if (!iframe?.contentWindow) return null;

  let timelines: Record<string, RuntimeTimeline | undefined> | undefined;
  try {
    timelines = (
      iframe.contentWindow as unknown as { __timelines?: Record<string, RuntimeTimeline> }
    ).__timelines;
  } catch {
    return null;
  }
  if (!timelines) return null;

  const tlId = compositionId || Object.keys(timelines)[0];
  if (!tlId) return null;
  const timeline = timelines[tlId];
  if (!timeline?.getChildren) return null;

  let doc: Document | null = null;
  try {
    doc = iframe.contentDocument;
  } catch {
    return null;
  }
  if (!doc) return null;

  const targetEl = doc.querySelector(selector);
  if (!targetEl) return null;

  for (const tween of timeline.getChildren(true)) {
    if (!tween.targets || !tween.vars) continue;
    let matches = false;
    for (const t of tween.targets()) {
      if (t === targetEl || (targetEl.id && t.id === targetEl.id)) {
        matches = true;
        break;
      }
    }
    if (!matches) continue;

    const vars = tween.vars;
    if (!vars.keyframes || typeof vars.keyframes !== "object") continue;

    const parsed = parsePercentageKeyframes(vars.keyframes as Record<string, unknown>);
    if (parsed) return parsed;
  }
  return null;
}

// fallow-ignore-next-line complexity
export function scanAllRuntimeKeyframes(iframe: HTMLIFrameElement | null): Map<
  string,
  {
    keyframes: Array<{ percentage: number; properties: Record<string, number | string> }>;
    easeEach?: string;
  }
> {
  const result = new Map<
    string,
    {
      keyframes: Array<{ percentage: number; properties: Record<string, number | string> }>;
      easeEach?: string;
    }
  >();
  if (!iframe?.contentWindow) return result;

  let timelines: Record<string, RuntimeTimeline | undefined> | undefined;
  try {
    timelines = (
      iframe.contentWindow as unknown as { __timelines?: Record<string, RuntimeTimeline> }
    ).__timelines;
  } catch {
    return result;
  }
  if (!timelines) return result;

  for (const timeline of Object.values(timelines)) {
    if (!timeline?.getChildren) continue;
    const tlDuration = typeof timeline.duration === "function" ? timeline.duration() : 0;

    for (const tween of timeline.getChildren(true)) {
      if (!tween.targets || !tween.vars) continue;
      const vars = tween.vars;

      if (vars.keyframes && typeof vars.keyframes === "object") {
        const parsed = parsePercentageKeyframes(vars.keyframes as Record<string, unknown>);
        if (parsed) {
          for (const target of tween.targets()) {
            const id = (target as HTMLElement).id;
            if (id && !result.has(id)) {
              result.set(id, parsed);
            }
          }
          continue;
        }
      }

      // Flat tweens: synthesize start + end keyframe entries
      if (!tlDuration || tlDuration <= 0) continue;
      const tweenStart = typeof tween.startTime === "function" ? tween.startTime() : undefined;
      if (typeof tweenStart !== "number" || !Number.isFinite(tweenStart)) continue;
      const tweenDur = typeof tween.duration === "function" ? tween.duration() : 0;

      const startPct = Math.round((tweenStart / tlDuration) * 1000) / 10;
      const endPct =
        tweenDur > 0 ? Math.round(((tweenStart + tweenDur) / tlDuration) * 1000) / 10 : startPct;
      const properties: Record<string, number | string> = {};
      const skip = new Set([
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
      ]);
      for (const [k, v] of Object.entries(vars)) {
        if (skip.has(k)) continue;
        if (typeof v === "number") properties[k] = roundTo3(v);
        else if (typeof v === "string") properties[k] = v;
      }
      if (Object.keys(properties).length === 0) continue;

      for (const target of tween.targets()) {
        const id = (target as HTMLElement).id;
        if (!id) continue;
        const existing = result.get(id);
        const entries = existing ?? { keyframes: [] };
        entries.keyframes.push({ percentage: startPct, properties });
        if (endPct !== startPct) {
          entries.keyframes.push({ percentage: endPct, properties });
        }
        if (!existing) result.set(id, entries);
      }
    }
  }

  for (const entry of result.values()) {
    entry.keyframes.sort((a, b) => a.percentage - b.percentage);
  }
  return result;
}
