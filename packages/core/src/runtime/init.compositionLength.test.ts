import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initSandboxRuntimeModular } from "./init";
import type { RuntimeTimelineLike } from "./types";
import {
  createMockTimeline,
  installImmediateAnimationFrame,
  resetRuntimeFixtureDom,
  stubDuration,
} from "./runtimeSeekFixture.test-helpers";

// Pins what the running runtime reports as a composition's length and size.
describe("runtime composition length and size", () => {
  const originalRequestAnimationFrame = window.requestAnimationFrame;
  const originalCancelAnimationFrame = window.cancelAnimationFrame;

  beforeEach(() => {
    resetRuntimeFixtureDom();
    installImmediateAnimationFrame();
  });

  afterEach(() => {
    window.__hfRuntimeTeardown?.();
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
    vi.restoreAllMocks();
    delete window.__player;
    delete window.__playerReady;
    delete window.__hf;
  });

  const lengthOf = (
    html: string,
    timelines: Record<string, RuntimeTimelineLike>,
    durations: Record<string, number> = {},
  ): number | undefined => {
    document.body.innerHTML = html;
    for (const [id, seconds] of Object.entries(durations)) {
      stubDuration(document.getElementById(id) as HTMLMediaElement, seconds);
    }
    window.__timelines = timelines;
    initSandboxRuntimeModular();
    return window.__player?.getDuration();
  };

  it("cuts a longer timeline at the root's declared length", () => {
    const html = `<div data-composition-id="main" data-root="true" data-duration="4"></div>`;
    expect(lengthOf(html, { main: createMockTimeline(10) })).toBe(4);
  });

  it("takes the timeline's length when the root declares none", () => {
    const html = `<div data-composition-id="main" data-root="true"></div>`;
    expect(lengthOf(html, { main: createMockTimeline(6) })).toBe(6);
  });

  it("extends to a nested video's end at its absolute start", () => {
    const html =
      `<div data-composition-id="main" data-root="true">` +
      `<div data-composition-id="scene" data-start="3">` +
      `<video id="v" data-start="1" data-duration="4"></video></div></div>`;
    expect(lengthOf(html, { main: createMockTimeline(2) }, { v: 10 })).toBe(8);
  });

  it("extends to a sub-composition's declared end", () => {
    const html =
      `<div data-composition-id="main" data-root="true">` +
      `<div data-composition-id="scene" data-start="1" data-duration="5"></div></div>`;
    expect(lengthOf(html, { main: createMockTimeline(2) })).toBe(6);
  });

  it("derives the length from the clips when nothing else gives one", () => {
    const html =
      `<div data-composition-id="main" data-root="true">` +
      `<div data-start="1" data-duration="3"></div></div>`;
    expect(lengthOf(html, {})).toBe(4);
    expect(window.__hf?.durationSource).toEqual({ source: "derived", seconds: 4, pendingClips: 0 });
  });

  it("reports 0 while a clip's length is pending", () => {
    const html =
      `<div data-composition-id="main" data-root="true">` +
      `<div data-start="0" data-duration="3"></div><video data-start="0"></video></div>`;
    expect(lengthOf(html, {})).toBe(0);
    expect(window.__hf?.durationSource).toEqual({
      source: "unresolved",
      seconds: null,
      pendingClips: 1,
    });
  });

  it("ignores a timeline shorter than a frame and keeps a tiny derived clip", () => {
    const html =
      `<div data-composition-id="main" data-root="true">` +
      `<div data-start="0" data-duration="0.01"></div></div>`;
    expect(lengthOf(html, { main: createMockTimeline(0.01) })).toBe(0.01);
  });

  it("reads the data-root composition, not the first one in the document", () => {
    const html =
      `<div data-composition-id="card" data-duration="9"></div>` +
      `<div data-composition-id="main" data-root="true" data-duration="4"></div>`;
    expect(lengthOf(html, { main: createMockTimeline(10) })).toBe(4);
  });

  it("reports the root's size to the host", () => {
    const sizes: string[] = [];
    vi.spyOn(window.parent, "postMessage").mockImplementation((message: unknown) => {
      const m = message as { type?: string; width?: number; height?: number };
      if (m?.type === "stage-size") sizes.push(`${m.width}x${m.height}`);
    });
    const html =
      `<div data-composition-id="card" data-width="800" data-height="600"></div>` +
      `<div data-composition-id="main" data-root="true" data-duration="4" data-width="1280.9" data-height="720"></div>`;
    lengthOf(html, { main: createMockTimeline(4) });
    expect(new Set(sizes)).toEqual(new Set(["1280x720"]));
  });
});
