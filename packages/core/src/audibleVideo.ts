export const AUDIBLE_MEDIA_SELECTOR =
  'audio[data-start], video[data-start]:not([muted]):not([data-has-audio="false"]):not([data-has-audio=""])';

export function isAudibleVideoElement(el: {
  tagName: string;
  hasAttribute(name: string): boolean;
  getAttribute(name: string): string | null;
}): boolean {
  if (el.tagName.toLowerCase() !== "video" || el.hasAttribute("muted")) return false;
  const declared = el.getAttribute("data-has-audio");
  return declared === null || declared === "true";
}
