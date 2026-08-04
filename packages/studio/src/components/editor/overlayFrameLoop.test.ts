// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { createGestureActiveRef, createOverlayFrameLoop } from "./overlayFrameLoop";

const nativeRequestAnimationFrame = globalThis.requestAnimationFrame;

afterEach(() => {
  globalThis.requestAnimationFrame = nativeRequestAnimationFrame;
});

/** Counts every requestAnimationFrame scheduled while installed — the number the runtime-cost gate reads. */
function countScheduledFrames(): () => number {
  let scheduled = 0;
  globalThis.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    scheduled += 1;
    return nativeRequestAnimationFrame(callback);
  };
  return () => scheduled;
}

function nextFrames(count: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let remaining = count;
    const tick = () => {
      remaining -= 1;
      if (remaining <= 0) resolve();
      else nativeRequestAnimationFrame(tick);
    };
    nativeRequestAnimationFrame(tick);
  });
}

describe("createOverlayFrameLoop", () => {
  it("runs one frame per arm and then parks", async () => {
    const step = vi.fn(() => false);
    const loop = createOverlayFrameLoop(step);
    const scheduled = countScheduledFrames();

    loop.arm();
    await nextFrames(6);

    expect(step).toHaveBeenCalledTimes(1);
    expect(scheduled()).toBe(1);
    loop.stop();
  });

  it("keeps running while the step reports work left", async () => {
    let remaining = 3;
    const step = vi.fn(() => {
      remaining -= 1;
      return remaining > 0;
    });
    const loop = createOverlayFrameLoop(step);

    loop.arm();
    await nextFrames(8);

    expect(step).toHaveBeenCalledTimes(3);
    loop.stop();
  });

  it("does not double-schedule when armed again while already armed", async () => {
    const step = vi.fn(() => false);
    const loop = createOverlayFrameLoop(step);
    const scheduled = countScheduledFrames();

    loop.arm();
    loop.arm();
    loop.arm();
    await nextFrames(4);

    expect(scheduled()).toBe(1);
    expect(step).toHaveBeenCalledTimes(1);
    loop.stop();
  });

  it("cancels a scheduled frame on stop and refuses to be re-armed after it", async () => {
    const step = vi.fn(() => true);
    const loop = createOverlayFrameLoop(step);

    loop.arm();
    loop.stop();
    loop.arm();
    await nextFrames(6);

    expect(step).not.toHaveBeenCalled();
  });
});

describe("createGestureActiveRef", () => {
  it("notifies on a change and stays quiet on a rewrite of the same value", () => {
    const ref = createGestureActiveRef();
    const listener = vi.fn();
    const unsubscribe = ref.subscribe(listener);

    ref.current = true;
    ref.current = true;
    expect(ref.current).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    ref.current = false;
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    ref.current = true;
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
