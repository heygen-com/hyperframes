import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initSandboxRuntimeModular } from "./init";
import type { RuntimeTimelineLike } from "./types";

function createMockTimeline(duration: number): RuntimeTimelineLike {
  const state = { time: 0, paused: true, duration };
  return {
    play: () => {
      state.paused = false;
    },
    pause: () => {
      state.paused = true;
    },
    seek: (time: number) => {
      state.time = time;
    },
    totalTime: (time: number) => {
      state.time = time;
    },
    time: () => state.time,
    duration: () => state.duration,
    add: () => {},
    paused: (value?: boolean) => {
      if (typeof value === "boolean") {
        state.paused = value;
      }
      return state.paused;
    },
    timeScale: () => {},
    set: () => {},
    getChildren: () => [],
  };
}

function createPaddableMockTimeline(duration: number): RuntimeTimelineLike {
  const timeline = createMockTimeline(duration) as RuntimeTimelineLike & {
    to: (_target: object, vars: { duration: number }, position: number) => void;
  };
  const baseDuration = timeline.duration;
  let paddedDuration = baseDuration();
  timeline.duration = () => paddedDuration;
  timeline.to = (_target, vars, position) => {
    paddedDuration = Math.max(paddedDuration, position + Math.max(0, Number(vars.duration) || 0));
  };
  return timeline;
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
      for (const [, callback] of pending) {
        callback(now);
      }
    },
    now: () => now,
  };
}

