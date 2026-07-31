// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
let clientWidth = 900;
let clientHeight = 240;

beforeAll(() => {
  vi.stubEnv("VITE_STUDIO_TIMELINE_ROW_VIRTUALIZATION_ENABLED", "1");
  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => clientWidth,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => clientHeight,
  });
});

beforeEach(() => {
  clientWidth = 900;
  clientHeight = 240;
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

/**
 * The virtualized list only mounts rows/clips after its ResizeObserver and the
 * follow-up layout effect have both flushed, which is more than one React tick.
 * A fixed number of flushes is a coin flip once the rest of the suite is
 * competing for workers, so wait for the DOM the assertions actually need.
 */
async function settleUntil(predicate: () => boolean, tries = 60): Promise<void> {
  for (let attempt = 0; attempt < tries; attempt++) {
    if (predicate()) return;
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
  }
}

async function advanceFrame(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

async function mountTimeline(element: React.ReactElement) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(element));
  await act(async () => {});
  return { host, root };
}

async function dispatchScroll(scroller: HTMLElement): Promise<void> {
  await act(async () => {
    scroller.dispatchEvent(new Event("scroll"));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

function clipsByTrack(count: number, duration = 1, includeLabels = false) {
  return Array.from({ length: count }, (_, track) => ({
    id: `clip-${track}`,
    ...(includeLabels ? { label: `Clip ${track}` } : {}),
    tag: "div",
    start: 0,
    duration,
    track,
  }));
}

async function scrollTimelineHorizontally(
  scroller: HTMLElement,
  scrollLeft: number,
): Promise<void> {
  scroller.scrollLeft = scrollLeft;
  await dispatchScroll(scroller);
}

// These tests mount 500-10,000 timeline elements and settle the virtualizer,
// which lands right on the 5s default once the rest of the suite is competing
// for workers. The generous ceiling is a flake guard, not an expected runtime.
describe("Timeline row virtualization", { timeout: 30_000 }, () => {
  it("keeps a zero-size first render bounded while the feature flag is enabled", async () => {
    clientWidth = 0;
    clientHeight = 0;
    const [{ Timeline }, { usePlayerStore }] = await Promise.all([
      import("./Timeline"),
      import("../store/playerStore"),
    ]);
    usePlayerStore.setState({
      duration: 60,
      timelineReady: true,
      elements: clipsByTrack(10_000),
    });

    const { host, root } = await mountTimeline(React.createElement(Timeline, { sessionEpoch: 2 }));

    const rows = host.querySelectorAll('[role="listitem"]');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(16);

    act(() => root.unmount());
    usePlayerStore.getState().reset();
  });

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

    const { host, root } = await mountTimeline(
      React.createElement(Timeline, {
        renderClipContent: () => React.createElement("span", { "data-rich-content": true }),
      }),
    );
    try {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 110));
      });

      const scroller = host.querySelector<HTMLElement>("[data-timeline-scroll-viewport]");
      const clip = host.querySelector<HTMLElement>('[data-el-id="clip-0"]');
      expect(scroller).not.toBeNull();
      expect(clip).not.toBeNull();
      expect(clip?.title).toBe("Clip 0 • 0.0s – 10.0s");
      expect(host.querySelector("[data-rich-content]")).not.toBeNull();

      if (scroller) await dispatchScroll(scroller);
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
    const [{ Timeline }, { usePlayerStore }, { getTimelineCanvasHeight, TRACK_H }] =
      await Promise.all([
        import("./Timeline"),
        import("../store/playerStore"),
        import("./timelineLayout"),
      ]);
    usePlayerStore.setState({
      duration: 60,
      timelineReady: true,
      elements: clipsByTrack(1_000),
    });

    const { host, root } = await mountTimeline(React.createElement(Timeline, { sessionEpoch: 3 }));

    await settleUntil(
      () =>
        (host.querySelector('[role="list"]')?.querySelectorAll('[role="listitem"]').length ?? 0) >
        0,
    );
    const list = host.querySelector<HTMLElement>('[role="list"]');
    const rows = list?.querySelectorAll('[role="listitem"]') ?? [];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(16);
    expect(rows[0]?.getAttribute("aria-posinset")).toBe("1");
    expect(rows[0]?.getAttribute("aria-setsize")).toBe("1000");
    expect(list?.parentElement?.style.height).toBe(
      `${getTimelineCanvasHeight(Array.from({ length: 1_000 }, () => TRACK_H))}px`,
    );

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
    expect(list?.querySelector('[data-timeline-row-key="0"]')).not.toBeNull();
    expect(document.activeElement).toBe(focusedControl);

    act(() => root.unmount());
    usePlayerStore.getState().reset();
  });

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

    await settleUntil(() => host.querySelectorAll("[data-clip]").length > 1);
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
    if (scroller) await scrollTimelineHorizontally(scroller, 8_000);

    const scrolledClips = [...host.querySelectorAll<HTMLElement>("[data-clip]")];
    expect(scrolledClips.map((clip) => clip.dataset.elId)).not.toEqual(initialWindowIds);
    expect(scrolledClips.length).toBeLessThanOrEqual(
      TIMELINE_VIEWPORT_BUDGETS.maxMountedClipRootsPerRow + 1,
    );
    expect(host.querySelector('[data-el-id="clip-490"]')).not.toBeNull();
    expect(host.querySelectorAll("[data-timeline-grid-cell]").length).toBeLessThan(100);

    await act(async () => usePlayerStore.getState().requestClipReveal("clip-300"));
    await advanceFrame();
    await act(async () => {});
    expect(usePlayerStore.getState().clipRevealRequest).toBeNull();
    const focusedClip = host.querySelector('[data-el-id="clip-300"]');
    expect(document.activeElement).toBe(focusedClip);
    await advanceFrame();
    expect(host.querySelector('[data-el-id="clip-300"]')).toBe(focusedClip);
    expect(document.activeElement).toBe(focusedClip);
    expect(host.querySelector('[data-el-id="clip-490"]')).not.toBeNull();

    if (scroller) await scrollTimelineHorizontally(scroller, 0);
    expect(host.querySelector('[data-el-id="clip-300"]')).toBe(focusedClip);
    expect(document.activeElement).toBe(focusedClip);

    act(() => root.unmount());
    usePlayerStore.getState().reset();
  });
});

