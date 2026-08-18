// fallow-ignore-file code-duplication
// (the timeline/rAF harness mirrors init.test.ts on purpose — these tests pin
// the paused-state transport contract and must not move when that file does.)
/**
 * What the transport loop owes a PAUSED runtime.
 *
 * Idle Studio burned a flat ~120 style recalcs/second because `transportTick`
 * rescheduled itself every frame regardless of play state and re-seeked the
 * timeline on every one of those frames. The frame loop can stop while paused,
 * but three of its passengers cannot: they are the only reason a composition
 * that registers its timeline late, or is edited while parked, ever converges.
 *
 * These are characterization tests first: every assertion here describes
 * behaviour that already held when the loop ran at 60fps, and must still hold
 * once it runs on a slow timer. `advancePausedTime` drives BOTH schedules so a
 * test cannot accidentally pin one of them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initSandboxRuntimeModular } from "./init";
import type { RuntimeTimelineLike } from "./types";

interface RecordingTimeline extends RuntimeTimelineLike {
  seekTimes: number[];
}

function createRecordingTimeline(duration: number): RecordingTimeline {
  const state = { time: 0, paused: true };
  const seekTimes: number[] = [];
  return {
    seekTimes,
    play: () => {
      state.paused = false;
    },
    pause: () => {
      state.paused = true;
    },
    seek: (time?: number) => {
      if (time !== undefined) {
        state.time = time;
        seekTimes.push(time);
      }
      return state.time;
    },
    totalTime: (time?: number) => {
      if (time !== undefined) {
        state.time = time;
        seekTimes.push(time);
      }
      return state.time;
    },
    time: () => state.time,
    duration: () => duration,
    add: () => {},
    paused: (value?: boolean) => {
      if (typeof value === "boolean") state.paused = value;
      return state.paused;
    },
    timeScale: () => {},
    set: () => {},
    getChildren: () => [],
  };
}

function createManualRaf() {
  let now = 0;
  let nextId = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  return {
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      nextId += 1;
      callbacks.set(nextId, callback);
      return nextId;
    },
    cancelAnimationFrame: (id: number) => {
      callbacks.delete(id);
    },
    step: (milliseconds: number) => {
      now += milliseconds;
      const pending = Array.from(callbacks.entries());
      callbacks.clear();
      for (const [, callback] of pending) callback(now);
    },
    pending: () => callbacks.size,
    now: () => now,
  };
}

type ManualRaf = ReturnType<typeof createManualRaf>;

/** Drive both possible paused schedules — the frame loop AND any slow timer. */
function advancePausedTime(raf: ManualRaf, milliseconds: number): void {
  const frames = Math.max(1, Math.round(milliseconds / 16));
  for (let index = 0; index < frames; index += 1) {
    raf.step(16);
    vi.advanceTimersByTime(16);
  }
}

function installManualRaf(): ManualRaf {
  const raf = createManualRaf();
  vi.spyOn(performance, "now").mockImplementation(() => raf.now());
  window.requestAnimationFrame = raf.requestAnimationFrame as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = raf.cancelAnimationFrame as typeof window.cancelAnimationFrame;
  return raf;
}

function writeRoot(attrs: { duration?: string } = {}): HTMLElement {
  const root = document.createElement("div");
  root.setAttribute("data-composition-id", "root");
  root.setAttribute("data-root", "true");
  root.setAttribute("data-start", "0");
  if (attrs.duration !== undefined) root.setAttribute("data-duration", attrs.duration);
  root.setAttribute("data-width", "1920");
  root.setAttribute("data-height", "1080");
  document.body.appendChild(root);
  return root;
}

