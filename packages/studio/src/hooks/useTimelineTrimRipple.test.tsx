// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore, type TimelineElement } from "../player";
import { installReactActEnvironment, mountReactHarness } from "./domSelectionTestHarness";
import { useTimelineTrimRipple } from "./useTimelineTrimRipple";

installReactActEnvironment();

function el(id: string, start: number, duration: number): TimelineElement {
  return { id, tag: "video", start, duration, track: 0, domId: id };
}

const startOf = (id: string) => usePlayerStore.getState().elements.find((e) => e.id === id)?.start;

/** One shared queue standing in for the editor's edit queue; `writes` is the save order. */
function mountTrimRipple(rippleOn: boolean, elements: TimelineElement[]) {
  usePlayerStore.getState().setElements(elements);
  usePlayerStore.setState({ rippleEditEnabled: rippleOn });
  const writes: string[] = [];
  let tail = Promise.resolve();
  const enqueue = (write: string, before?: Promise<void>) => {
    const run = tail.then(async () => {
      await before;
      writes.push(write);
    });
    tail = run.catch(() => undefined);
    return run;
  };
  const ids = (changes: Array<{ element: TimelineElement }>) =>
    changes.map((c) => c.element.id).join(",");
  const handleTimelineElementResize = vi.fn((element: TimelineElement) =>
    enqueue(`resize ${element.id}`),
  );
  const handleTimelineGroupResize = vi.fn(
    (changes: Array<{ element: TimelineElement }>, _options?: { coalesceKey?: string }) =>
      enqueue(`resize ${ids(changes)}`),
  );
  const handleTimelineGroupMove = vi.fn(
    (changes: Array<{ element: TimelineElement }>, options?: { beforeTiming?: Promise<void> }) =>
      enqueue(`move ${ids(changes)}`, options?.beforeTiming),
  );
  const reloadPreview = vi.fn();
  let hook: ReturnType<typeof useTimelineTrimRipple> | null = null;
  function Harness() {
    hook = useTimelineTrimRipple({
      handleTimelineElementResize,
      handleTimelineGroupResize,
      handleTimelineGroupMove,
      showToast: vi.fn(),
      reloadPreview,
      editQueueRef: { current: Promise.resolve(), projectId: "project" },
    });
    return null;
  }
  mountReactHarness(<Harness />);
  const trim = (element: TimelineElement, start: number, duration: number) =>
    hook!.handleTrimElement(element, { start, duration, playbackStart: undefined });
  return {
    trim,
    writes,
    handleTimelineElementResize,
    handleTimelineGroupResize,
    handleTimelineGroupMove,
    reloadPreview,
  };
}

describe("useTimelineTrimRipple", () => {
  afterEach(() => {
    usePlayerStore.getState().setElements([]);
    document.body.innerHTML = "";
  });

  it("closes the main-track gap a trim leaves, in the trim's own undo step", async () => {
    const a = el("a", 0, 4);
    const h = mountTrimRipple(true, [a, el("b", 4, 2)]);
    await act(() => h.trim(a, 0, 3));

    const { coalesceKey } = h.handleTimelineGroupResize.mock.calls[0]![1]!;
    expect(h.handleTimelineGroupMove).toHaveBeenCalledWith(
      [expect.objectContaining({ element: expect.objectContaining({ id: "b" }), start: 3 })],
      expect.objectContaining({ coalesceKey, label: "Resize timeline clip" }),
    );
    expect(startOf("b")).toBe(3);
  });

  it("saves a trim made right after another after the first one's shift", async () => {
    const a = el("a", 0, 4);
    const h = mountTrimRipple(true, [a, el("b", 4, 2)]);
    await act(async () => {
      const first = h.trim(a, 0, 3);
      const shiftedB = usePlayerStore.getState().elements.find((e) => e.id === "b")!;
      await Promise.all([first, h.trim(shiftedB, 3, 1)]);
    });

    expect(h.writes).toEqual(["resize a", "move b", "resize b"]);
  });

  // fails without the fix: the timeline put b back at 4 while the preview kept it at 3.
  it("a refused shift puts the clips back and reloads the preview to match", async () => {
    const a = el("a", 0, 4);
    const h = mountTrimRipple(true, [a, el("b", 4, 2)]);
    h.handleTimelineGroupMove.mockImplementationOnce(() => Promise.reject(new Error("refused")));

    await act(() => h.trim(a, 0, 3));

    expect(startOf("b")).toBe(4);
    expect(h.reloadPreview).toHaveBeenCalledOnce();
  });

  it("leaves the gap and moves nothing with Ripple off", async () => {
    const a = el("a", 0, 4);
    const h = mountTrimRipple(false, [a, el("b", 4, 2)]);
    await act(() => h.trim(a, 0, 3));

    expect(h.handleTimelineElementResize).toHaveBeenCalledTimes(1);
    expect(h.handleTimelineGroupMove).not.toHaveBeenCalled();
    expect(startOf("b")).toBe(4);
  });
});
