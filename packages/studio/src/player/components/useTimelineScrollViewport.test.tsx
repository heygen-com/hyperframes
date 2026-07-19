// @vitest-environment happy-dom

import React, { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTimelineScrollViewport } from "./useTimelineScrollViewport";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let resizeCallback: ResizeObserverCallback | null = null;
class MockResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeCallback = callback;
  }
  observe() {}
  disconnect() {}
}

const originalResizeObserver = globalThis.ResizeObserver;

beforeEach(() => {
  vi.useFakeTimers();
  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.ResizeObserver = originalResizeObserver;
  resizeCallback = null;
  document.body.innerHTML = "";
});

describe("useTimelineScrollViewport", () => {
  it("publishes resize, scroll, and settled snapshots", () => {
    let hook: ReturnType<typeof useTimelineScrollViewport> | undefined;
    function Probe() {
      hook = useTimelineScrollViewport(useRef<HTMLDivElement>(null), []);
      return null;
    }

    const root = createRoot(document.createElement("div"));
    act(() => root.render(React.createElement(Probe)));
    const element = document.createElement("div");
    const values = {
      left: 0,
      top: 0,
      width: 640,
      height: 240,
      scrollWidth: 1200,
      scrollHeight: 800,
    };
    Object.defineProperties(element, {
      scrollLeft: { configurable: true, get: () => values.left },
      scrollTop: { configurable: true, get: () => values.top },
      clientWidth: { configurable: true, get: () => values.width },
      clientHeight: { configurable: true, get: () => values.height },
      scrollWidth: { configurable: true, get: () => values.scrollWidth },
      scrollHeight: { configurable: true, get: () => values.scrollHeight },
    });

    act(() => hook?.setScrollRef(element));
    expect(hook?.viewport.clientWidth).toBe(640);

    values.width = 800;
    act(() => resizeCallback?.([], {} as ResizeObserver));
    expect(hook?.viewport.clientWidth).toBe(800);

    values.left = 120;
    values.top = 48;
    act(() => hook?.syncScrollViewport(element, true));
    act(() => vi.advanceTimersByTime(16));
    expect(hook?.viewport).toMatchObject({ scrollLeft: 120, scrollTop: 48, isScrolling: true });

    act(() => vi.advanceTimersByTime(100));
    expect(hook?.viewport.isScrolling).toBe(false);
    act(() => root.unmount());
  });
});
