export const MEASURED_OUTSIDE_NOISE = 0.0078125;
export const MEASURED_CANVAS_MUTATION = 169.741;
export const MEASURED_REWIND_MUTATION = 106.099;
export const OUTSIDE_FLOOR = 1;

// Through the producer's multi-worker PNG render. Noise: blur off rendered twice, five fixtures, bit-identical.
export const MEASURED_RENDER_NOISE = 0;
// Worst-tile MAE of the rewind mutation through the render (`callbacks`, 7 workers; caught 8 of 8 runs, always 97.02).
export const MEASURED_RENDER_REWIND_MUTATION = 97.02;

// Worst-tile MAE of each pinned known bug, where it was pinned. A pin passes only within half to double of it.
export const MEASURED_SCROLL_LOSS_FRESH_PAINT = 24.65;
export const MEASURED_LABEL_EARLY_FRESH_PAINT = 54.3;
export const MEASURED_SCROLL_LOSS_RENDER = 18.82;
export const MEASURED_LABEL_EARLY_RENDER = 53.87;

export const MEASURED_INSIDE_NOISE = 10.993;
export const MEASURED_CONTENT_CUT_MUTATION = 130.129;
export const MEASURED_CLIP_PATH_MUTATION = 124.322;

const geometricMean = (a: number, b: number): number => Math.sqrt(a * b);

export const RENDER_OUTSIDE_MAX_MAE = Math.max(
  OUTSIDE_FLOOR,
  geometricMean(MEASURED_RENDER_NOISE, MEASURED_RENDER_REWIND_MUTATION),
);

export const INVARIANTS = {
  block: 16,
  outsideMaxMae: Math.max(
    OUTSIDE_FLOOR,
    geometricMean(
      MEASURED_OUTSIDE_NOISE,
      Math.min(MEASURED_CANVAS_MUTATION, MEASURED_REWIND_MUTATION),
    ),
  ),
  // Not reliably caught: no mover blurred at all. It shows only where a large mover fills whole 16 px tiles.
  insideMaxMae: geometricMean(
    MEASURED_INSIDE_NOISE,
    Math.min(MEASURED_CONTENT_CUT_MUTATION, MEASURED_CLIP_PATH_MUTATION),
  ),
  // Any DOM change within radiusFrames of a checkpoint is masked by the trail mask: keep checkpoints 3 frames from one.
  radiusFrames: 2,
  minCheckedFraction: 0.5,
  shutterSamples: 8,
};
