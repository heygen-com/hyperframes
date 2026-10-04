import gsap from "gsap";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";

// GSAP 3.15 defaults: a percentage keyframe eases its segment power1.inOut; an array step is linear.
export const PERCENTAGE_SEGMENT_EASE = "power1.inOut";
export const ARRAY_STEP_EASE = "none";
// A motionPath tween is a plain tween to GSAP, so it runs GSAP's default tween ease.
const MOTION_PATH_RUN_EASE = "power1.out";

/** `run` warps a keyframed tween's whole progress; a segment eases with the keyframe it arrives
 *  at, else easeEach, else GSAP's default for the form. A flat tween has no run ease. */
export function keyframedTweenEases(anim: GsapAnimation): {
  run?: string;
  segment: (arriving: { ease?: string }) => string;
} {
  const data = anim.keyframes;
  const fallback =
    data?.format === "object-array" ? ARRAY_STEP_EASE : (data?.easeEach ?? PERCENTAGE_SEGMENT_EASE);
  return {
    run: data
      ? (data.ease ?? anim.ease ?? (anim.arcPath ? MOTION_PATH_RUN_EASE : undefined))
      : undefined,
    segment: (arriving) => arriving.ease ?? fallback,
  };
}

export function easeFunction(name: string | undefined): ((progress: number) => number) | null {
  if (!name || name === "none" || name === "linear") return null;
  return gsap.parseEase(name) ?? null;
}

export const runEaseOf = (anim: GsapAnimation) => keyframedTweenEases(anim).run;

/** The keyframe progress (0-100) GSAP shows at `timePercentage` of a tween with this run ease. */
export function progressAtTime(runEase: string | undefined, timePercentage: number): number {
  const run = easeFunction(runEase);
  return run ? run(timePercentage / 100) * 100 : timePercentage;
}

const SCAN_STEPS = 200;
const BISECT_STEPS = 40;

/** The time (0-100 of the tween) at which GSAP first reaches keyframe progress `percentage`. */
export function timeAtProgress(runEase: string | undefined, percentage: number): number {
  const run = easeFunction(runEase);
  if (!run || percentage <= 0 || percentage >= 100) return percentage;
  const target = percentage / 100;
  let low = 0;
  let high = 1;
  for (let step = 1; step <= SCAN_STEPS; step++) {
    if (run(step / SCAN_STEPS) >= target) {
      low = (step - 1) / SCAN_STEPS;
      high = step / SCAN_STEPS;
      break;
    }
  }
  for (let step = 0; step < BISECT_STEPS; step++) {
    const mid = (low + high) / 2;
    if (run(mid) >= target) high = mid;
    else low = mid;
  }
  return high * 100;
}
