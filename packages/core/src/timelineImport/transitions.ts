import { fpsToNumber } from "../fps.js";
import type { ImportClip, ImportTimeline } from "./schema.js";

export interface Fade {
  clipId: string;
  start: number;
  duration: number;
  /** `in`: the clip fades up over what is beneath it. `out`: it fades away to reveal it. */
  direction: "in" | "out";
}

export interface TransitionPlan {
  clips: ImportClip[];
  fades: Fade[];
  warnings: string[];
}

export interface PlanOptions {
  /** Length in seconds of the media file behind a clip; `undefined` when it cannot be read. */
  mediaDuration?: (clip: ImportClip) => number | undefined;
}

const FADEABLE = new Set(["dissolve", "crossfade"]);
const MICRO = 1e6;
const round6 = (n: number) => Math.round(n * MICRO) / MICRO;
const floor6 = (n: number) => Math.floor(n * MICRO + 1e-4) / MICRO;
const ceil6 = (n: number) => Math.ceil(n * MICRO - 1e-4) / MICRO;
const name = (clip: ImportClip) => clip.label ?? clip.id;
const seconds = (n: number) => `${round6(n)}s`;

const rateOf = (clip: ImportClip) => clip.playbackRate ?? 1;

/** Timeline seconds of footage before the clip's in-point. Stills never run out. */
function headHandle(clip: ImportClip): number {
  return clip.kind === "image" ? Infinity : clip.mediaStart / rateOf(clip);
}

/** How far the clip may start early: its footage before the in-point, and the room before 0 (a
 * negative start would make the animation library shift every tween). */
function headRoom(clip: ImportClip): number {
  return Math.min(headHandle(clip), clip.start);
}

/** Why the room is `room`, for a warning. */
function headLimit(clip: ImportClip, room: number): string {
  return clip.start <= headHandle(clip)
    ? `${seconds(room)} before ${name(clip)} on the timeline`
    : `${seconds(room)} before ${name(clip)}'s in-point`;
}

/** Timeline seconds of footage after the clip's out-point; `null` when the file length is unknown. */
function tailHandle(clip: ImportClip, options: PlanOptions): number | null {
  if (clip.kind === "image") return Infinity;
  const length = options.mediaDuration?.(clip);
  if (length === undefined) return null;
  const used = clip.mediaStart + clip.duration * rateOf(clip);
  return Math.max(0, (length - used) / rateOf(clip));
}

/** Plays the clip `by` seconds earlier. The margins keep float noise from moving a start after its
 * frame or an in-point before it. */
function startEarlier(clip: ImportClip, by: number): void {
  if (by <= 0) return;
  clip.start = Math.max(0, floor6(clip.start - by - 1e-6));
  clip.duration = round6(clip.end - clip.start);
  clip.mediaStart =
    clip.kind === "image" ? 0 : Math.max(0, ceil6(clip.mediaStart - by * rateOf(clip) + 2e-6));
}

/** Plays the clip `by` seconds later than it was cut to end. */
function endLater(clip: ImportClip, by: number): void {
  clip.duration = round6(clip.duration + by);
  clip.end = round6(clip.end + by);
}

type ImportTransition = ImportTimeline["transitions"][number];

interface Planner {
  frame: number;
  options: PlanOptions;
  fades: Fade[];
  warnings: string[];
}

const tailLimit = (a: ImportClip, tail: number | null) =>
  tail === null
    ? `the length of ${name(a)}'s file could not be read`
    : `${seconds(tail)} after ${name(a)}'s out-point`;

function warnIfShortened(
  plan: Planner,
  pair: string,
  requested: number,
  used: number,
  limits: string[],
): void {
  if (used >= requested - 1e-6 || limits.length === 0) return;
  plan.warnings.push(
    `dissolve between ${pair} shortened from ${seconds(requested)} to ${seconds(used)}: only ${limits.join(" and ")}`,
  );
}

/** Why a transition cannot be applied, which leaves a hard cut; `undefined` when it can. */
function hardCutReason(
  t: ImportTransition,
  a: ImportClip | null,
  b: ImportClip | null,
  pair: string,
): string | undefined {
  if (!FADEABLE.has(t.kind)) {
    return `transition "${t.kind}" at ${pair} was imported as a hard cut; only dissolves are applied (add a wipe with a registry block)`;
  }
  if (a?.kind === "audio" || b?.kind === "audio") {
    return `audio transition at ${pair} was imported as a hard cut`;
  }
  return undefined;
}

