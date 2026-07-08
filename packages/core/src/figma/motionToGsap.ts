import { mapEase, resolveMotionEase } from "./motionEase";
import type {
  CustomEaseRef,
  GsapKeyframeStep,
  GsapTween,
  MotionTimelineSpec,
  MotionDoc,
  MotionTrack,
  TimelineCustomEaseRef,
  TimelineKeyframeStep,
  TimelineTween,
  TimelineSpec,
} from "./types";

/**
 * repeat semantics match GSAP and motion.dev: count of EXTRA plays
 * (0 = play once). Infinity clamps to 0 — a single play — because a
 * deterministic render needs a finite timeline; composition-duration-aware
 * loop counts are a later milestone (spec §6 motion notes).
 */
function clampRepeat(repeat: number | undefined): number {
  return repeat !== undefined && Number.isFinite(repeat) && repeat > 0 ? Math.floor(repeat) : 0;
}

function deriveId(selector: string): string {
  const base = selector.replace(/^[#.]/, "").replace(/[^A-Za-z0-9_-]/g, "-");
  return `figma-${base.length > 0 ? base : "timeline"}`;
}

/** Mutable counter shared across all tracks so generated CustomEase names stay unique. */
interface CustomEaseCounter {
  value: number;
}

/** Resolves one segment's ease, registering a CustomEase in `customEases` for bezier arrays. */
function resolveStepEase(
  rawEase: string | [number, number, number, number],
  customEases: CustomEaseRef[],
  counter: CustomEaseCounter,
): string {
  const mapped = mapEase(rawEase);
  if (mapped.kind === "bezier") {
    const name = `hfCe${counter.value}`;
    counter.value += 1;
    customEases.push({ name, bezier: mapped.bezier });
    return name;
  }
  return mapped.ease;
}

function resolveTimelineStepEase(
  rawEase: string | [number, number, number, number],
  customEases: TimelineCustomEaseRef[],
  counter: CustomEaseCounter,
): string {
  const mapped = resolveMotionEase(rawEase);
  if (mapped.kind === "custom") {
    const name = `hfCe${counter.value}`;
    counter.value += 1;
    customEases.push({ name, ease: mapped.ease });
    return name;
  }
  return mapped.ease;
}

function buildTrackSteps<TStep>(
  track: MotionTrack,
  resolveEaseForStep: (rawEase: MotionTrack["ease"][number]) => string,
  makeStep: (value: number | string, duration: number, ease: string) => TStep,
): TStep[] {
  const steps: TStep[] = [];

  for (let i = 1; i < track.values.length; i += 1) {
    const tPrev = track.times[i - 1];
    const tCur = track.times[i];
    const value = track.values[i];
    if (tPrev === undefined || tCur === undefined || value === undefined) continue;

    const rawEase = track.ease[i - 1] ?? "linear";
    const ease = resolveEaseForStep(rawEase);
    steps.push(makeStep(value, (tCur - tPrev) * track.duration, ease));
  }

  return steps;
}

function assertTrackInitial(track: MotionTrack, context: string): number | string {
  if (track.values.length < 2 || track.times.length !== track.values.length) {
    throw new Error(`${context}: invalid track "${track.property}" (values/times mismatch)`);
  }
  const initial = track.values[0];
  if (initial === undefined) throw new Error(`${context}: empty track "${track.property}"`);
  return initial;
}

function buildTweenFields<TStep>(
  track: MotionTrack,
  selector: string,
  initial: number | string,
  steps: TStep[],
): {
  selector: string;
  property: string;
  initial: number | string;
  steps: TStep[];
  repeat: number;
} {
  return {
    selector,
    property: track.property,
    initial,
    steps,
    repeat: clampRepeat(track.repeat),
  };
}

function buildTween(
  track: MotionTrack,
  selector: string,
  customEases: CustomEaseRef[],
  counter: CustomEaseCounter,
): GsapTween {
  const initial = assertTrackInitial(track, "motionToGsap");
  const steps = buildTrackSteps(
    track,
    (rawEase) => resolveStepEase(rawEase, customEases, counter),
    (value, duration, ease): GsapKeyframeStep => ({ value, duration, ease }),
  );
  return buildTweenFields(track, selector, initial, steps);
}

function buildTimelineTween(
  track: MotionTrack,
  selector: string,
  customEases: TimelineCustomEaseRef[],
  counter: CustomEaseCounter,
): TimelineTween {
  const initial = assertTrackInitial(track, "motionToTimeline");
  const steps = buildTrackSteps(
    track,
    (rawEase) => resolveTimelineStepEase(rawEase, customEases, counter),
    (value, duration, ease): TimelineKeyframeStep => ({ value, duration, ease }),
  );
  return buildTweenFields(track, selector, initial, steps);
}

export function motionToGsap(doc: MotionDoc): TimelineSpec {
  const customEases: CustomEaseRef[] = [];
  const counter: CustomEaseCounter = { value: 0 };
  const tweens = doc.tracks.map((track) => buildTween(track, doc.selector, customEases, counter));
  return { timelineId: deriveId(doc.selector), tweens, customEases };
}

export function motionToTimeline(doc: MotionDoc): MotionTimelineSpec {
  const customEases: TimelineCustomEaseRef[] = [];
  const counter: CustomEaseCounter = { value: 0 };
  const tweens = doc.tracks.map((track) =>
    buildTimelineTween(track, doc.selector, customEases, counter),
  );
  return { timelineId: deriveId(doc.selector), tweens, customEases };
}
