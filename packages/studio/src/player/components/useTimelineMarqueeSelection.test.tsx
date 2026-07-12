// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import { usePlayerStore } from "../store/playerStore";
import { GUTTER, RULER_H, TRACK_H } from "./timelineLayout";
import type { StackingTimelineLayer } from "./timelineTrackOrder";
import { useTimelineMarqueeSelection } from "./useTimelineMarqueeSelection";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function element(id: string, start: number, duration: number, track: number): TimelineElement {
  return { id, tag: "div", start, duration, track };
}

function layer(id: string, elements: TimelineElement[]): StackingTimelineLayer {
  return {
    id,
    kind: "visual",
    contextKey: "",
    zIndex: 0,
    placementTrack: elements[0]?.track ?? 0,
    elements,
  };
}

function pointerEvent(type: string, init: MouseEventInit & { pointerId?: number }) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, "pointerId", { value: init.pointerId ?? 1 });
  return event;
}

function dispatchPointer(
  target: HTMLElement,
  type: "pointerdown" | "pointermove" | "pointerup",
  point: { x: number; y: number },
) {
  target.dispatchEvent(pointerEvent(type, { button: 0, clientX: point.x, clientY: point.y }));
}

function dragMarquee(
  harness: ReturnType<typeof renderMarqueeHarness>,
  start: { x: number; y: number },
  end: { x: number; y: number },
  downTarget: HTMLElement = harness.scroll,
) {
  dispatchPointer(downTarget, "pointerdown", start);
  dispatchPointer(harness.scroll, "pointermove", end);
  dispatchPointer(harness.scroll, "pointerup", end);
}

function renderMarqueeHarness(layers: StackingTimelineLayer[]) {
  const host = document.createElement("div");
  document.body.append(host);
  const layerOrder = layers.map((item) => item.id);
  const setShowPopover = () => {};
  const setRangeSelection = () => {};
  const seekedX: number[] = [];

  function Harness() {
    const scrollRef = React.useRef<HTMLDivElement | null>(null);
    const hook = useTimelineMarqueeSelection({
      scrollRef,
      ppsRef: { current: 100 },
      trackOrderRef: { current: layerOrder },
      timelineLayersRef: { current: layers },
      setShowPopover,
      setRangeSelectionRef: { current: setRangeSelection },
      seekFromX: (clientX: number) => seekedX.push(clientX),
    });
    return (
      <div
        ref={scrollRef}
        data-scroll="true"
        onPointerDown={(event) => {
          hook.handlePointerDown(event);
        }}
        onPointerMove={(event) => {
          hook.handlePointerMove(event);
        }}
        onPointerUp={(event) => {
          hook.handlePointerUp(event);
        }}
      >
        <button data-clip="true">clip</button>
        {hook.marqueeRect && <span data-marquee="true" />}
      </div>
    );
  }

  const root = createRoot(host);
  act(() => {
    root.render(<Harness />);
  });
  const scroll = host.querySelector<HTMLElement>("[data-scroll]");
  if (!scroll) throw new Error("Expected scroll host");
  Object.defineProperty(scroll, "clientWidth", { configurable: true, value: 160 });
  Object.defineProperty(scroll, "clientHeight", { configurable: true, value: 160 });
  Object.defineProperty(scroll, "scrollWidth", { configurable: true, value: 600 });
  Object.defineProperty(scroll, "scrollHeight", { configurable: true, value: 260 });
  scroll.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: 160,
      bottom: 160,
      width: 160,
      height: 160,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;

  return {
    host,
    scroll,
    root,
    seekedX,
    clip: host.querySelector<HTMLElement>("[data-clip]")!,
    unmount() {
      act(() => root.unmount());
    },
  };
}

afterEach(() => {
  document.body.innerHTML = "";
  usePlayerStore.getState().reset();
});

