/**
 * Factory for the shader-transition loading overlay DOM tree.
 *
 * Kept in its own module so the ~100-line DOM construction stays out of the
 * web component class body. The returned `ShaderLoaderElements` bag gives the
 * component direct handles to the nodes it needs to update without querying
 * the shadow DOM on every state change.
 */

import { SHADER_LOADING_PHRASES } from "./shader-options.js";

export interface ShaderLoaderElements {
  root: HTMLDivElement;
  fill: HTMLDivElement;
  title: HTMLSpanElement;
  detail: HTMLDivElement;
  transitionValue: HTMLSpanElement;
  frameLabel: HTMLSpanElement;
  frameValue: HTMLSpanElement;
  frameRow: HTMLDivElement;
}

export function createShaderLoader(): ShaderLoaderElements {
  const root = document.createElement("div");
  root.className = "hfp-shader-loader";
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");
  root.setAttribute("aria-label", "Preparing scene transitions");
  root.setAttribute("data-hyperframes-ignore", "");
  root.draggable = false;

  const blockOverlayInteraction = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  for (const eventName of [
    "selectstart",
    "dragstart",
    "pointerdown",
    "mousedown",
    "click",
    "dblclick",
    "contextmenu",
    "touchstart",
  ]) {
    root.addEventListener(eventName, blockOverlayInteraction, { capture: true });
  }

  const panel = document.createElement("div");
  panel.className = "hfp-shader-loader-panel";
  panel.draggable = false;

  const markFrame = document.createElement("div");
  markFrame.className = "hfp-shader-loader-mark";
  markFrame.draggable = false;
  markFrame.innerHTML = [
    '<svg width="78" height="78" viewBox="0 0 100 100" fill="none" aria-hidden="true" draggable="false">',
    '<path d="M10.1851 57.8021L33.1145 73.8313C36.2202 75.9978 41.5173 73.5433 42.4816 69.4984L51.7611 30.4271C52.7253 26.3822 48.5802 23.9277 44.4602 26.0942L13.917 42.1235C6.96677 45.7676 4.97564 54.1579 10.1851 57.8021Z" fill="url(#hfp-shader-loader-grad-left)"/>',
    '<path d="M87.5129 57.5141L56.9696 73.5433C52.8371 75.7098 48.7046 73.2553 49.6688 69.2104L58.9483 30.1391C59.9125 26.0942 65.2097 23.6397 68.3154 25.8062L91.2447 41.8354C96.4668 45.4796 94.4631 53.8699 87.5129 57.5141Z" fill="url(#hfp-shader-loader-grad-right)"/>',
    "<defs>",
    '<linearGradient id="hfp-shader-loader-grad-left" x1="48.5676" y1="25" x2="44.7804" y2="71.9384" gradientUnits="userSpaceOnUse">',
    '<stop stop-color="#06E3FA"/>',
    '<stop offset="1" stop-color="#4FDB5E"/>',
    "</linearGradient>",
    '<linearGradient id="hfp-shader-loader-grad-right" x1="54.8282" y1="73.8392" x2="72.0989" y2="32.8932" gradientUnits="userSpaceOnUse">',
    '<stop stop-color="#06E3FA"/>',
    '<stop offset="1" stop-color="#4FDB5E"/>',
    "</linearGradient>",
    "</defs>",
    "</svg>",
  ].join("");

  const titleContainer = document.createElement("div");
  titleContainer.className = "hfp-shader-loader-title";
  const titleText = document.createElement("span");
  titleText.className = "hfp-shader-loader-title-text";
  titleText.textContent = SHADER_LOADING_PHRASES[0] || "Preparing scene transitions";
  titleContainer.appendChild(titleText);

  const detail = document.createElement("div");
  detail.className = "hfp-shader-loader-detail";
  detail.textContent = "Rendering animated scene samples for shader transitions.";

  const track = document.createElement("div");
  track.className = "hfp-shader-loader-track";
  track.setAttribute("aria-hidden", "true");
  const fill = document.createElement("div");
  fill.className = "hfp-shader-loader-fill";
  track.appendChild(fill);

  const progress = document.createElement("div");
  progress.className = "hfp-shader-loader-progress";
  const createProgressRow = (labelText: string) => {
    const row = document.createElement("div");
    row.className = "hfp-shader-loader-row";
    const label = document.createElement("span");
    label.className = "hfp-shader-loader-label";
    label.textContent = labelText;
    const value = document.createElement("span");
    value.className = "hfp-shader-loader-value";
    row.appendChild(label);
    row.appendChild(value);
    progress.appendChild(row);
    return { row, label, value };
  };
  const transitionStatus = createProgressRow("transition");
  const frameStatus = createProgressRow("transition frame");

  panel.appendChild(markFrame);
  panel.appendChild(titleContainer);
  panel.appendChild(detail);
  panel.appendChild(track);
  panel.appendChild(progress);
  root.appendChild(panel);

  return {
    root,
    fill,
    title: titleText,
    detail,
    transitionValue: transitionStatus.value,
    frameLabel: frameStatus.label,
    frameValue: frameStatus.value,
    frameRow: frameStatus.row,
  };
}
