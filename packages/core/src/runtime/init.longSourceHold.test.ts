import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initSandboxRuntimeModular } from "./init";
import { deferMediaUntilDue } from "./preloadMedia";
import { unproxiedSrc } from "./proxySrc";
import { createMockTimeline, resetRuntimeFixtureDom } from "./runtimeSeekFixture.test-helpers";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1";
let seq = 0;

describe("later clips of a long file in the player on WebKit", () => {
  let file = "";
  const clip = (id: string) => document.getElementById(id) as HTMLVideoElement;
  const src = (id: string) => clip(id).getAttribute("src");

  beforeEach(async () => {
    resetRuntimeFixtureDom();
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(IPHONE);
    const frame = document.createElement("iframe");
    frame.setAttribute("data-hf-player-frame", "");
    Object.defineProperty(window, "frameElement", { value: frame, configurable: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(null, { status: 206, headers: { "content-range": "bytes 0-0/68000000" } }),
      ),
    );
    // Each test names its own file: a file's size is asked once per page.
    file = `/m/film-${seq++}.mp4`;
    deferMediaUntilDue();
    document.body.innerHTML =
      `<div data-composition-id="main" data-root="true" data-start="0" data-duration="60" data-width="1920" data-height="1080">` +
      [
        ["v0", 0, 30],
        ["v1", 20, 50],
        ["v2", 40, 70],
      ]
        .map(
          ([id, start, inPoint]) =>
            `<video id="${id}" src="${file}" data-start="${start}" data-duration="2" data-media-start="${inPoint}" data-track-index="0"></video>`,
        )
        .join("") +
      `</div>`;
    for (const video of document.querySelectorAll("video")) video.load = vi.fn();
    await vi.waitFor(() => expect(src("v2")).toBeNull());
    window.__timelines = { main: createMockTimeline(60) };
    initSandboxRuntimeModular();
  });

  afterEach(() => {
    window.__hfRuntimeTeardown?.();
    (window as Window & { __hfMediaDeferral?: MutationObserver }).__hfMediaDeferral?.disconnect();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, "frameElement");
    resetRuntimeFixtureDom();
  });

  it("hold no src until due, past the next take, and still name the file they play", () => {
    expect([src("v0"), src("v1"), src("v2")]).toEqual([`${file}#t=30`, `${file}#t=50`, null]);
    expect(unproxiedSrc(clip("v2"))).toBe(file);
  });

  it("get their src at their in-point when a paused seek lands on one", () => {
    window.__player?.seek(41);
    expect(src("v2")).toBe(`${file}#t=70`);
  });

  it("keep a src a binding sets while one is held, and play that one when due", () => {
    clip("v2").setAttribute("src", "/m/other.mp4");
    window.__player?.seek(41);
    expect(src("v2")).toBe("/m/other.mp4");
    expect(unproxiedSrc(clip("v2"))).toBe("/m/other.mp4");
  });

  it("let go of the file once passed, and get it back on a seek back", () => {
    window.__player?.seek(41);
    expect(src("v1")).toBeNull();
    window.__player?.seek(21);
    expect(src("v1")).toBe(`${file}#t=50`);
  });
});
