/**
 * Runtime diagnostic helpers for best-effort operations.
 *
 * Many runtime operations (postMessage to a parent frame, `media.play()` /
 * `pause()` / `currentTime=`, timeline `seek()`, anime.js feature detection,
 * etc.) can throw under perfectly normal conditions: the parent frame is
 * cross-origin, autoplay is denied, the media element was just removed from
 * the DOM, the timeline has been disposed, the host page does not include
 * anime.js. The right behaviour in each case is "tried, didn't work, move
 * on" — but emitting nothing makes silent failures invisible to anyone
 * debugging a genuinely broken composition, and the bare `catch {}` shape
 * also trips strict lint configurations on the inlined runtime IIFE.
 *
 * `swallow(label, err)` is the single funnel for these intentional silences.
 * It dispatches to:
 *
 *   - `console.debug` with the label, the error, and a `[hyperframes]` prefix
 *     when `window.__hfDebug === true` (or the legacy `__HYPERFRAMES_DEBUG`
 *     env-style global). Quiet by default; flip the flag in DevTools when
 *     hunting a regression.
 *   - A custom `__hf.onSwallowed` handler if installed — lets the studio /
 *     embeddings collect runtime swallow events without polluting the page
 *     console.
 *
 * Production behaviour without either flag set: completely silent, just
 * like the original empty `catch {}`. The shape is also lint-clean — the
 * helper call is a real statement, so no `no-empty` warnings ship in the
 * inlined IIFE.
 */
import { getDebugSurface } from "./globals.js";

/** The named error readiness waits fail with once start-up or the render-ready publish throws; it stays set. */
export function recordStartupError(error: unknown): void {
  let detail = "unknown error";
  try {
    detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  } catch (err) {
    swallow("runtime.startupError", err);
  }
  (window as Window & { __hfStartupError?: string }).__hfStartupError =
    `HyperFrames runtime failed: ${detail}. Check the composition's scripts and window.__timelines ` +
    `entries; if they look right, report this as a HyperFrames bug.`;
}

/**
 * A rejected `window.__hf.buildReady[key]` is the composition saying its own setup failed, so
 * readiness waits (render, snapshot, check) fail with the key and reason instead of capturing an
 * unbuilt scene. Returns the recorded message so a teardown can clear exactly this error.
 */
export function recordBuildReadyRejection(key: string, error: unknown): string {
  let detail = "unknown error";
  try {
    detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  } catch (err) {
    swallow("runtime.buildReadyRejection", err);
  }
  const message =
    `window.__hf.buildReady[${JSON.stringify(key)}] rejected: ${detail}. ` +
    `The composition reported that its own setup failed, so it cannot be rendered. Fix that ` +
    `setup, or resolve the promise only once the scene is drawable.`;
  (window as Window & { __hfStartupError?: string }).__hfStartupError = message;
  return message;
}

export function swallow(label: string, error?: unknown): void {
  if (typeof window === "undefined") return;
  const w = getDebugSurface();

  const handler = w.__hf?.onSwallowed;
  if (handler) {
    try {
      handler({ label, error });
    } catch (handlerError) {
      // Don't recurse into swallow() — a consumer hook that throws
      // shouldn't be allowed to take down the runtime, and routing the
      // failure back through swallow() would loop. Drop on the floor;
      // the original error already had its surface above.
      void handlerError;
    }
  }

  if (w.__hfDebug || w.__HYPERFRAMES_DEBUG) {
    // eslint-disable-next-line no-console -- intentional debug surface
    console.debug(`[hyperframes] ${label} swallowed:`, error);
  }
}
