import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initSandboxRuntimeModular } from "./init";
import { STUDIO_MANUAL_EDIT_GESTURE_ATTR } from "../editing/draftMarkers";
import type { RuntimeTimelineLike } from "./types";

/**
 * The transport parks itself when the editor is paused and settled. Everything
 * it used to discover by looking again on the next frame has to arrive by some
 * other route, and each of those routes gets a test here — one per row of the
 * enumeration in the PR body. A loop that stops noticing one of them is a
 * correctness regression no performance test would catch.
 */

const PARK_HEARTBEAT_MS = 80; // state.bridgeMaxPostIntervalMs

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
    pending: () => callbacks.size,
    step: (milliseconds = 16) => {
      now += milliseconds;
      const batch = Array.from(callbacks.entries());
      callbacks.clear();
      for (const [, callback] of batch) callback(now);
    },
    now: () => now,
  };
}

function createMockTimeline(duration: number): RuntimeTimelineLike {
  const state = { time: 0, paused: true, duration };
  return {
    play: () => {
      state.paused = false;
    },
    pause: () => {
      state.paused = true;
    },
    seek: (time?: number) => {
      if (time !== undefined) state.time = time;
      return state.time;
    },
    totalTime: (time?: number) => {
      if (time !== undefined) state.time = time;
      return state.time;
    },
    time: () => state.time,
    duration: () => state.duration,
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

/** MutationObserver records land in a microtask; nothing observes them sooner. */
const flushObservers = () => new Promise<void>((resolve) => queueMicrotask(() => resolve()));

describe("parked transport loop", () => {
  const originalRaf = window.requestAnimationFrame;
  const originalCancelRaf = window.cancelAnimationFrame;
  let raf: ReturnType<typeof createManualRaf>;
  let posted: Array<Record<string, unknown>>;

  const mount = (bodyHtml = "") => {
    document.body.innerHTML = `<div id="root" data-composition-id="main" data-root="true" data-start="0" data-duration="5">${bodyHtml}</div>`;
    window.__timelines = { main: createMockTimeline(5) };
  };

  /** Run frames until nothing asks for another one. */
  const settle = (maxFrames = 200): number => {
    let frames = 0;
    while (raf.pending() > 0 && frames < maxFrames) {
      raf.step();
      frames += 1;
    }
    return frames;
  };

  /**
   * Park the transport AND drain init's own one-shot timers, several of which
   * post state and would otherwise be mistaken for a heartbeat. Leaves exactly
   * one timer pending: the parked heartbeat.
   */
  const quiesce = (): void => {
    settle();
    // Up to ~400 ms of 1 ms steps: the transport holds a deferred manifest
    // post for one cadence interval before it may park.
    for (let i = 0; i < 400; i += 1) {
      if (raf.pending() === 0 && vi.getTimerCount() <= 1) return;
      vi.advanceTimersByTime(1);
      settle();
    }
    throw new Error(
      `transport never quiesced (raf ${raf.pending()}, timers ${vi.getTimerCount()})`,
    );
  };

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    document.body.innerHTML = "";
    (globalThis as typeof globalThis & { CSS?: { escape?: (v: string) => string } }).CSS ??= {};
    globalThis.CSS.escape ??= (value: string) => value;
    raf = createManualRaf();
    window.requestAnimationFrame = raf.requestAnimationFrame as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = raf.cancelAnimationFrame as typeof window.cancelAnimationFrame;
    posted = [];
    vi.spyOn(window.parent, "postMessage").mockImplementation((message: unknown) => {
      posted.push(message as Record<string, unknown>);
    });
    window.__timelines = {};
  });

  afterEach(() => {
    window.__hfRuntimeTeardown?.();
    document.body.innerHTML = "";
    window.__timelines = {} as Record<string, RuntimeTimelineLike>;
    delete window.__player;
    delete window.__playerReady;
    delete window.__HF_EXPORT_RENDER_SEEK_CONFIG;
    delete (window as { __hfLottie?: unknown }).__hfLottie;
    vi.restoreAllMocks();
    vi.useRealTimers();
    window.requestAnimationFrame = originalRaf;
    window.cancelAnimationFrame = originalCancelRaf;
  });

  it("stops asking for animation frames once paused and settled", () => {
    mount();
    initSandboxRuntimeModular();
    quiesce();
    expect(raf.pending()).toBe(0);
    // Exactly one thing still scheduled: the parked heartbeat.
    expect(vi.getTimerCount()).toBe(1);
  });

  it("keeps asking for animation frames while playing", () => {
    mount();
    initSandboxRuntimeModular();
    quiesce();
    window.__player!.play();
    // Every frame during playback re-arms: the loop must never park mid-play.
    for (let i = 0; i < 10; i += 1) {
      expect(raf.pending()).toBeGreaterThan(0);
      raf.step();
    }
    expect(raf.pending()).toBeGreaterThan(0);
  });

  it("posts the paused bridge heartbeat on its documented interval while parked", () => {
    mount();
    initSandboxRuntimeModular();
    quiesce();
    const before = posted.filter((m) => m["type"] === "state").length;
    for (let beat = 0; beat < 3; beat += 1) vi.advanceTimersByTime(PARK_HEARTBEAT_MS);
    const after = posted.filter((m) => m["type"] === "state").length;
    expect(after - before).toBe(3);
    // Still parked: the heartbeat is a timer, not a frame.
    expect(raf.pending()).toBe(0);
  });

  it("delivers a live data-duration edit while parked", async () => {
    mount();
    initSandboxRuntimeModular();
    quiesce();

    window.__timelines!["main"] = createMockTimeline(9);
    document.getElementById("root")!.setAttribute("data-duration", "9");
    await flushObservers();

    settle();
    expect(window.__player!.getDuration()).toBeCloseTo(9, 3);
  });

  it("delivers a timeline registered into window.__timelines, which no observer can see", () => {
    mount();
    window.__timelines = {};
    initSandboxRuntimeModular();
    document.getElementById("root")!.removeAttribute("data-duration");
    quiesce();
    expect(window.__player!.getDuration()).not.toBeCloseTo(12, 3);

    // No DOM mutation and no event: the registry is a plain object. Only the
    // parked heartbeat's signature re-read can find this.
    window.__timelines!["main"] = createMockTimeline(12);
    vi.advanceTimersByTime(PARK_HEARTBEAT_MS);
    settle();
    expect(window.__player!.getDuration()).toBeCloseTo(12, 3);
  });

  it("delivers a timed element mounted after the loop parked", async () => {
    mount();
    initSandboxRuntimeModular();
    quiesce();
    const manifestBefore = window.__clipManifest?.clips.length ?? 0;

    const late = document.createElement("div");
    late.id = "late-clip";
    late.setAttribute("data-start", "1");
    late.setAttribute("data-duration", "2");
    document.getElementById("root")!.appendChild(late);
    await flushObservers();

    settle();
    expect(window.__clipManifest!.clips.length).toBeGreaterThan(manifestBefore);
    expect(window.__clipManifest!.clips.some((clip) => clip.id === "late-clip")).toBe(true);
  });

  it("delivers media metadata that arrives after the loop parked", async () => {
    mount(`<video id="v" data-start="0" src="a.mp4"></video>`);
    initSandboxRuntimeModular();
    quiesce();

    const video = document.getElementById("v") as HTMLVideoElement;
    Object.defineProperty(video, "duration", { value: 30, configurable: true });
    // `durationchange` is an event, not a DOM mutation: this is the only route.
    video.dispatchEvent(new Event("durationchange"));
    await flushObservers();

    settle();
    expect(window.__player!.getDuration()).toBeGreaterThanOrEqual(30);
  });

  it("delivers the start of a Studio manual-edit gesture while parked", async () => {
    mount(`<div id="c" data-start="0" data-duration="2"></div>`);
    initSandboxRuntimeModular();
    quiesce();
    expect(raf.pending()).toBe(0);

    document.getElementById("c")!.setAttribute(STUDIO_MANUAL_EDIT_GESTURE_ATTR, "token-1");
    await flushObservers();
    expect(raf.pending()).toBeGreaterThan(0);
  });

  it("runs the reconciling seek the frame a manual-edit gesture ends", async () => {
    mount(`<div id="c" data-start="0" data-duration="2"></div>`);
    initSandboxRuntimeModular();
    quiesce();

    const target = document.getElementById("c")!;
    target.setAttribute(STUDIO_MANUAL_EDIT_GESTURE_ATTR, "token-1");
    await flushObservers();
    raf.step();
    // A gesture owns the paused frame: the loop stays awake and defers the seek.
    expect(raf.pending()).toBe(1);

    const timeline = window.__timelines!["main"] as RuntimeTimelineLike;
    const seeks: number[] = [];
    const originalTotalTime = timeline.totalTime!.bind(timeline);
    timeline.totalTime = (time?: number, suppress?: boolean) => {
      if (time !== undefined) seeks.push(time);
      return originalTotalTime(time, suppress);
    };

    target.removeAttribute(STUDIO_MANUAL_EDIT_GESTURE_ATTR);
    await flushObservers();
    raf.step();
    expect(seeks.length).toBeGreaterThan(0);
  });

  it("wakes on an explicit seek from the control surface", () => {
    mount();
    initSandboxRuntimeModular();
    quiesce();
    expect(raf.pending()).toBe(0);

    window.__player!.seek(1);
    expect(raf.pending()).toBeGreaterThan(0);
    settle();
    expect(window.__player!.getTime()).toBeCloseTo(1, 3);
  });

  it("never parks while an export render is driving frames", () => {
    window.__HF_EXPORT_RENDER_SEEK_CONFIG = { mode: "seek" };
    mount();
    initSandboxRuntimeModular();
    quiesce();

    window.__player!.renderSeek(1);
    // The render path must keep the exact scheduling it had before: a frame is
    // always in flight, whatever the playhead is doing.
    for (let i = 0; i < 10; i += 1) {
      expect(raf.pending()).toBeGreaterThan(0);
      raf.step();
    }
  });

  it("still parks after Studio's own renderSeek fallback, which is not a render", () => {
    // `playbackAdapter` drives an overhanging-timeline preview through
    // renderSeek. Latching on that alone would leave the loop unparked for the
    // whole session — the export config is what separates the two.
    expect(window.__HF_EXPORT_RENDER_SEEK_CONFIG).toBeUndefined();
    mount();
    initSandboxRuntimeModular();
    quiesce();

    window.__player!.renderSeek(1);
    quiesce();
    expect(raf.pending()).toBe(0);
    expect(window.__player!.getTime()).toBeCloseTo(1, 3);
  });

  it("stops both the frame loop and the parked timer on teardown", () => {
    mount();
    initSandboxRuntimeModular();
    quiesce();

    window.__hfRuntimeTeardown?.();
    posted.length = 0;
    // The count, not just the silence: a heartbeat that is still armed but
    // returns early on `tornDown` posts nothing either, so counting posts
    // alone passes with the clearTimeout deleted.
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(PARK_HEARTBEAT_MS * 5);
    expect(raf.pending()).toBe(0);
    expect(posted.filter((m) => m["type"] === "state")).toHaveLength(0);
  });

  it("keeps the manifest on its frame cadence while playing, whatever the DOM does", () => {
    mount();
    initSandboxRuntimeModular();
    quiesce();
    window.__player!.play();
    // Two seconds in, so the rebind policy's play hold is not what is doing
    // the work — this has to hold for the rest of playback too.
    for (let i = 0; i < 130; i += 1) raf.step();

    const root = document.getElementById("root")!;
    const before = posted.filter((m) => m["type"] === "timeline").length;
    for (let frame = 0; frame < 30; frame += 1) {
      // A composition that appends a node every frame. The manifest is a full
      // document walk; posting it per frame is the regression this guards.
      const node = document.createElement("div");
      node.setAttribute("data-start", String(frame));
      node.setAttribute("data-duration", "1");
      root.appendChild(node);
      raf.step();
    }
    const posts = posted.filter((m) => m["type"] === "timeline").length - before;
    // Main's cadence over 30 frames is one post per 20 frames, so at most two.
    expect(posts).toBeLessThanOrEqual(2);
  });

  it("does not park when the manifest post throws with a change still pending", async () => {
    mount();
    initSandboxRuntimeModular();
    quiesce();

    // postTimeline walks author DOM, which can throw. Fail it exactly once.
    const NODE_SELECTOR =
      "[data-start], [data-track-index], [data-composition-id], video, audio, img";
    const realQueryAll = Document.prototype.querySelectorAll;
    let failuresLeft = 1;
    vi.spyOn(Document.prototype, "querySelectorAll").mockImplementation(function (
      this: Document,
      selector: string,
    ) {
      if (selector === NODE_SELECTOR && failuresLeft > 0) {
        failuresLeft -= 1;
        throw new Error("author DOM blew up");
      }
      return realQueryAll.call(this, selector);
    } as typeof Document.prototype.querySelectorAll);

    const late = document.createElement("div");
    late.id = "late-after-throw";
    late.setAttribute("data-start", "1");
    late.setAttribute("data-duration", "2");
    document.getElementById("root")!.appendChild(late);
    await flushObservers();

    // Run frames until the manifest post is attempted and throws. The post is
    // rate-limited, so it lands on the frame counter's boundary, not the first
    // woken frame.
    let thrown: unknown = null;
    for (let frame = 0; frame < 60 && thrown == null; frame += 1) {
      if (raf.pending() === 0) break;
      try {
        raf.step();
      } catch (error) {
        thrown = error;
      }
    }
    expect(String(thrown)).toContain("author DOM blew up");
    // The change is still owed, so the loop must not have parked on it.
    expect(raf.pending()).toBeGreaterThan(0);

    settle();
    expect(window.__clipManifest!.clips.some((clip) => clip.id === "late-after-throw")).toBe(true);
  });

  it("delivers an adapter duration that grows while parked, with no DOM mutation and no event", () => {
    mount();
    initSandboxRuntimeModular();
    quiesce();
    const before = window.__player!.getDuration();

    // A Lottie instance lengthening is a live animation object changing. No
    // observer and no event can see it; only the parked poll can.
    window.__hfLottie = [{ goToAndStop: () => {}, totalFrames: 600, frameRate: 30 }] as never;
    vi.advanceTimersByTime(PARK_HEARTBEAT_MS);
    settle();

    expect(before).toBeLessThan(20);
    expect(window.__player!.getDuration()).toBeCloseTo(20, 3);
  });
});
