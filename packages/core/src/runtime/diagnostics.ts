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
    if (error instanceof Error) {
      detail = `${error.name}: ${error.message}`;
      detail += startupErrorStack(error, detail);
    } else {
      detail = String(error);
    }
  } catch (err) {
    swallow("runtime.startupError", err);
  }
  detail = detail.replace(/\s+/g, " ").trim();
  (window as Window & { __hfStartupError?: string }).__hfStartupError =
    `HyperFrames runtime failed: ${detail}. Check the composition's scripts and window.__timelines ` +
    `entries; if they look right, report this as a HyperFrames bug.`;
}

/** Starts the warning for a scene callback that threw; the render log shows it once per render. */
export const SCENE_CALLBACK_ERROR_PREFIX = "[hyperframes] scene timeline callback threw:";

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

function isCompositionFrame(frame: string): boolean {
  const location = /(?:\(|@|\bat )(\S+?):\d+(?::\d+)?\)?$/.exec(frame)?.[1];
  if (!location || location.startsWith("hyperframes://")) return false;
  return (
    location.startsWith("hyperframes-composition://") ||
    /\.html?(?:[?#]|$)/i.test(location) ||
    (typeof document !== "undefined" && location === document.URL)
  );
}

function startupErrorStack(error: Error, header: string): string {
  try {
    const stack = error.stack;
    if (typeof stack !== "string") return "";
    const hasHeader =
      stack === header || stack.startsWith(`${header}\n`) || stack.startsWith(`${header}\r`);
    const body = hasHeader ? stack.slice(header.length) : stack;
    const frames = body
      .split(/[\r\n]+/)
      .map((line) => line.trim().replace(/\s+/g, " "))
      .filter((line) => /^at\s+\S/.test(line) || /^[^@]*@.+:\d+(?::\d+)?$/.test(line));
    const selected = frames.slice(0, 3);
    const composition = frames.find(isCompositionFrame);
    if (composition && !selected.includes(composition)) selected.push(composition);
    return selected.length ? ` [thrown at: ${selected.join(" <- ")}]` : "";
  } catch (err) {
    swallow("runtime.startupError.stack", err);
    return "";
  }
}
