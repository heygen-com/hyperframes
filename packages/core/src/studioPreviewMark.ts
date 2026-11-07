import { isWebKit } from "./runtime/mediaClock.js";

export const STUDIO_PREVIEW_MARK_META = "hyperframes-studio-preview";
export const PREVIEW_SEEK_HOLD_ATTR = "data-hf-preview-seek-hold";
export const PREVIEW_VIDEO_FRAME_ATTR = "data-hf-preview-video-frame";
export const PREVIEW_VIDEO_SOURCE_ATTR = "data-hf-preview-video-source";
export const PREVIEW_VIDEO_CANVAS_ATTR = "data-hf-preview-video-canvas";
export const STUDIO_PREVIEW_CAPTURE_MODE = "capture";
export const PLAYER_FRAME_ATTR = "data-hf-player-frame";

export function inPlayerFrame(doc: Document): boolean {
  return isWebKit() && doc.defaultView?.frameElement?.hasAttribute(PLAYER_FRAME_ATTR) === true;
}

export function defersMediaIn(doc: Document): boolean {
  return (
    doc.querySelector(`meta[name="${STUDIO_PREVIEW_MARK_META}"]`) !== null || inPlayerFrame(doc)
  );
}
export const STUDIO_PREVIEW_UPCOMING_ATTR = "data-hf-upcoming";
export const STUDIO_PREVIEW_LAZY_ATTR = "data-hf-preview-lazy";
export const STUDIO_PREVIEW_ERRORS = "__hfPreviewErrors";
export const STUDIO_PREVIEW_ERROR_KINDS = "__hfPreviewErrorKinds";

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
  PREVIEW_VIDEO_FRAME_ATTR,
  PREVIEW_VIDEO_SOURCE_ATTR,
  PREVIEW_VIDEO_CANVAS_ATTR,
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
