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
      expect(state.zoomMode).toBe("fit");
      expect(state.pixelsPerSecond).toBe(100);
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

  describe("updateElementStart", () => {
    it("updates the start time of a specific element", () => {
      usePlayerStore.getState().setElements([
        { id: "el-1", tag: "div", start: 0, duration: 5, track: 0 },
        { id: "el-2", tag: "div", start: 5, duration: 5, track: 1 },
      ]);
      usePlayerStore.getState().updateElementStart("el-1", 3);
      const elements = usePlayerStore.getState().elements;
      expect(elements[0].start).toBe(3);
      expect(elements[1].start).toBe(5); // unchanged
    });

    it("does not modify elements when id is not found", () => {
      const original: TimelineElement[] = [
        { id: "el-1", tag: "div", start: 0, duration: 5, track: 0 },
      ];
      usePlayerStore.getState().setElements(original);
      usePlayerStore.getState().updateElementStart("nonexistent", 10);
      expect(usePlayerStore.getState().elements[0].start).toBe(0);
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

  describe("setPixelsPerSecond", () => {
    it("updates pixelsPerSecond", () => {
      usePlayerStore.getState().setPixelsPerSecond(200);
      expect(usePlayerStore.getState().pixelsPerSecond).toBe(200);
    });

    it("clamps to minimum of 10", () => {
      usePlayerStore.getState().setPixelsPerSecond(5);
      expect(usePlayerStore.getState().pixelsPerSecond).toBe(10);
    });

    it("clamps negative values to 10", () => {
      usePlayerStore.getState().setPixelsPerSecond(-50);
      expect(usePlayerStore.getState().pixelsPerSecond).toBe(10);
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

    it("does not reset playbackRate, zoomMode, or pixelsPerSecond", () => {
      const store = usePlayerStore.getState();
      store.setPlaybackRate(2);
      store.setZoomMode("manual");
      store.setPixelsPerSecond(200);

      usePlayerStore.getState().reset();

      const state = usePlayerStore.getState();
      // reset() only resets the fields explicitly listed in the reset function
      expect(state.playbackRate).toBe(2);
      expect(state.zoomMode).toBe("manual");
      expect(state.pixelsPerSecond).toBe(200);
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
