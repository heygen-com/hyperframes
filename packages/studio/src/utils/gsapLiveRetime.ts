import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { parseGsapScriptAcorn } from "@hyperframes/core/gsap-parser-acorn";
import { RUNTIME_FILLER } from "@hyperframes/core/runtime/protocol";
import { findGsapScriptElements, scriptsRegistering, timelineKeys } from "./gsapSoftReload";

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

const RERUN = { kind: "rerun" } as const;

function untimedShape(animation: GsapAnimation): string {
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
    if (untimedShape(prev) !== untimedShape(next)) return RERUN;
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

export type LiveRetime = Extract<LiveRetimePlan, { kind: "retime" }> & {
  script: HTMLScriptElement;
};

/** Plans against the script the preview is running now; `rerun` when no single live script owns the timeline. */
export function planLiveRetimeFromPreview(
  iframe: HTMLIFrameElement | null,
  after: string,
): LiveRetime | typeof RERUN {
  const doc = iframe?.contentDocument;
  const [key] = timelineKeys(after);
  if (!doc || !key) return RERUN;
  const [script, ...extra] = scriptsRegistering(findGsapScriptElements(doc), [key]);
  if (!script || extra.length > 0) return RERUN;
  const plan = planLiveRetime(script.textContent ?? "", after);
  return plan.kind === "retime" ? { ...plan, script } : RERUN;
}

interface LiveTween {
  duration: (value?: number) => number;
  data?: unknown;
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
export function applyLiveRetime(iframe: HTMLIFrameElement | null, plan: LiveRetime): string | null {
  const win = iframe?.contentWindow as { __timelines?: Record<string, unknown> } | null;
  const timeline = win?.__timelines?.[plan.key] as LiveTimeline | undefined;
  if (typeof timeline?.getChildren !== "function") return `no live timeline "${plan.key}"`;
  // The script's tweens only: the runtime also nests sub-composition timelines and adds filler tweens here.
  // Paired before anything moves: moving a tween re-sorts the timeline's children.
  const children = timeline
    .getChildren(false, true, false)
    .filter((tween) => tween.data !== RUNTIME_FILLER);
  if (children.length !== plan.tweens.length) {
    return `${children.length} live tweens for ${plan.tweens.length} in the script`;
  }
  const unpaired = plan.tweens.findIndex((t, i) => !targetsMatch(children[i]!, t.selector));
  if (unpaired >= 0)
    return `live tween ${unpaired} does not target ${plan.tweens[unpaired]!.selector}`;
  if (plan.tweens.some((t) => t.moved)) {
    // Re-added in script order: GSAP orders equal starts by when they were added, as a fresh run does.
    const bySource = plan.tweens
      .map((t, i) => ({ ...t, tween: children[i]! }))
      .sort((a, b) => a.source - b.source);
    for (const { tween } of bySource) timeline.remove(tween);
    for (const { tween, start, duration } of bySource) {
      if (tween.duration() !== duration) tween.duration(duration);
      timeline.add(tween, start);
    }
  }
  // A script element runs once, so this only keeps the next comparison honest; nothing re-executes.
  plan.script.textContent = plan.after;
  return null;
}
