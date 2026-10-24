export const STUDIO_PREVIEW_MARK_META = "hyperframes-studio-preview";
export const STUDIO_PREVIEW_CAPTURE_MODE = "capture";
export const STUDIO_PREVIEW_UPCOMING_ATTR = "data-hf-upcoming";
export const STUDIO_PREVIEW_LAZY_ATTR = "data-hf-preview-lazy";
export const STUDIO_PREVIEW_ERRORS = "__hfPreviewErrors";
export const PREVIEW_RASTER_ATTR = "data-hf-preview-raster";
export const RUNTIME_STAMPED_ATTR = "data-hf-autostamped";
export const STUDIO_PREVIEW_FAR_SCENE_ATTR = "data-hf-far-scene";
export const STUDIO_PREVIEW_PARKED_SCENE_ATTR = "data-hf-parked-scene";
export const PREVIEW_ONLY_ATTRS = [
  STUDIO_PREVIEW_UPCOMING_ATTR,
  STUDIO_PREVIEW_FAR_SCENE_ATTR,
  STUDIO_PREVIEW_PARKED_SCENE_ATTR,
  STUDIO_PREVIEW_LAZY_ATTR,
  PREVIEW_RASTER_ATTR,
  RUNTIME_STAMPED_ATTR,
] as const;

export function applyAuthoredTiming(
  el: Element,
  attrs: ReadonlyArray<readonly [name: string, value: string]>,
): void {
  for (const [name, value] of attrs) el.setAttribute(name, value);
  el.removeAttribute(RUNTIME_STAMPED_ATTR);
}
