// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Timeline } from "./Timeline";
import { liveTime, usePlayerStore } from "../store/playerStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class MockResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}

const originalResizeObserver = globalThis.ResizeObserver;
const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");

beforeAll(() => {
  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => 900,
  });
});

afterAll(() => {
  globalThis.ResizeObserver = originalResizeObserver;
  if (originalClientWidth)
    Object.defineProperty(HTMLElement.prototype, "clientWidth", originalClientWidth);
  document.body.innerHTML = "";
});

const clips = [{ id: "intro", tag: "div", start: 2, duration: 10, track: 0 }];
const needle = (host: HTMLElement) =>
  host.querySelector<HTMLElement>("[data-timeline-playhead-layer] > div")?.style.transform;

describe("Timeline playhead across a composition switch", () => {
  it("places the remounted playhead at the restored time", async () => {
    usePlayerStore.setState({ duration: 20, currentTime: 0, timelineReady: true, elements: clips });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<Timeline />));
    const atZero = needle(host);
    await act(async () => usePlayerStore.getState().setCurrentTime(4));
    const atFour = needle(host);
    expect(atFour).not.toBe(atZero);

    await act(async () => usePlayerStore.setState({ elements: [], timelineReady: false }));
    await act(async () => usePlayerStore.getState().setCurrentTime(1.5));
    await act(async () => {
      usePlayerStore.getState().setCurrentTime(4);
      liveTime.notify(4);
    });
    await act(async () => usePlayerStore.setState({ elements: clips, timelineReady: true }));

    expect(needle(host)).toBe(atFour);
    act(() => root.unmount());
  });
});
