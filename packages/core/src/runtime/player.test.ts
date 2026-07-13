import { describe, it, expect, vi } from "vitest";
import { createRuntimePlayer } from "./player";
import type { RuntimeTimelineLike } from "./types";

function createMockTimeline(opts?: { time?: number; duration?: number }): RuntimeTimelineLike {
  const state = { time: opts?.time ?? 0, duration: opts?.duration ?? 10, paused: false };
  return {
    play: vi.fn(() => {
      state.paused = false;
    }),
    pause: vi.fn(() => {
      state.paused = true;
    }),
    seek: vi.fn((t?: number) => {
      if (t !== undefined) state.time = t;
      return state.time;
    }),
    totalTime: vi.fn((t?: number) => {
      if (t !== undefined) state.time = t;
      return state.time;
    }),
    time: vi.fn(() => state.time),
    duration: vi.fn(() => state.duration),
    add: vi.fn(),
    paused: vi.fn((p?: boolean) => {
      if (p !== undefined) state.paused = p;
    }),
    timeScale: vi.fn(),
    set: vi.fn(),
  };
}

function createMockDeps(timeline?: RuntimeTimelineLike | null) {
  let isPlaying = false;
  let playbackRate = 1;
  return {
    getTimeline: vi.fn(() => timeline ?? null),
    setTimeline: vi.fn(),
    getIsPlaying: vi.fn(() => isPlaying),
    setIsPlaying: vi.fn((v: boolean) => {
      isPlaying = v;
    }),
    getPlaybackRate: vi.fn(() => playbackRate),
    setPlaybackRate: vi.fn((v: number) => {
      playbackRate = v;
    }),
    getCanonicalFps: vi.fn(() => 30),
    onSyncMedia: vi.fn(),
    onStatePost: vi.fn(),
    onDeterministicSeek: vi.fn(),
    onDeterministicPause: vi.fn(),
    onDeterministicPlay: vi.fn(),
    onRenderFrameSeek: vi.fn(),
    onShowNativeVideos: vi.fn(),
    getSafeDuration: vi.fn(() => 10),
  };
}

function createNestedTimelineHarness() {
  const createScene = (start: number, duration: number) => {
    const state = { time: 0, paused: false };
    const timeline = {
      play: vi.fn(() => {
        state.paused = false;
      }),
      pause: vi.fn(() => {
        state.paused = true;
      }),
      seek: vi.fn((t?: number) => {
        if (t !== undefined) state.time = t;
        return state.time;
      }),
      totalTime: vi.fn((t?: number) => {
        if (t !== undefined) state.time = t;
        return state.time;
      }),
      time: vi.fn(() => state.time),
      duration: vi.fn(() => duration),
      add: vi.fn(),
      paused: vi.fn((p?: boolean) => {
        if (p !== undefined) state.paused = p;
      }),
      timeScale: vi.fn(),
      set: vi.fn(),
    } satisfies RuntimeTimelineLike;
    return { timeline, state, start, duration };
  };

  const scene1 = createScene(0, 1.5);
  const scene2 = createScene(1.5, 10);
  const scene5 = createScene(12, 3);
  const children = [scene1, scene2, scene5];

  const masterState = { time: 0, paused: false };
  const master = {
    play: vi.fn(() => {
      masterState.paused = false;
    }),
    pause: vi.fn(() => {
      masterState.paused = true;
    }),
    seek: vi.fn((t?: number) => {
      if (t === undefined) return masterState.time;
      masterState.time = t;
      for (const child of children) {
        if (child.state.paused) continue;
        child.state.time = Math.max(0, Math.min(t - child.start, child.duration));
      }
    }),
    totalTime: vi.fn((t?: number) => {
      if (t === undefined) return masterState.time;
      masterState.time = t;
      for (const child of children) {
        if (child.state.paused) continue;
        child.state.time = Math.max(0, Math.min(t - child.start, child.duration));
      }
    }),
    time: vi.fn(() => masterState.time),
    duration: vi.fn(() => 20),
    add: vi.fn(),
    paused: vi.fn((p?: boolean) => {
      if (p !== undefined) masterState.paused = p;
    }),
    timeScale: vi.fn(),
    set: vi.fn(),
  } satisfies RuntimeTimelineLike;

  return {
    master,
    scene1: scene1.timeline,
    scene2: scene2.timeline,
    scene5: scene5.timeline,
  };
}

