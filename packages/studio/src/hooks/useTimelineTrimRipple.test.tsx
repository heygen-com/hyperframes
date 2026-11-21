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

function mountTrimRipple(rippleOn: boolean) {
  const a = el("a", 0, 4);
  usePlayerStore.getState().setElements([a, el("b", 4, 2)]);
  usePlayerStore.setState({ rippleEditEnabled: rippleOn });
  const handleTimelineElementResize = vi.fn().mockResolvedValue(undefined);
  const handleTimelineGroupMove = vi.fn().mockResolvedValue(undefined);
  let hook: ReturnType<typeof useTimelineTrimRipple> | null = null;
  function Harness() {
    hook = useTimelineTrimRipple({
      handleTimelineElementResize,
      handleTimelineGroupResize: vi.fn().mockResolvedValue(undefined),
      handleTimelineGroupMove,
      showToast: vi.fn(),
    });
    return null;
  }
  mountReactHarness(<Harness />);
  const trim = () =>
    act(() => hook!.handleTrimElement(a, { start: 0, duration: 3, playbackStart: undefined }));
  return { trim, handleTimelineElementResize, handleTimelineGroupMove };
}

describe("useTimelineTrimRipple", () => {
  afterEach(() => {
    usePlayerStore.getState().setElements([]);
    document.body.innerHTML = "";
  });

  it("closes the main-track gap a trim leaves, in the trim's own undo step", async () => {
    const { trim, handleTimelineElementResize, handleTimelineGroupMove } = mountTrimRipple(true);
    await trim();

    const { coalesceKey } = handleTimelineElementResize.mock.calls[0]![2];
    expect(handleTimelineGroupMove).toHaveBeenCalledWith(
      [expect.objectContaining({ element: expect.objectContaining({ id: "b" }), start: 3 })],
      expect.objectContaining({ coalesceKey, label: "Resize timeline clip" }),
    );
    expect(usePlayerStore.getState().elements.find((e) => e.id === "b")?.start).toBe(3);
  });

  it("leaves the gap and moves nothing with Ripple off", async () => {
    const { trim, handleTimelineElementResize, handleTimelineGroupMove } = mountTrimRipple(false);
    await trim();

    expect(handleTimelineElementResize).toHaveBeenCalledTimes(1);
    expect(handleTimelineGroupMove).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().elements.find((e) => e.id === "b")?.start).toBe(4);
  });
});
