import { describe, it, expect, beforeEach, vi } from "vitest";
import { usePlayerStore, liveTime, type TimelineElement } from "./playerStore";

describe("usePlayerStore", () => {
  beforeEach(() => {
    usePlayerStore.getState().reset();
  });

  describe("initial state", () => {
    it("has correct defaults", () => {
      const state = usePlayerStore.getState();
      expect(state.isPlaying).toBe(false);
      expect(state.currentTime).toBe(0);
      expect(state.duration).toBe(0);
      expect(state.timelineReady).toBe(false);
      expect(state.elements).toEqual([]);
      expect(state.selectedElementId).toBeNull();
      expect(state.playbackRate).toBe(1);
      expect(state.audioMuted).toBe(false);
      expect(state.loopEnabled).toBe(false);
      expect(state.zoomMode).toBe("fit");
      expect(state.manualZoomPercent).toBe(100);
    });
  });

  describe("setIsPlaying", () => {
    it("sets isPlaying to true", () => {
      usePlayerStore.getState().setIsPlaying(true);
      expect(usePlayerStore.getState().isPlaying).toBe(true);
    });

    it("sets isPlaying to false", () => {
      usePlayerStore.getState().setIsPlaying(true);
      usePlayerStore.getState().setIsPlaying(false);
      expect(usePlayerStore.getState().isPlaying).toBe(false);
    });
  });

  describe("setCurrentTime", () => {
    it("updates currentTime", () => {
      usePlayerStore.getState().setCurrentTime(12.5);
      expect(usePlayerStore.getState().currentTime).toBe(12.5);
    });

    it("accepts zero", () => {
      usePlayerStore.getState().setCurrentTime(42);
      usePlayerStore.getState().setCurrentTime(0);
      expect(usePlayerStore.getState().currentTime).toBe(0);
    });
  });

  describe("setDuration", () => {
    it("updates duration", () => {
      usePlayerStore.getState().setDuration(120);
      expect(usePlayerStore.getState().duration).toBe(120);
    });
  });

  describe("setPlaybackRate", () => {
    it("updates playbackRate", () => {
      usePlayerStore.getState().setPlaybackRate(2);
      expect(usePlayerStore.getState().playbackRate).toBe(2);
    });
  });

  describe("setAudioMuted", () => {
    it("updates audioMuted", () => {
      usePlayerStore.getState().setAudioMuted(true);
      expect(usePlayerStore.getState().audioMuted).toBe(true);
    });
  });

  describe("setLoopEnabled", () => {
    it("updates loopEnabled", () => {
      usePlayerStore.getState().setLoopEnabled(true);
      expect(usePlayerStore.getState().loopEnabled).toBe(true);
    });
  });

  describe("setInPoint", () => {
    it("updates inPoint", () => {
      usePlayerStore.getState().setInPoint(1.5);
      expect(usePlayerStore.getState().inPoint).toBe(1.5);
    });

    it("clears inPoint when given null", () => {
      usePlayerStore.getState().setInPoint(1.5);
      usePlayerStore.getState().setInPoint(null);
      expect(usePlayerStore.getState().inPoint).toBeNull();
    });

    it("rejects non-finite values", () => {
      usePlayerStore.getState().setInPoint(Number.NaN);
      expect(usePlayerStore.getState().inPoint).toBeNull();
    });

    it("nullifies outPoint when new inPoint is at or past existing outPoint", () => {
      usePlayerStore.getState().setOutPoint(2);
      usePlayerStore.getState().setInPoint(3);
      expect(usePlayerStore.getState().outPoint).toBeNull();
      expect(usePlayerStore.getState().inPoint).toBe(3);
    });

    it("preserves outPoint when new inPoint is before it", () => {
      usePlayerStore.getState().setOutPoint(5);
      usePlayerStore.getState().setInPoint(2);
      expect(usePlayerStore.getState().outPoint).toBe(5);
    });

    it("auto-enables loopEnabled when set to a non-null value", () => {
      usePlayerStore.getState().setLoopEnabled(false);
      usePlayerStore.getState().setInPoint(1.5);
      expect(usePlayerStore.getState().loopEnabled).toBe(true);
    });

    it("preserves loopEnabled when cleared with null", () => {
      usePlayerStore.getState().setLoopEnabled(true);
      usePlayerStore.getState().setInPoint(null);
      expect(usePlayerStore.getState().loopEnabled).toBe(true);

      usePlayerStore.getState().setLoopEnabled(false);
      usePlayerStore.getState().setInPoint(null);
      expect(usePlayerStore.getState().loopEnabled).toBe(false);
    });
  });

  describe("setOutPoint", () => {
    it("updates outPoint", () => {
      usePlayerStore.getState().setOutPoint(4.2);
      expect(usePlayerStore.getState().outPoint).toBe(4.2);
    });

    it("clears outPoint when given null", () => {
      usePlayerStore.getState().setOutPoint(4.2);
      usePlayerStore.getState().setOutPoint(null);
      expect(usePlayerStore.getState().outPoint).toBeNull();
    });

    it("rejects non-finite values", () => {
      usePlayerStore.getState().setOutPoint(Number.POSITIVE_INFINITY);
      expect(usePlayerStore.getState().outPoint).toBeNull();
    });

    it("nullifies inPoint when new outPoint is at or before existing inPoint", () => {
      usePlayerStore.getState().setInPoint(5);
      usePlayerStore.getState().setOutPoint(3);
      expect(usePlayerStore.getState().inPoint).toBeNull();
      expect(usePlayerStore.getState().outPoint).toBe(3);
    });

    it("preserves inPoint when new outPoint is after it", () => {
      usePlayerStore.getState().setInPoint(2);
      usePlayerStore.getState().setOutPoint(5);
      expect(usePlayerStore.getState().inPoint).toBe(2);
    });

    it("auto-enables loopEnabled when set to a non-null value", () => {
      usePlayerStore.getState().setLoopEnabled(false);
      usePlayerStore.getState().setOutPoint(4.2);
      expect(usePlayerStore.getState().loopEnabled).toBe(true);
    });

    it("preserves loopEnabled when cleared with null", () => {
      usePlayerStore.getState().setLoopEnabled(true);
      usePlayerStore.getState().setOutPoint(null);
      expect(usePlayerStore.getState().loopEnabled).toBe(true);

      usePlayerStore.getState().setLoopEnabled(false);
      usePlayerStore.getState().setOutPoint(null);
      expect(usePlayerStore.getState().loopEnabled).toBe(false);
    });
  });

  describe("setTimelineReady", () => {
    it("updates timelineReady", () => {
      usePlayerStore.getState().setTimelineReady(true);
      expect(usePlayerStore.getState().timelineReady).toBe(true);
    });
  });

  describe("setElements", () => {
    it("sets the elements array", () => {
      const elements: TimelineElement[] = [
        { id: "el-1", tag: "div", start: 0, duration: 5, track: 0 },
        {
          id: "el-2",
          tag: "video",
          start: 2,
          duration: 10,
          track: 1,
          src: "test.mp4",
        },
      ];
      usePlayerStore.getState().setElements(elements);
      expect(usePlayerStore.getState().elements).toEqual(elements);
      expect(usePlayerStore.getState().elements).toHaveLength(2);
    });

    it("replaces existing elements", () => {
      usePlayerStore
        .getState()
        .setElements([{ id: "el-1", tag: "div", start: 0, duration: 5, track: 0 }]);
      usePlayerStore
        .getState()
        .setElements([{ id: "el-3", tag: "span", start: 1, duration: 3, track: 0 }]);
      const elements = usePlayerStore.getState().elements;
      expect(elements).toHaveLength(1);
      expect(elements[0].id).toBe("el-3");
    });
  });

  describe("setSelectedElementId", () => {
    it("selects an element", () => {
      usePlayerStore.getState().setSelectedElementId("el-1");
      expect(usePlayerStore.getState().selectedElementId).toBe("el-1");
    });

    it("clears selection with null", () => {
      usePlayerStore.getState().setSelectedElementId("el-1");
      usePlayerStore.getState().setSelectedElementId(null);
      expect(usePlayerStore.getState().selectedElementId).toBeNull();
    });
  });

  describe("selectedElementIds", () => {
    it("sets a multi-id selection with a coherent anchor", () => {
      usePlayerStore.getState().setSelection(["el-1", "el-2", "el-3"], "el-2");

      const state = usePlayerStore.getState();
      expect([...state.selectedElementIds]).toEqual(["el-1", "el-2", "el-3"]);
      expect(state.selectedElementId).toBe("el-2");
    });

    it("falls back to the first selected id when the anchor is outside the set", () => {
      usePlayerStore.getState().setSelection(["el-1", "el-2"], "missing");

      const state = usePlayerStore.getState();
      expect([...state.selectedElementIds]).toEqual(["el-1", "el-2"]);
      expect(state.selectedElementId).toBe("el-1");
    });

    it("single-click selection replaces the set with the selected id", () => {
      const store = usePlayerStore.getState();
      store.setSelection(["el-1", "el-2"], "el-2");
      store.setSelectedElementId("el-3");

      const state = usePlayerStore.getState();
      expect([...state.selectedElementIds]).toEqual(["el-3"]);
      expect(state.selectedElementId).toBe("el-3");
    });

    it("setSelectedElementId collapses to a single element even for a current member", () => {
      const store = usePlayerStore.getState();
      store.setSelection(["el-1", "el-2", "el-3"], "el-1");
      // A genuine single selection (click) collapses the set, even if the id was a member.
      store.setSelectedElementId("el-2");

      const state = usePlayerStore.getState();
      expect([...state.selectedElementIds]).toEqual(["el-2"]);
      expect(state.selectedElementId).toBe("el-2");
    });

    it("setSelectionAnchor moves the anchor within a group without collapsing it", () => {
      const store = usePlayerStore.getState();
      store.setSelection(["el-1", "el-2", "el-3"], "el-1");
      // A DOM->store echo during a group gesture only moves the anchor.
      store.setSelectionAnchor("el-2");

      let state = usePlayerStore.getState();
      expect([...state.selectedElementIds]).toEqual(["el-1", "el-2", "el-3"]);
      expect(state.selectedElementId).toBe("el-2");

      // A non-member anchor is a genuine new single selection.
      store.setSelectionAnchor("outside");
      state = usePlayerStore.getState();
      expect([...state.selectedElementIds]).toEqual(["outside"]);
      expect(state.selectedElementId).toBe("outside");
    });

    it("clearing single selection empties the set", () => {
      const store = usePlayerStore.getState();
      store.setSelection(["el-1", "el-2"], "el-2");
      store.setSelectedElementId(null);

      const state = usePlayerStore.getState();
      expect([...state.selectedElementIds]).toEqual([]);
      expect(state.selectedElementId).toBeNull();
    });

    it("toggle adds and removes members while keeping the anchor in the set", () => {
      const store = usePlayerStore.getState();
      store.setSelectedElementId("el-1");
      store.toggleSelectedElementId("el-2");

      let state = usePlayerStore.getState();
      expect([...state.selectedElementIds]).toEqual(["el-1", "el-2"]);
      expect(state.selectedElementId).toBe("el-1");

      store.toggleSelectedElementId("el-1");

      state = usePlayerStore.getState();
      expect([...state.selectedElementIds]).toEqual(["el-2"]);
      expect(state.selectedElementId).toBe("el-2");
    });

    it("clearSelection empties the set and the anchor", () => {
      const store = usePlayerStore.getState();
      store.setSelection(["el-1", "el-2"], "el-2");
      store.clearSelection();

      const state = usePlayerStore.getState();
      expect([...state.selectedElementIds]).toEqual([]);
      expect(state.selectedElementId).toBeNull();
    });
  });

  describe("updateElement", () => {
    it("updates the start time of a specific element", () => {
      usePlayerStore.getState().setElements([
        { id: "el-1", tag: "div", start: 0, duration: 5, track: 0 },
        { id: "el-2", tag: "div", start: 5, duration: 5, track: 1 },
      ]);
      usePlayerStore.getState().updateElement("el-1", { start: 3 });
      const elements = usePlayerStore.getState().elements;
      expect(elements[0].start).toBe(3);
      expect(elements[1].start).toBe(5); // unchanged
    });

    it("does not modify elements when id is not found", () => {
      const original: TimelineElement[] = [
        { id: "el-1", tag: "div", start: 0, duration: 5, track: 0 },
      ];
      usePlayerStore.getState().setElements(original);
      usePlayerStore.getState().updateElement("nonexistent", { start: 10 });
      expect(usePlayerStore.getState().elements[0].start).toBe(0);
    });

    it("prefers the stable element key when duplicate ids exist", () => {
      usePlayerStore.getState().setElements([
        { id: "headline", key: "a", tag: "div", start: 0, duration: 5, track: 0 },
        { id: "headline", key: "b", tag: "div", start: 5, duration: 5, track: 1 },
      ]);

      usePlayerStore.getState().updateElement("b", { start: 9 });

      const elements = usePlayerStore.getState().elements;
      expect(elements[0].start).toBe(0);
      expect(elements[1].start).toBe(9);
    });
  });

  describe("setZoomMode", () => {
    it("changes zoom mode to manual", () => {
      usePlayerStore.getState().setZoomMode("manual");
      expect(usePlayerStore.getState().zoomMode).toBe("manual");
    });

    it("changes zoom mode back to fit", () => {
      usePlayerStore.getState().setZoomMode("manual");
      usePlayerStore.getState().setZoomMode("fit");
      expect(usePlayerStore.getState().zoomMode).toBe("fit");
    });
  });

  describe("setManualZoomPercent", () => {
    it("updates the manual zoom percent", () => {
      usePlayerStore.getState().setManualZoomPercent(200);
      expect(usePlayerStore.getState().manualZoomPercent).toBe(200);
    });

    it("clamps to minimum of 10", () => {
      usePlayerStore.getState().setManualZoomPercent(5);
      expect(usePlayerStore.getState().manualZoomPercent).toBe(10);
    });

    it("clamps negative values to 10", () => {
      usePlayerStore.getState().setManualZoomPercent(-50);
      expect(usePlayerStore.getState().manualZoomPercent).toBe(10);
    });

    it("clamps to the maximum supported zoom percent", () => {
      usePlayerStore.getState().setManualZoomPercent(5000);
      expect(usePlayerStore.getState().manualZoomPercent).toBe(2000);
    });
  });

  describe("reset", () => {
    it("resets all state to defaults", () => {
      // Mutate everything
      const store = usePlayerStore.getState();
      store.setIsPlaying(true);
      store.setCurrentTime(42);
      store.setDuration(120);
      store.setTimelineReady(true);
      store.setElements([{ id: "el-1", tag: "div", start: 0, duration: 5, track: 0 }]);
      store.setSelectedElementId("el-1");

      // Reset
      usePlayerStore.getState().reset();

      const state = usePlayerStore.getState();
      expect(state.isPlaying).toBe(false);
      expect(state.currentTime).toBe(0);
      expect(state.duration).toBe(0);
      expect(state.timelineReady).toBe(false);
      expect(state.elements).toEqual([]);
      expect(state.selectedElementId).toBeNull();
    });

    it("does not reset playbackRate, audioMuted, loopEnabled, zoomMode, or manualZoomPercent", () => {
      const store = usePlayerStore.getState();
      store.setPlaybackRate(2);
      store.setAudioMuted(true);
      store.setLoopEnabled(true);
      store.setZoomMode("manual");
      store.setManualZoomPercent(200);

      usePlayerStore.getState().reset();

      const state = usePlayerStore.getState();
      // reset() only resets the fields explicitly listed in the reset function
      expect(state.playbackRate).toBe(2);
      expect(state.audioMuted).toBe(true);
      expect(state.loopEnabled).toBe(true);
      expect(state.zoomMode).toBe("manual");
      expect(state.manualZoomPercent).toBe(200);
    });
  });
});

