import type { RuntimeDeterministicAdapter } from "../types";
import { swallow } from "../diagnostics";

/**
 * Render-function adapter for Hyperframes.
 *
 * The lowest-common-denominator adapter: it drives compositions whose visual
 * state is a pure function of time, drawn by a callback the composition
 * registers — no animation library required. This is the seek-driven
 * replacement for the `requestAnimationFrame` loop such compositions would use
 * during live playback, and it covers hand-rolled clocks, React state
 * timelines, and `<canvas>` / demoscene effects.
 *
 * It is also the bridge for design tools that emit a time-driven render
 * function rather than a GSAP timeline (e.g. a `render(t)` over React state),
 * which previously had no adapter and so produced blank frames under capture.
 *
 * ## Usage in a composition
 *
 * Register one or more `render(timeSeconds)` callbacks. The runtime calls them
 * with the exact composition time for every captured frame, in place of the
 * `requestAnimationFrame` loop you would use for live playback:
 *
 * ```html
 * <canvas id="scene" width="1920" height="1080"></canvas>
 * <script>
 *   const ctx = document.getElementById("scene").getContext("2d");
 *   function renderAt(timeSeconds) {
 *     ctx.clearRect(0, 0, 1920, 1080);
 *     // ...draw the frame as a pure function of timeSeconds...
 *   }
 *   window.__hfRender = window.__hfRender || [];
 *   window.__hfRender.push(renderAt);
 * </script>
 * ```
 *
 * The adapter mirrors the current time onto `window.__hfTime` (seconds) while
 * driving callbacks, so helper draw routines can read the seek position
 * directly instead of `performance.now()`.
 *
 * ## Determinism
 *
 * Callbacks MUST render purely from the `timeSeconds` argument — no
 * `Date.now()`, no `performance.now()`, no unseeded randomness. The same time
 * must always produce the same frame: the runtime seeks forward, backward, and
 * out of order, and may seek the same frame more than once.
 */
type RenderFn = (timeSeconds: number) => void;

interface RenderFnWindow extends Window {
  /** Compositions register `render(timeSeconds)` callbacks here for the adapter to drive. */
  __hfRender?: RenderFn[];
  /** Current seek position in seconds, mirrored for poll-style draw helpers. */
  __hfTime?: number;
}

export function createRenderFnAdapter(): RuntimeDeterministicAdapter {
  const getCallbacks = (): RenderFn[] => {
    const list = (window as RenderFnWindow).__hfRender;
    return Array.isArray(list) ? list : [];
  };

  return {
    name: "render-fn",

    discover: () => {
      // Nothing to discover — callbacks are read lazily on seek so that
      // registrations made after bootstrap (the common case: composition
      // scripts run after the runtime mounts) are always picked up.
    },

    seek: (ctx) => {
      const callbacks = getCallbacks();
      if (callbacks.length === 0) return;
      const time = Math.max(0, Number(ctx.time) || 0);
      (window as RenderFnWindow).__hfTime = time;
      // Snapshot before iterating: a callback may register another callback,
      // and a newcomer must not be invoked mid-seek (nor loop the iteration).
      for (const render of callbacks.slice()) {
        try {
          render(time);
        } catch (err) {
          // Keep rendering the remaining callbacks if one throws.
          swallow("runtime.adapters.render-fn.site1", err);
        }
      }
    },

    pause: () => {
      // No-op: a render function is a pure function of time, so there is no
      // running clock to stop. The next seek fully defines the frame.
    },
  };
}
