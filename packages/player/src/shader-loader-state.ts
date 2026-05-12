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

export class ShaderLoaderState {
  private readonly _el: ShaderLoaderElements;
  private _hideTimeout: ReturnType<typeof setTimeout> | null = null;

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

  reset(): void {
    if (this._hideTimeout) {
      clearTimeout(this._hideTimeout);
      this._hideTimeout = null;
    }
    this._el.root.classList.remove("hfp-visible", "hfp-hiding");
    this._el.fill.style.transform = "scaleX(0)";
    this._el.transitionValue.textContent = "";
    this._el.frameValue.textContent = "";
    this._el.frameRow.style.visibility = "hidden";
  }

  update(status: ShaderTransitionState, loadingMode: string): void {
    if (loadingMode !== "player") {
      this.reset();
      return;
    }
    if (status.ready || !status.loading) {
      this.hide();
      return;
    }

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

    this._el.transitionValue.textContent =
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

    this._el.frameValue.textContent = frameValue;
    this._el.frameRow.style.visibility = frameValue ? "visible" : "hidden";
    this._el.root.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
    this.show();
  }

  get hideTimeout(): ReturnType<typeof setTimeout> | null {
    return this._hideTimeout;
  }

  destroy(): void {
    if (this._hideTimeout) {
      clearTimeout(this._hideTimeout);
      this._hideTimeout = null;
    }
  }

  private _scheduleCleanup(): void {
    if (this._hideTimeout) clearTimeout(this._hideTimeout);
    this._hideTimeout = setTimeout(() => {
      this._el.root.classList.remove("hfp-hiding");
      this._hideTimeout = null;
    }, HIDE_TRANSITION_MS);
  }
}
