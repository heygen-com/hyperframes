import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { parseGsapScriptAcorn, scriptShape } from "@hyperframes/parsers/gsap-parser-acorn";
import { hasExplicitTime } from "@hyperframes/parsers/gsap-writer-acorn";
import {
  retimeLiveTweens,
  type LiveRetimeResult,
  type TweenTiming,
} from "@hyperframes/core/runtime/live-retime";
import {
  applySoftReloadFinalization,
  findGsapScriptElements,
  scriptsRegistering,
  timelineKeys,
} from "./gsapSoftReload";
import { previewFrameOpaque, previewRequest } from "../player/lib/previewChannel";
import { savedTiming } from "./authoredSource";

/**
 * How a saved script differs from the live one: `retime` when only tween starts and lengths moved
 * (`tweens` in the live timeline's child order), `rerun` for anything only a re-run reproduces.
 */
export type LiveRetimePlan =
  | { kind: "retime"; key: string; after: string; tweens: TweenTiming[] }
  | { kind: "rerun" };

const RERUN = { kind: "rerun" } as const;

function untimedShape(animation: GsapAnimation): string {
  const { id: _id, position: _p, resolvedStart: _s, duration: _d, ...rest } = animation;
  // An offset into the text, which moves when the preview reformats its copy of the script.
  const provenance = rest.provenance && { ...rest.provenance, sourceRange: undefined };
  return JSON.stringify({ ...rest, provenance }, (_key, value) =>
    typeof value === "string" && value.startsWith("__raw:")
      ? (scriptShape(`(${value.slice(6)}\n)`) ?? value)
      : value,
  );
}

const onTimeline = (animation: GsapAnimation) => !animation.global;

const placedAlone = (animation: GsapAnimation) =>
  hasExplicitTime(animation) && typeof animation.resolvedStart === "number";

/** Undefined when only GSAP knows it: an unwritten length takes `gsap.defaults`, which a script may change. */
const lengthOf = (animation: GsapAnimation) =>
  animation.method === "set" ? 0 : animation.durationUnresolved ? undefined : animation.duration;

/** The last two script shapes, by text: a repeat drag starts from the script the last one saved. */
const shapes = new Map<string, string | null>();

function shapeOf(code: string): string | null {
  const shape = shapes.has(code) ? (shapes.get(code) as string | null) : scriptShape(code, true);
  shapes.delete(code);
  shapes.set(code, shape);
  if (shapes.size > 2) shapes.delete(shapes.keys().next().value!);
  return shape;
}

/** Decides, from the two scripts alone, whether a saved edit moved tweens and nothing else. */
export function planLiveRetime(before: string, after: string): LiveRetimePlan {
  // The preview runs the script re-printed by the bundler; a timing edit rewrites numbers only.
  const shape = shapeOf(before);
  if (shape === null || shape !== shapeOf(after)) return RERUN;
  const keys = timelineKeys(after);
  if (keys.length !== 1 || timelineKeys(before).join() !== keys.join()) return RERUN;
  const was = parseGsapScriptAcorn(before).animations.filter(onTimeline);
  const now = parseGsapScriptAcorn(after).animations.filter(onTimeline);
  if (was.length !== now.length) return RERUN;
  const tweens: TweenTiming[] = [];
  for (const [index, next] of now.entries()) {
    const prev = was[index]!;
    if (untimedShape(prev) !== untimedShape(next)) return RERUN;
    // A relative position follows the parser's playhead, which is not GSAP's; only numbers place a tween alone.
    if (!placedAlone(next) || !placedAlone(prev)) return RERUN;
    const duration = lengthOf(next);
    const wasDuration = lengthOf(prev);
    if (duration === undefined || wasDuration === undefined) return RERUN;
    tweens.push({
      selector: next.targetSelector,
      start: next.resolvedStart!,
      duration,
      wasStart: prev.resolvedStart!,
      wasDuration,
      moved: next.resolvedStart !== prev.resolvedStart || duration !== wasDuration,
      source: index,
    });
  }
  // A GSAP timeline keeps its children sorted by start, an equal start after the earlier one: pair in that order.
  tweens.sort((x, y) => x.wasStart - y.wasStart || x.source - y.source);
  return { kind: "retime", key: keys[0]!, after, tweens };
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

/** Moves the live tweens a `retime` plan names; false, with nothing changed, when the timeline differs. */
export function applyLiveRetime(iframe: HTMLIFrameElement | null, plan: LiveRetime): boolean {
  const win = iframe?.contentWindow as { __timelines?: Record<string, unknown> } | null;
  return retimeLiveTweens(win, plan.script, plan);
}

const RETIME_RESULTS = new Set<unknown>(["moved", "unchanged", "failed"]);

/** The frame's reply is data: anything but exactly `{ result }` with a known result counts as a failure. */
function sealedRetimeResult(reply: unknown): LiveRetimeResult {
  if (typeof reply !== "object" || reply === null || Object.keys(reply).length !== 1)
    return "failed";
  const { result } = reply as { result?: unknown };
  return RETIME_RESULTS.has(result) ? (result as LiveRetimeResult) : "failed";
}

/** The edited file as saved before and after the edit. */
type SavedFiles = { before?: string; after?: string };

/** A `retime` plan from the file as saved before the edit; null when no single script there owns the timeline. */
function planFromSavedFile(
  scriptText: string,
  savedBefore: string,
): Extract<LiveRetimePlan, { kind: "retime" }> | null {
  const [key] = timelineKeys(scriptText);
  if (!key) return null;
  const previous = new DOMParser().parseFromString(savedBefore, "text/html");
  const [before, ...extra] = scriptsRegistering(findGsapScriptElements(previous), [key]);
  if (!before || extra.length > 0) return null;
  const plan = planLiveRetime(before.textContent ?? "", scriptText);
  return plan.kind === "retime" ? plan : null;
}

// Planned from the saved files alone; the frame checks its timeline matches the plan before moving anything.
async function moveSealedLiveTweens(
  iframe: HTMLIFrameElement,
  scriptText: string,
  currentTime: number,
  reloadPreview: () => void,
  files: SavedFiles,
): Promise<boolean> {
  if (files.before === undefined || files.after === undefined) return false;
  const plan = planFromSavedFile(scriptText, files.before);
  if (!plan) return false;
  const { key: planKey, after, tweens } = plan;
  const reply = await previewRequest(iframe, "live-retime", {
    key: planKey,
    after,
    tweens,
    time: currentTime,
    timing: savedTiming(files.after),
  });
  const result = sealedRetimeResult(reply);
  if (result === "unchanged") return false;
  if (result === "failed") reloadPreview();
  return true;
}

/** Syncs a saved timing edit by moving the live tweens; false when only re-running the script can. */
export function moveLiveTweens(
  iframe: HTMLIFrameElement,
  scriptText: string,
  currentTime: number,
  reloadPreview: () => void,
  files: SavedFiles = {},
): boolean | Promise<boolean> {
  if (previewFrameOpaque(iframe))
    return moveSealedLiveTweens(iframe, scriptText, currentTime, reloadPreview, files);
  const plan = planLiveRetimeFromPreview(iframe, scriptText);
  if (plan.kind !== "retime") return false;
  try {
    if (!applyLiveRetime(iframe, plan)) return false;
  } catch (error) {
    console.error("[Studio] Moving the live tweens threw; reloading the preview", error);
    reloadPreview();
    return true;
  }
  if (!applySoftReloadFinalization(iframe, currentTime)) reloadPreview();
  return true;
}
