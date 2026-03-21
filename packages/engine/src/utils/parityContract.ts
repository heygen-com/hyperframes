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
  "box-sizing",
] as const;

export function quantizeTimeToFrame(timeSeconds: number, fps: number): number {
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
  const safeTime = Number.isFinite(timeSeconds) && timeSeconds > 0 ? timeSeconds : 0;
  const frameIndex = Math.floor(safeTime * safeFps + 1e-9);
  return frameIndex / safeFps;
}
