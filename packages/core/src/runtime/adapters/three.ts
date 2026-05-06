import type { RuntimeDeterministicAdapter } from "../types";

/**
 * Three.js / WebGL deterministic adapter.
 *
 * Compositions can render frames driven by HyperFrames time using either:
 *
 * 1. **Direct render-callback registry (recommended).** Push a `(time) => void`
 *    callback into `window.__hfThreeRender`. The adapter invokes every
 *    registered callback synchronously on each seek, before the legacy event
 *    is dispatched:
 *      ```js
 *      window.__hfThreeRender = window.__hfThreeRender || [];
 *      window.__hfThreeRender.push(renderAt);
 *      renderAt(window.__hfThreeTime || 0);
 *      ```
 *    This mirrors the `__hfAnime` / `__hfLottie` registry convention used by
 *    sibling adapters and is robust against listener-registration ordering and
 *    execution-context isolation that can swallow `CustomEvent` dispatches
 *    during render mode (see #584).
 *
 * 2. **Legacy `hf-seek` event.** A `CustomEvent("hf-seek", { detail: { time } })`
 *    is dispatched on `window` after every callback runs. Existing
 *    compositions using `window.addEventListener("hf-seek", ...)` keep working
 *    unchanged.
 *
 * `window.__hfThreeTime` is also written on every seek for compositions that
 * poll the latest time outside of either dispatch path.
 */
export function createThreeAdapter(): RuntimeDeterministicAdapter {
  let forcedTime: number | null = null;
  let lastForcedTime = 0;

  return {
    name: "three",
    discover: () => {},
    seek: (ctx) => {
      const time = Math.max(0, Number(ctx.time) || 0);
      forcedTime = time;
      lastForcedTime = time;
      (window as ThreeAdapterWindow).__hfThreeTime = time;
      const callbacks = (window as ThreeAdapterWindow).__hfThreeRender;
      if (Array.isArray(callbacks)) {
        for (const cb of callbacks) {
          try {
            if (typeof cb === "function") cb(time);
          } catch {
            // ignore per-callback failures — keep iterating so one broken
            // composition layer can't starve sibling layers of seeks.
          }
        }
      }
      try {
        window.dispatchEvent(new CustomEvent("hf-seek", { detail: { time } }));
      } catch {
        // ignore custom event failures
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
      // Don't clear __hfThreeRender — callbacks are owned by the composition.
    },
  };
}

interface ThreeAdapterWindow extends Window {
  __hfThreeTime?: number;
  /** Render callbacks registered by compositions for the adapter to invoke on each seek. */
  __hfThreeRender?: ((time: number) => void)[];
}
