import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeTimelineLike } from "./types";

function pausedTimeline(duration: number): RuntimeTimelineLike {
  let time = 0;
  return {
    play: () => {},
    pause: () => {},
    seek: (t?: number) => (t === undefined ? time : (time = t)),
    totalTime: (t?: number) => (t === undefined ? time : (time = t)),
    time: () => time,
    duration: () => duration,
    add: () => {},
    paused: () => true,
    timeScale: () => {},
    set: () => {},
    getChildren: () => [],
  };
}

function clip(parent: Element, start: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "clip";
  el.setAttribute("data-start", start);
  el.setAttribute("data-duration", "2");
  el.setAttribute("data-track-index", "1");
  parent.appendChild(el);
  return el;
}

describe("runtime entry", () => {
  afterEach(() => {
    window.__hfRuntimeTeardown?.();
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    window.__timelines = {};
    delete window.__player;
    delete window.__playerReady;
    delete window.__renderReady;
    delete window.__hfTimelinesBuilding;
    delete (window as { __hyperframeRuntimeBootstrapped?: boolean })
      .__hyperframeRuntimeBootstrapped;
  });

  it("paints no timed clip until the first visibility pass decides it", async () => {
    const root = document.createElement("div");
    root.setAttribute("data-composition-id", "main");
    root.setAttribute("data-root", "true");
    root.setAttribute("data-start", "0");
    root.setAttribute("data-width", "1920");
    root.setAttribute("data-height", "1080");
    document.body.appendChild(root);
    const current = clip(root, "0");
    const later = clip(root, "5");
    window.__timelines = { main: pausedTimeline(10) };
    // Readiness, which runs the first pass, waits while GSAP batches timelines.
    window.__hfTimelinesBuilding = true;

    vi.resetModules();
    await import("./entry");
    const visibility = () => [current, later].map((el) => getComputedStyle(el).visibility);
    expect(window.__renderReady).toBe(false);
    expect(visibility()).toEqual(["hidden", "hidden"]);

    window.__hfTimelinesBuilding = false;
    window.dispatchEvent(new CustomEvent("hf-timelines-built"));
    expect(window.__renderReady).toBe(true);
    expect(visibility()).toEqual(["visible", "hidden"]);
  });
});
