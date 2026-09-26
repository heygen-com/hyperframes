// fallow-ignore-file code-duplication
import { afterEach, describe, expect, it, vi } from "vitest";
import { HF_COLOR_GRADING_ATTR, serializeHfColorGrading } from "../colorGrading";
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
const contentSkipped = (...els: HTMLElement[]) =>
  els.map((el) =>
    Array.from(document.styleSheets).some((sheet) =>
      Array.from(sheet.cssRules).some(
        (rule) =>
          rule instanceof CSSStyleRule &&
          rule.style.getPropertyValue("content-visibility") === "hidden" &&
          el.matches(rule.selectorText),
      ),
    ),
  );

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
    // Studio serves later scenes' images lazy; laid out, they would load before the first pass.
    const plate = later.appendChild(document.createElement("img"));
    plate.setAttribute("loading", "lazy");
    // A composition script may write visibility inline before the runtime runs.
    later.style.visibility = "visible";
    // Readiness, which runs the first pass, waits while GSAP batches timelines.
    window.__hfTimelinesBuilding = true;
    Object.defineProperty(document, "readyState", { configurable: true, get: () => "loading" });

    await evaluateRuntime();
    expect(window.__player).toBeUndefined();
    expect(visibility(current, later)).toEqual(["hidden", "hidden"]);
    expect(contentSkipped(current, later, poster)).toEqual([false, false, false]);
    expect(getComputedStyle(plate).display).toBe("none");

    delete (document as { readyState?: unknown }).readyState;
    document.dispatchEvent(new Event("DOMContentLoaded"));
    expect(window.__renderReady).toBe(false);
    expect(visibility(current, later, poster)).toEqual(["hidden", "hidden", "visible"]);

    window.__hfTimelinesBuilding = false;
    window.dispatchEvent(new CustomEvent("hf-timelines-built"));
    expect(window.__renderReady).toBe(true);
    expect(visibility(current, later, poster)).toEqual(["visible", "hidden", "visible"]);
    expect(getComputedStyle(plate).display).not.toBe("none");
  });

  it("skips the content of each hidden clip not due within the look-ahead, until something shows it", async () => {
    const root = mountRoot();
    const current = timed(root, "div", "0");
    const soon = timed(root, "div", "1.5");
    const later = timed(root, "div", "5");

    await evaluateRuntime();
    expect(contentSkipped(current, soon, later)).toEqual([false, false, true]);
    // How Studio's layer reveal shows a hidden clip.
    later.style.visibility = "visible";
    expect(contentSkipped(later)).toEqual([false]);
  });

  it("leaves nothing hidden when the runtime is evaluated a second time", async () => {
    const root = mountRoot();
    const current = timed(root, "div", "0");

    await evaluateRuntime();
    await evaluateRuntime();
    // Paused and never sought: no later pass would lift a rule the second copy added.
    expect(visibility(root, current)).toEqual(["visible", "visible"]);
    expect(document.querySelectorAll("style[data-hf-first-pass-hide]")).toHaveLength(0);
  });

  it("grades media inside a clip once the first pass shows the clip, with no seek", async () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const scene = timed(mountRoot(), "div", "0");
    // Untimed: the video inherits the scene's window, so no pass writes its visibility.
    const video = document.createElement("video");
    video.setAttribute(
      HF_COLOR_GRADING_ATTR,
      serializeHfColorGrading({ adjust: { exposure: 0.5 } }),
    );
    Object.defineProperty(video, "readyState", { value: HTMLMediaElement.HAVE_CURRENT_DATA });
    Object.defineProperty(video, "videoWidth", { value: 640 });
    Object.defineProperty(video, "videoHeight", { value: 360 });
    scene.appendChild(video);

    await evaluateRuntime();

    expect(window.__renderReady).toBe(true);
    expect(getContext.mock.calls.some(([type]) => String(type).startsWith("webgl"))).toBe(true);
    getContext.mockRestore();
  });
});
