/**
 * HDR passthrough overlay planner.
 *
 * `analyzeOverlayTiming` reads the page once to derive every frame where the
 * overlay DOM can change; `planOverlayStates` turns that into ordered static
 * intervals. Splitting them keeps the interval math pure and unit-testable.
 */

import { fpsToNumber } from "@hyperframes/core";
import {
  computeAuthoredClipBoundaryFrames,
  computeStaticFrameSet,
  staticFramesFromAnimated,
  type StaticDedupIneligibleCause,
} from "@hyperframes/engine";
import type {
  AnalyzeOverlayTimingArgs,
  OverlayPlan,
  OverlayState,
  OverlayTimingAnalysis,
  PassthroughIneligibleReason,
  PlanOverlayStatesArgs,
} from "./types.js";

/**
 * Longest run of consecutive change frames accepted as "short" motion (a fade
 * or a caption pop-in), captured as one state per frame. Anything longer is
 * continuous animation and v1 declines it: per-frame capture of long motion is
 * the layered path's job. A lone clip cut or `set()` produces a run of 2-4.
 */
export const MAX_SHORT_ANIMATION_RUN_FRAMES = 15;

/**
 * Most frames the static analysis may disagree with the render's own frame
 * count by (float noise in `ceil(duration * fps)` against the probe's
 * epsilon-snapped count). Beyond it the analysis is not about this render.
 */
const MAX_FRAME_COUNT_DRIFT = 1;

/** Static-dedup causes that are not a problem once the video is excluded. */
const TOLERATED_CAUSES: ReadonlySet<StaticDedupIneligibleCause> = new Set([
  // Captions driven only by clip windows have no GSAP tweens at all. Static dedup
  // reads "no tweens" as "animated some other way"; the visible non-GSAP drivers
  // (CSS/WAAPI, canvas, frame sources, iframes) are still checked individually.
  "no_gsap_tweens",
]);

const CAUSE_REASONS: Record<StaticDedupIneligibleCause, PassthroughIneligibleReason> = {
  zero_duration: "analysis_limit",
  video: "video_count",
  canvas: "canvas",
  frame_source: "frame_source",
  iframe: "iframe",
  no_gsap_tweens: "overlay_non_gsap_animation",
  css_animation: "overlay_non_gsap_animation",
  timeline_call: "timeline_call",
  unresolvable_clip_start: "unresolvable_clip_start",
  frame_limit: "analysis_limit",
  interval_limit: "analysis_limit",
};

/** A clip window on the composition clock, as the runtime resolves it. */
export interface ResolvedClipWindow {
  start: number;
  /** `null` for an open-ended clip (the root). */
  end: number | null;
}

/** What `collectOverlayPageFacts` reads from the page. */
export interface OverlayPageFacts {
  /** `window.__hf.clipWindow` exists. */
  hasClipResolver: boolean;
  /** Resolved windows of every timed element except the passthrough video. */
  clipWindows: ResolvedClipWindow[];
  /** Timed elements (`[data-start]`) the runtime could not resolve a window for. */
  unresolvedClipIds: string[];
  /**
   * Reasons the engine's timeline walk cannot be trusted to place every tween
   * at its true composition time (sub-timelines placed at an offset under an
   * unregistered root, time scaling, tweens outside every registered timeline).
   */
  timelineProblems: string[];
}

/**
 * Runs in the page; must stay self-contained (it is serialized by
 * `page.evaluate`). Reads only; never seeks or mutates the DOM.
 *
 * The engine's tween walker visits each `window.__timelines` entry from offset
 * 0. That places a tween correctly only when some registered timeline on its
 * ancestor chain sits at composition time 0 with no time scaling in between;
 * the runtime can instead nest sub-composition timelines at their host's start
 * under an unregistered root. Those cases are reported, not corrected.
 */
