// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
let host: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  globalThis.Image = MockImage as unknown as typeof Image;
  MockImage.instances = [];
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  globalThis.ResizeObserver = originalResizeObserver;
  globalThis.Image = originalImage;
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
});

describe("CompositionThumbnail", () => {
  function renderThumbnail(): MockImage {
    root = createRoot(host);
    act(() => {
      root!.render(
        React.createElement(CompositionThumbnail, {
          previewUrl: "/api/projects/demo/preview",
          label: "",
          labelColor: "#fff",
        }),
      );
    });
    const probe = MockImage.instances[0];
    if (!probe) throw new Error("Expected an image probe");
    return probe;
  }

  it("renders visible tiles after the off-DOM probe loads", () => {
    const probe = renderThumbnail();

    act(() => {
      probe.naturalWidth = 1920;
      probe.naturalHeight = 1080;
      probe.onload?.();
    });

    const tiles = [...host.querySelectorAll("img")];
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.every((tile) => !tile.classList.contains("hidden"))).toBe(true);
  });

  it("aborts its off-DOM image probe when unmounted", () => {
    const probe = renderThumbnail();
    expect(host.querySelector("img")).toBeNull();
    expect(probe.src).toContain("/api/projects/demo/thumbnail/index.html");

    act(() => root?.unmount());
    root = null;

    expect(probe.onload).toBeNull();
    expect(probe.onerror).toBeNull();
    expect(probe.src).toBe("");
  });
});
