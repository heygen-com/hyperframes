// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockResizeObserver, reportResize } from "../../hooks/resizeObserverTestUtils";
import { createThumbnailRequestIdentity, thumbnailScheduler } from "../lib/thumbnailScheduler";
import {
  buildCompositionThumbnailUrl,
  CompositionThumbnail,
  planCompositionStrip,
} from "./CompositionThumbnail";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

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
  vi.useRealTimers();
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
      "http://localhost:3000/api/projects/demo/thumbnail/index.html?t=2.00&v=v3&revision=0&selector=.card&selectorIndex=2",
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
  });

  it("includes the persisted content revision in the cache identity", () => {
    const url = buildCompositionThumbnailUrl({
      previewUrl: "/api/projects/demo/preview",
      origin: "http://localhost:3000",
      contentRevision: 7,
    });

    expect(new URL(url).searchParams.get("revision")).toBe("7");
  });
});

describe("planCompositionStrip", () => {
  const timeOf = (plan: ReturnType<typeof planCompositionStrip>, tile: number) => {
    const { chunk, frame } = plan.tile(tile);
    return plan.times(chunk)[frame]!;
  };

  it.each([
    [0, 10, 1.25],
    [1.5, 7, 0.6],
    [0, 600, 18.4],
    [3, 0.2, 0.045],
    [0, 8, 1.136],
  ])(
    "gives each tile a later frame inside its own span (start %s, range %s, tile %s s)",
    (start, range, tile) => {
      const plan = planCompositionStrip(start, range, tile);
      const tiles = Math.ceil(range / tile);
      for (let i = 0; i < tiles; i++) {
        const time = timeOf(plan, i);
        const [from, to] = [start + i * tile, start + (i + 1) * tile];
        if (to <= start + range + 1e-9) {
          expect(time).toBeGreaterThanOrEqual(from);
          expect(time).toBeLessThanOrEqual(to);
          if (i > 0) expect(time).toBeGreaterThan(timeOf(plan, i - 1));
        } else {
          // The last tile runs past the clip's end and shows the clip's last grid cell.
          expect(time).toBeGreaterThan(start + range - tile);
          expect(time).toBeLessThan(start + range);
        }
      }
    },
  );

  it("shows a clip narrower than one grid cell at the middle of its range", () => {
    const plan = planCompositionStrip(0, 10, 16);
    expect(plan.times(plan.tile(0).chunk)).toEqual([5]);
  });

  it("asks a chunk for at most 8 ascending times", () => {
    const plan = planCompositionStrip(0, 600, 18.4);
    for (let tile = 0; tile < 33; tile++) {
      const times = plan.times(plan.tile(tile).chunk);
      expect(times.length).toBeLessThanOrEqual(8);
      expect([...times].sort((a, b) => a - b)).toEqual(times);
    }
  });

  it("asks for the same chunks at every zoom inside one power of two", () => {
    // A 6 s clip from 1.25 s at tiles from 0.86 s down to 0.5 s wide: a 0.5 s step throughout.
    const plans = [0.86, 0.67, 0.55, 0.5].map((tile) => planCompositionStrip(1.25, 6, tile));
    for (const chunk of [0, 1]) {
      expect(new Set(plans.map((plan) => String(plan.times(chunk)))).size).toBe(1);
    }
  });
});

