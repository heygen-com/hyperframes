// A saved timing edit that only moved tweens moves the live ones instead of re-running the script.
// Studio plans the move from the saved scripts; the frame checks its timeline matches the plan first.
import { RUNTIME_FILLER } from "../protocol";
import {
  applyTimingPlan,
  compositionFile,
  finalizeSoftReload,
  findGsapScriptElements,
  parseSavedTiming,
  planSavedTiming,
  scriptsRegistering,
  swapWaiting,
  type SavedTiming,
  type SoftReloadWindow,
} from "./softReload";

export interface TweenTiming {
  selector: string;
  start: number;
  duration: number;
  wasStart: number;
  wasDuration: number;
  moved: boolean;
  /** Its place in the script, which is the order a fresh run adds it to the timeline. */
  source: number;
}

/** A move planned from the saved scripts: `tweens` in the live timeline's child order. */
export type RetimePlan = { key: string; after: string; tweens: TweenTiming[] };

interface LiveTween {
  duration: (value?: number) => number;
  startTime: () => number;
  delay: () => number;
  repeatDelay?: () => number;
  data?: unknown;
  targets?: () => unknown[];
}
interface LiveTimeline {
  getChildren(nested: boolean, tweens: true, timelines: false): LiveTween[];
  getChildren(nested: false, tweens: false, timelines: true): LiveTimeline[];
  remove: (child: LiveTween) => unknown;
  add: (child: LiveTween, position: number) => unknown;
  time: () => number;
  progress: (value: number, suppressEvents: boolean) => unknown;
  totalTime: (time: number, suppressEvents: boolean) => unknown;
}

const same = (a: number, b: number) => Math.abs(a - b) < 1e-6;

const targetsMatch = (tween: LiveTween, selector: string) => {
  const targets = tween.targets?.() ?? [];
  try {
    return targets.length > 0 && targets.every((t) => (t as Element).matches?.(selector) === true);
  } catch {
    return false;
  }
};

/** The live tweens, one per planned tween, when each sits exactly where the parser says it did. */
function pairedLiveTweens(timeline: LiveTimeline, plan: RetimePlan): LiveTween[] | null {
  // The script's tweens only: the runtime also nests sub-composition timelines and adds filler tweens here.
  const children = timeline
    .getChildren(false, true, false)
    .filter((tween) => tween.data !== RUNTIME_FILLER);
  if (children.length !== plan.tweens.length) return null;
  const paired = plan.tweens.every((t, i) => {
    const live = children[i]!;
    return (
      targetsMatch(live, t.selector) &&
      same(live.startTime() - live.delay(), t.wasStart) &&
      same(live.duration(), t.wasDuration)
    );
  });
  return paired ? children : null;
}

/** The writer rounds every time it writes to 3 decimals. */
const near = (a: number, b: number) => Math.abs(a - b) <= 2e-3;

/** One stretch for every tween (start = shift + stretch × old start, length = stretch × old length), in old order. */
function sharesOneStretch(tweens: TweenTiming[]): boolean {
  const first = tweens[0]!;
  const last = tweens.at(-1)!;
  const longest = tweens.reduce((x, y) => (y.wasDuration > x.wasDuration ? y : x));
  const spread = last.wasStart - first.wasStart;
  // Taken over the widest span, so the writer's rounding cannot push it past `near`.
  const stretch =
    spread > longest.wasDuration
      ? (last.start - first.start) / spread
      : longest.wasDuration > 0
        ? longest.duration / longest.wasDuration
        : 1;
  const fits = tweens.every(
    (t) =>
      near(t.start, first.start + stretch * (t.wasStart - first.wasStart)) &&
      near(t.duration, stretch * t.wasDuration),
  );
  return stretch > 0 && fits;
}

/** Tweens on one element still start in the order they did, an equal start in script order. */
const keepsOrder = (tweens: TweenTiming[]) =>
  tweens.every(
    (t, k) => k === 0 || (tweens[k - 1]!.start - t.start || tweens[k - 1]!.source - t.source) < 0,
  );

/**
 * A tween keeps the start values it recorded when it first played, so every element a move touches
 * must keep its tweens' spacing, and no timeline the script does not own may animate it.
 */
function movesKeepEachElementsHistory(
  timeline: LiveTimeline,
  plan: RetimePlan,
  children: LiveTween[],
  registry: unknown[],
): boolean {
  const byElement = new Map<unknown, number[]>();
  children.forEach((child, i) => {
    for (const target of child.targets?.() ?? []) {
      const indexes = byElement.get(target);
      if (indexes) indexes.push(i);
      else byElement.set(target, [i]);
    }
  });
  const moved = new Set<unknown>();
  for (const [target, indexes] of byElement) {
    if (!indexes.some((i) => plan.tweens[i]!.moved)) continue;
    const tweens = indexes.map((i) => plan.tweens[i]!);
    // GSAP adds delays to the schedule unstretched; a shift keeps every length.
    const shifted = tweens.every((t) => t.duration === t.wasDuration);
    const undelayed = indexes.every((i) => !children[i]!.delay() && !children[i]!.repeatDelay?.());
    if (!keepsOrder(tweens) || !sharesOneStretch(tweens) || !(shifted || undelayed)) return false;
    moved.add(target);
  }
  return !animatedElsewhere(timeline, registry, moved);
}

