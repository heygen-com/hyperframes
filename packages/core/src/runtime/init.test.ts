import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initSandboxRuntimeModular } from "./init";
import type { RuntimeTimelineLike } from "./types";

function createMockTimeline(duration: number): RuntimeTimelineLike {
  const state = { time: 0, paused: true };
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
    duration: () => duration,
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
});