/**
 * The flag-off build is the one users get today. It mounts every clip, so the
 * scroll-time concessions windowing makes are pure cost there: this block pins
 * the timeline to doing no per-frame work at all while a gesture runs.
 */
describe("Timeline without row virtualization", { timeout: 30_000 }, () => {
  async function renderUnvirtualizedTimeline() {
    vi.stubEnv("VITE_STUDIO_TIMELINE_ROW_VIRTUALIZATION_ENABLED", "0");
    vi.resetModules();
    const [{ Timeline }, { usePlayerStore }] = await Promise.all([
      import("./Timeline"),
      import("../store/playerStore"),
    ]);
    usePlayerStore.setState({
      duration: 60,
      timelineReady: true,
      selectedElementId: "clip-0",
      elements: clipsByTrack(40, 10, true),
    });

    const { host, root } = await mountTimeline(
      React.createElement(Timeline, {
        renderClipContent: () => React.createElement("span", { "data-rich-content": true }),
      }),
    );
    return {
      host,
      dispose: () => {
        act(() => root.unmount());
        usePlayerStore.getState().reset();
        vi.stubEnv("VITE_STUDIO_TIMELINE_ROW_VIRTUALIZATION_ENABLED", "1");
        vi.resetModules();
      },
    };
  }

  it("mounts every clip rather than a window", async () => {
    const { host, dispose } = await renderUnvirtualizedTimeline();
    try {
      expect(host.querySelectorAll("[data-clip]").length).toBe(40);
    } finally {
      dispose();
    }
  });

  it("keeps clip content mounted across a scroll gesture", async () => {
    const { host, dispose } = await renderUnvirtualizedTimeline();
    try {
      const scroller = host.querySelector<HTMLElement>("[data-timeline-scroll-viewport]");
      expect(scroller).not.toBeNull();
      const richBefore = host.querySelectorAll("[data-rich-content]").length;
      expect(richBefore).toBe(40);

      if (scroller) await dispatchScroll(scroller);

      expect(host.querySelectorAll("[data-rich-content]").length).toBe(richBefore);
    } finally {
      dispose();
    }
  });

  it("does not swap clip content back in after the gesture settles", async () => {
    const { host, dispose } = await renderUnvirtualizedTimeline();
    try {
      const scroller = host.querySelector<HTMLElement>("[data-timeline-scroll-viewport]");
      const clip = host.querySelector<HTMLElement>('[data-el-id="clip-0"]');
      if (scroller) await dispatchScroll(scroller);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
      });

      expect(host.querySelector('[data-el-id="clip-0"]')).toBe(clip);
      expect(host.querySelectorAll("[data-rich-content]").length).toBe(40);
    } finally {
      dispose();
    }
  });

  it("leaves the scroll position alone, so no snapshot round trip happens", async () => {
    const { host, dispose } = await renderUnvirtualizedTimeline();
    try {
      const scroller = host.querySelector<HTMLElement>("[data-timeline-scroll-viewport]");
      if (!scroller) throw new Error("Expected a timeline scroll viewport");
      scroller.scrollTop = 400;
      await dispatchScroll(scroller);

      expect(scroller.scrollTop).toBe(400);
    } finally {
      dispose();
    }
  });
});