// fallow-ignore-next-line complexity
function collectOverlayPageFacts(videoId: string): OverlayPageFacts {
  type Node = {
    parent?: Node | null;
    startTime?: () => number;
    totalDuration?: () => number;
    timeScale?: () => number;
    getChildren?: (nested: boolean, tweens: boolean, timelines: boolean) => Node[];
    targets?: () => unknown[];
  };
  const w = window as unknown as {
    __timelines?: Record<string, Node>;
    __hf?: { clipWindow?: (el: Element) => { start: number; end: number } | null };
    gsap?: { globalTimeline?: Node };
  };
  const EPS = 1e-6;
  const timelineProblems: string[] = [];
  const isTimeline = (n: Node | null | undefined): n is Node =>
    !!n && typeof n.getChildren === "function";
  const scaled = (n: Node) => {
    const ts = typeof n.timeScale === "function" ? n.timeScale() : 1;
    return Math.abs(ts - 1) > EPS;
  };
  const hasElementTarget = (n: Node): boolean => {
    const tweens = isTimeline(n) ? (n.getChildren?.(true, true, false) ?? []) : [n];
    return tweens.some((t) =>
      (typeof t.targets === "function" ? t.targets() : []).some(
        (target) =>
          !!target &&
          typeof target === "object" &&
          (target as { nodeType?: unknown }).nodeType === 1,
      ),
    );
  };

  const describe = (n: Node): string => {
    const tweens = isTimeline(n) ? (n.getChildren?.(true, true, false) ?? []) : [n];
    const ids = tweens.flatMap((t) =>
      (typeof t.targets === "function" ? t.targets() : []).map((target) => {
        const el = target as { id?: string; tagName?: string };
        return el.id ? `#${el.id}` : (el.tagName ?? "?").toLowerCase();
      }),
    );
    const span = typeof n.totalDuration === "function" ? n.totalDuration() : 0;
    const start = typeof n.startTime === "function" ? n.startTime() : 0;
    return `${[...new Set(ids)].slice(0, 3).join(" ")} at ${start.toFixed(3)}s for ${span.toFixed(3)}s`;
  };
  const globalTimeline = w.gsap?.globalTimeline ?? null;
  const registered = new Map<Node, string>();
  for (const [key, entry] of Object.entries(w.__timelines ?? {})) {
    // The runtime may register a proxy; identity checks need the GSAP timeline behind it.
    const tl = (entry as (Node & { __hfReal?: Node }) | undefined)?.__hfReal ?? entry;
    if (isTimeline(tl)) registered.set(tl, key);
  }
  // Registered timelines whose engine walk (from offset 0) lands at true composition time.
  const anchored = new Set<Node>();
  const roots = new Set<Node>();
  for (const [tl, key] of registered) {
    const chain: Node[] = [tl];
    for (let p = tl.parent; p && p !== globalTimeline; p = p.parent) chain.push(p);
    const root = chain[chain.length - 1] as Node;
    roots.add(root);
    // offsets[i]: chain[i]'s start on the root's clock (the clock the runtime seeks).
    const offsets: number[] = new Array<number>(chain.length).fill(0);
    let offset = 0;
    let unscaledBelow = true;
    for (let i = chain.length - 2; i >= 0; i--) {
      const node = chain[i] as Node;
      offset += typeof node.startTime === "function" ? node.startTime() : 0;
      offsets[i] = offset;
      if (scaled(node)) unscaledBelow = false;
    }
    if (!unscaledBelow) {
      timelineProblems.push(`timeline "${key}" is time-scaled`);
      continue;
    }
    for (let i = 0; i < chain.length; i++) {
      const node = chain[i] as Node;
      if (registered.has(node) && Math.abs(offsets[i] as number) < EPS) {
        for (let j = 0; j <= i; j++) anchored.add(chain[j] as Node);
        break;
      }
    }
    if (!anchored.has(tl)) {
      timelineProblems.push(
        `timeline "${key}" starts at ${(offsets[0] as number).toFixed(3)}s under an unregistered root`,
      );
    }
  }
  if (roots.size > 1) timelineProblems.push(`${roots.size} independent root timelines`);
  for (const root of roots) {
    for (const child of root.getChildren?.(true, true, true) ?? []) {
      if (scaled(child)) {
        timelineProblems.push("a nested tween or timeline is time-scaled");
        break;
      }
    }
    // A tween the engine walk never reaches (no anchored registered ancestor) is invisible to it.
    const stack: Node[] = [root];
    while (stack.length > 0) {
      const node = stack.pop() as Node;
      if (anchored.has(node)) continue;
      for (const child of node.getChildren?.(false, true, true) ?? []) {
        if (anchored.has(child)) continue;
        if (isTimeline(child)) stack.push(child);
        else if (hasElementTarget(child)) {
          timelineProblems.push(`a tween outside every registered timeline (${describe(child)})`);
          stack.length = 0;
          break;
        }
      }
    }
  }
  if (globalTimeline && isTimeline(globalTimeline)) {
    for (const child of globalTimeline.getChildren?.(false, true, true) ?? []) {
      if (roots.has(child) || registered.has(child)) continue;
      if (hasElementTarget(child)) {
        timelineProblems.push(
          `an unregistered GSAP animation targets the page (${describe(child)})`,
        );
        break;
      }
    }
  }

  const clipWindows: ResolvedClipWindow[] = [];
  const unresolvedClipIds: string[] = [];
  const resolve = w.__hf?.clipWindow;
  const hasClipResolver = typeof resolve === "function";
  if (hasClipResolver) {
    for (const el of Array.from(document.querySelectorAll("[data-start], [data-composition-id]"))) {
      if (el.id === videoId) continue;
      const win = resolve(el);
      if (!win || !Number.isFinite(win.start)) {
        if (el.hasAttribute("data-start"))
          unresolvedClipIds.push(el.id || el.tagName.toLowerCase());
        continue;
      }
      clipWindows.push({ start: win.start, end: Number.isFinite(win.end) ? win.end : null });
    }
  }
  return { hasClipResolver, clipWindows, unresolvedClipIds, timelineProblems };
}