describe("paused transport schedule", () => {
  const originalRequestAnimationFrame = window.requestAnimationFrame;
  const originalCancelAnimationFrame = window.cancelAnimationFrame;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    (globalThis as typeof globalThis & { CSS?: { escape?: (value: string) => string } }).CSS ??= {};
    globalThis.CSS.escape ??= (value: string) => value;
  });

  afterEach(() => {
    window.__hfRuntimeTeardown?.();
    document.body.innerHTML = "";
    window.__timelines = {} as Record<string, RuntimeTimelineLike>;
    delete window.__player;
    delete window.__playerReady;
    delete window.__renderReady;
    delete (window as { __HF_EXPORT_RENDER_SEEK_CONFIG?: unknown }).__HF_EXPORT_RENDER_SEEK_CONFIG;
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // --- Renderer safety: the three passengers that must survive ---------------

  it("discovers a timeline registered after init while paused, sets its duration, and renders it", () => {
    const raf = installManualRaf();
    writeRoot();
    window.__timelines = {} as Record<string, RuntimeTimelineLike>;

    initSandboxRuntimeModular();
    expect(window.__player?.getDuration()).toBe(0);

    // The composition's own script runs after runtime init — both the Studio
    // preview and the renderer sit paused while this happens. Nothing but the
    // periodic rebind will ever notice it.
    const late = createRecordingTimeline(6);
    window.__timelines = { root: late } as Record<string, RuntimeTimelineLike>;

    advancePausedTime(raf, 2_000);

    expect(window.__player?.getDuration()).toBe(6);
    expect(late.seekTimes.length).toBeGreaterThan(0);
  });

  it("keeps a usable bound timeline when the registry entry is replaced while paused", () => {
    // The periodic rebind now runs on the slow schedule; it must still refuse
    // to adopt a replacement once a usable timeline is bound. (init.test.ts
    // pinned this against the frame loop, which no longer turns while paused.)
    const raf = installManualRaf();
    writeRoot({ duration: "5" });
    window.__timelines = { root: createRecordingTimeline(5) } as Record<
      string,
      RuntimeTimelineLike
    >;

    initSandboxRuntimeModular();
    window.__timelines.root = createRecordingTimeline(8);
    advancePausedTime(raf, 3_000);

    expect(window.__player?.getDuration()).toBe(5);
  });

  it("picks up a live data-duration edit while paused", () => {
    const raf = installManualRaf();
    const root = writeRoot({ duration: "5" });
    window.__timelines = { root: createRecordingTimeline(5) } as Record<
      string,
      RuntimeTimelineLike
    >;

    initSandboxRuntimeModular();
    const initialFrames = window.__clipManifest?.durationInFrames;
    expect(initialFrames).toBeGreaterThan(0);

    // Studio edits a clip's duration on the parked composition.
    root.setAttribute("data-duration", "9");
    advancePausedTime(raf, 2_000);

    expect(window.__clipManifest?.durationInFrames).toBeGreaterThan(initialFrames ?? 0);
  });

  it("re-applies animated state under a stationary playhead after the DOM changes", () => {
    const raf = installManualRaf();
    writeRoot({ duration: "5" });
    const timeline = createRecordingTimeline(5);
    window.__timelines = { root: timeline } as Record<string, RuntimeTimelineLike>;

    initSandboxRuntimeModular();
    window.__player?.seek(2);

    // Studio mutates the parked composition; the playhead has not moved, so
    // only a paused re-seek can put the animated values back on the new DOM.
    const added = document.createElement("div");
    added.id = "late-clip";
    added.setAttribute("data-start", "0");
    added.setAttribute("data-duration", "5");
    document.body.firstElementChild?.appendChild(added);

    const before = timeline.seekTimes.length;
    advancePausedTime(raf, 2_000);

    const applied = timeline.seekTimes.slice(before);
    expect(applied.length).toBeGreaterThan(0);
    // Re-applied at the stationary playhead (the root GSAP render nudge adds
    // a millisecond), never at some other time.
    for (const time of applied) expect(time).toBeCloseTo(2, 2);
  });

  // --- The cost: the FRAME loop stops ---------------------------------------

  it("stops the frame loop while paused and re-arms it on play", () => {
    const raf = installManualRaf();
    writeRoot({ duration: "5" });
    const timeline = createRecordingTimeline(5);
    window.__timelines = { root: timeline } as Record<string, RuntimeTimelineLike>;

    initSandboxRuntimeModular();
    advancePausedTime(raf, 1_000);

    // Paused, no pending seek: stepping frames does no transport work at all.
    const beforeIdle = timeline.seekTimes.length;
    for (let frame = 0; frame < 30; frame += 1) raf.step(16);
    expect(timeline.seekTimes.length).toBe(beforeIdle);
    expect(raf.pending()).toBe(0);

    // Play re-arms the frame loop immediately — not on the next slow tick.
    window.__player?.play();
    expect(raf.pending()).toBe(1);
    const beforePlaying = timeline.seekTimes.length;
    raf.step(16);
    expect(timeline.seekTimes.length).toBeGreaterThan(beforePlaying);

    // Pause stops it again within one frame.
    window.__player?.pause();
    raf.step(16);
    expect(raf.pending()).toBe(0);
  });

  it("runs a paused seek's work without leaving the frame loop armed", () => {
    const raf = installManualRaf();
    writeRoot({ duration: "5" });
    const timeline = createRecordingTimeline(5);
    window.__timelines = { root: timeline } as Record<string, RuntimeTimelineLike>;

    initSandboxRuntimeModular();
    for (let frame = 0; frame < 5; frame += 1) raf.step(16);

    const before = timeline.seekTimes.length;
    window.__player?.seek(3);

    expect(timeline.seekTimes.length).toBeGreaterThan(before);
    expect(timeline.seekTimes.at(-1)).toBeCloseTo(3, 5);
    expect(raf.pending()).toBe(0);
  });

  it("cancels the paused schedule on teardown with no callback afterwards", () => {
    const raf = installManualRaf();
    writeRoot({ duration: "5" });
    const timeline = createRecordingTimeline(5);
    window.__timelines = { root: timeline } as Record<string, RuntimeTimelineLike>;

    initSandboxRuntimeModular();
    advancePausedTime(raf, 1_000);

    window.__hfRuntimeTeardown?.();
    const afterTeardown = timeline.seekTimes.length;

    advancePausedTime(raf, 5_000);
    expect(timeline.seekTimes.length).toBe(afterTeardown);
    expect(raf.pending()).toBe(0);
  });

  it("leaves the paused schedule off once the producer capture protocol drives frames", () => {
    const raf = installManualRaf();
    writeRoot({ duration: "5" });
    const timeline = createRecordingTimeline(5);
    window.__timelines = { root: timeline } as Record<string, RuntimeTimelineLike>;
    window.__HF_EXPORT_RENDER_SEEK_CONFIG = { fps: 30, fpsSource: "render-options" };

    initSandboxRuntimeModular();

    // renderSeek still does its own seek and media sync.
    const beforeRenderSeek = timeline.seekTimes.length;
    window.__player?.renderSeek(1);
    expect(timeline.seekTimes.length).toBeGreaterThan(beforeRenderSeek);
    expect(timeline.seekTimes.at(-1)).toBeCloseTo(1, 5);

    // ...and once the load-time work has drained, nothing re-seeks behind its
    // back between a capture seek and the screenshot that follows it.
    advancePausedTime(raf, 1_000);
    const settled = timeline.seekTimes.length;
    advancePausedTime(raf, 5_000);
    expect(timeline.seekTimes.length).toBe(settled);
  });
});
