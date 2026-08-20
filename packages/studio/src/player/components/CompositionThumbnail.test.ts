// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { thumbnailScheduler } from "../lib/thumbnailScheduler";
import { buildCompositionThumbnailUrl, CompositionThumbnail } from "./CompositionThumbnail";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

class MockResizeObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}

class MockImage {
  static instances: MockImage[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 0;
  naturalHeight = 0;
  src = "";

  constructor() {
    MockImage.instances.push(this);
  }
}

const originalResizeObserver = globalThis.ResizeObserver;
const originalImage = globalThis.Image;
const originalFetch = globalThis.fetch;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
let host: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  globalThis.Image = MockImage as unknown as typeof Image;
  globalThis.fetch = vi.fn(async () => new Response(new Blob(["thumbnail"]), { status: 200 }));
  URL.createObjectURL = vi.fn(() => "blob:composition-thumbnail");
  URL.revokeObjectURL = vi.fn();
  MockImage.instances = [];
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  thumbnailScheduler.invalidateProject("/api/projects/demo/preview");
  globalThis.ResizeObserver = originalResizeObserver;
  globalThis.Image = originalImage;
  globalThis.fetch = originalFetch;
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
  document.body.replaceChildren();
});

describe("buildCompositionThumbnailUrl", () => {
  it("includes selector and occurrence index for precise element thumbnails", () => {
    expect(
      buildCompositionThumbnailUrl({
        previewUrl: "/api/projects/demo/preview",
        seekTime: 1,
        duration: 2,
        selector: ".card",
        selectorIndex: 2,
        origin: "http://localhost:3000",
      }),
    ).toBe(
      "http://localhost:3000/api/projects/demo/thumbnail/index.html?t=2.00&v=v3&selector=.card&selectorIndex=2",
    );
  });

  it("asks for source density only when a caller opts in", () => {
    const base = {
      previewUrl: "/api/projects/demo/preview",
      seekTime: 1,
      duration: 0,
      origin: "http://localhost:3000",
    };

    expect(buildCompositionThumbnailUrl(base)).not.toContain("output=");
    expect(buildCompositionThumbnailUrl({ ...base, output: "source" })).toContain("output=source");
    expect(buildCompositionThumbnailUrl({ ...base, output: "storyboard" })).toContain(
      "output=storyboard",
    );
  });
});

describe("CompositionThumbnail", () => {
  async function renderThumbnail(): Promise<MockImage> {
    root = createRoot(host);
    await act(async () => {
      root!.render(
        React.createElement(CompositionThumbnail, {
          previewUrl: "/api/projects/demo/preview",
          label: "",
          labelColor: "#fff",
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const probe = MockImage.instances[0];
    if (!probe) throw new Error("Expected an image probe");
    return probe;
  }

  it("renders visible tiles after the scheduled off-DOM probe loads", async () => {
    const probe = await renderThumbnail();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/projects/demo/thumbnail/index.html"),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(probe.src).toBe("blob:composition-thumbnail");

    await act(async () => {
      probe.naturalWidth = 1920;
      probe.naturalHeight = 1080;
      probe.onload?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const tiles = [...host.querySelectorAll("img")];
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.every((tile) => !tile.classList.contains("hidden"))).toBe(true);
  });

  it("aborts its scheduled off-DOM image probe when unmounted", async () => {
    const probe = await renderThumbnail();
    expect(host.querySelector("img")).toBeNull();
    expect(probe.src).toBe("blob:composition-thumbnail");

    await act(async () => {
      root?.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    root = null;

    expect(probe.onload).toBeNull();
    expect(probe.onerror).toBeNull();
    expect(probe.src).toBe("");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:composition-thumbnail");
  });
});