/** The engine's static-frame analysis, reduced to what the planner reads. */
export interface StaticFrameFacts {
  totalFrames: number;
  causes: readonly StaticDedupIneligibleCause[];
  reason: string;
  animatedFrameSet: ReadonlySet<number>;
}

export interface DeriveOverlayTimingArgs {
  stats: StaticFrameFacts;
  page: OverlayPageFacts;
  /** Decimal frame rate, as the engine's analysis uses it. */
  fps: number;
  totalFrames: number;
  maxStates: number;
}

type Rejection = Extract<OverlayTimingAnalysis, { ok: false }>;

/** Disqualifiers that need no frame math: engine causes, then the page facts. */
function analysisVerdict(args: DeriveOverlayTimingArgs): Rejection | null {
  const { stats, page, totalFrames } = args;
  const firstBlocking = stats.causes.find((cause) => !TOLERATED_CAUSES.has(cause));
  if (firstBlocking) {
    return { ok: false, reason: CAUSE_REASONS[firstBlocking], detail: stats.reason };
  }
  if (!page.hasClipResolver) {
    return { ok: false, reason: "unresolvable_clip_start", detail: "runtime clipWindow missing" };
  }
  if (page.unresolvedClipIds.length > 0) {
    const detail = page.unresolvedClipIds.slice(0, 5).join(", ");
    return { ok: false, reason: "unresolvable_clip_start", detail };
  }
  if (page.timelineProblems.length > 0) {
    return { ok: false, reason: "analysis_limit", detail: page.timelineProblems.join("; ") };
  }
  if (!(totalFrames > 0) || Math.abs(stats.totalFrames - totalFrames) > MAX_FRAME_COUNT_DRIFT) {
    const detail = `analysed ${stats.totalFrames} frames, render has ${totalFrames}`;
    return { ok: false, reason: "analysis_limit", detail };
  }
  return null;
}

/** Engine-animated frames, plus resolved clip cuts and any frames past the analysed range. */
function animatedFrames(args: DeriveOverlayTimingArgs): Set<number> {
  const { stats, page, fps, totalFrames } = args;
  const animated = new Set(stats.animatedFrameSet);
  // Resolved windows place nested-composition clips on the composition clock;
  // the engine's own boundary scan reads raw `data-start` values. Use both.
  const windows = page.clipWindows.map(({ start, end }) => ({ start, end }));
  for (const f of computeAuthoredClipBoundaryFrames(windows, fps)) animated.add(f);
  // Frames past the analysed range were never looked at (tween ranges were
  // clamped to its last frame): treat them as moving.
  const firstUnseen =
    totalFrames > stats.totalFrames ? Math.max(0, stats.totalFrames - 1) : totalFrames;
  for (let f = firstUnseen; f < totalFrames; f++) animated.add(f);
  return animated;
}

/** Index of the first run of consecutive frames longer than `limit`, or -1. */
function firstLongRun(sortedFrames: readonly number[], limit: number): number {
  let runStart = 0;
  for (let i = 1; i <= sortedFrames.length; i++) {
    const contiguous =
      i < sortedFrames.length && sortedFrames[i] === (sortedFrames[i - 1] as number) + 1;
    if (contiguous) continue;
    if (i - runStart > limit) return runStart;
    runStart = i;
  }
  return -1;
}

/**
 * The pure half of `analyzeOverlayTiming`: verdicts and change frames from the
 * engine's static analysis plus the page facts.
 */
