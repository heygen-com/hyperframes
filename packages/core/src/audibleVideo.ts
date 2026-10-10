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
  /** The composition root's `data-fx-chain`: the master bus only exists in the Web Audio graph. */
  masterChain?: string | null;
}): boolean {
  return (
    (fields.volume ?? 1) > 1 ||
    Boolean(fields.fxChain || fields.automation || fields.audioGroup || fields.masterChain)
  );
}