describe("createRuntimePlayer", () => {
  describe("play", () => {
    it("does nothing without a timeline", () => {
      const deps = createMockDeps(null);
      const player = createRuntimePlayer(deps);
      player.play();
      expect(deps.setIsPlaying).not.toHaveBeenCalled();
    });

    it("does nothing if already playing", () => {
      const timeline = createMockTimeline();
      const deps = createMockDeps(timeline);
      deps.getIsPlaying.mockReturnValue(true);
      const player = createRuntimePlayer(deps);
      player.play();
      expect(timeline.play).not.toHaveBeenCalled();
    });

    it("plays the timeline and updates state", () => {
      const timeline = createMockTimeline({ time: 2, duration: 10 });
      const deps = createMockDeps(timeline);
      const player = createRuntimePlayer(deps);
      player.play();
      expect(timeline.play).toHaveBeenCalled();
      expect(deps.setIsPlaying).toHaveBeenCalledWith(true);
      expect(deps.onDeterministicPlay).toHaveBeenCalled();
      expect(deps.onShowNativeVideos).toHaveBeenCalled();
      expect(deps.onStatePost).toHaveBeenCalledWith(true);
    });

    it("resets to 0 when at end of timeline", () => {
      const timeline = createMockTimeline({ time: 10, duration: 10 });
      const deps = createMockDeps(timeline);
      deps.getSafeDuration.mockReturnValue(10);
      const player = createRuntimePlayer(deps);
      player.play();
      expect(timeline.seek).toHaveBeenCalledWith(0, false);
      expect(deps.onDeterministicSeek).toHaveBeenCalledWith(0);
    });

    it("sets timeScale to playbackRate", () => {
      const timeline = createMockTimeline({ time: 0, duration: 10 });
      const deps = createMockDeps(timeline);
      deps.getPlaybackRate.mockReturnValue(2);
      const player = createRuntimePlayer(deps);
      player.play();
      expect(timeline.timeScale).toHaveBeenCalledWith(2);
    });
  });

  describe("pause", () => {
    it("does nothing without a timeline", () => {
      const deps = createMockDeps(null);
      const player = createRuntimePlayer(deps);
      player.pause();
      expect(deps.setIsPlaying).not.toHaveBeenCalled();
    });

    it("pauses the timeline and syncs media", () => {
      const timeline = createMockTimeline({ time: 5 });
      const deps = createMockDeps(timeline);
      const player = createRuntimePlayer(deps);
      player.pause();
      expect(timeline.pause).toHaveBeenCalled();
      expect(deps.setIsPlaying).toHaveBeenCalledWith(false);
      expect(deps.onDeterministicSeek).toHaveBeenCalledWith(5);
      expect(deps.onDeterministicPause).toHaveBeenCalled();
      expect(deps.onSyncMedia).toHaveBeenCalledWith(5, false);
      expect(deps.onRenderFrameSeek).toHaveBeenCalledWith(5);
      expect(deps.onStatePost).toHaveBeenCalledWith(true);
    });
  });

  // Regression: nested compositions register sibling timelines alongside
  // the master (e.g. `scene1-logo-intro` + `scene2-4-canvas` next to the
  // master's own inline timeline). Before this, pausing the master would
  // leave siblings free-running, so scene animations kept advancing and the
  // composition would visibly drift past the paused time even though the
  // player UI was frozen.
  describe("timeline registry propagation", () => {
    it("pauses every sibling timeline, not just the master", () => {
      const master = createMockTimeline({ time: 5 });
      const scene1 = createMockTimeline();
      const scene2 = createMockTimeline();
      const deps = createMockDeps(master);
      const player = createRuntimePlayer({
        ...deps,
        getTimelineRegistry: () => ({ main: master, scene1, scene2 }),
      });
      player.pause();
      expect(master.pause).toHaveBeenCalledTimes(1);
      expect(scene1.pause).toHaveBeenCalledTimes(1);
      expect(scene2.pause).toHaveBeenCalledTimes(1);
    });

    it("plays every sibling timeline when the master plays", () => {
      const master = createMockTimeline({ time: 0, duration: 10 });
      const scene1 = createMockTimeline();
      const scene2 = createMockTimeline();
      const deps = createMockDeps(master);
      const player = createRuntimePlayer({
        ...deps,
        getTimelineRegistry: () => ({ main: master, scene1, scene2 }),
      });
      player.play();
      expect(master.play).toHaveBeenCalledTimes(1);
      expect(scene1.play).toHaveBeenCalledTimes(1);
      expect(scene2.play).toHaveBeenCalledTimes(1);
    });

    it("propagates playbackRate to siblings on play", () => {
      const master = createMockTimeline({ time: 0, duration: 10 });
      const scene1 = createMockTimeline();
      const deps = createMockDeps(master);
      deps.getPlaybackRate.mockReturnValue(2);
      const player = createRuntimePlayer({
        ...deps,
        getTimelineRegistry: () => ({ main: master, scene1 }),
      });
      player.play();
      expect(scene1.timeScale).toHaveBeenCalledWith(2);
    });

    it("does not call pause/play on the master twice through the registry", () => {
      const master = createMockTimeline({ time: 5 });
      const deps = createMockDeps(master);
      const player = createRuntimePlayer({
        ...deps,
        // The master is identity-equal to one of the registry entries.
        getTimelineRegistry: () => ({ main: master }),
      });
      player.pause();
      expect(master.pause).toHaveBeenCalledTimes(1);
    });

    it("swallows errors from a broken sibling without breaking pause", () => {
      const master = createMockTimeline({ time: 5 });
      const broken = createMockTimeline();
      (broken.pause as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw new Error("boom");
      });
      const ok = createMockTimeline();
      const deps = createMockDeps(master);
      const player = createRuntimePlayer({
        ...deps,
        getTimelineRegistry: () => ({ main: master, broken, ok }),
      });
      expect(() => player.pause()).not.toThrow();
      expect(master.pause).toHaveBeenCalled();
      expect(ok.pause).toHaveBeenCalled();
    });

    it("is a no-op when no registry is supplied (back-compat)", () => {
      const master = createMockTimeline({ time: 5 });
      const deps = createMockDeps(master);
      const player = createRuntimePlayer(deps);
      expect(() => player.pause()).not.toThrow();
      expect(master.pause).toHaveBeenCalled();
    });

    it("tolerates undefined entries in the registry", () => {
      const master = createMockTimeline({ time: 5 });
      const scene = createMockTimeline();
      const deps = createMockDeps(master);
      const player = createRuntimePlayer({
        ...deps,
        getTimelineRegistry: () => ({ main: master, gone: undefined, scene }),
      });
      expect(() => player.pause()).not.toThrow();
      expect(scene.pause).toHaveBeenCalled();
    });
  });

  describe("seek", () => {
    it("does nothing without a timeline", () => {
      const deps = createMockDeps(null);
      const player = createRuntimePlayer(deps);
      player.seek(5);
      expect(deps.onDeterministicSeek).not.toHaveBeenCalled();
    });

    it("seeks to quantized time and pauses", () => {
      const timeline = createMockTimeline({ duration: 10 });
      const deps = createMockDeps(timeline);
      const player = createRuntimePlayer(deps);
      player.seek(3);
      expect(timeline.pause).toHaveBeenCalled();
      expect(timeline.totalTime).toHaveBeenCalled();
      expect(deps.setIsPlaying).toHaveBeenCalledWith(false);
      expect(deps.onSyncMedia).toHaveBeenCalled();
      expect(deps.onStatePost).toHaveBeenCalledWith(true);
    });

    it("rearms paused sibling timelines so master seek updates their local offsets", () => {
      const { master, scene1, scene2, scene5 } = createNestedTimelineHarness();
      const deps = createMockDeps(master);
      const player = createRuntimePlayer({
        ...deps,
        getTimelineRegistry: () => ({ main: master, scene1, scene2, scene5 }),
      });
      player.pause();
      player.seek(3);
      expect(scene1.play).toHaveBeenCalledTimes(1);
      expect(scene2.play).toHaveBeenCalledTimes(1);
      expect(scene5.play).toHaveBeenCalledTimes(1);
      expect(master.totalTime).toHaveBeenCalledWith(3, false);
      expect(scene1.time()).toBe(1.5);
      expect(scene2.time()).toBe(1.5);
      expect(scene5.time()).toBe(0);
      expect(scene1.pause).toHaveBeenCalledTimes(2);
      expect(scene2.pause).toHaveBeenCalledTimes(2);
      expect(scene5.pause).toHaveBeenCalledTimes(2);
    });

    it("clamps negative time to 0", () => {
      const timeline = createMockTimeline({ duration: 10 });
      const deps = createMockDeps(timeline);
      const player = createRuntimePlayer(deps);
      player.seek(-5);
      expect(deps.onDeterministicSeek).toHaveBeenCalledWith(0);
    });

    it("handles NaN time", () => {
      const timeline = createMockTimeline({ duration: 10 });
      const deps = createMockDeps(timeline);
      const player = createRuntimePlayer(deps);
      player.seek(NaN);
      expect(deps.onDeterministicSeek).toHaveBeenCalledWith(0);
    });

    it("seeks to the exact safe duration without snapping back a frame", () => {
      const timeline = createMockTimeline({ duration: 8 });
      const deps = createMockDeps(timeline);
      deps.getSafeDuration.mockReturnValue(8);
      const player = createRuntimePlayer(deps);
      player.seek(8);
      expect(timeline.pause).toHaveBeenCalled();
      expect(timeline.totalTime).toHaveBeenCalledWith(8, false);
      expect(deps.onDeterministicSeek).toHaveBeenCalledWith(8);
      expect(deps.onSyncMedia).toHaveBeenCalledWith(8, false);
    });

    // Regression: A/E Jump-to-in/out shortcuts (PR #842) send
    // `{ keepPlaying: true }` so playback survives the seek. Before this fix the
    // runtime always called setIsPlaying(false), so the shortcut paused playback
    // on every press in compositions backed by the `__player` runtime adapter.
    describe("keepPlaying option", () => {
      it("preserves play state when keepPlaying is true and playback was active", () => {
        const timeline = createMockTimeline({ duration: 10 });
        const deps = createMockDeps(timeline);
        deps.getIsPlaying.mockReturnValue(true);
        const player = createRuntimePlayer(deps);
        player.seek(3, { keepPlaying: true });
        expect(deps.setIsPlaying).not.toHaveBeenCalledWith(false);
        expect(deps.onDeterministicPlay).toHaveBeenCalled();
        expect(deps.onShowNativeVideos).toHaveBeenCalled();
        expect(deps.onSyncMedia).toHaveBeenCalledWith(expect.any(Number), true);
      });

      it("resumes the master timeline after the deterministic seek pauses it", () => {
        const timeline = createMockTimeline({ duration: 10 });
        const deps = createMockDeps(timeline);
        deps.getIsPlaying.mockReturnValue(true);
        const player = createRuntimePlayer(deps);
        player.seek(3, { keepPlaying: true });
        // The helper pauses then seeks; the keep-playing branch must call
        // play() afterwards so the timeline is left running.
        const playMock = timeline.play as ReturnType<typeof vi.fn>;
        const pauseMock = timeline.pause as ReturnType<typeof vi.fn>;
        expect(playMock).toHaveBeenCalledTimes(1);
        expect(pauseMock).toHaveBeenCalled();
        expect(playMock.mock.invocationCallOrder[0]).toBeGreaterThan(
          pauseMock.mock.invocationCallOrder[pauseMock.mock.invocationCallOrder.length - 1],
        );
      });

      it("applies playbackRate to master and siblings on resume", () => {
        const master = createMockTimeline({ duration: 10 });
        const scene1 = createMockTimeline();
        const deps = createMockDeps(master);
        deps.getIsPlaying.mockReturnValue(true);
        deps.getPlaybackRate.mockReturnValue(2);
        const player = createRuntimePlayer({
          ...deps,
          getTimelineRegistry: () => ({ main: master, scene1 }),
        });
        player.seek(3, { keepPlaying: true });
        expect(master.timeScale).toHaveBeenCalledWith(2);
        expect(scene1.timeScale).toHaveBeenCalledWith(2);
        expect(scene1.play).toHaveBeenCalled();
      });

      it("stays paused when keepPlaying is true but playback was not active", () => {
        const timeline = createMockTimeline({ duration: 10 });
        const deps = createMockDeps(timeline);
        deps.getIsPlaying.mockReturnValue(false);
        const player = createRuntimePlayer(deps);
        player.seek(3, { keepPlaying: true });
        expect(deps.setIsPlaying).toHaveBeenCalledWith(false);
        expect(deps.onSyncMedia).toHaveBeenCalledWith(expect.any(Number), false);
        expect(deps.onDeterministicPlay).not.toHaveBeenCalled();
        expect(deps.onShowNativeVideos).not.toHaveBeenCalled();
      });

      it("pauses on seek when keepPlaying is false (explicit)", () => {
        const timeline = createMockTimeline({ duration: 10 });
        const deps = createMockDeps(timeline);
        deps.getIsPlaying.mockReturnValue(true);
        const player = createRuntimePlayer(deps);
        player.seek(3, { keepPlaying: false });
        expect(deps.setIsPlaying).toHaveBeenCalledWith(false);
        expect(deps.onSyncMedia).toHaveBeenCalledWith(expect.any(Number), false);
        expect(deps.onDeterministicPlay).not.toHaveBeenCalled();
      });

      it("pauses on seek when no options are passed (default behavior unchanged)", () => {
        const timeline = createMockTimeline({ duration: 10 });
        const deps = createMockDeps(timeline);
        deps.getIsPlaying.mockReturnValue(true);
        const player = createRuntimePlayer(deps);
        player.seek(3);
        expect(deps.setIsPlaying).toHaveBeenCalledWith(false);
        expect(deps.onSyncMedia).toHaveBeenCalledWith(expect.any(Number), false);
        expect(deps.onDeterministicPlay).not.toHaveBeenCalled();
      });
    });
  });

  describe("renderSeek", () => {
    it("seeks deterministically for render pipeline", () => {
      const timeline = createMockTimeline({ duration: 10 });
      const deps = createMockDeps(timeline);
      const player = createRuntimePlayer(deps);
      player.renderSeek(5);
      expect(timeline.pause).toHaveBeenCalled();
      expect(deps.setIsPlaying).toHaveBeenCalledWith(false);
      expect(deps.onRenderFrameSeek).toHaveBeenCalled();
    });

    it("can suppress timeline events during administrative render seeks", () => {
      const timeline = createMockTimeline({ duration: 10 });
      const deps = createMockDeps(timeline);
      const player = createRuntimePlayer(deps);
      const renderSeek = player.renderSeek as (
        time: number,
        options?: { suppressEvents?: boolean },
      ) => void;

      renderSeek(5, { suppressEvents: true });

      expect(timeline.totalTime).toHaveBeenCalledWith(5, true);
    });

    it("renderSeek rearms paused siblings and keeps them active for export frames", () => {
      const { master, scene1, scene2, scene5 } = createNestedTimelineHarness();
      const deps = createMockDeps(master);
      const player = createRuntimePlayer({
        ...deps,
        getTimelineRegistry: () => ({ main: master, scene1, scene2, scene5 }),
      });
      player.pause();
      player.renderSeek(5);
      expect(master.totalTime).toHaveBeenCalledWith(5, false);
      expect(scene1.time()).toBe(1.5);
      expect(scene2.time()).toBe(3.5);
      expect(scene5.time()).toBe(0);
      expect(scene1.play).toHaveBeenCalledTimes(1);
      expect(scene2.play).toHaveBeenCalledTimes(1);
      expect(scene5.play).toHaveBeenCalledTimes(1);
      expect(scene1.pause).toHaveBeenCalledTimes(1);
      expect(scene2.pause).toHaveBeenCalledTimes(1);
      expect(scene5.pause).toHaveBeenCalledTimes(1);
    });
  });

  describe("tolerates non-conformant timeline objects", () => {
    it("handles duration as a number property instead of a function", () => {
      const timeline = {
        play: vi.fn(),
        pause: vi.fn(),
        seek: vi.fn(),
        totalTime: vi.fn(),
        time: vi.fn(() => 2),
        duration: 10,
        add: vi.fn(),
        paused: vi.fn(),
        set: vi.fn(),
      } as unknown as RuntimeTimelineLike;
      const deps = createMockDeps(timeline);
      const player = createRuntimePlayer(deps);
      expect(player.getDuration()).toBe(10);
      expect(() => player.play()).not.toThrow();
    });

    it("handles missing pause method", () => {
      const timeline = {
        play: vi.fn(),
        seek: vi.fn(),
        time: vi.fn(() => 0),
        duration: vi.fn(() => 10),
        add: vi.fn(),
        paused: vi.fn(),
        set: vi.fn(),
      } as unknown as RuntimeTimelineLike;
      const deps = createMockDeps(timeline);
      const player = createRuntimePlayer(deps);
      expect(() => player.pause()).not.toThrow();
      expect(() => player.seek(3)).not.toThrow();
    });

    it("handles missing play method", () => {
      const timeline = {
        pause: vi.fn(),
        seek: vi.fn(),
        time: vi.fn(() => 0),
        duration: vi.fn(() => 10),
        add: vi.fn(),
        paused: vi.fn(),
        set: vi.fn(),
      } as unknown as RuntimeTimelineLike;
      const deps = createMockDeps(timeline);
      const player = createRuntimePlayer(deps);
      expect(() => player.play()).not.toThrow();
    });

    it("handles time as a number property instead of a function", () => {
      const timeline = {
        play: vi.fn(),
        pause: vi.fn(),
        seek: vi.fn(),
        time: 5,
        duration: vi.fn(() => 10),
        add: vi.fn(),
        paused: vi.fn(),
        set: vi.fn(),
      } as unknown as RuntimeTimelineLike;
      const deps = createMockDeps(timeline);
      const player = createRuntimePlayer(deps);
      expect(player.getTime()).toBe(5);
    });
  });

  describe("getters", () => {
    it("getTime returns timeline time", () => {
      const timeline = createMockTimeline({ time: 7.5 });
      const deps = createMockDeps(timeline);
      const player = createRuntimePlayer(deps);
      expect(player.getTime()).toBe(7.5);
    });

    it("getDuration returns timeline duration", () => {
      const timeline = createMockTimeline({ duration: 30 });
      const deps = createMockDeps(timeline);
      const player = createRuntimePlayer(deps);
      expect(player.getDuration()).toBe(30);
    });

    it("getTime returns 0 without timeline", () => {
      const deps = createMockDeps(null);
      const player = createRuntimePlayer(deps);
      expect(player.getTime()).toBe(0);
    });

    it("getDuration returns 0 without timeline", () => {
      const deps = createMockDeps(null);
      const player = createRuntimePlayer(deps);
      expect(player.getDuration()).toBe(0);
    });

    it("isPlaying delegates to deps", () => {
      const deps = createMockDeps(null);
      deps.getIsPlaying.mockReturnValue(true);
      const player = createRuntimePlayer(deps);
      expect(player.isPlaying()).toBe(true);
    });

    it("setPlaybackRate delegates to deps", () => {
      const deps = createMockDeps(null);
      const player = createRuntimePlayer(deps);
      player.setPlaybackRate(1.5);
      expect(deps.setPlaybackRate).toHaveBeenCalledWith(1.5);
    });

    it("getPlaybackRate delegates to deps", () => {
      const deps = createMockDeps(null);
      deps.getPlaybackRate.mockReturnValue(2);
      const player = createRuntimePlayer(deps);
      expect(player.getPlaybackRate()).toBe(2);
    });
  });
});
