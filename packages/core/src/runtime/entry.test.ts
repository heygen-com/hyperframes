// fallow-ignore-file code-duplication
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

function timed<K extends keyof HTMLElementTagNameMap>(
  parent: Element,
  tag: K,
  start: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = "clip";
  el.setAttribute("data-start", start);
  el.setAttribute("data-duration", "2");
  el.setAttribute("data-track-index", "1");
  parent.appendChild(el);
  return el;
}

function mountRoot(): HTMLElement {
  const root = document.createElement("div");
  root.setAttribute("data-composition-id", "main");
  root.setAttribute("data-root", "true");
  root.setAttribute("data-start", "0");
  root.setAttribute("data-width", "1920");
  root.setAttribute("data-height", "1080");
  document.body.appendChild(root);
  window.__timelines = { main: pausedTimeline(10) };
  return root;
}

async function evaluateRuntime(): Promise<void> {
  vi.resetModules();
  await import("./entry");
}

const visibility = (...els: HTMLElement[]) => els.map((el) => getComputedStyle(el).visibility);

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
    const win = window as {
      __hyperframeRuntimeBootstrapped?: boolean;
      __hfFirstPassHidden?: boolean;
    };
    delete win.__hyperframeRuntimeBootstrapped;
    delete win.__hfFirstPassHidden;
    delete (document as { readyState?: unknown }).readyState;
  });

  it("paints no timed clip, from script evaluation until the first visibility pass decides it", async () => {
    const root = mountRoot();
    const current = timed(root, "div", "0");
    const later = timed(root, "div", "5");
    const poster = timed(root, "img", "0");
    // A composition script may write visibility inline before the runtime runs.
    later.style.visibility = "visible";
    // Readiness, which runs the first pass, waits while GSAP batches timelines.
    window.__hfTimelinesBuilding = true;
    Object.defineProperty(document, "readyState", { configurable: true, get: () => "loading" });

    await evaluateRuntime();
    expect(window.__player).toBeUndefined();
    expect(visibility(current, later)).toEqual(["hidden", "hidden"]);

    delete (document as { readyState?: unknown }).readyState;
    document.dispatchEvent(new Event("DOMContentLoaded"));
    expect(window.__renderReady).toBe(false);
    expect(visibility(current, later, poster)).toEqual(["hidden", "hidden", "visible"]);

    window.__hfTimelinesBuilding = false;
    window.dispatchEvent(new CustomEvent("hf-timelines-built"));
    expect(window.__renderReady).toBe(true);
    expect(visibility(current, later, poster)).toEqual(["visible", "hidden", "visible"]);
  });

  it("leaves nothing hidden when the runtime is evaluated a second time", async () => {
    const root = mountRoot();
    const current = timed(root, "div", "0");

    await evaluateRuntime();
    await evaluateRuntime();
    window.__player?.seek(1);

    expect(visibility(root, current)).toEqual(["visible", "visible"]);
    expect(document.querySelectorAll("style[data-hf-first-pass-hide]")).toHaveLength(0);
  });
});
