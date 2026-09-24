export const MEDIA_VISUAL_STYLE_PROPERTIES = [
  "width",
  "height",
  "top",
  "left",
  "right",
  "bottom",
  "inset",
  "object-fit",
  "object-position",
  "z-index",
  "opacity",
  "visibility",
  "filter",
  "mix-blend-mode",
  "backdrop-filter",
  "border-width",
  "border-style",
  "border-color",
  "border-radius",
  "overflow",
  "clip-path",
  "mask",
  "mask-image",
  "mask-size",
  "mask-position",
  "mask-repeat",
  "transform",
  "transform-origin",
  "translate",
  "rotate",
  "scale",
  "box-sizing",
] as const;

export type MediaVisualStyleProperty = (typeof MEDIA_VISUAL_STYLE_PROPERTIES)[number];

const FRAME_BOUNDARY_EPSILON = 1e-3;

function safeFps(fps: number): number {
  return Number.isFinite(fps) && fps > 0 ? fps : 30;
}

function safeTime(timeSeconds: number): number {
  return Number.isFinite(timeSeconds) && timeSeconds > 0 ? timeSeconds : 0;
}

export function quantizeTimeToFrame(timeSeconds: number, fps: number): number {
  const grid = safeFps(fps);
  const frameIndex = Math.floor(safeTime(timeSeconds) * grid + 1e-9);
  return frameIndex / grid;
}

/**
 * The grid a deterministic render seek lands on.
 *
 * With no `subFrameDivisions` this is the output frame grid, unchanged. Sub-frame
 * sampling (motion blur) passes an integer subdivision count, which can only refine
 * the output grid, never move a frame-time instant off it.
 *
 * The finer grid rounds where the frame grid floors. A sub-frame time makes a float
 * round trip (the caller builds `ticks / (fps * divisions)`, this recomputes
 * `time * fps * divisions`), and past a few million ticks that error exceeds the
 * floor epsilon, which would silently drop a sample one tick early.
 */
export function quantizeSeekTime(
  timeSeconds: number,
  fps: number,
  subFrameDivisions?: number,
): number {
  const divisions = Number.isInteger(subFrameDivisions) ? (subFrameDivisions as number) : 1;
  if (divisions <= 1) return quantizeTimeToFrame(timeSeconds, fps);
  const grid = safeFps(fps) * divisions;
  return Math.round(safeTime(timeSeconds) * grid) / grid;
}

/** Snap decimal noise near a frame boundary without moving genuinely fractional timing. */
export function snapTimeToFrameBoundary(timeSeconds: number, fps: number): number {
  const grid = safeFps(fps);
  const time = safeTime(timeSeconds);
  const framePosition = time * grid;
  const nearestFrame = Math.round(framePosition);
  return Math.abs(framePosition - nearestFrame) <= FRAME_BOUNDARY_EPSILON
    ? nearestFrame / grid
    : time;
}

export function copyMediaVisualStyles(
  targetStyle: CSSStyleDeclaration,
  sourceStyle: CSSStyleDeclaration,
  properties: readonly string[] = MEDIA_VISUAL_STYLE_PROPERTIES,
): void {
  for (const property of properties) {
    const value = sourceStyle.getPropertyValue(property);
    if (value) {
      targetStyle.setProperty(property, value);
    }
  }
}
