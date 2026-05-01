import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
});