/** The incoming clip starts early and the outgoing one plays on, each over the footage it has. */
function planDissolve(
  plan: Planner,
  t: ImportTransition,
  a: ImportClip,
  b: ImportClip,
  pair: string,
): void {
  if (Math.abs(a.end - b.start) > plan.frame / 2) {
    plan.warnings.push(`dissolve between ${pair} skipped: the clips do not meet at the cut`);
    return;
  }
  const head = headRoom(b);
  const tail = tailHandle(a, plan.options);
  const inUsed = floor6(Math.min(t.inOffset, head));
  const outUsed = floor6(Math.min(t.outOffset, tail ?? 0));
  if (inUsed + outUsed < plan.frame) {
    plan.warnings.push(
      `dissolve between ${pair} imported as a hard cut: no footage beyond the trim points to dissolve over`,
    );
    return;
  }
  warnIfShortened(
    plan,
    pair,
    t.inOffset + t.outOffset,
    inUsed + outUsed,
    [
      inUsed < t.inOffset ? headLimit(b, head) : "",
      outUsed < t.outOffset ? tailLimit(a, tail) : "",
    ].filter(Boolean),
  );
  endLater(a, outUsed);
  startEarlier(b, inUsed);
  plan.fades.push({
    clipId: b.id,
    start: b.start,
    duration: round6(inUsed + outUsed),
    direction: "in",
  });
}

/** From nothing: the clip may start early on its head handle, then fades up through the cut. */
function planFadeIn(plan: Planner, t: ImportTransition, b: ImportClip, pair: string): void {
  const head = headRoom(b);
  const inUsed = floor6(Math.min(t.inOffset, head));
  const outUsed = floor6(Math.min(t.outOffset, b.duration));
  if (inUsed + outUsed < plan.frame) {
    plan.warnings.push(`fade from nothing at ${pair} was imported as a hard cut: it has no length`);
    return;
  }
  warnIfShortened(
    plan,
    pair,
    t.inOffset + t.outOffset,
    inUsed + outUsed,
    [inUsed < t.inOffset ? headLimit(b, head) : ""].filter(Boolean),
  );
  startEarlier(b, inUsed);
  plan.fades.push({
    clipId: b.id,
    start: b.start,
    duration: round6(inUsed + outUsed),
    direction: "in",
  });
}

/** To nothing: the clip may play on past its end on its tail handle, fading away through the cut. */
function planFadeOut(plan: Planner, t: ImportTransition, a: ImportClip, pair: string): void {
  const tail = tailHandle(a, plan.options);
  const inUsed = floor6(Math.min(t.inOffset, a.duration));
  const outUsed = floor6(Math.min(t.outOffset, tail ?? 0));
  if (inUsed + outUsed < plan.frame) {
    plan.warnings.push(`fade to nothing at ${pair} was imported as a hard cut: it has no length`);
    return;
  }
  warnIfShortened(
    plan,
    pair,
    t.inOffset + t.outOffset,
    inUsed + outUsed,
    [outUsed < t.outOffset ? tailLimit(a, tail) : ""].filter(Boolean),
  );
  endLater(a, outUsed);
  plan.fades.push({
    clipId: a.id,
    start: round6(a.end - inUsed - outUsed),
    duration: round6(inUsed + outUsed),
    direction: "out",
  });
}

/**
 * A dissolve straddles the cut: the outgoing clip plays past its end and the incoming one starts
 * early, which needs footage beyond each trim point (the "handles"). Each side is clamped to the
 * handle it has; with none on either side the cut stays hard. The incoming clip then fades in
 * over the outgoing one, which is the same picture as a mutual cross fade for opaque clips.
 *
 * A transition next to a gap is a fade from or to nothing: the clip fades in (or out) on its own,
 * showing whatever lies beneath, which is the background when nothing does.
 */
export function planTransitions(
  timeline: ImportTimeline,
  options: PlanOptions = {},
): TransitionPlan {
  const clips = new Map(timeline.clips.map((clip) => [clip.id, { ...clip }]));
  const plan: Planner = {
    frame: 1 / fpsToNumber(timeline.fps),
    options,
    fades: [],
    warnings: [],
  };

  for (const t of timeline.transitions) {
    const a = t.from === null ? null : clips.get(t.from);
    const b = t.to === null ? null : clips.get(t.to);
    if (a === undefined || b === undefined || (a === null && b === null)) continue;
    const pair = [a, b]
      .filter((clip): clip is ImportClip => clip !== null)
      .map(name)
      .join(" and ");
    const refusal = hardCutReason(t, a, b, pair);
    if (refusal !== undefined) plan.warnings.push(refusal);
    else if (a !== null && b !== null) planDissolve(plan, t, a, b, pair);
    else if (b !== null) planFadeIn(plan, t, b, pair);
    else if (a !== null) planFadeOut(plan, t, a, pair);
  }

  return {
    clips: timeline.clips.map((clip) => clips.get(clip.id) ?? clip),
    fades: plan.fades,
    warnings: plan.warnings,
  };
}