describe("CompositionThumbnail", () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const fetchedUrls = () =>
    (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map(([url]) => String(url));
  const stripTimes = () =>
    fetchedUrls()
      .map((url) => new URL(url).searchParams.get("times"))
      .filter(Boolean);
  const slices = () => [...host.querySelectorAll<HTMLElement>("[data-strip-frame]")];
  const tileWidth = () => slices()[0]?.closest<HTMLElement>(".shrink-0")?.style.width;

  function sizeHost(width: number, height: number) {
    Object.defineProperty(host, "clientWidth", { configurable: true, value: width });
    Object.defineProperty(host, "clientHeight", { configurable: true, value: height });
  }

  async function renderThumbnail(props: Record<string, unknown> = {}) {
    root ??= createRoot(host);
    await act(async () => {
      root!.render(
        React.createElement(CompositionThumbnail, {
          previewUrl: "/api/projects/demo/preview",
          label: "",
          labelColor: "#fff",
          ...props,
        }),
      );
      await flush();
    });
  }

  async function loadImage(index: number, width: number, height: number) {
    const image = MockImage.instances[index];
    if (!image) throw new Error(`Expected image probe ${index}`);
    await act(async () => {
      image.naturalWidth = width;
      image.naturalHeight = height;
      image.onload?.();
      await flush();
    });
  }

  const eightSeconds = { sourceStart: 0, sourceRangeDuration: 8 };

  it("renders visible tiles after the scheduled off-DOM probe loads", async () => {
    sizeHost(500, 40);
    await renderThumbnail();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/projects/demo/thumbnail/index.html"),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(MockImage.instances[0]?.src).toBe("blob:composition-thumbnail");

    await loadImage(0, 1920, 1080);

    expect(slices().length).toBeGreaterThan(0);
    // Pictures read untinted by default, like video filmstrips; the theme tokens own any dimming.
    expect(
      slices().every(
        (slice) => slice.style.opacity === "var(--timeline-composition-thumbnail-opacity)",
      ),
    ).toBe(true);
    expect(slices()[0]?.parentElement?.parentElement?.style.mixBlendMode).toBe(
      "var(--timeline-composition-thumbnail-blend)",
    );
  });

  it.each([
    { name: "a wide", width: 2700, height: 1000, tileWidth: 108, letterboxed: false },
    { name: "a square", width: 1000, height: 1000, tileWidth: 48, letterboxed: true },
    { name: "a portrait", width: 1080, height: 1920, tileWidth: 48, letterboxed: true },
  ])(
    "shows $name picture whole at the clip's measured height",
    async ({ width, height, tileWidth, letterboxed }) => {
      sizeHost(500, 40);
      await renderThumbnail();
      await loadImage(0, width, height);

      const slice = slices()[0]!;
      const tile = letterboxed ? slice.parentElement?.parentElement : slice.parentElement;
      expect(tile?.style.width).toBe(`${tileWidth}px`);
      // A tile held at its minimum width letterboxes the picture instead of cropping it.
      expect(slice.style.aspectRatio !== "").toBe(letterboxed);
    },
  );

  it("re-tiles at the height the resize observer reports", async () => {
    await renderThumbnail();
    await loadImage(0, 2700, 1000);

    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
    act(() => reportResize(500, 40));
    act(() => vi.advanceTimersToNextFrame());

    expect(slices()[0]?.parentElement?.style.width).toBe("108px");
  });

  it("draws nothing over the clip's own fill while its frames load", async () => {
    globalThis.fetch = vi.fn(() => new Promise<Response>(() => {}));
    sizeHost(500, 40);
    await renderThumbnail(eightSeconds);

    expect(globalThis.fetch).toHaveBeenCalled();
    expect(host.querySelectorAll("img, [data-strip-frame], .animate-pulse")).toHaveLength(0);
  });

  it("aborts its scheduled off-DOM image probe when unmounted", async () => {
    await renderThumbnail();
    const probe = MockImage.instances[0]!;
    expect(slices()).toHaveLength(0);
    expect(probe.src).toBe("blob:composition-thumbnail");

    await act(async () => {
      root?.unmount();
      await flush();
    });
    root = null;

    expect(probe.onload).toBeNull();
    expect(probe.onerror).toBeNull();
    expect(probe.src).toBe("");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:composition-thumbnail");
  });

  it("releases the old request and ignores its late result when persisted content changes", async () => {
    const signals: AbortSignal[] = [];
    const resolveFetches: Array<(response: Response) => void> = [];
    globalThis.fetch = vi.fn((_url, init) => {
      signals.push(init?.signal as AbortSignal);
      return new Promise<Response>((resolve) => resolveFetches.push(resolve));
    });

    await renderThumbnail({ projectId: "demo", contentRevision: 0 });
    await renderThumbnail({ projectId: "demo", contentRevision: 1 });

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    expect(fetchedUrls()[1]).toContain("revision=1");

    await act(async () => {
      resolveFetches[0]?.(new Response(new Blob(["stale"]), { status: 200 }));
      await flush();
    });
    expect(MockImage.instances).toHaveLength(0);

    await act(async () => {
      resolveFetches[1]?.(new Response(new Blob(["fresh"]), { status: 200 }));
      await flush();
    });
    expect(MockImage.instances).toHaveLength(1);
    expect(MockImage.instances[0]?.src).toBe("blob:composition-thumbnail");
  });

  it("shows each tile the frame the composition renders at that tile's time, in one request", async () => {
    sizeHost(500, 40);
    await renderThumbnail(eightSeconds);

    // One strip and nothing else: a clip costs the server one render, as a lone poster did.
    expect(fetchedUrls()).toHaveLength(1);
    expect(stripTimes()).toEqual(["0.500,1.500,2.500,3.500,4.500,5.500,6.500,7.500"]);

    await loadImage(0, 8 * 240, 135);
    // 500 px at 71 px tiles: 8 tiles of 1.136 s; the last runs past the 8 s clip.
    const frames = slices().map((slice) => Number(slice.dataset.stripFrame));
    expect(frames).toEqual([0, 1, 2, 3, 5, 6, 7, 7]);
    const times = stripTimes()[0]!.split(",").map(Number);
    frames.slice(0, 7).forEach((frame, tile) => {
      const tileSeconds = (8 * 71) / 500;
      expect(times[frame]).toBeGreaterThanOrEqual(tile * tileSeconds);
      expect(times[frame]).toBeLessThanOrEqual((tile + 1) * tileSeconds);
    });
    // Each slice shows its own cell of the 8-frame strip.
    slices().forEach((slice, tile) =>
      expect(slice.style.backgroundPositionX).toBe(`${(frames[tile]! / 7) * 100}%`),
    );
    // A tile exactly one frame wide is filled edge to edge, so neighbours meet without a seam.
    expect(slices().every((slice) => slice.style.aspectRatio === "")).toBe(true);
  });

  it("holds one lease per chunk for the whole clip, however many tiles show it", async () => {
    const acquire = vi.spyOn(thumbnailScheduler, "acquire");
    try {
      sizeHost(500, 40);
      await renderThumbnail(eightSeconds);
      await loadImage(0, 8 * 240, 135);

      expect(slices()).toHaveLength(8);
      expect(acquire).toHaveBeenCalledTimes(1);
    } finally {
      acquire.mockRestore();
    }
  });

  it("moves its held lease to a new priority instead of taking another", async () => {
    const priorities: string[] = [];
    const acquire = thumbnailScheduler.acquire.bind(thumbnailScheduler);
    const spy = vi.spyOn(thumbnailScheduler, "acquire").mockImplementation((request, listener) => {
      const lease = acquire(request, listener);
      return {
        ...lease,
        updatePriority: (priority) => {
          priorities.push(priority);
          lease.updatePriority(priority);
        },
      };
    });
    try {
      sizeHost(500, 40);
      await renderThumbnail({ ...eightSeconds, priority: "visible" });
      await loadImage(0, 8 * 240, 135);
      await renderThumbnail({ ...eightSeconds, priority: "overscan" });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(priorities).toEqual(["overscan"]);
      expect(slices()).toHaveLength(8);
    } finally {
      spy.mockRestore();
    }
  });

  it("asks for nothing before the clip has a width, then only its strip", async () => {
    await renderThumbnail(eightSeconds);
    expect(globalThis.fetch).not.toHaveBeenCalled();

    act(() => reportResize(500, 40));
    await act(flush);
    expect(fetchedUrls()).toHaveLength(1);
    expect(stripTimes()).toHaveLength(1);
  });

  it("keeps a tile's last frame until its new chunk arrives", async () => {
    sizeHost(500, 40);
    await renderThumbnail(eightSeconds);
    await loadImage(0, 8 * 240, 135);

    act(() => reportResize(1000, 40));
    await act(flush);

    // 1000 px is 15 tiles of 0.568 s: a 0.5 s step, in two chunks.
    expect(stripTimes().slice(1).sort()).toEqual([
      "0.250,0.750,1.250,1.750,2.250,2.750,3.250,3.750",
      "4.250,4.750,5.250,5.750,6.250,6.750,7.250,7.750",
    ]);
    expect(slices().map((slice) => Number(slice.dataset.stripFrame))).toEqual([
      0, 1, 2, 3, 5, 6, 7, 7,
    ]);

    await loadImage(1, 8 * 240, 135);
    await loadImage(2, 8 * 240, 135);
    expect(slices()).toHaveLength(15);
    expect(fetchedUrls()).toHaveLength(3);
  });

  it("shows the poster in a tile whose strip fails", async () => {
    globalThis.fetch = vi.fn(async (url) =>
      String(url).includes("times=")
        ? new Response("", { status: 500 })
        : new Response(new Blob(["poster"]), { status: 200 }),
    );
    sizeHost(500, 40);
    await renderThumbnail(eightSeconds);
    await loadImage(0, 1920, 1080);

    expect(fetchedUrls().some((url) => new URL(url).searchParams.has("t"))).toBe(true);
    expect(slices().length).toBeGreaterThan(0);
    expect(slices().every((slice) => slice.style.backgroundSize === "100% 100%")).toBe(true);
  });

  it("learns the frame's shape again after an edit changes it", async () => {
    sizeHost(500, 40);
    await renderThumbnail({ ...eightSeconds, contentRevision: 0 });
    await loadImage(0, 8 * 240, 135);
    expect(tileWidth()).toBe("71px");

    await renderThumbnail({ ...eightSeconds, contentRevision: 1 });
    await loadImage(1, 8 * 76, 135);

    expect(tileWidth()).toBe("48px");
  });

  it("never lets go of the shown strip while an edit's strip loads", async () => {
    const live = new Map<string, number>();
    let lowestDuringEdit = Number.POSITIVE_INFINITY;
    let shownStrip: string | undefined;
    let editing = false;
    const acquire = thumbnailScheduler.acquire.bind(thumbnailScheduler);
    const spy = vi.spyOn(thumbnailScheduler, "acquire").mockImplementation((request, listener) => {
      const id = createThumbnailRequestIdentity(request);
      if (!shownStrip && request.key.includes("times")) shownStrip = id;
      live.set(id, (live.get(id) ?? 0) + 1);
      const lease = acquire(request, listener);
      return {
        ...lease,
        release: () => {
          lease.release();
          live.set(id, (live.get(id) ?? 1) - 1);
          if (editing && id === shownStrip)
            lowestDuringEdit = Math.min(lowestDuringEdit, live.get(id)!);
        },
      };
    });
    try {
      sizeHost(500, 40);
      await renderThumbnail({ ...eightSeconds, contentRevision: 0 });
      await loadImage(0, 8 * 240, 135);

      editing = true;
      await renderThumbnail({ ...eightSeconds, contentRevision: 1 });

      expect(lowestDuringEdit).toBeGreaterThan(0);
      expect(fetchedUrls().filter((url) => url.includes("revision=0"))).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("keeps a portrait clip's tile width while an edit's frames load", async () => {
    sizeHost(384, 40);
    await renderThumbnail({ ...eightSeconds, contentRevision: 0 });
    await loadImage(0, 8 * 76, 135);
    expect(tileWidth()).toBe("48px");

    await renderThumbnail({ ...eightSeconds, contentRevision: 1 });

    expect(tileWidth()).toBe("48px");
  });

  it("letterboxes a portrait frame at its own aspect in a tile held at the minimum width", async () => {
    sizeHost(384, 40);
    await renderThumbnail(eightSeconds);
    await loadImage(0, 8 * 76, 135);

    const slice = slices()[0]!;
    expect(slice.parentElement?.parentElement?.style.width).toBe("48px");
    expect(parseFloat(slice.style.aspectRatio)).toBeCloseTo(76 / 135);
    // The 16:9 guess and the learned shape give the same 1 s grid here, so nothing is asked twice.
    expect(fetchedUrls()).toHaveLength(1);
  });
});
