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