describe("initSandboxRuntimeModular", () => {
  const originalRequestAnimationFrame = window.requestAnimationFrame;
  const originalCancelAnimationFrame = window.cancelAnimationFrame;

  beforeEach(() => {
    document.body.innerHTML = "";
    (globalThis as typeof globalThis & { CSS?: { escape?: (value: string) => string } }).CSS ??= {};
    globalThis.CSS.escape ??= (value: string) => value;
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = (() => {}) as typeof window.cancelAnimationFrame;
  });

  afterEach(() => {
    (window as Window & { __hfRuntimeTeardown?: (() => void) | null }).__hfRuntimeTeardown?.();
    document.body.innerHTML = "";
    delete (window as Window & { __timelines?: Record<string, RuntimeTimelineLike> }).__timelines;
    delete (window as Window & { __player?: unknown }).__player;
    delete (window as Window & { __playerReady?: boolean }).__playerReady;
    delete (window as Window & { __renderReady?: boolean }).__renderReady;
    vi.restoreAllMocks();
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("uses the shorter live child timeline when the authored window is longer", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const child = document.createElement("div");
    child.setAttribute("data-composition-id", "slide-1");
    child.setAttribute("data-start", "0");
    child.setAttribute("data-hf-authored-duration", "14");
    root.appendChild(child);

    (window as Window & { __timelines?: Record<string, RuntimeTimelineLike> }).__timelines = {
      main: createMockTimeline(20),
      "slide-1": createMockTimeline(8),
    };

    initSandboxRuntimeModular();

    const player = (
      window as Window & {
        __player?: { renderSeek: (timeSeconds: number) => void };
      }
    ).__player;
    expect(player).toBeDefined();

    player?.renderSeek(9);

    expect(child.style.visibility).toBe("hidden");
  });

  it("uses the shorter authored host window when the child timeline is longer", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const child = document.createElement("div");
    child.setAttribute("data-composition-id", "slide-1");
    child.setAttribute("data-start", "0");
    child.setAttribute("data-hf-authored-duration", "2");
    root.appendChild(child);

    (window as Window & { __timelines?: Record<string, RuntimeTimelineLike> }).__timelines = {
      main: createMockTimeline(20),
      "slide-1": createMockTimeline(8),
    };

    initSandboxRuntimeModular();

    const player = (
      window as Window & {
        __player?: { renderSeek: (timeSeconds: number) => void };
      }
    ).__player;
    expect(player).toBeDefined();

    player?.renderSeek(3);

    expect(child.style.visibility).toBe("hidden");
  });

  it("keeps external composition hosts visible through their authored duration", async () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const child = document.createElement("div");
    child.setAttribute("data-composition-id", "sub");
    child.setAttribute("data-composition-src", "compositions/sub.html");
    child.setAttribute("data-start", "0");
    child.setAttribute("data-duration", "3");
    root.appendChild(child);

    const template = document.createElement("template");
    template.id = "sub-template";
    template.innerHTML = `
      <div data-composition-id="sub" data-width="1920" data-height="1080">
        <div id="hold-marker">HOLD ME</div>
      </div>
    `;
    document.body.appendChild(template);

    (window as Window & { __timelines?: Record<string, RuntimeTimelineLike> }).__timelines = {
      main: createMockTimeline(3),
      sub: createMockTimeline(1),
    };

    initSandboxRuntimeModular();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

    const player = (
      window as Window & {
        __player?: { renderSeek: (timeSeconds: number) => void };
      }
    ).__player;
    expect(player).toBeDefined();
    expect(child.querySelector("#hold-marker")?.textContent).toBe("HOLD ME");

    player?.renderSeek(2);

    expect(child.style.visibility).toBe("visible");
  });

  it("keeps compiled external composition hosts visible through their authored duration", async () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const child = document.createElement("div");
    child.setAttribute("data-composition-id", "sub");
    child.setAttribute("data-composition-file", "compositions/sub.html");
    child.setAttribute("data-start", "0");
    child.setAttribute("data-duration", "3");
    child.innerHTML = '<div id="hold-marker">HOLD ME</div>';
    root.appendChild(child);

    (window as Window & { __timelines?: Record<string, RuntimeTimelineLike> }).__timelines = {
      main: createMockTimeline(3),
      sub: createMockTimeline(1),
    };

    initSandboxRuntimeModular();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

    const player = (
      window as Window & {
        __player?: { renderSeek: (timeSeconds: number) => void };
      }
    ).__player;
    expect(player).toBeDefined();

    player?.renderSeek(2);

    expect(child.style.visibility).toBe("visible");
  });

  it("pads the root timeline to the authored composition schedule before seeking visibility", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const slide1 = document.createElement("div");
    slide1.id = "slide-1";
    slide1.setAttribute("data-composition-id", "slide-1");
    slide1.setAttribute("data-start", "0");
    slide1.setAttribute("data-hf-authored-duration", "14");
    root.appendChild(slide1);

    const slide2 = document.createElement("div");
    slide2.id = "slide-2";
    slide2.setAttribute("data-composition-id", "slide-2");
    slide2.setAttribute("data-start", "slide-1");
    slide2.setAttribute("data-hf-authored-duration", "12");
    root.appendChild(slide2);

    const slide3 = document.createElement("div");
    slide3.id = "slide-3";
    slide3.setAttribute("data-composition-id", "slide-3");
    slide3.setAttribute("data-start", "slide-2");
    slide3.setAttribute("data-hf-authored-duration", "16");
    root.appendChild(slide3);

    (window as Window & { __timelines?: Record<string, RuntimeTimelineLike> }).__timelines = {
      main: createPaddableMockTimeline(14),
    };

    initSandboxRuntimeModular();

    const player = (
      window as Window & {
        __player?: { getDuration: () => number; seek: (timeSeconds: number) => void };
      }
    ).__player;
    expect(player).toBeDefined();
    expect(player?.getDuration()).toBe(42);

    player?.seek(30);

    expect(root.style.visibility).toBe("visible");
    expect(slide1.style.visibility).toBe("hidden");
    expect(slide2.style.visibility).toBe("hidden");
    expect(slide3.style.visibility).toBe("visible");
  });

  it("pauses nested media that is outside the timed-media cache after a seek", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const child = document.createElement("div");
    child.setAttribute("data-composition-id", "slide-translation");
    child.setAttribute("data-start", "20");
    child.setAttribute("data-duration", "16");
    root.appendChild(child);

    const video = document.createElement("video");
    child.appendChild(video);
    Object.defineProperty(video, "duration", { value: 20, writable: true, configurable: true });
    Object.defineProperty(video, "paused", { value: false, writable: true, configurable: true });
    Object.defineProperty(video, "readyState", { value: 4, writable: true, configurable: true });
    Object.defineProperty(video, "currentTime", { value: 0, writable: true, configurable: true });
    const pause = () => {
      Object.defineProperty(video, "paused", { value: true, writable: true, configurable: true });
    };
    video.load = () => {};
    video.pause = pause;

    (window as Window & { __timelines?: Record<string, RuntimeTimelineLike> }).__timelines = {
      main: createMockTimeline(40),
      "slide-translation": createMockTimeline(16),
    };

    initSandboxRuntimeModular();

    const player = (
      window as Window & {
        __player?: { seek: (timeSeconds: number) => void };
      }
    ).__player;
    expect(player).toBeDefined();

    player?.seek(29);

    expect(video.paused).toBe(true);
    expect(video.currentTime).toBe(9);
  });

  it("updates visibility for timed elements inside nested compositions", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const child = document.createElement("div");
    child.setAttribute("data-composition-id", "nested");
    child.setAttribute("data-start", "10");
    child.setAttribute("data-duration", "10");
    root.appendChild(child);

    const sceneA = document.createElement("section");
    sceneA.id = "scene-a";
    sceneA.setAttribute("data-start", "0");
    sceneA.setAttribute("data-duration", "4");
    child.appendChild(sceneA);

    const sceneB = document.createElement("section");
    sceneB.id = "scene-b";
    sceneB.setAttribute("data-start", "4");
    sceneB.setAttribute("data-duration", "4");
    child.appendChild(sceneB);

    (window as Window & { __timelines?: Record<string, RuntimeTimelineLike> }).__timelines = {
      main: createMockTimeline(20),
      nested: createMockTimeline(8),
    };

    initSandboxRuntimeModular();

    const player = (
      window as Window & {
        __player?: { seek: (timeSeconds: number) => void };
      }
    ).__player;
    expect(player).toBeDefined();

    player?.seek(11);

    expect(sceneA.style.visibility).toBe("visible");
    expect(sceneB.style.visibility).toBe("hidden");

    player?.seek(15);

    expect(sceneA.style.visibility).toBe("hidden");
    expect(sceneB.style.visibility).toBe("visible");
  });

  it("clamps nested media to the authored host window on seek", () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const child = document.createElement("div");
    child.setAttribute("data-composition-id", "slide-translation");
    child.setAttribute("data-start", "20");
    child.setAttribute("data-duration", "16");
    root.appendChild(child);

    const video = document.createElement("video");
    child.appendChild(video);
    Object.defineProperty(video, "duration", { value: 20, writable: true, configurable: true });
    Object.defineProperty(video, "paused", { value: false, writable: true, configurable: true });
    Object.defineProperty(video, "readyState", { value: 4, writable: true, configurable: true });
    Object.defineProperty(video, "currentTime", { value: 0, writable: true, configurable: true });
    const pause = () => {
      Object.defineProperty(video, "paused", { value: true, writable: true, configurable: true });
    };
    video.load = () => {};
    video.pause = pause;

    (window as Window & { __timelines?: Record<string, RuntimeTimelineLike> }).__timelines = {
      main: createMockTimeline(40),
      "slide-translation": createMockTimeline(16),
    };

    initSandboxRuntimeModular();

    const player = (
      window as Window & {
        __player?: { seek: (timeSeconds: number) => void };
      }
    ).__player;
    expect(player).toBeDefined();

    player?.seek(37);

    expect(video.paused).toBe(true);
    expect(video.currentTime).toBe(0);
  });

  it("activates sub-composition timelines at data-start near 0 during renderSeek", () => {
    // Regression: sub-compositions starting at or near t=0 had their GSAP
    // sub-timelines ignored during render because renderSeek did not
    // activate (unpause) nested child timelines before seeking the root.
    // The children were added to the root while paused, and GSAP's
    // totalTime() does not propagate to paused children.
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-duration", "24");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const hookHost = document.createElement("div");
    hookHost.setAttribute("data-composition-id", "hook");
    hookHost.setAttribute("data-start", "0.001");
    hookHost.setAttribute("data-duration", "2");
    hookHost.setAttribute("data-track-index", "0");
    hookHost.classList.add("clip");
    root.appendChild(hookHost);

    const laterHost = document.createElement("div");
    laterHost.setAttribute("data-composition-id", "tweet");
    laterHost.setAttribute("data-start", "1.5");
    laterHost.setAttribute("data-duration", "4.5");
    laterHost.setAttribute("data-track-index", "1");
    laterHost.classList.add("clip");
    root.appendChild(laterHost);

    const hookTimeline = createMockTimeline(2);
    const tweetTimeline = createMockTimeline(4.5);
    const rootTimeline = createMockTimeline(24);

    (window as Window & { __timelines?: Record<string, RuntimeTimelineLike> }).__timelines = {
      main: rootTimeline,
      hook: hookTimeline,
      tweet: tweetTimeline,
    };

    initSandboxRuntimeModular();

    const player = (
      window as Window & {
        __player?: { renderSeek: (timeSeconds: number) => void };
      }
    ).__player;
    expect(player).toBeDefined();

    // Simulate that the hook timeline was paused (as happens when
    // children are added to a paused root timeline in GSAP)
    hookTimeline.paused!(true);
    tweetTimeline.paused!(true);

    // Seek to 0.5s — well within the hook's window [0.001, 2.001]
    player?.renderSeek(0.5);

    // renderSeek should activate (unpause) all child timelines before
    // seeking the root. Without the fix, children stay paused and GSAP's
    // totalTime() propagation skips them, leaving elements at initial CSS
    // state (opacity: 0).
    expect(hookTimeline.paused!()).toBe(false);
    expect(tweetTimeline.paused!()).toBe(false);

    // The hook host should be visible at t=0.5
    expect(hookHost.style.visibility).toBe("visible");
  });

  it("plays scheduled child timelines without a captured root timeline when audio has failed", () => {
    const raf = createManualRaf();
    vi.spyOn(performance, "now").mockImplementation(() => raf.now());
    window.requestAnimationFrame = raf.requestAnimationFrame as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = raf.cancelAnimationFrame as typeof window.cancelAnimationFrame;

    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-duration", "4");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);

    const child = document.createElement("div");
    child.setAttribute("data-composition-id", "scene");
    child.setAttribute("data-start", "0");
    child.setAttribute("data-duration", "4");
    root.appendChild(child);

    const audio = document.createElement("audio");
    audio.setAttribute("data-start", "0");
    audio.setAttribute("data-duration", "4");
    Object.defineProperty(audio, "error", {
      value: { code: 4, message: "format error" },
      configurable: true,
    });
    Object.defineProperty(audio, "networkState", {
      value: HTMLMediaElement.NETWORK_NO_SOURCE,
      configurable: true,
    });
    Object.defineProperty(audio, "readyState", {
      value: HTMLMediaElement.HAVE_NOTHING,
      configurable: true,
    });
    Object.defineProperty(audio, "paused", { value: true, configurable: true });
    Object.defineProperty(audio, "currentTime", { value: 0, writable: true, configurable: true });
    audio.load = () => {};
    audio.play = vi.fn(() => Promise.reject(new Error("format error")));
    root.appendChild(audio);

    const childTimeline = createMockTimeline(4);
    (window as Window & { __timelines?: Record<string, RuntimeTimelineLike> }).__timelines = {
      scene: childTimeline,
    };

    initSandboxRuntimeModular();

    const player = (
      window as Window & {
        __player?: { play: () => void; getTime: () => number; isPlaying: () => boolean };
      }
    ).__player;
    expect(player).toBeDefined();

    player?.play();
    raf.step(1_000);

    expect(player?.isPlaying()).toBe(true);
    expect(player?.getTime()).toBeCloseTo(1, 1);
    expect(childTimeline.time()).toBeCloseTo(1, 1);
  });
});
