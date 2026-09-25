// Until the first visibility pass decides each timed clip, a paused page would paint every clip at once
// (and decode every scene's images). Media is left out: init's media pass owns it.
const HIDE_UNTIL_FIRST_PASS =
  "[data-start]:not(video, audio, img) { visibility: hidden !important; }";

let hideStyle: HTMLStyleElement | null = null;

export function hideTimedClipsUntilFirstPass(): void {
  if (hideStyle || typeof document === "undefined") return;
  const parent = document.head ?? document.documentElement;
  if (!parent) return;
  hideStyle = document.createElement("style");
  hideStyle.textContent = HIDE_UNTIL_FIRST_PASS;
  parent.appendChild(hideStyle);
}

export function revealTimedClipsAfterFirstPass(): void {
  hideStyle?.remove();
  hideStyle = null;
}
