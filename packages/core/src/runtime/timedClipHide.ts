// Hides timed non-media clips from script evaluation until the first visibility pass decides them;
// before it, a paused page painted every clip at once. Media is left to init's media pass.
// The rule and its flag live on the page, so every runtime copy shares them.
const HIDE_ATTR = "data-hf-first-pass-hide";
const HIDE_UNTIL_FIRST_PASS =
  "[data-start]:not(video, audio, img) { visibility: hidden !important; }";

type FirstPassWindow = Window & {
  __hfFirstPassHidden?: boolean;
  __hyperframeRuntimeBootstrapped?: boolean;
};

export function hideTimedClipsUntilFirstPass(): void {
  if (typeof document === "undefined") return;
  const win = window as FirstPassWindow;
  // A runtime that already initialised may never run another pass to lift a new rule.
  if (win.__hfFirstPassHidden || win.__hyperframeRuntimeBootstrapped) return;
  const parent = document.head ?? document.documentElement;
  if (!parent) return;
  const style = document.createElement("style");
  style.setAttribute(HIDE_ATTR, "");
  style.textContent = HIDE_UNTIL_FIRST_PASS;
  parent.appendChild(style);
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