describe("useTimelineMarqueeSelection", () => {
  it("selects clips intersecting an empty-lane drag rectangle", () => {
    const layers = [
      layer("lane-0", [element("first", 0.5, 0.5, 0)]),
      layer("lane-1", [element("second", 2, 0.5, 1)]),
      layer("lane-2", [element("third", 0.5, 0.5, 2)]),
    ];
    const harness = renderMarqueeHarness(layers);
    const start = { x: GUTTER + 10, y: RULER_H + 4 };
    const end = { x: GUTTER + 260, y: RULER_H + TRACK_H * 2 - 2 };

    act(() => {
      dispatchPointer(harness.scroll, "pointerdown", start);
      dispatchPointer(harness.scroll, "pointermove", end);
    });
    expect(harness.host.querySelector("[data-marquee]")).not.toBeNull();

    act(() => {
      dispatchPointer(harness.scroll, "pointerup", end);
    });

    expect([...usePlayerStore.getState().selectedElementIds]).toEqual(["first", "second"]);
    harness.unmount();
  });

  it("treats a sub-threshold empty-lane drag as a clear click that also seeks", () => {
    usePlayerStore.getState().setSelection(["selected"]);
    const harness = renderMarqueeHarness([layer("lane-0", [element("selected", 0, 1, 0)])]);

    act(() => {
      dragMarquee(harness, { x: GUTTER + 20, y: RULER_H + 4 }, { x: GUTTER + 21, y: RULER_H + 5 });
    });

    expect(usePlayerStore.getState().selectedElementIds.size).toBe(0);
    expect(harness.host.querySelector("[data-marquee]")).toBeNull();
    // A sub-threshold press still scrubs the playhead to the click, like a plain lane click.
    expect(harness.seekedX).toEqual([GUTTER + 20]);
    harness.unmount();
  });

  it("does not start from clips or the ruler", () => {
    usePlayerStore.getState().setSelection(["kept"]);
    const harness = renderMarqueeHarness([layer("lane-0", [element("kept", 0, 1, 0)])]);

    act(() => {
      dragMarquee(
        harness,
        { x: GUTTER + 20, y: RULER_H + 4 },
        { x: GUTTER + 80, y: RULER_H + 40 },
        harness.clip,
      );
      dragMarquee(harness, { x: GUTTER + 20, y: RULER_H - 2 }, { x: GUTTER + 80, y: RULER_H + 40 });
    });

    expect([...usePlayerStore.getState().selectedElementIds]).toEqual(["kept"]);
    expect(harness.host.querySelector("[data-marquee]")).toBeNull();
    harness.unmount();
  });

  it("clears selection when the released marquee hits no clips", () => {
    usePlayerStore.getState().setSelection(["selected"]);
    const harness = renderMarqueeHarness([layer("lane-0", [element("selected", 4, 1, 0)])]);

    act(() => {
      dragMarquee(harness, { x: GUTTER + 10, y: RULER_H + 4 }, { x: GUTTER + 80, y: RULER_H + 40 });
    });

    expect(usePlayerStore.getState().selectedElementIds.size).toBe(0);
    harness.unmount();
  });

  it("uses autoscroll position when resolving the released marquee", () => {
    const originalRaf = window.requestAnimationFrame;
    const originalCancel = window.cancelAnimationFrame;
    const callbacks: FrameRequestCallback[] = [];
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = (() => {}) as typeof window.cancelAnimationFrame;
    const harness = renderMarqueeHarness([layer("lane-0", [element("reachable", 1.28, 0.2, 0)])]);

    try {
      act(() => {
        dispatchPointer(harness.scroll, "pointerdown", { x: GUTTER + 10, y: RULER_H + 4 });
        dispatchPointer(harness.scroll, "pointermove", { x: 155, y: RULER_H + 40 });
        callbacks.shift()?.(0);
        dispatchPointer(harness.scroll, "pointerup", { x: 155, y: RULER_H + 40 });
      });

      expect(harness.scroll.scrollLeft).toBeGreaterThan(0);
      expect([...usePlayerStore.getState().selectedElementIds]).toEqual(["reachable"]);
      harness.unmount();
    } finally {
      window.requestAnimationFrame = originalRaf;
      window.cancelAnimationFrame = originalCancel;
    }
  });
});
