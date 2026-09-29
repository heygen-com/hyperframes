export const AUDIBLE_VIDEO_QUALIFIER =
  ':not([muted]):not([data-has-audio="false"]):not([data-has-audio=""])';

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
