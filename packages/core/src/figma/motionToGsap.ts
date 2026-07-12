import { mapEase } from "./motionEase";
import type {
  CustomEaseRef,
  GsapKeyframeStep,
  GsapTween,
  MotionDoc,
  MotionTrack,
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

function buildSteps(
  track: MotionTrack,
  customEases: CustomEaseRef[],
  counter: CustomEaseCounter,
): GsapKeyframeStep[] {
  const steps: GsapKeyframeStep[] = [];

  for (let i = 1; i < track.values.length; i += 1) {
    const tPrev = track.times[i - 1];
    const tCur = track.times[i];
    const value = track.values[i];
    if (tPrev === undefined || tCur === undefined || value === undefined) continue;

    const rawEase = track.ease[i - 1] ?? "linear";
    const ease = resolveStepEase(rawEase, customEases, counter);
    steps.push({ value, duration: (tCur - tPrev) * track.duration, ease });
  }

  return steps;
}

function buildTween(
  track: MotionTrack,
  selector: string,
  customEases: CustomEaseRef[],
  counter: CustomEaseCounter,
): GsapTween {
  if (track.values.length < 2 || track.times.length !== track.values.length) {
    throw new Error(`motionToGsap: invalid track "${track.property}" (values/times mismatch)`);
  }
  const initial = track.values[0];
  if (initial === undefined) throw new Error(`motionToGsap: empty track "${track.property}"`);

  return {
    selector,
    property: track.property,
    initial,
    steps: buildSteps(track, customEases, counter),
    repeat: clampRepeat(track.repeat),
  };
}

export function motionToGsap(doc: MotionDoc): TimelineSpec {
  const customEases: CustomEaseRef[] = [];
  const counter: CustomEaseCounter = { value: 0 };
  const tweens = doc.tracks.map((track) => buildTween(track, doc.selector, customEases, counter));
  return { timelineId: deriveId(doc.selector), tweens, customEases };
}
