import type { StylableElement } from "./domRealm";
import { swallow } from "./diagnostics";
import {
  RUNTIME_STAMPED_ATTR,
  STUDIO_PREVIEW_MARK_META,
  STUDIO_PREVIEW_UPCOMING_ATTR,
} from "../studioPreviewMark";

// Hides timed non-media clips from script evaluation until the first visibility pass decides them;
// before it, a paused page painted every clip at once. Media is left to init's media pass.
// The rule and its flag live on the page, so every runtime copy shares them.
const HIDE_ATTR = "data-hf-first-pass-hide";
const HIDE_UNTIL_FIRST_PASS =
  "[data-start]:not(video, audio, img) { visibility: hidden !important; }";
const PREVIEW_HIDE_UNTIL_FIRST_PASS = 'img[loading="lazy"] { display: none !important; }';
const SKIP_ATTR = "data-hf-skip-hidden-images";
export const SKIPPED_CLIP = `[data-start]:not(video, audio, img, [${STUDIO_PREVIEW_UPCOMING_ATTR}], [${RUNTIME_STAMPED_ATTR}])[style*="visibility: hidden"]`;
const SKIP_HIDDEN_IMAGES = `${SKIPPED_CLIP} img { display: none !important; }`;
const STUDIO_PREVIEW_MARK = `meta[name="${STUDIO_PREVIEW_MARK_META}"]`;
export const CLIP_HIDDEN_ATTR = "data-hf-clip-hidden";
const CONTENTS_ATTR = "data-hf-hidden-clip-contents";
export const FILTER_SAMPLING_ATTR = "data-hf-filter-sampling";
const HIDDEN_CLIP = `[${CLIP_HIDDEN_ATTR}][style*="visibility: hidden"]`;
const FILTERED_CLIP = `${HIDDEN_CLIP}:not([${FILTER_SAMPLING_ATTR}])`;
// feColorMatrix can make hidden input opaque; filter the final group without changing layout.
const HIDE_HIDDEN_CLIP_CONTENTS = `${HIDDEN_CLIP} * { visibility: hidden !important; }
${FILTERED_CLIP} { filter: opacity(0) !important; }`;

function isHostFilterTransition(animation: Animation, el: StylableElement): boolean {
  if (!("transitionProperty" in animation)) return false;
  if (
    animation.transitionProperty !== "filter" &&
    animation.transitionProperty !== "-webkit-filter"
  )
    return false;
  const effect = animation.effect;
  return Boolean(
    effect &&
    "target" in effect &&
    effect.target === el &&
    !("pseudoElement" in effect && effect.pseudoElement),
  );
}

type PaintChange = { el: StylableElement; hidden: boolean; change: () => void };

function changeClipPaintBatch(changes: PaintChange[]): void {
  const before = changes.map(({ el, hidden }) =>
    el.matches(FILTERED_CLIP) !== hidden && typeof el.getAnimations === "function"
      ? new Set(el.getAnimations())
      : null,
  );
  for (const { change } of changes) change();
  const after = changes.map(({ el }, i) => (before[i] ? el.getAnimations() : []));
  for (const [i, { el }] of changes.entries()) {
    // Finish only new gate transitions; authored, descendant, and pseudo effects keep running.
    for (const animation of after[i] ?? []) {
      if (before[i]?.has(animation) || !isHostFilterTransition(animation, el)) continue;
      try {
        animation.finish();
      } catch (err) {
        swallow("runtime.timedClipHide.finishGateTransition", err);
      }
    }
  }
}

function changeClipPaint(el: StylableElement, hidden: boolean, change: () => void): void {
  changeClipPaintBatch([{ el, hidden: hidden && !el.hasAttribute(FILTER_SAMPLING_ATTR), change }]);
}

/** null leaves Studio-stamped visibility authored while removing its runtime hide flag. */
export function setTimedClipVisibility(
  el: StylableElement,
  visibility: "hidden" | "visible" | null,
): void {
  changeClipPaint(el, visibility === "hidden", () => {
    if (visibility !== null) el.style.visibility = visibility;
    el.toggleAttribute(CLIP_HIDDEN_ATTR, visibility === "hidden");
  });
}

/** Change visibility without taking ownership of the runtime's hide marker. */
export function setTimedClipPaintVisibility(el: StylableElement, visibility: string): void {
  changeClipPaint(el, el.hasAttribute(CLIP_HIDDEN_ATTR) && visibility === "hidden", () => {
    el.style.visibility = visibility;
  });
}

export function showHiddenClips(): () => void {
  const hidden = Array.from(document.querySelectorAll<StylableElement>(HIDDEN_CLIP));
  for (const el of hidden) setTimedClipPaintVisibility(el, "visible");
  return () => {
    for (const el of hidden) setTimedClipPaintVisibility(el, "hidden");
  };
}

export function showHiddenClipFilters(root: Document = document): () => void {
  const hidden = Array.from(root.querySelectorAll<StylableElement>(FILTERED_CLIP));
  changeClipPaintBatch(
    hidden.map((el) => ({
      el,
      hidden: false,
      change: () => el.setAttribute(FILTER_SAMPLING_ATTR, ""),
    })),
  );
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    changeClipPaintBatch(
      hidden.map((el) => ({
        el,
        hidden: el.matches(HIDDEN_CLIP),
        change: () => el.removeAttribute(FILTER_SAMPLING_ATTR),
      })),
    );
  };
}

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
  if (!document.querySelector(`style[${CONTENTS_ATTR}]`))
    appendStyle(parent, CONTENTS_ATTR, HIDE_HIDDEN_CLIP_CONTENTS);
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
