// @vitest-environment happy-dom

import React, { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import { useTimelineGeometry } from "./useTimelineGeometry";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const element: TimelineElement = { id: "hero", tag: "div", start: 20, duration: 2, track: 1 };

const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));

function Harness({
  expandedElements,
  lastScrollLeftRef,
  scrollWidth = 20_000,
}: {
  expandedElements: TimelineElement[];
  lastScrollLeftRef: React.RefObject<number>;
  scrollWidth?: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const ppsRef = useRef(0);
  const fitPpsRef = useRef(0);
  useTimelineGeometry({
    viewportWidth: 1600,
    effectiveDuration: 60,
    zoomMode: "manual",
    manualZoomPercent: 100,
    ppsRef,
    fitPpsRef,
    draggedClip: null,
    resizingClip: null,
    expandedElements,
    isDragging,
    scrollRef,
    lastScrollLeftRef,
    contentOrigin: 32,
  });
  return (
    <div
      ref={(node) => {
        scrollRef.current = node;
        if (node) {
          Object.defineProperty(node, "clientWidth", { configurable: true, value: 1600 });
          Object.defineProperty(node, "scrollWidth", { configurable: true, value: scrollWidth });
        }
      }}
    />
  );
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  usePlayerStore.setState({ timelineProjectId: "project-a" });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  usePlayerStore.getState().reset();
  document.body.replaceChildren();
});

describe("useTimelineGeometry restore-scroll effect", () => {
  it("reads lastScrollLeftRef at frame time, not effect time, so a same-commit reveal isn't undone", async () => {
    // A sibling effect in the same commit (a fresh timeline-focus reveal) can
    // update lastScrollLeftRef and the DOM scrollLeft together after this
    // effect has already scheduled its frame. The frame must see that update,
    // not the value that was current when it was scheduled.
    const lastScrollLeftRef = { current: 132 };
    act(() => {
      root.render(<Harness expandedElements={[]} lastScrollLeftRef={lastScrollLeftRef} />);
    });
    const scroll = host.firstElementChild as HTMLDivElement;
    scroll.scrollLeft = 132;

    // Flush this effect (it schedules a frame, capturing whatever it reads
    // right now) BEFORE the sibling mutates the ref, exactly as in a real
    // commit where this effect registers and runs ahead of the reveal's.
    act(() => {
      root.render(<Harness expandedElements={[element]} lastScrollLeftRef={lastScrollLeftRef} />);
    });
    // Simulate the sibling reveal effect: it runs after this one in the same
    // commit and updates both the DOM and the ref before the frame fires.
    lastScrollLeftRef.current = 450;
    scroll.scrollLeft = 450;
    await act(async () => {
      await nextFrame();
    });

    expect(scroll.scrollLeft).toBe(450);
  });

  it("still restores the pre-edit position when nothing else changed the ref mid-frame", async () => {
    const lastScrollLeftRef = { current: 300 };
    act(() => {
      root.render(<Harness expandedElements={[]} lastScrollLeftRef={lastScrollLeftRef} />);
    });
    const scroll = host.firstElementChild as HTMLDivElement;
    scroll.scrollLeft = 0;

    act(() => {
      root.render(<Harness expandedElements={[element]} lastScrollLeftRef={lastScrollLeftRef} />);
    });
    await act(async () => {
      await nextFrame();
    });

    expect(scroll.scrollLeft).toBe(300);
  });
});
