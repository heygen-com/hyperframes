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
  it("mounts a bounded list range over the full geometry height", async () => {
    const [{ Timeline }, { usePlayerStore }, { getTimelineCanvasHeight }] = await Promise.all([
      import("./Timeline"),
      import("../store/playerStore"),
      import("./timelineLayout"),
    ]);
    usePlayerStore.setState({
      duration: 60,
      timelineReady: true,
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

    const list = host.querySelector<HTMLElement>('[role="list"]');
    const rows = list?.querySelectorAll('[role="listitem"]') ?? [];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(16);
    expect(rows[0]?.getAttribute("aria-posinset")).toBe("1");
    expect(rows[0]?.getAttribute("aria-setsize")).toBe("1000");
    expect(list?.parentElement?.style.height).toBe(`${getTimelineCanvasHeight(1_000)}px`);

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
  }, 10_000);
});
