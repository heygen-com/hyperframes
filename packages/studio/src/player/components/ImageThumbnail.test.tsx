// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ImageThumbnail } from "./ImageThumbnail";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

// --- Observer stubs: fire "intersecting" immediately on observe ---
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

// --- Image stub: captures instances so tests fire load/error deterministically ---
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

const originalIO = globalThis.IntersectionObserver;
const originalRO = globalThis.ResizeObserver;
const originalImage = globalThis.Image;

let host: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  globalThis.IntersectionObserver =
    MockIntersectionObserver as unknown as typeof IntersectionObserver;
  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  globalThis.Image = MockImage as unknown as typeof Image;
  MockImage.instances = [];
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  globalThis.IntersectionObserver = originalIO;
  globalThis.ResizeObserver = originalRO;
  globalThis.Image = originalImage;
  document.body.innerHTML = "";
});

function render(props: { imageSrc: string; label?: string; labelColor?: string }) {
  root = createRoot(host);
  act(() => {
    root!.render(
      <ImageThumbnail
        imageSrc={props.imageSrc}
        label={props.label ?? ""}
        labelColor={props.labelColor ?? "#fff"}
      />,
    );
  });
}

function lastProbe(): MockImage {
  const probe = MockImage.instances.at(-1);
  expect(probe).toBeDefined();
  return probe!;
}

/** Assert at least one tile rendered and the first tile serves `expectedSrc`. */
function expectFirstTileSrc(expectedSrc: string): void {
  const imgs = [...host.querySelectorAll("img")];
  expect(imgs.length).toBeGreaterThanOrEqual(1);
  expect(imgs[0].getAttribute("src")).toBe(expectedSrc);
}

describe("ImageThumbnail", () => {
  it("shows the loading shimmer before the image resolves", () => {
    render({ imageSrc: "/api/projects/p/preview/assets/pic.png" });
    expect(host.querySelector(".animate-pulse")).not.toBeNull();
    expect(host.querySelectorAll("img").length).toBe(0);
  });

  it("probes the resolved src and renders repeated object-cover tiles on load", () => {
    render({ imageSrc: "/api/projects/p/preview/assets/pic.png" });
    const probe = lastProbe();
    expect(probe.src).toBe("/api/projects/p/preview/assets/pic.png");

    act(() => {
      probe.naturalWidth = 1920;
      probe.naturalHeight = 1080;
      probe.onload?.();
    });

    const imgs = [...host.querySelectorAll("img")];
    expect(imgs.length).toBeGreaterThanOrEqual(1);
    for (const img of imgs) {
      expect(img.getAttribute("src")).toBe("/api/projects/p/preview/assets/pic.png");
      expect(img.className).toContain("object-cover");
    }
    expect(host.querySelector(".animate-pulse")).toBeNull();
  });

  it("drops the shimmer and renders no tiles when a raster image fails to load", () => {
    render({ imageSrc: "/api/projects/p/preview/assets/missing.png" });
    act(() => lastProbe().onerror?.());
    expect(host.querySelectorAll("img").length).toBe(0);
    expect(host.querySelector(".animate-pulse")).toBeNull();
  });

  it("renders tiles at 16:9 when an SVG has no intrinsic dimensions (naturalWidth=0)", () => {
    render({ imageSrc: "/api/projects/p/preview/assets/logo.svg" });
    const probe = lastProbe();

    act(() => {
      // naturalWidth stays 0 — SVG with no width/height attribute
      probe.onload?.();
    });

    expectFirstTileSrc("/api/projects/p/preview/assets/logo.svg");
    expect(host.querySelector(".animate-pulse")).toBeNull();
  });

  it("renders SVG tiles at 16:9 fallback even when the probe fires onerror", () => {
    // Some browser/sandbox environments fire onerror for SVGs even though the
    // <img> element itself can render the file — we must not blank the strip.
    render({ imageSrc: "/api/projects/p/preview/assets/icon.svg" });

    act(() => lastProbe().onerror?.());

    expectFirstTileSrc("/api/projects/p/preview/assets/icon.svg");
    expect(host.querySelector(".animate-pulse")).toBeNull();
  });

  it("renders the label above the strip when provided", () => {
    render({ imageSrc: "/x.png", label: "hero", labelColor: "#abc" });
    act(() => {
      const probe = lastProbe();
      probe.naturalWidth = 100;
      probe.naturalHeight = 100;
      probe.onload?.();
    });
    const label = [...host.querySelectorAll("span")].find((s) => s.textContent === "hero");
    expect(label).toBeDefined();
    expect(label!.closest(".z-10")).not.toBeNull();
  });
});
