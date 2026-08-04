// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { thumbnailResolver } from "../lib/mediaResolver";
import { stubVideoExtraction } from "../lib/mediaResolver.testHelpers";
import { VideoThumbnail } from "./VideoThumbnail";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

// Fire "intersecting" immediately on observe so the extraction effect runs.
class MockIntersectionObserver {
  private cb: IntersectionObserverCallback;
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
  }
  observe() {
    this.cb(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
  disconnect() {}
  unobserve() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

class MockResizeObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}

const originalIO = globalThis.IntersectionObserver;
const originalRO = globalThis.ResizeObserver;

let host: HTMLDivElement;
let root: Root | null = null;
let createdVideos: HTMLVideoElement[];

beforeEach(() => {
  // Module-level cache: without this a prior test's frames or failure leaks in.
  thumbnailResolver.reset();
  globalThis.IntersectionObserver =
    MockIntersectionObserver as unknown as typeof IntersectionObserver;
  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

  createdVideos = stubVideoExtraction();

  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.restoreAllMocks();
  globalThis.IntersectionObserver = originalIO;
  globalThis.ResizeObserver = originalRO;
  document.body.innerHTML = "";
});

function element(videoSrc: string, duration?: number) {
  return React.createElement(VideoThumbnail, {
    videoSrc,
    label: "",
    labelColor: "#fff",
    duration,
  });
}

/** Mount and let the resolver's concurrency slot + effect flush. */
async function render(videoSrc: string, duration?: number) {
  root = createRoot(host);
  await act(async () => {
    root!.render(element(videoSrc, duration));
  });
}

async function settle() {
  await act(async () => {
    await new Promise<void>((r) => setTimeout(r, 0));
  });
}

function lastVideo(): HTMLVideoElement {
  const v = createdVideos.at(-1);
  expect(v).toBeDefined();
  return v!;
}

/** Drive one hidden <video> through metadata + `frames` seeks. */
async function extract(video: HTMLVideoElement, frames: number) {
  await act(async () => {
    video.dispatchEvent(new Event("loadedmetadata"));
  });
  for (let i = 0; i < frames; i++) {
    await act(async () => {
      video.dispatchEvent(new Event("seeked"));
    });
  }
}

describe("VideoThumbnail — tainted-canvas fallback", () => {
  it("stops the extractor and drops the shimmer when toDataURL throws a SecurityError", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(() => {
      throw new DOMException("Tainted canvases may not be exported.", "SecurityError");
    });

    await render("https://cdn.example.com/no-cors.mp4");

    // The effect ran once visible → a hidden <video> was created.
    await extract(lastVideo(), 1);

    // No frame captured, and crucially the shimmer is gone (not spinning
    // forever) — the clip falls back to its plain background.
    expect(host.querySelectorAll("img").length).toBe(0);
    expect(host.querySelector(".animate-pulse")).toBeNull();
  });

  it("drops the shimmer when a no-CORS load fires the video error event (0 frames) (#2214)", async () => {
    await render("https://cdn.example.com/no-cors.mp4");
    // Before the load resolves, the shimmer placeholder is up.
    expect(host.querySelector(".animate-pulse")).not.toBeNull();

    const video = lastVideo();
    // crossOrigin="anonymous" against a CORS-less server fails the load outright —
    // the error listener fires instead of loadedmetadata/seeked, so no frame is
    // ever captured. The shimmer must stop rather than spin forever.
    await act(async () => {
      video.dispatchEvent(new Event("error"));
    });

    expect(host.querySelectorAll("img").length).toBe(0);
    expect(host.querySelector(".animate-pulse")).toBeNull();
  });

  it("keeps streaming frames while the shimmer is up until a frame arrives", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/jpeg;base64,AAAA",
    );

    await render("/api/projects/p/preview/assets/clip.mp4");
    // Before any seek resolves, the shimmer placeholder is shown.
    expect(host.querySelector(".animate-pulse")).not.toBeNull();

    await extract(lastVideo(), 1);

    // A frame was captured, so tiles render and the shimmer clears.
    expect(host.querySelectorAll("img").length).toBeGreaterThanOrEqual(1);
    expect(host.querySelector(".animate-pulse")).toBeNull();
  });
});

describe("VideoThumbnail — shared resolution", () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/jpeg;base64,AAAA",
    );
  });

  it("extracts once for seven components on the same source at the same duration", async () => {
    root = createRoot(host);
    await act(async () => {
      root!.render(
        React.createElement(
          "div",
          null,
          ...Array.from({ length: 7 }, (_, i) =>
            React.createElement(
              React.Fragment,
              { key: i },
              element("/api/projects/p/preview/assets/shared.mp4", 5),
            ),
          ),
        ),
      );
    });

    expect(createdVideos).toHaveLength(1);
    await extract(lastVideo(), 6);
    expect(createdVideos).toHaveLength(1);
    // All seven strips render from the one extraction.
    expect(host.querySelectorAll(".animate-pulse").length).toBe(0);
  });

  it("extracts separately for two clips trimmed to different durations", async () => {
    root = createRoot(host);
    await act(async () => {
      root!.render(
        React.createElement(
          "div",
          null,
          React.createElement(
            React.Fragment,
            { key: "a" },
            element("/api/projects/p/preview/assets/shared.mp4", 5),
          ),
          React.createElement(
            React.Fragment,
            { key: "b" },
            element("/api/projects/p/preview/assets/shared.mp4", 12),
          ),
        ),
      );
    });

    await settle();
    // Two distinct (source, duration) pairs → two extractions, each seeking to
    // its own clip's stops rather than sharing one frame set.
    expect(createdVideos).toHaveLength(2);
  });

  it("serves a re-mount from cache after every consumer unmounted", async () => {
    await render("/api/projects/p/preview/assets/shared.mp4", 5);
    await extract(lastVideo(), 6);
    expect(createdVideos).toHaveLength(1);

    await act(async () => root!.unmount());
    root = null;
    await settle();

    await render("/api/projects/p/preview/assets/shared.mp4", 5);
    // No second extraction, and the frames are on screen immediately.
    expect(createdVideos).toHaveLength(1);
    expect(host.querySelectorAll("img").length).toBeGreaterThanOrEqual(1);
  });
});
