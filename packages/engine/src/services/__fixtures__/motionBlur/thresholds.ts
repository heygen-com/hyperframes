export const MEASURED_OUTSIDE_NOISE = 0.0078125;
export const MEASURED_CANVAS_MUTATION = 169.741;
export const MEASURED_REWIND_MUTATION = 106.099;
export const OUTSIDE_FLOOR = 1;

export const MEASURED_INSIDE_NOISE = 10.993;
export const MEASURED_CONTENT_CUT_MUTATION = 130.129;
export const MEASURED_CLIP_PATH_MUTATION = 124.322;
export const INSIDE_NOT_CAUGHT = ["no mover blurred"] as const;

const geometricMean = (a: number, b: number): number => Math.sqrt(a * b);

export const INVARIANTS = {
  block: 16,
  outsideMaxMae: Math.max(
    OUTSIDE_FLOOR,
    geometricMean(
      MEASURED_OUTSIDE_NOISE,
      Math.min(MEASURED_CANVAS_MUTATION, MEASURED_REWIND_MUTATION),
    ),
  ),
  insideMaxMae: geometricMean(
    MEASURED_INSIDE_NOISE,
    Math.min(MEASURED_CONTENT_CUT_MUTATION, MEASURED_CLIP_PATH_MUTATION),
  ),
  radiusFrames: 2,
  minCheckedFraction: 0.5,
  shutterSamples: 8,
};
