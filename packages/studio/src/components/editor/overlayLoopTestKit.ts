/**
 * Test-only helpers for the canvas overlay loops.
 *
 * Imported by `*.test.tsx` in this directory only. The frame counter is the
 * thing the tests actually assert on: the runtime-cost gate measures idle cost
 * as `requestAnimationFrame` calls per second, so the unit tests measure the
 * same quantity rather than a proxy for it.
 */
import { act } from "react";

const nativeRequestAnimationFrame = globalThis.requestAnimationFrame;

/** Advance `count` real frames, flushing React work scheduled by each. */
export async function flushAnimationFrames(count = 3): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await act(
      () =>
        new Promise<void>((resolve) => {
          nativeRequestAnimationFrame(() => resolve());
        }),
    );
  }
}

/**
 * Count every frame scheduled from now on. Call `restoreAnimationFrameCounter`
 * (or let the suite's afterEach do it) once the assertion is made.
 */
export function countScheduledFrames(): () => number {
  let scheduled = 0;
  globalThis.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    scheduled += 1;
    return nativeRequestAnimationFrame(callback);
  };
  return () => scheduled;
}

export function restoreAnimationFrameCounter(): void {
  globalThis.requestAnimationFrame = nativeRequestAnimationFrame;
}

export function testDomRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

/**
 * happy-dom holds each MutationObserver's delivery callback only via a WeakRef,
 * so a GC between observe() and a mutation silently stops delivery and any test
 * that drives a real observer flakes under full-suite memory pressure. Pin
 * WeakRef to a strong ref for those files.
 */
const RealWeakRef = globalThis.WeakRef;
class StrongRef<T extends WeakKey> {
  #value: T;
  constructor(value: T) {
    this.#value = value;
  }
  deref(): T {
    return this.#value;
  }
}

export function pinWeakRefStrong(): void {
  (globalThis as { WeakRef: unknown }).WeakRef = StrongRef;
}

export function unpinWeakRef(): void {
  globalThis.WeakRef = RealWeakRef;
}
