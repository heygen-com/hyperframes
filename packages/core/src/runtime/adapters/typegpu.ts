import type { RuntimeDeterministicAdapter } from "../types";
import { dispatchSeekEvent } from "./seek-dispatch";

/**
 * TypeGPU / WebGPU adapter for HyperFrames
 *
 * Enables seekable GPU-rendered compositions built with TypeGPU or raw WebGPU.
 * Since WebGPU pipelines are not introspectable from outside (unlike GSAP
 * timelines or Lottie instances), this adapter uses the same push+poll pattern
 * as the Three.js adapter:
 *
 *   - `window.__hfTypegpuTime` — poll this from your rAF/render loop instead
 *     of `performance.now()` to get the current seek position in seconds.
 *
 *   - `"hf-seek"` CustomEvent on `window` — listen for this to imperatively
 *     re-render a single frame at the new seek position.
 *
 * ## Usage in a composition
 *
 * ```html
 * <canvas id="gpu-canvas" width="1920" height="1080"></canvas>
 * <script type="module">
 *   const adapter = await navigator.gpu.requestAdapter();
 *   const device  = await adapter.requestDevice();
 *   // ... build your pipeline ...
 *
 *   function render(timeSeconds) {
 *     // update your time uniform and submit a draw call
 *     device.queue.writeBuffer(uniformBuf, 0, new Float32Array([timeSeconds]));
 *     // ... submit command encoder ...
 *   }
 *
 *   // Seek: fired by HyperFrames whenever the player scrubs or plays
 *   window.addEventListener("hf-seek", (e) => render(e.detail.time));
 *
 *   // Initial frame at t=0
 *   render(window.__hfTypegpuTime ?? 0);
 * </script>
 * ```
 *
 * Works with TypeGPU (https://docs.swmansion.com/TypeGPU) and raw WebGPU alike.
 * The adapter makes no assumptions about how the pipeline is constructed.
 * Multiple canvases / renderers are supported — each listens for the same event.
 *
 * ## Render-mode determinism
 *
 * For frame-perfect video renders, call `await device.queue.onSubmittedWorkDone()`
 * after each `render(time)` invocation before the frame is captured. This ensures
 * the GPU has finished writing to the canvas before the engine screenshots it.
 *
 * ## Browser feature detection
 *
 * Always guard against environments where WebGPU is unavailable:
 *
 * ```js
 * if (!navigator.gpu) { /* fallback or early return *\/ }
 * const adapter = await navigator.gpu.requestAdapter();
 * if (!adapter)       { /* GPU unavailable — software fallback *\/ }
 * ```
 *
 * The adapter itself does not check for WebGPU support — that is the
 * composition author's responsibility.
 */
export function createTypegpuAdapter(): RuntimeDeterministicAdapter {
  let forcedTime: number | null = null;
  let lastForcedTime = 0;

  return {
    name: "typegpu",

    discover: () => {
      // WebGPU pipelines have no global registry — nothing to auto-discover.
    },

    seek: (ctx) => {
      forcedTime = Math.max(0, Number(ctx.time) || 0);
      lastForcedTime = forcedTime;
      window.__hfTypegpuTime = forcedTime;
      dispatchSeekEvent(forcedTime);
    },

    pause: () => {
      if (forcedTime == null) {
        forcedTime = Math.max(0, lastForcedTime);
      }
    },

    play: () => {
      forcedTime = null;
    },

    revert: () => {
      forcedTime = null;
      lastForcedTime = 0;
    },
  };
}