/** Whether a timeline other than `own` (nested in it, or another registered one) animates any of `targets`. */
function animatedElsewhere(own: LiveTimeline, registry: unknown[], targets: Set<unknown>): boolean {
  const seen = new Set<unknown>([own]);
  const visit = (timeline: LiveTimeline): boolean => {
    if (seen.has(timeline)) return false;
    seen.add(timeline);
    return (
      timeline
        .getChildren(false, true, false)
        .some((tween) => tween.targets?.().some((target) => targets.has(target))) ||
      timeline.getChildren(false, false, true).some(visit)
    );
  };
  const timelines = registry.filter(
    (entry): entry is LiveTimeline => typeof (entry as LiveTimeline)?.getChildren === "function",
  );
  return own.getChildren(false, false, true).some(visit) || timelines.some(visit);
}

/**
 * Moves the live tweens `plan` names and records the saved script as `script`'s text.
 * False, with nothing changed, when the live timeline is not exactly what the plan read.
 */
export function retimeLiveTweens(
  win: { __timelines?: Record<string, unknown> } | null,
  script: HTMLScriptElement,
  plan: RetimePlan,
): boolean {
  const timeline = win?.__timelines?.[plan.key] as LiveTimeline | undefined;
  if (typeof timeline?.getChildren !== "function") return false;
  // Paired before anything moves: moving a tween re-sorts the timeline's children.
  const children = pairedLiveTweens(timeline, plan);
  if (!children) return false;
  if (plan.tweens.some((t) => t.moved)) {
    const registry = Object.values(win?.__timelines ?? {});
    if (!movesKeepEachElementsHistory(timeline, plan, children, registry)) return false;
    // Re-added in script order: GSAP orders equal starts by when they were added, as a fresh run does.
    const bySource = plan.tweens
      .map((t, i) => ({ ...t, tween: children[i]! }))
      .sort((a, b) => a.source - b.source);
    for (const { tween } of bySource) timeline.remove(tween);
    for (const { tween, start, duration } of bySource) {
      if (tween.duration() !== duration) tween.duration(duration);
      timeline.add(tween, start);
    }
    // Replayed to the playhead as the runtime binds a fresh load, callbacks included.
    const at = timeline.time();
    timeline.progress(0.0001, true);
    timeline.totalTime(at, false);
  }
  // A script element runs once, so this only keeps the next comparison honest; nothing re-executes.
  script.textContent = plan.after;
  return true;
}

/** `timing`: the saved file's clip and film timing, which no commit could patch into a sealed frame. */
export type LiveRetimeParams = RetimePlan & { time: number; timing: SavedTiming };
/** "unchanged": nothing moved, so only a re-run syncs it; "failed": the preview may be half-moved. */
export type LiveRetimeResult = "moved" | "unchanged" | "failed";

const MAX_TWEENS = 1_000;
const MAX_KEY = 512;
const MAX_SELECTOR = 2_000;
const MAX_SCRIPT = 1_000_000;
const TIMING_FIELDS = "duration,moved,selector,source,start,wasDuration,wasStart";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Object.prototype.toString.call(value) === "[object Object]";
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const okSelector = (selector: unknown): boolean =>
  typeof selector === "string" && selector.length > 0 && selector.length <= MAX_SELECTOR;
const okSource = (source: unknown): boolean => Number.isInteger(source) && (source as number) >= 0;

function okTimes({ start, duration, wasStart, wasDuration }: Record<string, unknown>): boolean {
  if (![start, duration, wasStart, wasDuration].every(finite)) return false;
  return (duration as number) >= 0 && (wasDuration as number) >= 0;
}

function parseTiming(value: unknown): TweenTiming | null {
  if (!isRecord(value) || Object.keys(value).sort().join() !== TIMING_FIELDS) return null;
  const ok =
    okSelector(value.selector) &&
    okTimes(value) &&
    okSource(value.source) &&
    typeof value.moved === "boolean";
  return ok ? (value as unknown as TweenTiming) : null;
}

export function parseLiveRetime(params: unknown): LiveRetimeParams | null {
  if (!isRecord(params) || Object.keys(params).sort().join() !== "after,key,time,timing,tweens")
    return null;
  const { key, after, time, tweens } = params;
  if (typeof key !== "string" || key.length === 0 || key.length > MAX_KEY) return null;
  if (typeof after !== "string" || after.length === 0 || after.length > MAX_SCRIPT) return null;
  if (!finite(time) || time < 0) return null;
  if (!Array.isArray(tweens) || tweens.length === 0 || tweens.length > MAX_TWEENS) return null;
  const parsed = tweens.map(parseTiming);
  const timing = parseSavedTiming(params.timing);
  if (!timing || !parsed.every(Boolean)) return null;
  return { key, after, time, tweens: parsed as TweenTiming[], timing };
}

/** The frame moving its own tweens to the plan Studio made from the saved scripts, then re-seeking. */
export function liveRetime(params: LiveRetimeParams): { result: LiveRetimeResult } {
  const win = window as SoftReloadWindow;
  if (swapWaiting(win)) return { result: "unchanged" };
  const [script, ...extra] = scriptsRegistering(findGsapScriptElements(document), [params.key]);
  if (!script || extra.length > 0) return { result: "unchanged" };
  const timing = planSavedTiming(document, compositionFile(document, [params.key]), params.timing);
  if (!timing) return { result: "failed" };
  try {
    if (!retimeLiveTweens(win, script, params)) return { result: "unchanged" };
    if (!win.__hfForceTimelineRebind) return { result: "failed" };
    const finalize = () => {
      applyTimingPlan(timing);
      finalizeSoftReload(win, params.time);
    };
    if (win.__hfSuppressSceneMutations) win.__hfSuppressSceneMutations(finalize);
    else finalize();
    return { result: "moved" };
  } catch (error) {
    console.error("[hyperframes] Moving the live tweens threw; a full reload follows", error);
    return { result: "failed" };
  }
}
