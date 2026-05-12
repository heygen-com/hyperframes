import type { RuntimeDeterministicAdapter } from "../types";
import { swallow } from "../diagnostics";

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
 *
 * Multiple canvases / renderers are supported — each just listens for the
 * same `"hf-seek"` event.
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
      try {
        window.dispatchEvent(new CustomEvent("hf-seek", { detail: { time: forcedTime } }));
      } catch (err) {
        swallow("runtime.adapters.typegpu.site1", err);
      }
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
