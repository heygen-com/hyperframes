import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeTimelineLike } from "./types";
import {
  createMockTimeline,
  installImmediateAnimationFrame,
  resetRuntimeFixtureDom,
} from "./runtimeSeekFixture.test-helpers";

/**
 * `visits` counts the media elements handed to `syncRuntimeMedia` — the pass's
 * own definition of "visited", since every per-clip effect happens inside that
 * loop.
 *
 * `disableNarrowing` neutralises ONLY the index's element narrowing, leaving
 * every other line of the runtime identical. That is what makes the cross-check
 * below a comparison of the indexed path against the full-visit path, rather
 * than a comparison of two differently-configured runtimes.
 */
const mediaSpy = vi.hoisted(() => ({ visits: [] as number[], disableNarrowing: false }));

vi.mock("./media", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./media")>();
  return {
    ...actual,
    refreshRuntimeMediaCache: (params?: Parameters<typeof actual.refreshRuntimeMediaCache>[0]) =>
      actual.refreshRuntimeMediaCache(
        mediaSpy.disableNarrowing && params ? { ...params, elements: undefined } : params,
      ),
    syncRuntimeMedia: (params: Parameters<typeof actual.syncRuntimeMedia>[0]) => {
      mediaSpy.visits.push(params.clips.length);
      return actual.syncRuntimeMedia(params);
    },
  };
});

const { initSandboxRuntimeModular } = await import("./init");

/**
 * `count` back-to-back one-second clips, so the transport crosses exactly one
 * start and one end per second of travel and the flip set is knowable without
 * reproducing the index's arithmetic.
 */
function mountClips(count: number): void {
  const clips = Array.from(
    { length: count },
    (_unused, i) => `<video id="clip${i}" data-start="${i}" data-duration="1"></video>`,
  ).join("");
  document.body.innerHTML = `<div data-composition-id="main" data-root="true" data-start="0">${clips}</div>`;
  for (const video of document.querySelectorAll("video")) {
    Object.defineProperty(video, "duration", { value: 1, configurable: true });
  }
  window.__timelines = { main: createMockTimeline(count) };
}

/** Every observable the media pass can write, for every element. Compared
 *  between the two arms instead of re-deriving what each should have been. */
function mediaState(): Array<Record<string, unknown>> {
  return Array.from(document.querySelectorAll("video, audio")).map((raw) => {
    const el = raw as HTMLMediaElement;
    return {
      id: el.id,
      paused: el.paused,
      currentTime: el.currentTime,
      volume: el.volume,
      muted: el.muted,
      visibility: (el as HTMLElement).style.visibility,
    };
  });
}

