/**
 * Runtime state controller for the shader-transition loading overlay.
 *
 * Manages show/hide transitions (with a CSS fade-out delay) and updates
 * the progress bar, phrase text, and detail rows from `ShaderTransitionState`
 * messages received from the iframe.
 *
 * Holds direct references to the DOM nodes created by `createShaderLoader`
 * so state updates never touch the shadow-DOM query API at runtime.
 */

import { SHADER_LOADING_PHRASES, type ShaderTransitionState } from "./shader-options.js";
import type { ShaderLoaderElements } from "./shader-loader-element.js";

const HIDE_TRANSITION_MS = 420;

/** A progress row shows only while it has a value, so no bare label is left on the card. */
function setRowValue(row: HTMLElement, value: HTMLElement, text: string): void {
  value.textContent = text;
  row.style.visibility = text ? "visible" : "hidden";
}

export class ShaderLoaderState {
  private readonly _el: ShaderLoaderElements;
  private _hideTimeout: ReturnType<typeof setTimeout> | null = null;
  private _hiddenCallbacks: Array<() => void> = [];
  private _drawingAssets = false;

  constructor(elements: ShaderLoaderElements) {
    this._el = elements;
  }

  show(): void {
    if (this._hideTimeout) {
      clearTimeout(this._hideTimeout);
      this._hideTimeout = null;
    }
    this._el.root.classList.remove("hfp-hiding");
    this._el.root.classList.add("hfp-visible");
  }

  hide(): void {
    if (this._el.root.classList.contains("hfp-hiding")) {
      if (!this._hideTimeout) this._scheduleCleanup();
      return;
    }
    if (!this._el.root.classList.contains("hfp-visible")) return;
    this._el.root.classList.add("hfp-hiding");
    this._el.root.classList.remove("hfp-visible");
    this._scheduleCleanup();
  }

  /** Runs `cb` once the panel is fully gone: now if it is not raised or
   *  fading, otherwise when the fade's cleanup fires. */
  whenHidden(cb: () => void): void {
    const cls = this._el.root.classList;
    if (cls.contains("hfp-visible") || cls.contains("hfp-hiding")) this._hiddenCallbacks.push(cb);
    else cb();
  }

  private _flushHidden(): void {
    const callbacks = this._hiddenCallbacks;
    this._hiddenCallbacks = [];
    for (const cb of callbacks) cb();
  }

  reset(): void {
    if (this._hideTimeout) {
      clearTimeout(this._hideTimeout);
      this._hideTimeout = null;
    }
    this._el.root.classList.remove("hfp-visible", "hfp-hiding");
    this._drawingAssets = false;
    this._flushHidden();
    this._el.fill.style.transform = "scaleX(0)";
    setRowValue(this._el.transitionRow, this._el.transitionValue, "");
    setRowValue(this._el.frameRow, this._el.frameValue, "");
  }

  // fallow-ignore-next-line unused-class-member, complexity
  update(status: ShaderTransitionState, loadingMode: string): void {
    const draws = loadingMode === "player" && status.loading && !status.ready;
    // A shader message that draws nothing leaves the Loading assets card to its own owner.
    if (this._drawingAssets && !draws) return;
    if (loadingMode !== "player") {
      this.reset();
      return;
    }
    if (status.ready || !status.loading) {
      this.hide();
      return;
    }
    // showAssetsLoading() may have left "Loading assets" here for a prior
    // show; this path owns the label whenever it's the one drawing the panel.
    this._el.root.setAttribute("aria-label", "Preparing scene transitions");
    this._drawingAssets = false;

    const progress =
      typeof status.progress === "number" && Number.isFinite(status.progress) ? status.progress : 0;
    const total =
      typeof status.total === "number" && Number.isFinite(status.total) ? status.total : 0;
    const ratio = total > 0 ? Math.min(1, Math.max(0, progress / total)) : 0;

    const phraseIndex = Math.min(
      SHADER_LOADING_PHRASES.length - 1,
      Math.floor(ratio * SHADER_LOADING_PHRASES.length),
    );
    this._el.title.textContent =
      SHADER_LOADING_PHRASES[phraseIndex] || "Preparing scene transitions";

    this._el.detail.textContent =
      status.phase === "cached"
        ? "Loading cached transition frames before playback."
        : status.phase === "finalizing"
          ? "Uploading transition textures for smooth playback."
          : "Rendering animated scene samples for shader transitions.";

    this._el.fill.style.transform = `scaleX(${ratio})`;

    // fallow-ignore-next-line code-duplication
    const transitionValue =
      status.currentTransition !== undefined && status.transitionTotal !== undefined
        ? `${status.currentTransition}/${status.transitionTotal}`
        : total > 0
          ? `${progress}/${total}`
          : "";

    const frameValue =
      status.transitionFrame !== undefined && status.transitionFrames !== undefined
        ? `${status.transitionFrame}/${status.transitionFrames}`
        : "";

    this._el.frameLabel.textContent =
      status.phase === "cached"
        ? "cached transition frames"
        : status.phase === "finalizing"
          ? "finalizing transition frames"
          : "rendering transition frames";

    setRowValue(this._el.transitionRow, this._el.transitionValue, transitionValue);
    setRowValue(this._el.frameRow, this._el.frameValue, frameValue);
    this._el.root.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
    this.show();
  }

  /** Second reason to show the same overlay — reuses the shader-transition
   *  panel's DOM rather than drawing a second one. */
  showAssetsLoading(): void {
    this.reset();
    this._el.title.textContent = "Loading assets";
    this._el.detail.textContent = "Waiting for images, video and fonts to finish loading.";
    this._el.root.setAttribute("aria-label", "Loading assets");
    this._drawingAssets = true;
    this.show();
  }

  /** Hides the panel only while it is the Loading assets card, never a shader load drawn over it. */
  hideAssetsLoading(): void {
    if (this._drawingAssets) this.hide();
  }

  // fallow-ignore-next-line unused-class-member
  get hideTimeout(): ReturnType<typeof setTimeout> | null {
    return this._hideTimeout;
  }

  destroy(): void {
    if (this._hideTimeout) {
      clearTimeout(this._hideTimeout);
      this._hideTimeout = null;
    }
    this._hiddenCallbacks = [];
  }

  private _scheduleCleanup(): void {
    if (this._hideTimeout) clearTimeout(this._hideTimeout);
    this._hideTimeout = setTimeout(() => {
      this._el.root.classList.remove("hfp-hiding");
      this._hideTimeout = null;
      this._flushHidden();
    }, HIDE_TRANSITION_MS);
  }
}
