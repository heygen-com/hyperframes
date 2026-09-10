/**
 * Shared fixture for the runtime suites that drive real seeks through
 * `initSandboxRuntimeModular` — the timing-resolver scoping suite and the media
 * clip index suite.
 *
 * Not a `.test.ts` file on purpose: vitest's `include` is `src/**\/*.test.ts`,
 * so this is imported, never collected. Each suite keeps its own `vi.mock`
 * calls, which are file-scoped and cannot be shared.
 */
import type { RuntimeTimelineLike } from "./types";

/** A paused timeline of a fixed duration, registered on `window.__timelines`.
 *  The runtime only syncs a clock duration when a timeline is BOUND, so a
 *  fixture without one never reaches the code these suites are about. */
export function createMockTimeline(duration: number): RuntimeTimelineLike {
  const state = { time: 0, paused: true };
  return {
    play: () => {
      state.paused = false;
    },
    pause: () => {
      state.paused = true;
    },
    seek: (time?: number) => (time === undefined ? state.time : (state.time = time)),
    totalTime: (time?: number) => (time === undefined ? state.time : (state.time = time)),
    time: () => state.time,
    duration: () => duration,
    add: () => {},
    paused: (value?: boolean) =>
      typeof value === "boolean" ? (state.paused = value) : state.paused,
    timeScale: () => {},
    set: () => {},
    getChildren: () => [],
  };
}

/** Empty document plus the `CSS.escape` jsdom does not ship, which the runtime's
 *  selector building needs. */
export function resetRuntimeFixtureDom(): void {
  document.body.innerHTML = "";
  (globalThis as typeof globalThis & { CSS?: { escape?: (value: string) => string } }).CSS ??= {};
  globalThis.CSS.escape ??= (value: string) => value;
}

/** Run every animation frame callback immediately, so a test can drive the
 *  transport without waiting on a real frame clock. */
export function installImmediateAnimationFrame(): void {
  window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = (() => {}) as typeof window.cancelAnimationFrame;
}

/** jsdom leaves `duration` as NaN; a writable getter also lets a test mimic the
 *  `el.load()` reset `syncRuntimeMedia` performs on the seek-retry path. */
export function stubDuration(
  el: HTMLMediaElement,
  initial: number,
): { set: (next: number) => void } {
  let value = initial;
  Object.defineProperty(el, "duration", { get: () => value, configurable: true });
  return { set: (next: number) => (value = next) };
}
