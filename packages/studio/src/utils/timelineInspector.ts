import type { TimelineElement } from "../player";

export const TIMELINE_INSPECTOR_BOUNDARY_EPSILON_SECONDS = 0.08;

const AUDIO_TIMELINE_TAGS = new Set(["audio", "music", "sfx", "sound", "narration"]);
const AUDIO_SOURCE_EXT_RE = /\.(aac|flac|m4a|mp3|ogg|opus|wav)(?:[?#].*)?$/i;

export function getTimelineElementKey(
  element: Pick<TimelineElement, "id" | "key"> | null | undefined,
): string | null {
  if (!element) return null;
  return element.key ?? element.id;
}

export function isAudioTimelineElement(
  element: Pick<TimelineElement, "tag" | "src"> | null | undefined,
): boolean {
  if (!element) return false;
  const tag = element.tag.trim().toLowerCase();
  if (AUDIO_TIMELINE_TAGS.has(tag)) return true;
  return Boolean(element.src && AUDIO_SOURCE_EXT_RE.test(element.src));
}

export function canInspectTimelineElement(
  element: Pick<TimelineElement, "tag" | "src"> | null | undefined,
): boolean {
  return !isAudioTimelineElement(element);
}

export function shouldShowTimelineInspectorBounds(
  currentTime: number,
  element: Pick<TimelineElement, "start" | "duration"> | null | undefined,
  epsilonSeconds = TIMELINE_INSPECTOR_BOUNDARY_EPSILON_SECONDS,
): boolean {
  if (!element) return false;
  if (!Number.isFinite(currentTime)) return false;
  if (!Number.isFinite(element.start) || !Number.isFinite(element.duration)) return false;
  const start = Math.max(0, element.start);
  const end = Math.max(start, start + Math.max(0, element.duration));
  const epsilon = Math.max(0, epsilonSeconds);
  return Math.abs(currentTime - start) <= epsilon || Math.abs(currentTime - end) <= epsilon;
}

export function isTimelineElementActiveAtTime(
  currentTime: number,
  element: Pick<TimelineElement, "start" | "duration"> | null | undefined,
  epsilonSeconds = TIMELINE_INSPECTOR_BOUNDARY_EPSILON_SECONDS,
): boolean {
  if (!element) return false;
  if (!Number.isFinite(currentTime)) return false;
  if (!Number.isFinite(element.start) || !Number.isFinite(element.duration)) return false;
  const start = Math.max(0, element.start);
  const end = Math.max(start, start + Math.max(0, element.duration));
  const epsilon = Math.max(0, epsilonSeconds);
  return currentTime >= start - epsilon && currentTime <= end + epsilon;
}

export interface TimelineLayerVisibility {
  visible: boolean;
  compositeOpacity: number;
  hasBox: boolean;
  inViewport: boolean;
}

export function getTimelineLayerVisibilityInPreview(
  element: HTMLElement,
  options: { minCompositeOpacity?: number } = {},
): TimelineLayerVisibility {
  const hidden: TimelineLayerVisibility = {
    visible: false,
    compositeOpacity: 0,
    hasBox: false,
    inViewport: false,
  };
  if (!element.isConnected) return hidden;
  const doc = element.ownerDocument;
  const win = doc.defaultView;
  if (!win) return hidden;

  const minCompositeOpacity = options.minCompositeOpacity ?? 0.01;
  let compositeOpacity = 1;
  let current: HTMLElement | null = element;
  while (current && current !== doc.body && current !== doc.documentElement) {
    const style = win.getComputedStyle(current);
    if (style.display === "none" || style.visibility === "hidden") {
      return { ...hidden, compositeOpacity };
    }
    compositeOpacity *= Number.parseFloat(style.opacity || "1");
    if (compositeOpacity <= minCompositeOpacity) {
      return { ...hidden, compositeOpacity };
    }
    current = current.parentElement;
  }

  const rect = element.getBoundingClientRect();
  const hasBox = rect.width > 0.5 && rect.height > 0.5;
  if (!hasBox) return { visible: false, compositeOpacity, hasBox, inViewport: false };

  const viewportWidth = win.innerWidth || doc.documentElement.clientWidth;
  const viewportHeight = win.innerHeight || doc.documentElement.clientHeight;
  const inViewport =
    rect.right > 0 && rect.bottom > 0 && rect.left < viewportWidth && rect.top < viewportHeight;
  return {
    visible: inViewport,
    compositeOpacity,
    hasBox,
    inViewport,
  };
}

export function isTimelineLayerVisibleInPreview(
  element: HTMLElement,
  options: { minCompositeOpacity?: number } = {},
): boolean {
  return getTimelineLayerVisibilityInPreview(element, options).visible;
}