describe("liveTime", () => {
  it("notifies subscribers with the current time", () => {
    const listener = vi.fn();
    const unsubscribe = liveTime.subscribe(listener);

    liveTime.notify(5.5);
    expect(listener).toHaveBeenCalledWith(5.5);
    expect(listener).toHaveBeenCalledTimes(1);

    liveTime.notify(10);
    expect(listener).toHaveBeenCalledWith(10);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
  });

  it("supports multiple subscribers", () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    const unsub1 = liveTime.subscribe(listener1);
    const unsub2 = liveTime.subscribe(listener2);

    liveTime.notify(3);
    expect(listener1).toHaveBeenCalledWith(3);
    expect(listener2).toHaveBeenCalledWith(3);

    unsub1();
    unsub2();
  });

  it("unsubscribe stops notifications", () => {
    const listener = vi.fn();
    const unsubscribe = liveTime.subscribe(listener);

    liveTime.notify(1);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();

    liveTime.notify(2);
    expect(listener).toHaveBeenCalledTimes(1); // not called again
  });

  it("unsubscribe returns true when listener existed", () => {
    const listener = vi.fn();
    const unsubscribe = liveTime.subscribe(listener);
    // Set.delete returns boolean, our unsubscribe wraps it
    const result = unsubscribe();
    expect(result).toBe(true);
  });

  it("double unsubscribe returns false", () => {
    const listener = vi.fn();
    const unsubscribe = liveTime.subscribe(listener);
    unsubscribe();
    const result = unsubscribe();
    expect(result).toBe(false);
  });
});
