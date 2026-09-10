// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  IDLE_POLL_MS,
  requestOverlayFrames,
  resetOverlayFrameLoopForTests,
  subscribeOverlayFrame,
} from "./overlayFrameLoop";

/**
 * The editor's overlay polls run on one shared, parkable frame loop. The two
 * things that must hold: it stops asking for frames when nothing is happening,
 * and every route by which something CAN happen starts it again.
 */
describe("overlay frame loop", () => {
  const originalRaf = window.requestAnimationFrame;
  const originalCancelRaf = window.cancelAnimationFrame;
  let queued: Array<() => void>;

  /** Run whatever frames are queued, once. */
  const step = (): number => {
    const batch = queued;
    queued = [];
    for (const callback of batch) callback();
    return batch.length;
  };

  /** Frames requested over `ms` of wall time, stepping each one. */
  const framesOver = (ms: number): number => {
    let frames = 0;
    for (let elapsed = 0; elapsed < ms; elapsed += 16) {
      vi.advanceTimersByTime(16);
      frames += step();
    }
    return frames;
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
    queued = [];
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      queued.push(() => callback(performance.now()));
      return queued.length;
    }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = (() => {
      queued = [];
    }) as typeof window.cancelAnimationFrame;
  });

  afterEach(() => {
    resetOverlayFrameLoopForTests();
    vi.useRealTimers();
    window.requestAnimationFrame = originalRaf;
    window.cancelAnimationFrame = originalCancelRaf;
  });

  it("runs every subscriber on one frame, not one frame each", () => {
    const calls: string[] = [];
    subscribeOverlayFrame(() => calls.push("a"));
    subscribeOverlayFrame(() => calls.push("b"));
    expect(step()).toBe(1);
    expect(calls).toEqual(["a", "b"]);
  });

  it("drops to the idle poll rate once nothing has happened", () => {
    let runs = 0;
    subscribeOverlayFrame(() => {
      runs += 1;
    });
    // Awake first: the subscriber has never read anything.
    framesOver(500);
    const runsWhileAwake = runs;
    runs = 0;
    framesOver(1000);
    // A second of silence is four idle polls, not sixty frames.
    expect(runsWhileAwake).toBeGreaterThan(10);
    expect(runs).toBeLessThanOrEqual(Math.ceil(1000 / IDLE_POLL_MS) + 1);
  });

  it("wakes to full rate on a pointer event", () => {
    let runs = 0;
    subscribeOverlayFrame(() => {
      runs += 1;
    });
    framesOver(1000);
    runs = 0;
    window.dispatchEvent(new Event("pointermove"));
    expect(framesOver(200)).toBeGreaterThan(5);
    expect(runs).toBeGreaterThan(5);
  });

  const previewState = (frame: number, isPlaying = false): void => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { source: "hf-preview", type: "state", frame, isPlaying },
      }),
    );
  };

  it("wakes to full rate when the preview reports a new frame", () => {
    let runs = 0;
    subscribeOverlayFrame(() => {
      runs += 1;
    });
    previewState(0);
    framesOver(1000);
    runs = 0;
    previewState(1);
    framesOver(200);
    expect(runs).toBeGreaterThan(5);
  });

  it("ignores the paused heartbeat, which repeats a frame the overlays already drew", () => {
    let runs = 0;
    subscribeOverlayFrame(() => {
      runs += 1;
    });
    previewState(7);
    framesOver(1000);
    runs = 0;
    // The bridge posts an unchanged state every 80ms while paused. Treating
    // that as news would hold the overlays at 60fps for the life of the tab.
    for (let beat = 0; beat < 12; beat += 1) {
      previewState(7);
      framesOver(80);
    }
    expect(runs).toBeLessThanOrEqual(Math.ceil(960 / IDLE_POLL_MS) + 1);
  });

  it("wakes on an explicit request, which is how preview-document mutations arrive", () => {
    let runs = 0;
    subscribeOverlayFrame(() => {
      runs += 1;
    });
    framesOver(1000);
    runs = 0;
    requestOverlayFrames();
    framesOver(200);
    expect(runs).toBeGreaterThan(5);
  });

  it("stops entirely, and stops listening, once the last subscriber leaves", () => {
    let runs = 0;
    const unsubscribe = subscribeOverlayFrame(() => {
      runs += 1;
    });
    framesOver(100);
    unsubscribe();
    runs = 0;
    window.dispatchEvent(new Event("pointermove"));
    framesOver(1000);
    expect(runs).toBe(0);
    expect(queued).toHaveLength(0);
  });
});
