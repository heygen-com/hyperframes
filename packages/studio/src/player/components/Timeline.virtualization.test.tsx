// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class MockResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback(
      [
        {
          target,
          borderBoxSize: [{ inlineSize: target.clientWidth, blockSize: target.clientHeight }],
        } as unknown as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}

const originalResizeObserver = globalThis.ResizeObserver;
const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");

beforeAll(() => {
  vi.stubEnv("VITE_STUDIO_TIMELINE_ROW_VIRTUALIZATION_ENABLED", "1");
  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => 900,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 240,
  });
});

afterAll(() => {
  vi.unstubAllEnvs();
  globalThis.ResizeObserver = originalResizeObserver;
  if (originalClientWidth)
    Object.defineProperty(HTMLElement.prototype, "clientWidth", originalClientWidth);
  if (originalClientHeight)
    Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
  document.body.innerHTML = "";
});

describe("Timeline row virtualization", () => {
  it("defers rich clip content while scrolling without replacing the clip shell", async () => {
    const [{ Timeline }, { usePlayerStore }] = await Promise.all([
      import("./Timeline"),
      import("../store/playerStore"),
    ]);
    usePlayerStore.setState({
      duration: 60,
      timelineReady: true,
      selectedElementId: "clip-0",
      elements: [{ id: "clip-0", label: "Clip 0", tag: "div", start: 0, duration: 10, track: 0 }],
    });

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () =>
        root.render(
          React.createElement(Timeline, {
            renderClipContent: () => React.createElement("span", { "data-rich-content": true }),
          }),
        ),
      );
      await act(async () => {});
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 110));
      });

      const scroller = host.querySelector<HTMLElement>("[data-timeline-scroll-viewport]");
      const clip = host.querySelector<HTMLElement>('[data-el-id="clip-0"]');
      expect(scroller).not.toBeNull();
      expect(clip).not.toBeNull();
      expect(clip?.title).toBe("Clip 0 • 0.0s – 10.0s");
      expect(host.querySelector("[data-rich-content]")).not.toBeNull();

      await act(async () => {
        scroller?.dispatchEvent(new Event("scroll"));
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      });
      expect(host.querySelector('[data-el-id="clip-0"]')).toBe(clip);
      expect(host.querySelector("[data-rich-content]")).toBeNull();

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 110));
      });
      expect(host.querySelector('[data-el-id="clip-0"]')).toBe(clip);
      expect(host.querySelector("[data-rich-content]")).not.toBeNull();
    } finally {
      act(() => root.unmount());
      usePlayerStore.getState().reset();
    }
  });

  it("mounts a bounded list range over the full geometry height", async () => {
    const [{ Timeline }, { usePlayerStore }, { getTimelineCanvasHeight }] = await Promise.all([
      import("./Timeline"),
      import("../store/playerStore"),
      import("./timelineLayout"),
    ]);
    usePlayerStore.setState({
      duration: 60,
      timelineReady: true,
      // Repeated fixture shape intentionally contrasts row and clip windowing scales.
      // fallow-ignore-next-line code-duplication
      elements: Array.from({ length: 1_000 }, (_, track) => ({
        id: `clip-${track}`,
        tag: "div",
        start: 0,
        duration: 1,
        track,
      })),
    });

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(React.createElement(Timeline, { sessionEpoch: 3 })));
    await act(async () => {});

    const treegrid = host.querySelector<HTMLElement>('[role="treegrid"]');
    const rows = treegrid?.querySelectorAll('[role="row"]') ?? [];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(16);
    expect(rows[0]?.getAttribute("aria-rowindex")).toBe("1");
    expect(treegrid?.getAttribute("aria-rowcount")).toBe("1000");
    expect(treegrid?.parentElement?.style.height).toBe(`${getTimelineCanvasHeight(1_000)}px`);

    const firstRow = rows[0] as HTMLElement;
    const focusedControl = firstRow.querySelector<HTMLButtonElement>("button");
    expect(focusedControl).not.toBeNull();
    act(() => focusedControl?.focus());
    const scroller = host.querySelector<HTMLElement>("[data-timeline-scroll-viewport]");
    expect(scroller).not.toBeNull();
    if (scroller) {
      scroller.scrollTop = 500 * 48;
      await act(async () => {
        scroller.dispatchEvent(new Event("scroll"));
      });
    }
    expect(treegrid?.querySelector('[data-timeline-row-key="0"]')).not.toBeNull();
    expect(document.activeElement).toBe(focusedControl);

    act(() => root.unmount());
    usePlayerStore.getState().reset();
  }, 10_000);

  it("windows clips and ruler cells while retaining an off-window selected clip", async () => {
    const [{ Timeline }, { usePlayerStore }, { TIMELINE_VIEWPORT_BUDGETS }] = await Promise.all([
      import("./Timeline"),
      import("../store/playerStore"),
      import("../lib/timelineViewportBudgets"),
    ]);
    usePlayerStore.setState({
      duration: 1_000,
      timelineReady: true,
      zoomMode: "manual",
      manualZoomPercent: 2_000,
      selectedElementId: "clip-490",
      selectedElementIds: new Set(["clip-490"]),
      // Repeated fixture shape intentionally contrasts row and clip windowing scales.
      // fallow-ignore-next-line code-duplication
      elements: Array.from({ length: 500 }, (_, index) => ({
        id: `clip-${index}`,
        tag: "div",
        start: index * 2,
        duration: 1,
        track: 0,
      })),
    });

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(React.createElement(Timeline, { sessionEpoch: 4 })));
    await act(async () => {});

    const initialClips = [...host.querySelectorAll<HTMLElement>("[data-clip]")];
    const initialGridCells = host.querySelectorAll("[data-timeline-grid-cell]");
    expect(initialClips.length).toBeGreaterThan(1);
    expect(initialClips.length).toBeLessThanOrEqual(
      TIMELINE_VIEWPORT_BUDGETS.maxMountedClipRootsPerRow + 1,
    );
    expect(initialGridCells.length).toBeLessThan(100);
    expect(host.querySelector('[data-el-id="clip-490"]')).not.toBeNull();
    const initialWindowIds = initialClips.map((clip) => clip.dataset.elId);

    const scroller = host.querySelector<HTMLElement>("[data-timeline-scroll-viewport]");
    expect(scroller).not.toBeNull();
    if (scroller) {
      scroller.scrollLeft = 8_000;
      await act(async () => {
        scroller.dispatchEvent(new Event("scroll"));
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      });
    }

    const scrolledClips = [...host.querySelectorAll<HTMLElement>("[data-clip]")];
    expect(scrolledClips.map((clip) => clip.dataset.elId)).not.toEqual(initialWindowIds);
    expect(scrolledClips.length).toBeLessThanOrEqual(
      TIMELINE_VIEWPORT_BUDGETS.maxMountedClipRootsPerRow + 1,
    );
    expect(host.querySelector('[data-el-id="clip-490"]')).not.toBeNull();
    expect(host.querySelectorAll("[data-timeline-grid-cell]").length).toBeLessThan(100);

    await act(async () => usePlayerStore.getState().requestClipReveal("clip-300"));
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    await act(async () => {});
    expect(usePlayerStore.getState().clipRevealRequest).toBeNull();
    expect(document.activeElement?.getAttribute("data-el-id")).toBe("clip-300");
    expect(host.querySelector('[data-el-id="clip-490"]')).not.toBeNull();

    act(() => root.unmount());
    usePlayerStore.getState().reset();
  });
});
