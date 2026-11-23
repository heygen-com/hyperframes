import { animationValues, type AnimationValues } from "./timelineValues";
import { createRuntimeStartTimeResolver } from "./startResolver";
import { findRootCompositionElement } from "./compositionDimension";
import { readElementRateSpec, readMediaStart } from "./playbackRate";
import { timeAtSourceTime } from "../speedRamp";
import type { ElementRef, Target } from "./inspectionTypes";
import { isElementNode } from "./domRealm";
export interface TimelineRequest {
  component?: Target;
  at?: number;
  range?: [number, number];
  boundary?: number;
  generation?: string;
  offset?: number;
}
export interface TimedAnimation {
  parent?: TimedAnimation;
  timeline?: TimedAnimation;
  _ease?: (progress: number) => number;
  vars?: Record<string, unknown>;
  targets?: () => unknown[];
  getChildren?: (nested: boolean, tweens: boolean, timelines: boolean) => TimedAnimation[];
  startTime(): number;
  duration(): number;
  totalDuration?(): number;
  timeScale?(): number;
  repeat?(): number;
  repeatDelay?(): number;
  yoyo?(): boolean;
  paused?(): boolean;
}
export interface Interval {
  start: number;
  end: number;
}
function classify(interval: Interval, q: TimelineRequest): string | null {
  const { start, end } = interval;
  const near = (a: number, b: number) => Math.abs(a - b) <= 1e-7;
  const before = (a: number, b: number) => a < b && !near(a, b);
  const beforeOrAt = (a: number, b: number) => a < b || near(a, b);
  if (q.boundary != null) {
    const t = q.boundary;
    if (near(start, end) && near(start, t)) return "instant";
    if (near(start, t)) return "starts";
    if (near(end, t)) return "ends";
    return start < t && end > t ? "crosses" : null;
  }
  if (q.at != null)
    return near(start, end)
      ? near(start, q.at)
        ? "instant"
        : null
      : beforeOrAt(start, q.at) && before(q.at, end)
        ? "active"
        : null;
  if (q.range)
    return near(start, end)
      ? beforeOrAt(q.range[0], start) && before(start, q.range[1])
        ? "instant"
        : null
      : before(start, q.range[1]) && before(q.range[0], end)
        ? "intersects"
        : null;
  return near(start, end) ? "instant" : "scheduled";
}
// Convert a local interval into occurrences in an animation's total-time clock.
function cycles(a: TimedAnimation, input: Interval[], warnings: Set<string>): Interval[] {
  const d = a.duration(),
    repeat = a.repeat?.() ?? 0,
    gap = a.repeatDelay?.() ?? 0;
  if (repeat < 0 || repeat > 1000) {
    warnings.add("Infinite or >1000 repeats are not expanded; timing incomplete.");
    return [];
  }
  const result: Interval[] = [];
  for (let cycle = 0; cycle <= repeat; cycle++)
    for (const interval of input) {
      const start = Math.max(0, interval.start),
        end = Math.min(d, interval.end);
      if (end < start) continue;
      const reverse = !!a.yoyo?.() && cycle % 2 === 1;
      result.push({
        start: cycle * (d + gap) + (reverse ? d - end : start),
        end: cycle * (d + gap) + (reverse ? d - start : end),
      });
      if (result.length >= 10000) {
        warnings.add("Occurrence expansion limit reached; timing incomplete.");
        return result;
      }
    }
  return result;
}
function globalIntervals(
  a: TimedAnimation,
  root: TimedAnimation,
  warnings: Set<string>,
  activity: Interval[] = [{ start: 0, end: a.duration() }],
): Interval[] {
  let intervals = cycles(a, activity, warnings);
  let node = a;
  const seen = new Set<TimedAnimation>();
  while (node !== root) {
    if (seen.has(node) || !node.parent) {
      warnings.add("Animation is not attached to a registered root; global time unknown.");
      return [];
    }
    seen.add(node);
    const scale = node.timeScale?.() ?? 1;
    if (node.paused?.() || !scale) {
      warnings.add("Paused or zero-speed nested animation excluded; activation is unknown.");
      return [];
    }
    const total = node.totalDuration?.() ?? node.duration();
    intervals = intervals.map((i) => {
      const x = node.startTime() + (scale < 0 ? (total - i.end) / -scale : i.start / scale);
      const y = node.startTime() + (scale < 0 ? (total - i.start) / -scale : i.end / scale);
      return { start: x, end: y };
    });
    node = node.parent;
    intervals = cycles(node, intervals, warnings);
  }
  return intervals;
}
export interface TimelineEvent extends Interval {
  kind: "animation" | "item";
  relation: string;
  component: ElementRef | null;
  targets: ElementRef[];
  properties: string[];
  values?: AnimationValues;
  stack: string | null;
}
export interface TimelineRuntimeResult {
  status: string;
  candidates: ElementRef[];
  events: TimelineEvent[];
  warnings: string[];
}
export function inspectTimelineRuntime(
  q: TimelineRequest,
  roots: TimedAnimation[],
  scope: Element,
  describe: (el: Element) => ElementRef,
  origin: (a: TimedAnimation) => string | null,
  reserved: Set<string>,
  registry: Record<string, TimedAnimation>,
): TimelineRuntimeResult {
  const warnings = new Set<string>();
  const events: TimelineEvent[] = [];
  const seen = new Set<TimedAnimation>();
  const resolver = createRuntimeStartTimeResolver({
    timelineRegistry: registry,
    documentRef: scope.ownerDocument,
    includeAuthoredTimingAttrs: true,
  });
  const rootElement = findRootCompositionElement(scope.ownerDocument);
  const clocks = new Map<TimedAnimation, Element>();
  for (const [id, timeline] of Object.entries(registry)) {
    const host = scope.ownerDocument.querySelector(`[data-composition-id="${CSS.escape(id)}"]`);
    if (host) clocks.set(timeline, host);
  }
  const clockFor = (animation: TimedAnimation, fallback: TimedAnimation) => {
    const visited = new Set<TimedAnimation>();
    let node: TimedAnimation | undefined = animation;
    while (node && !visited.has(node)) {
      if (clocks.has(node)) return node;
      visited.add(node);
      node = node.parent;
    }
    return fallback;
  };
  const toProjectTime = (clock: TimedAnimation, intervals: Interval[]): Interval[] => {
    const host = clocks.get(clock);
    if (!host || host === rootElement) return intervals;
    const start = resolver.resolveStartForElement(host, 0);
    const offset = readMediaStart(host);
    const rate = readElementRateSpec(host);
    if (!Number.isFinite(start)) {
      warnings.add("Composition start could not be resolved; timing incomplete.");
      return [];
    }
    return intervals
      .filter((interval) => interval.end >= offset)
      .map((interval) => ({
        start: start + timeAtSourceTime(rate, Math.max(0, interval.start - offset)),
        end: start + timeAtSourceTime(rate, interval.end - offset),
      }));
  };
  const component = (el: Element) =>
    describe(q.component ? scope : (el.closest("[data-composition-id]") ?? scope));
  for (const root of roots)
    for (const a of root.getChildren?.(true, true, false) ?? []) {
      if (events.length >= 10000) {
        warnings.add("Global event limit reached; narrow component/time query. Timing incomplete.");
        break;
      }
      if (seen.has(a)) continue;
      seen.add(a);
      const clock = clockFor(a, root);
      const internal = a.timeline;
      if (
        internal &&
        a._ease &&
        [0, 0.25, 0.5, 0.75, 1].some((t) => Math.abs(a._ease!(t) - t) > 1e-7)
      ) {
        warnings.add("Nonlinear internal timeline easing is not mapped; timing incomplete.");
        continue;
      }
      const pieces = internal?.getChildren?.(true, true, false) ?? [a];
      for (const piece of pieces) {
        const targets = (piece.targets?.() ?? []).filter(isElementNode);
        if (!targets.some((el) => scope === el || scope.contains(el))) continue;
        const properties = Object.keys(piece.vars ?? {}).filter(
          (k) => !reserved.has(k) && !k.startsWith("on"),
        );
        const values = animationValues(
          piece.vars ?? {},
          properties,
          internal && a.vars?.keyframes ? a.vars.ease : undefined,
        );
        const localIntervals = internal
          ? globalIntervals(
              a,
              clock,
              warnings,
              globalIntervals(piece, internal, warnings).map((i) => {
                const scale = internal.duration() ? a.duration() / internal.duration() : 1;
                return { start: i.start * scale, end: i.end * scale };
              }),
            )
          : globalIntervals(a, clock, warnings);
        const intervals = toProjectTime(clock, localIntervals);
        for (const interval of intervals) {
          if (events.length >= 10000) {
            warnings.add("Global event limit reached; timing incomplete.");
            break;
          }
          const relation = classify(interval, q);
          if (!relation) continue;
          for (const owner of new Set(
            targets
              .filter((el) => scope === el || scope.contains(el))
              .map((el) => (q.component ? scope : (el.closest("[data-composition-id]") ?? scope))),
          )) {
            const stack = origin(a);
            const existing = events.find(
              (e) =>
                e.kind === "animation" &&
                e.stack === stack &&
                stack !== null &&
                e.start === interval.start &&
                e.end === interval.end &&
                e.component?.ref === describe(owner).ref &&
                e.properties.join() === properties.join() &&
                JSON.stringify(e.values) === JSON.stringify(values),
            );
            if (existing) {
              for (const target of targets.map(describe))
                if (!existing.targets.some((t) => t.ref === target.ref))
                  existing.targets.push(target);
            } else
              events.push({
                ...interval,
                kind: "animation",
                relation,
                component: describe(owner),
                targets: targets.map(describe),
                properties,
                values,
                stack,
              });
          }
        }
      }
    }
  for (const el of [
    scope,
    ...scope.querySelectorAll("[data-start],[data-duration],[data-end],[data-composition-id]"),
  ]) {
    if (!el.matches("[data-start],[data-duration],[data-end],[data-composition-id]")) continue;
    const media = el.tagName === "AUDIO" || el.tagName === "VIDEO";
    const start = media
      ? resolver.resolveMediaStartForElement(el)
      : resolver.resolveStartForElement(el, Number.NaN);
    const duration = resolver.resolveDurationForElement(el);
    if (!Number.isFinite(start) || duration == null || !Number.isFinite(duration) || duration < 0) {
      warnings.add("Some HF item timing could not be resolved.");
      continue;
    }
    const interval = { start, end: start + duration };
    const relation = classify(interval, q);
    if (!relation) continue;
    events.push({
      ...interval,
      kind: "item",
      relation,
      component: component(el),
      targets: [describe(el)],
      properties: [],
      stack: null,
    });
  }
  events.sort((a, b) => a.start - b.start || a.end - b.end);
  return { status: "found", candidates: [describe(scope)], events, warnings: [...warnings] };
}
