import { STUDIO_PREVIEW_MARK_META, STUDIO_PREVIEW_UPCOMING_ATTR } from "../studioPreviewMark";

// Hides timed non-media clips from script evaluation until the first visibility pass decides them;
// before it, a paused page painted every clip at once. Media is left to init's media pass.
// The rule and its flag live on the page, so every runtime copy shares them.
const HIDE_ATTR = "data-hf-first-pass-hide";
const HIDE_UNTIL_FIRST_PASS =
  "[data-start]:not(video, audio, img) { visibility: hidden !important; }";
const PREVIEW_HIDE_UNTIL_FIRST_PASS = 'img[loading="lazy"] { display: none !important; }';
const SKIP_ATTR = "data-hf-skip-hidden-images";
export const SKIPPED_CLIP = `[data-start]:not(video, audio, img, [${STUDIO_PREVIEW_UPCOMING_ATTR}])[style*="visibility: hidden"]`;
const SKIP_HIDDEN_IMAGES = `${SKIPPED_CLIP} img { display: none !important; }`;
const STUDIO_PREVIEW_MARK = `meta[name="${STUDIO_PREVIEW_MARK_META}"]`;

type FirstPassWindow = Window & {
  __hfFirstPassHidden?: boolean;
  __hyperframeRuntimeBootstrapped?: boolean;
};

function appendStyle(parent: Element, attr: string, css: string): void {
  const style = document.createElement("style");
  style.setAttribute(attr, "");
  style.textContent = css;
  parent.appendChild(style);
}

/** True in Studio's preview, where hidden clips' images are neither fetched nor decoded until due. */
export function skipsHiddenImages(): boolean {
  return document.querySelector(`style[${SKIP_ATTR}]`) !== null;
}

export function hideTimedClipsUntilFirstPass(): void {
  if (typeof document === "undefined") return;
  const parent = document.head ?? document.documentElement;
  if (!parent) return;
  const preview = document.querySelector(STUDIO_PREVIEW_MARK) !== null;
  if (preview && !skipsHiddenImages()) appendStyle(parent, SKIP_ATTR, SKIP_HIDDEN_IMAGES);
  const win = window as FirstPassWindow;
  // A runtime that already initialised may never run another pass to lift a new rule.
  if (win.__hfFirstPassHidden || win.__hyperframeRuntimeBootstrapped) return;
  const css = preview
    ? `${HIDE_UNTIL_FIRST_PASS} ${PREVIEW_HIDE_UNTIL_FIRST_PASS}`
    : HIDE_UNTIL_FIRST_PASS;
  appendStyle(parent, HIDE_ATTR, css);
  win.__hfFirstPassHidden = true;
}

/** True when this call lifted the rule; callers then re-register what skipped hidden elements (grading). */
export function revealTimedClipsAfterFirstPass(): boolean {
  const win = window as FirstPassWindow;
  if (!win.__hfFirstPassHidden) return false;
  win.__hfFirstPassHidden = false;
  for (const style of document.querySelectorAll(`style[${HIDE_ATTR}]`)) style.remove();
  return true;
}
