// @vitest-environment happy-dom

import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import { usePlayerStore } from "../store/playerStore";
import type { ResizingClipState } from "./useTimelineClipDrag";
import { useTimelineClipDrag } from "./useTimelineClipDrag";
import { mountReactHarness } from "../../hooks/domSelectionTestHarness";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function el(id: string, over: Partial<TimelineElement> = {}): TimelineElement {
  return { id, key: id, tag: "video", start: 0, duration: 2, track: 0, domId: id, ...over };
}

afterEach(() => {
  document.body.innerHTML = "";
  usePlayerStore.getState().reset();
});

function renderResizeHarness(elements: TimelineElement[], selected: string[]) {
  usePlayerStore.getState().setElements(elements);
  usePlayerStore.setState({ timelineSnapEnabled: false });
  usePlayerStore.getState().setSelectedElementIds(new Set(selected));

  const scroll = document.createElement("div");
  document.body.append(scroll);
  const onResizeElement = vi.fn();
  let setResizingClip: ((s: ResizingClipState | null) => void) | null = null;

  function Harness() {
    const hook = useTimelineClipDrag({
      scrollRef: { current: scroll },
      ppsRef: { current: 100 },
      durationRef: { current: 100 },
      trackOrderRef: { current: [0, 1] },
      onResizeElement,
      setShowPopover: vi.fn(),
      setRangeSelectionRef: { current: vi.fn() },
    });
    setResizingClip = hook.setResizingClip;
    return null;
  }

  const root = mountReactHarness(<Harness />);
  const apply = setResizingClip!;

  return {
    onResizeElement,
    storeById(id: string) {
      return usePlayerStore.getState().elements.find((e) => e.id === id)!;
    },
    startResize(element: TimelineElement, edge: "start" | "end") {
      act(() => {
        apply({
          element,
          edge,
          originClientX: 0,
          previewStart: element.start,
          previewDuration: element.duration,
          previewPlaybackStart: element.playbackStart,
          started: false,
        });
      });
    },
    movePointer(clientX: number) {
      act(() => {
        window.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX, clientY: 0 }));
      });
    },
    async dropPointer() {
      await act(async () => {
        window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
      });
    },
    pressEscape() {
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });
    },
    unmount() {
      act(() => root.unmount());
    },
  };
}

// Two clips a(0,2) + b(5,3) selected as a group, with a's END edge grabbed and
// dragged +0.5s (50px @ 100pps). `bOver` customizes b (e.g. locking it).
function startGroupResize(bOver: Partial<TimelineElement> = {}) {
  const a = el("a", { start: 0, duration: 2 });
  const b = el("b", { start: 5, duration: 3, ...bOver });
  const h = renderResizeHarness([a, b], ["a", "b"]);
  h.startResize(a, "end");
  h.movePointer(50);
  return { a, b, h };
}

// Drop the pointer and assert exactly one resize persisted: the grabbed clip `a`
// grown to 2.5s (the +0.5 gesture), with no other member patched.
async function expectSingleResizeToA(
  h: ReturnType<typeof renderResizeHarness>,
  a: TimelineElement,
): Promise<void> {
  await h.dropPointer();
  expect(h.onResizeElement).toHaveBeenCalledTimes(1);
  expect(h.onResizeElement).toHaveBeenCalledWith(a, expect.objectContaining({ duration: 2.5 }));
}

describe("useTimelineClipDrag — single-clip resize (unchanged path)", () => {
  it("resizes only the grabbed clip and persists once", async () => {
    const a = el("a", { start: 0, duration: 2 });
    const b = el("b", { start: 5, duration: 2 });
    const h = renderResizeHarness([a, b], []); // no multi-selection

    h.startResize(a, "end");
    h.movePointer(50); // +0.5s at 100 pps
    await expectSingleResizeToA(h, a);
    expect(h.storeById("a").duration).toBe(2.5);
    expect(h.storeById("b").duration).toBe(2); // untouched
    h.unmount();
  });
});

describe("useTimelineClipDrag — multi-select group resize (restored)", () => {
  it("previews the non-grabbed member through the store, grabbed stays out until commit", () => {
    const { h } = startGroupResize(); // grabbed asks +0.5

    // Non-grabbed member is previewed in the store; the grabbed clip renders from
    // resizingClip state, so its store value is still the original until commit.
    expect(h.storeById("b").duration).toBe(3.5);
    expect(h.storeById("a").duration).toBe(2);
    h.unmount();
  });

  it("commits the whole group — persists every member by the shared delta", async () => {
    const { a, b, h } = startGroupResize();
    await h.dropPointer();

    expect(h.onResizeElement).toHaveBeenCalledTimes(2);
    expect(h.onResizeElement).toHaveBeenCalledWith(a, expect.objectContaining({ duration: 2.5 }));
    expect(h.onResizeElement).toHaveBeenCalledWith(b, expect.objectContaining({ duration: 3.5 }));
    expect(h.storeById("a").duration).toBe(2.5);
    expect(h.storeById("b").duration).toBe(3.5);
    h.unmount();
  });

  it("degrades to single-clip when a selected member is locked — locked clip untouched", async () => {
    const { a, h } = startGroupResize({ timelineLocked: true });
    await expectSingleResizeToA(h, a);
    expect(h.storeById("b").duration).toBe(3); // locked member never patched
    h.unmount();
  });

  it("Escape rolls back the previewed non-grabbed member and persists nothing", () => {
    const { h } = startGroupResize();
    expect(h.storeById("b").duration).toBe(3.5); // previewed

    h.pressEscape();
    expect(h.storeById("b").duration).toBe(3); // restored
    expect(h.onResizeElement).not.toHaveBeenCalled();
    h.unmount();
  });
});
