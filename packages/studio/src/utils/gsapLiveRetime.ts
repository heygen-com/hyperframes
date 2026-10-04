import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { parseGsapScriptAcorn } from "@hyperframes/core/gsap-parser-acorn";
import { findGsapScriptElements, scriptsRegistering, timelineKeys } from "./gsapSoftReload";

/** A tween of the saved script, with where it sat before the edit and where it sits now. */
interface TweenTiming {
  selector: string;
  start: number;
  duration: number;
  moved: boolean;
  /** Its place in the script, which is the order a fresh run adds it to the timeline. */
  source: number;
}

/**
 * How a saved script differs from the live one. `retime`: only tween starts and lengths moved,
 * so the live tweens can be moved in place; `tweens` is in the live timeline's child order.
 * `rerun`: anything else, which only re-running the script reproduces.
 */
export type LiveRetimePlan =
  | { kind: "retime"; key: string; after: string; tweens: TweenTiming[] }
  | { kind: "rerun" };

const RERUN: LiveRetimePlan = { kind: "rerun" };

/** Everything about a tween except where it sits and how long it runs. */
function shape(animation: GsapAnimation): string {
  const { id: _id, position: _p, resolvedStart: _s, duration: _d, ...rest } = animation;
  return JSON.stringify(rest);
}

const onTimeline = (animation: GsapAnimation) => !animation.global;

/** Decides, from the two scripts alone, whether a saved edit moved tweens and nothing else. */
export function planLiveRetime(before: string, after: string): LiveRetimePlan {
  const keys = timelineKeys(after);
  if (keys.length !== 1 || timelineKeys(before).join() !== keys.join()) return RERUN;
  const was = parseGsapScriptAcorn(before).animations.filter(onTimeline);
  const now = parseGsapScriptAcorn(after).animations.filter(onTimeline);
  if (was.length !== now.length) return RERUN;
  const tweens: (TweenTiming & { was: number })[] = [];
  for (const [index, next] of now.entries()) {
    const prev = was[index]!;
    if (shape(prev) !== shape(next)) return RERUN;
    if (typeof next.resolvedStart !== "number" || typeof prev.resolvedStart !== "number") {
      return RERUN;
    }
    const duration = next.duration ?? 0;
    const moved = next.resolvedStart !== prev.resolvedStart || duration !== (prev.duration ?? 0);
    tweens.push({
      selector: next.targetSelector,
      start: next.resolvedStart,
      duration,
      moved,
      source: index,
      was: prev.resolvedStart,
    });
  }
  // A GSAP timeline keeps its children sorted by start, an equal start after the earlier one: pair in that order.
  const live = tweens.map((t, i) => ({ t, i })).sort((x, y) => x.t.was - y.t.was || x.i - y.i);
  return {
    kind: "retime",
    key: keys[0]!,
    after,
    tweens: live.map(({ t: { was: _was, ...t } }) => t),
  };
}

/** Plans against the script the preview is running now; `rerun` when no single live script owns the timeline. */
export function planLiveRetimeFromPreview(
  iframe: HTMLIFrameElement | null,
  after: string,
): LiveRetimePlan {
  const doc = iframe?.contentDocument;
  const [key] = timelineKeys(after);
  if (!doc || !key) return RERUN;
  const live = scriptsRegistering(findGsapScriptElements(doc), [key]);
  return live.length === 1 ? planLiveRetime(live[0]!.textContent ?? "", after) : RERUN;
}

interface LiveTween {
  duration: (value?: number) => number;
  targets?: () => unknown[];
}
interface LiveTimeline {
  getChildren: (nested: boolean, tweens: boolean, timelines: boolean) => LiveTween[];
  remove: (child: LiveTween) => unknown;
  add: (child: LiveTween, position: number) => unknown;
}

const targetsMatch = (tween: LiveTween, selector: string) => {
  const targets = tween.targets?.() ?? [];
  try {
    return targets.length > 0 && targets.every((t) => (t as Element).matches?.(selector) === true);
  } catch {
    return false; // not a selector the DOM can read
  }
};

/**
 * Moves the live tweens a `retime` plan names and records the saved script as the live one.
 * Returns the reason when the live timeline does not pair one-to-one with the saved script.
 */
export function applyLiveRetime(
  iframe: HTMLIFrameElement | null,
  plan: Extract<LiveRetimePlan, { kind: "retime" }>,
): string | null {
  const win = iframe?.contentWindow as { __timelines?: Record<string, unknown> } | null;
  const doc = iframe?.contentDocument;
  const timeline = win?.__timelines?.[plan.key] as LiveTimeline | undefined;
  if (!doc || typeof timeline?.getChildren !== "function") return `no live timeline "${plan.key}"`;
  const [script, ...extra] = scriptsRegistering(findGsapScriptElements(doc), [plan.key]);
  if (!script || extra.length > 0)
    return `${extra.length + (script ? 1 : 0)} scripts register "${plan.key}"`;
  // Paired before anything moves: moving a tween re-sorts the timeline's children.
  const children = timeline.getChildren(false, true, true);
  if (children.length !== plan.tweens.length) {
    return `${children.length} live tweens for ${plan.tweens.length} in the script`;
  }
  const unpaired = plan.tweens.findIndex((t, i) => !targetsMatch(children[i]!, t.selector));
  if (unpaired >= 0)
    return `live tween ${unpaired} does not target ${plan.tweens[unpaired]!.selector}`;
  if (!plan.tweens.some((t) => t.moved)) {
    script.textContent = plan.after;
    return null;
  }
  // Re-added in script order: GSAP orders equal starts by when they were added, as a fresh run does.
  const bySource = plan.tweens
    .map((t, i) => ({ ...t, tween: children[i]! }))
    .sort((a, b) => a.source - b.source);
  for (const { tween } of bySource) timeline.remove(tween);
  for (const { tween, start, duration } of bySource) {
    if (tween.duration() !== duration) tween.duration(duration);
    timeline.add(tween, start);
  }
  // A script element runs once, so this only keeps the next comparison honest; nothing re-executes.
  script.textContent = plan.after;
  return null;
}
