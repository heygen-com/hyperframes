export const STUDIO_PREVIEW_MARK_META = "hyperframes-studio-preview";
export const STUDIO_PREVIEW_CAPTURE_MODE = "capture";
export const STUDIO_PREVIEW_UPCOMING_ATTR = "data-hf-upcoming";
export const STUDIO_PREVIEW_LAZY_ATTR = "data-hf-preview-lazy";
export const STUDIO_PREVIEW_ERRORS = "__hfPreviewErrors";

export const refusedPreviewMessage = (status: number) =>
  `The preview page could not be loaded (HTTP ${status}).`;
export function refusedPreviewStatus(message: string): number | null {
  const status = /^The preview page could not be loaded \(HTTP (\d{3})\)\.$/.exec(message)?.[1];
  return status ? Number(status) : null;
}
export const PREVIEW_RASTER_ATTR = "data-hf-preview-raster";
export const RUNTIME_STAMPED_ATTR = "data-hf-autostamped";
export const CLIP_HIDDEN_ATTR = "data-hf-clip-hidden";
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

export const isClipHiddenByRuntime = (el: HTMLElement) =>
  el.hasAttribute(CLIP_HIDDEN_ATTR) && el.style.visibility === "hidden";

export function applyAuthoredTiming(
  el: Element,
  attrs: ReadonlyArray<readonly [name: string, value: string]>,
): void {
  for (const [name, value] of attrs) el.setAttribute(name, value);
  el.removeAttribute(RUNTIME_STAMPED_ATTR);
}
