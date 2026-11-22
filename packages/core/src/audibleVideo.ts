import { readClipTiming } from "./compositionContract.js";
import { readLinkTiming } from "./mediaLink.js";

export const AUDIBLE_VIDEO_QUALIFIER =
  ':not([muted]):is(:not([data-has-audio]),[data-has-audio="true"])';

export const AUDIBLE_MEDIA_SELECTOR = `audio[data-start], video[data-start]${AUDIBLE_VIDEO_QUALIFIER}`;

export function isAudibleVideoElement(el: {
  tagName: string;
  hasAttribute(name: string): boolean;
  getAttribute(name: string): string | null;
}): boolean {
  if (el.tagName.toLowerCase() !== "video" || el.hasAttribute("muted")) return false;
  const declared = el.getAttribute("data-has-audio");
  return declared === null || declared === "true";
}

export function audibleVideoNeedsWebAudio(fields: {
  volume?: number | null;
  fxChain?: string | null;
  automation?: string | null;
  audioGroup?: string | null;
  masterChain?: string | null;
}): boolean {
  return (
    (fields.volume ?? 1) > 1 ||
    Boolean(fields.fxChain || fields.automation || fields.audioGroup || fields.masterChain)
  );
}

export interface ParentCopy {
  kind: "audio" | "video";
  src: string;
  start: number;
  duration: number;
  mediaStart: number;
}

export function mediaFileOf(el: HTMLMediaElement): string | null {
  const raw = el.getAttribute("src") || el.querySelector("source")?.getAttribute("src");
  if (!raw) return null;
  try {
    return new URL(raw, el.ownerDocument.baseURI).href;
  } catch {
    return null;
  }
}

export function parentCopyOf(el: HTMLMediaElement): ParentCopy | null {
  if (el.preload === "metadata" || el.preload === "none") return null;
  const tag = el.tagName.toLowerCase();
  if (tag !== "audio" && !isAudibleVideoElement(el)) return null;
  const src = mediaFileOf(el);
  if (!src) return null;
  const timing = readClipTiming(el);
  return {
    kind: tag === "audio" ? "audio" : "video",
    src,
    start: timing.start ?? 0,
    duration: timing.duration ?? Number.POSITIVE_INFINITY,
    mediaStart: readLinkTiming(el).mediaStart,
  };
}
