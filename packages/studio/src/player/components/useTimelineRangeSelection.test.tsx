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

function renderRangeSelection() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const scrollRef = React.createRef<HTMLDivElement>();
  const ppsRef = { current: 100 };
  const dragScrollRaf = { current: 0 };
  const isDragging = { current: false };
  const elements: TimelineElement[] = [];
  const elementsRef = { current: elements };
  const trackOrder: number[] = [];
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
  return { root, surface };
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