describe("per-seek media clip index", () => {
  const originalRequestAnimationFrame = window.requestAnimationFrame;
  const originalCancelAnimationFrame = window.cancelAnimationFrame;

  beforeEach(() => {
    resetRuntimeFixtureDom();
    installImmediateAnimationFrame();
    mediaSpy.visits = [];
    mediaSpy.disableNarrowing = false;
  });

  afterEach(() => {
    window.__hfRuntimeTeardown?.();
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
    document.body.innerHTML = "";
    window.__timelines = {} as Record<string, RuntimeTimelineLike>;
    delete window.__player;
    delete window.__playerReady;
    delete window.__renderReady;
    mediaSpy.disableNarrowing = false;
  });

  /** Elements visited by ONE single-frame seek, after the transport has already
   *  settled at a time (so the sweep has a previous position to work from). */
  function visitsForOneFrameSeek(clipCount: number): number {
    mountClips(clipCount);
    initSandboxRuntimeModular();
    window.__player!.seek(3.0);
    mediaSpy.visits = [];
    window.__player!.seek(3.02);
    expect(mediaSpy.visits).toHaveLength(1);
    return mediaSpy.visits[0]!;
  }

  /**
   * The load-bearing assertion, and it is INVARIANCE, not a threshold. A
   * threshold ("visits fewer than 20 elements") passes on a small fixture while
   * a real composition of eighty videos still visits eighty. Quadrupling the
   * clip count must not change what one frame costs at all.
   *
   * Before the index, both numbers were the clip count: every seek rebuilt the
   * window of every media element in the document and handed all of them to the
   * per-clip loop.
   */
  it("visits the same number of clips for a one-frame seek at n clips and at 4n", () => {
    const few = visitsForOneFrameSeek(8);
    const many = visitsForOneFrameSeek(32);

    expect(many).toBe(few);
    // A ceiling too: within one frame at t=3.0 only the clip covering [3,4) is
    // in window and no boundary is crossed, so this is the active set alone.
    expect(many).toBeLessThanOrEqual(2);
  });

  it("still visits every clip whose window a long jump crosses", () => {
    mountClips(32);
    initSandboxRuntimeModular();
    window.__player!.seek(1.0);
    mediaSpy.visits = [];
    // Twenty seconds of travel crosses twenty starts and twenty ends. The point
    // is that the index does not silently skip them — a sublinear seek that
    // under-visits leaves elements playing.
    window.__player!.seek(21.0);
    expect(mediaSpy.visits[0]!).toBeGreaterThanOrEqual(20);
  });

  /**
   * The equivalence half, and the one that catches a wrong optimisation rather
   * than a missing one. Random seek sequences, and after every single seek the
   * indexed runtime's media state must equal the full-visit runtime's — the
   * same code with only the narrowing turned off.
   *
   * Deterministic: a fixed seed, so a failure is reproducible rather than a
   * flake someone reruns until it passes.
   */
  it("leaves every media element in the same state as a full-visit pass", () => {
    let seed = 0x5eed;
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    const runSequence = (times: number[], disableNarrowing: boolean) => {
      mediaSpy.disableNarrowing = disableNarrowing;
      mountClips(12);
      initSandboxRuntimeModular();
      const states: Array<Array<Record<string, unknown>>> = [];
      for (const time of times) {
        window.__player!.seek(time);
        states.push(mediaState());
      }
      window.__hfRuntimeTeardown?.();
      document.body.innerHTML = "";
      return states;
    };

    for (let sequence = 0; sequence < 4; sequence += 1) {
      // A mix of single frames, mid-clip nudges and long jumps in both
      // directions — the shapes that decide whether the sweep is right.
      const times = Array.from({ length: 16 }, () => Math.round(random() * 1200) / 100);
      expect(runSequence(times, false), `seek sequence ${sequence}`).toEqual(
        runSequence(times, true),
      );
    }
    // Two full runtimes per sequence, and under coverage instrumentation that
    // runs well past the 5s default. An explicit budget, not a global bump.
  }, 30_000);

  /**
   * The render path must not consult the index at all: capture depends on the
   * exact state of every element on every frame, and a frame captured against a
   * stale one cannot be recovered. Same latch, and the same reasoning, as the
   * duration-floor cache.
   */
  it("visits every clip on a render-capture seek, however small the step", () => {
    mountClips(16);
    initSandboxRuntimeModular();
    window.__player!.renderSeek(3.0);
    mediaSpy.visits = [];
    window.__player!.renderSeek(3.02);

    expect(mediaSpy.visits[0]!).toBe(16);
  });

  it("reseeds after a render seek, so a later live seek cannot trust a stale sweep", () => {
    mountClips(16);
    initSandboxRuntimeModular();
    window.__player!.renderSeek(3.0);
    mediaSpy.visits = [];
    // The sweep has no trustworthy previous position, so this visits everything
    // rather than assuming the render pass left it one.
    window.__player!.seek(3.02);
    expect(mediaSpy.visits[0]!).toBe(16);
  });

  it("re-derives the index when a clip is moved on the timeline", () => {
    mountClips(16);
    initSandboxRuntimeModular();
    window.__player!.seek(3.0);

    // clip15 lived at [15,16). Moved onto the playhead it must become active,
    // which it cannot if the index still holds its old window.
    document.querySelector("#clip15")!.setAttribute("data-start", "3");
    mediaSpy.visits = [];
    window.__player!.seek(3.01);

    expect(document.querySelector<HTMLVideoElement>("#clip15")!.style.visibility).not.toBe(
      "hidden",
    );
  });
});
