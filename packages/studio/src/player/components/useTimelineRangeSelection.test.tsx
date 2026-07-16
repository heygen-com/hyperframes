// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import { useTimelineRangeSelection } from "./useTimelineRangeSelection";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

beforeEach(() => {
  document.body.innerHTML = "";
  usePlayerStore.getState().reset();
});

function pointerEvent(type: string, init: PointerEventInit): Event {
  if (typeof PointerEvent === "function") return new PointerEvent(type, init);
  return new MouseEvent(type, init);
}

function renderRangeSelection({
  elements = [],
  trackOrder = [],
}: {
  elements?: TimelineElement[];
  trackOrder?: number[];
} = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const scrollRef = React.createRef<HTMLDivElement>();
  const ppsRef = { current: 100 };
  const dragScrollRaf = { current: 0 };
  const isDragging = { current: false };
  const elementsRef = { current: elements };
  const trackOrderRef = { current: trackOrder };

  function Harness() {
    const selection = useTimelineRangeSelection({
      scrollRef,
      ppsRef,
      effectiveDuration: 10,
      pps: 100,
      seekFromX: vi.fn(),
      autoScrollDuringDrag: vi.fn(),
      dragScrollRaf,
      isDragging,
      setShowPopover: vi.fn(),
      elementsRef,
      trackOrderRef,
    });

    return (
      <div
        ref={scrollRef}
        onPointerDown={selection.handlePointerDown}
        onPointerMove={selection.handlePointerMove}
        onPointerUp={selection.handlePointerUp}
      />
    );
  }

  act(() => {
    root.render(<Harness />);
  });

  const surface = scrollRef.current;
  if (!surface) throw new Error("Expected timeline surface");
  Object.defineProperty(surface, "setPointerCapture", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(surface, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      left: 0,
      top: 0,
      right: 800,
      bottom: 300,
      width: 800,
      height: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
  return { root, surface };
}

const marqueeClips: TimelineElement[] = [
  { id: "clip-1", tag: "div", start: 0, duration: 1, track: 0 },
  { id: "clip-2", tag: "div", start: 2, duration: 1, track: 0 },
];

function dragMarquee(
  surface: HTMLDivElement,
  modifiers: {
    pointerDown?: PointerEventInit;
    pointerMove?: PointerEventInit;
    pointerUp?: PointerEventInit;
  } = {},
): void {
  act(() => {
    surface.dispatchEvent(
      pointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: 180,
        clientY: 80,
        ...modifiers.pointerDown,
      }),
    );
    surface.dispatchEvent(
      pointerEvent("pointermove", {
        bubbles: true,
        button: 0,
        clientX: 40,
        clientY: 90,
        ...modifiers.pointerMove,
      }),
    );
    surface.dispatchEvent(
      pointerEvent("pointerup", {
        bubbles: true,
        button: 0,
        clientX: 40,
        clientY: 90,
        ...modifiers.pointerUp,
      }),
    );
  });
}

describe("useTimelineRangeSelection selection clearing", () => {
  it("clears element and keyframe selections on Escape with no marquee", () => {
    const harness = renderRangeSelection();
    const store = usePlayerStore.getState();
    store.setSelectedElementId("clip-1");
    store.toggleSelectedKeyframe("clip-1:50");

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    const state = usePlayerStore.getState();
    expect(state.selectedElementId).toBeNull();
    expect(state.selectedElementIds.size).toBe(0);
    expect(state.selectedKeyframes.size).toBe(0);
    act(() => harness.root.unmount());
  });

  it("clears a keyframe-only selection on Escape with no marquee", () => {
    const harness = renderRangeSelection();
    usePlayerStore.getState().toggleSelectedKeyframe("clip-1:50");

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(usePlayerStore.getState().selectedKeyframes.size).toBe(0);
    act(() => harness.root.unmount());
  });

  it("keeps empty timeline clicks as the element deselection path", () => {
    const harness = renderRangeSelection();
    usePlayerStore.getState().setSelection(["clip-1", "clip-2"], "clip-1");

    act(() => {
      harness.surface.dispatchEvent(
        pointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 100, clientY: 100 }),
      );
      harness.surface.dispatchEvent(
        pointerEvent("pointerup", { bubbles: true, button: 0, clientX: 100, clientY: 100 }),
      );
    });

    const state = usePlayerStore.getState();
    expect(state.selectedElementId).toBeNull();
    expect(state.selectedElementIds.size).toBe(0);
    act(() => harness.root.unmount());
  });
});

describe("useTimelineRangeSelection marquee modifiers", () => {
  it("adds the pre-drag selection when Shift is held at pointerup", () => {
    const harness = renderRangeSelection({ elements: marqueeClips, trackOrder: [0] });
    usePlayerStore.getState().setSelectedElementId("clip-2");

    dragMarquee(harness.surface, { pointerUp: { shiftKey: true } });

    const state = usePlayerStore.getState();
    expect(state.selectedElementId).toBe("clip-1");
    expect(state.selectedElementIds).toEqual(new Set(["clip-2", "clip-1"]));
    act(() => harness.root.unmount());
  });

  it("replaces the selection when Shift is released before pointerup", () => {
    const harness = renderRangeSelection({ elements: marqueeClips, trackOrder: [0] });
    usePlayerStore.getState().setSelectedElementId("clip-2");

    dragMarquee(harness.surface, {
      pointerMove: { shiftKey: true },
      pointerUp: { shiftKey: false },
    });

    const state = usePlayerStore.getState();
    expect(state.selectedElementId).toBe("clip-1");
    expect(state.selectedElementIds).toEqual(new Set(["clip-1"]));
    act(() => harness.root.unmount());
  });

  it("replaces the selection for a plain marquee", () => {
    const harness = renderRangeSelection({ elements: marqueeClips, trackOrder: [0] });
    usePlayerStore.getState().setSelectedElementId("clip-2");

    dragMarquee(harness.surface);

    const state = usePlayerStore.getState();
    expect(state.selectedElementId).toBe("clip-1");
    expect(state.selectedElementIds).toEqual(new Set(["clip-1"]));
    act(() => harness.root.unmount());
  });

  it("does not seed marquee additivity from Cmd or Ctrl at pointerdown", () => {
    const harness = renderRangeSelection({ elements: marqueeClips, trackOrder: [0] });
    usePlayerStore.getState().setSelectedElementId("clip-2");

    dragMarquee(harness.surface, {
      pointerDown: { metaKey: true, ctrlKey: true },
    });

    expect(usePlayerStore.getState().selectedElementIds).toEqual(new Set(["clip-1"]));
    act(() => harness.root.unmount());
  });
});