export function deriveOverlayTiming(args: DeriveOverlayTimingArgs): OverlayTimingAnalysis {
  const rejection = analysisVerdict(args);
  if (rejection) return rejection;
  const { totalFrames, maxStates } = args;
  const staticFrames = staticFramesFromAnimated(animatedFrames(args), totalFrames);
  const changeFrames: number[] = [];
  for (let f = 1; f < totalFrames; f++) if (!staticFrames.has(f)) changeFrames.push(f);

  const longRun = firstLongRun(changeFrames, MAX_SHORT_ANIMATION_RUN_FRAMES);
  if (longRun >= 0) {
    const detail = `overlay changes on every frame from ${changeFrames[longRun]} (more than ${MAX_SHORT_ANIMATION_RUN_FRAMES})`;
    return { ok: false, reason: "overlay_continuous_animation", detail };
  }
  const states = changeFrames.length + 1;
  if (states > maxStates) {
    return {
      ok: false,
      reason: "too_many_states",
      detail: `${states} overlay states (limit ${maxStates})`,
    };
  }
  return { ok: true, timing: { totalFrames, changeFrames } };
}

/**
 * Contract:
 *
 * Derive `OverlayTiming.changeFrames` statically, with the passthrough video
 * excluded, from the engine's static-frame analysis
 * (`computeStaticFrameSet(page, fps, [videoId])`: tween intervals, clip cuts
 * and the timeline-callback / canvas / iframe / frame-source / CSS-WAAPI /
 * analysis-limit disqualifiers) plus the runtime's resolved clip windows
 * (`window.__hf.clipWindow`, the window render and preview use).
 *
 * Rules:
 *   - A frame `f` in `[1, totalFrames)` is a change frame iff it is not
 *     static under the engine rule (`f` and `f - 1` both outside every tween
 *     range and clip-cut neighbourhood). Clip cuts claim `round(t * fps)` +/- 1,
 *     so the flip lands on a state start whether the frame clock rounds or
 *     floors.
 *   - Zero-duration tweens (`tl.set`) are discrete changes: allowed.
 *   - Tweens with duration are allowed while every run of consecutive change
 *     frames stays within `MAX_SHORT_ANIMATION_RUN_FRAMES` (each such frame
 *     becomes its own state); longer runs → `overlay_continuous_animation`.
 *   - More than `maxStates` resulting states → `too_many_states`.
 *
 * Never seeks or mutates the DOM, so the page stays where it was.
 */
export async function analyzeOverlayTiming(
  args: AnalyzeOverlayTimingArgs,
): Promise<OverlayTimingAnalysis> {
  const { page } = args.session;
  const fps = fpsToNumber(args.fps);
  const stats = await computeStaticFrameSet(page, fps, [args.videoId]);
  const facts = await page.evaluate(collectOverlayPageFacts, args.videoId);
  return deriveOverlayTiming({
    stats,
    page: facts,
    fps,
    totalFrames: args.totalFrames,
    maxStates: args.maxStates,
  });
}

/**
 * Contract (pure, synchronous):
 *
 * Splits `[0, timing.totalFrames)` at every `timing.changeFrames` entry into
 * half-open `OverlayState`s, in order, `index` 0..n-1, covering every frame
 * exactly once (see `OverlayPlan` invariants in types.ts). `captureFrame` is
 * `Math.floor((startFrame + endFrame - 1) / 2)`. Ignores change frames
 * outside `[1, totalFrames)` and duplicates. `totalFrames <= 0` → no states.
 * Does not dedupe by content; that happens after capture.
 */
export function planOverlayStates(args: PlanOverlayStatesArgs): OverlayPlan {
  const { timing, fps, width, height } = args;
  const totalFrames = Math.max(0, Math.floor(timing.totalFrames));
  const states: OverlayState[] = [];
  if (totalFrames > 0) {
    const cuts = [
      ...new Set(
        timing.changeFrames.filter((f) => Number.isInteger(f) && f >= 1 && f < totalFrames),
      ),
    ].sort((a, b) => a - b);
    let startFrame = 0;
    for (const endFrame of [...cuts, totalFrames]) {
      states.push({
        index: states.length,
        startFrame,
        endFrame,
        captureFrame: Math.floor((startFrame + endFrame - 1) / 2),
      });
      startFrame = endFrame;
    }
  }
  return { states, fps, totalFrames, width, height };
}
