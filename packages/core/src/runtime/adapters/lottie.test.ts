import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLottieAdapter } from "./lottie";
import { createRuntimeStartTimeResolver } from "../startResolver";

const lottieWindow = window as Window & {
  lottie?: {
    loadAnimation: (params: unknown) => unknown;
    getRegisteredAnimations: () => unknown[];
  };
  __hfLottie?: unknown[];
};

function createLottieWebAnim(opts?: { totalFrames?: number; frameRate?: number }) {
  return {
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    goToAndStop: vi.fn(),
    goToAndPlay: vi.fn(),
    totalFrames: opts?.totalFrames ?? 120,
    frameRate: opts?.frameRate ?? 30,
  };
}

function createDotLottiePlayer(opts?: {
  totalFrames?: number;
  frameRate?: number;
  duration?: number;
}) {
  return {
    play: vi.fn(),
    pause: vi.fn(),
    totalFrames: opts?.totalFrames ?? 60,
    frameRate: opts?.frameRate ?? 30,
    duration: opts?.duration ?? 2,
    setCurrentRawFrameValue: vi.fn(),
    seek: vi.fn(),
  };
}

describe("lottie adapter", () => {
  beforeEach(() => {
    delete lottieWindow.lottie;
    delete lottieWindow.__hfLottie;
  });

  afterEach(() => {
    delete lottieWindow.lottie;
    delete lottieWindow.__hfLottie;
  });

  it("has correct name", () => {
    expect(createLottieAdapter().name).toBe("lottie");
  });

  describe("discover", () => {
    it("auto-discovers lottie-web animations", () => {
      const anim = createLottieWebAnim();
      lottieWindow.lottie = {
        loadAnimation: vi.fn(),
        getRegisteredAnimations: () => [anim],
      };
      lottieWindow.__hfLottie = [];
      const adapter = createLottieAdapter();
      adapter.discover();
      expect(lottieWindow.__hfLottie).toContain(anim);
    });

    it("does not duplicate existing animations", () => {
      const anim = createLottieWebAnim();
      lottieWindow.lottie = {
        loadAnimation: vi.fn(),
        getRegisteredAnimations: () => [anim],
      };
      lottieWindow.__hfLottie = [anim];
      const adapter = createLottieAdapter();
      adapter.discover();
      expect(lottieWindow.__hfLottie).toHaveLength(1);
    });

    it("handles no global lottie", () => {
      const adapter = createLottieAdapter();
      expect(() => adapter.discover()).not.toThrow();
    });
  });

  function mountedAt(start: string) {
    document.body.innerHTML = `<div data-composition-id="root"><div data-composition-id="host" data-start="${start}"><div data-composition-id="walk"><div id="player"></div></div></div></div>`;
    const { resolveStartForElement } = createRuntimeStartTimeResolver({});
    const adapter = createLottieAdapter({
      resolveStartSeconds: (el) => resolveStartForElement(el, 0),
    });
    return { adapter, player: document.getElementById("player")! };
  }

  describe("seek", () => {
    it("seeks a player in a mounted composition to the time since that composition started", () => {
      const { adapter, player } = mountedAt("3");
      const anim = { ...createLottieWebAnim(), wrapper: player };
      const dot = { ...createDotLottiePlayer({ totalFrames: 60, frameRate: 30 }), canvas: player };
      lottieWindow.__hfLottie = [anim, dot];
      adapter.seek({ time: 4 });
      expect(anim.goToAndStop).toHaveBeenCalledWith(1000, false);
      expect(dot.setCurrentRawFrameValue).toHaveBeenCalledWith(30);
      adapter.seek({ time: 1 });
      expect(anim.goToAndStop).toHaveBeenLastCalledWith(0, false);
      document.body.innerHTML = "";
    });

    it("keeps page time for a player in a composition that starts at 0", () => {
      const { adapter, player } = mountedAt("0");
      const anim = { ...createLottieWebAnim(), wrapper: player };
      lottieWindow.__hfLottie = [anim];
      adapter.seek({ time: 2 });
      expect(anim.goToAndStop).toHaveBeenCalledWith(2000, false);
      document.body.innerHTML = "";
    });

    it("seeks lottie-web with goToAndStop in ms", () => {
      const anim = createLottieWebAnim();
      lottieWindow.__hfLottie = [anim];
      const adapter = createLottieAdapter();
      adapter.seek({ time: 2 });
      expect(anim.goToAndStop).toHaveBeenCalledWith(2000, false);
    });

    it("seeks dotlottie-web v2 with setCurrentRawFrameValue", () => {
      const player = createDotLottiePlayer({ totalFrames: 60, frameRate: 30 });
      lottieWindow.__hfLottie = [player];
      const adapter = createLottieAdapter();
      adapter.seek({ time: 1 });
      // frame = time * fps = 1 * 30 = 30
      expect(player.setCurrentRawFrameValue).toHaveBeenCalledWith(30);
    });

    it("clamps frame to totalFrames - 1", () => {
      const player = createDotLottiePlayer({ totalFrames: 60, frameRate: 30 });
      lottieWindow.__hfLottie = [player];
      const adapter = createLottieAdapter();
      adapter.seek({ time: 10 }); // frame = 300, but totalFrames = 60
      expect(player.setCurrentRawFrameValue).toHaveBeenCalledWith(59);
    });

    it.each([0, -1, NaN, Infinity, undefined])(
      "does not seek a dotlottie v1 player with duration %s",
      (duration) => {
        const player = { pause: vi.fn(), seek: vi.fn(), duration };
        lottieWindow.__hfLottie = [player];
        const adapter = createLottieAdapter();
        adapter.seek({ time: 0 });
        adapter.seek({ time: 1 });
        expect(player.seek).not.toHaveBeenCalled();
      },
    );

    it("seeks a dotlottie v1 player once its duration becomes available", () => {
      const player = { pause: vi.fn(), seek: vi.fn(), duration: 0 };
      lottieWindow.__hfLottie = [player];
      const adapter = createLottieAdapter();
      adapter.seek({ time: 0 });
      player.duration = 2;
      adapter.seek({ time: 1 });
      adapter.seek({ time: -1 });
      adapter.seek({ time: 3 });
      expect(player.seek.mock.calls).toEqual([[50], [0], [100]]);
    });

    it("wraps a looping lottie-web animation into its own cycle and clamps a one-shot", () => {
      const cycle = { ...createLottieWebAnim({ totalFrames: 120, frameRate: 30 }), loop: true };
      const once = createLottieWebAnim({ totalFrames: 120, frameRate: 30 });
      lottieWindow.__hfLottie = [cycle, once];
      const adapter = createLottieAdapter();
      adapter.seek({ time: 5 });
      adapter.seek({ time: 8 });
      expect(cycle.goToAndStop.mock.calls).toEqual([
        [30, true],
        [0, true],
      ]);
      expect(once.goToAndStop.mock.calls).toEqual([
        [119, true],
        [119, true],
      ]);
    });

    it("wraps a loop whose length is not a whole number of seconds without holding at the seam", () => {
      const cycle = { ...createLottieWebAnim({ totalFrames: 901, frameRate: 30 }), loop: true };
      lottieWindow.__hfLottie = [cycle];
      createLottieAdapter().seek({ time: (9 * 901) / 30 });
      expect(cycle.goToAndStop).toHaveBeenCalledWith(0, true);
    });

    it.each([
      [24, 23.976, 85],
      [30, 25, 17],
    ])(
      "starts cycle %s-frame @ %s fps number %s on frame 0 despite float error",
      (frames, fps, k) => {
        const cycle = {
          ...createLottieWebAnim({ totalFrames: frames, frameRate: fps }),
          loop: true,
        };
        lottieWindow.__hfLottie = [cycle];
        createLottieAdapter().seek({ time: (k * frames) / fps });
        expect(cycle.goToAndStop).toHaveBeenCalledWith(0, true);
      },
    );

    it("holds a one-shot lottie-web animation on its last frame past its end", () => {
      const anim = createLottieWebAnim({ totalFrames: 30, frameRate: 30 });
      lottieWindow.__hfLottie = [anim];
      const adapter = createLottieAdapter();
      adapter.seek({ time: 0.5 });
      adapter.seek({ time: 2.5 });
      expect(anim.goToAndStop.mock.calls).toEqual([
        [500, false],
        [29, true],
      ]);
    });

    it("wraps a looping dotlottie player into its own cycle", () => {
      const player = { ...createDotLottiePlayer({ totalFrames: 60, frameRate: 30 }), loop: true };
      lottieWindow.__hfLottie = [player];
      createLottieAdapter().seek({ time: 3 });
      expect(player.setCurrentRawFrameValue).toHaveBeenCalledWith(30);
    });

    it("does nothing with no instances", () => {
      const adapter = createLottieAdapter();
      expect(() => adapter.seek({ time: 1 })).not.toThrow();
    });

    it("clamps negative time to 0", () => {
      const anim = createLottieWebAnim();
      lottieWindow.__hfLottie = [anim];
      const adapter = createLottieAdapter();
      adapter.seek({ time: -5 });
      expect(anim.goToAndStop).toHaveBeenCalledWith(0, false);
    });
  });

  describe("pause", () => {
    it("pauses lottie-web animation", () => {
      const anim = createLottieWebAnim();
      lottieWindow.__hfLottie = [anim];
      const adapter = createLottieAdapter();
      adapter.pause();
      expect(anim.pause).toHaveBeenCalled();
    });

    it("pauses dotlottie player", () => {
      const player = createDotLottiePlayer();
      lottieWindow.__hfLottie = [player];
      const adapter = createLottieAdapter();
      adapter.pause();
      expect(player.pause).toHaveBeenCalled();
    });
  });

  describe("revert", () => {
    it("does not throw", () => {
      const adapter = createLottieAdapter();
      expect(() => adapter.revert!()).not.toThrow();
    });
  });

  describe("getInferredDurationSeconds", () => {
    it("returns null with no registered instances", () => {
      const adapter = createLottieAdapter();
      expect(adapter.getInferredDurationSeconds?.()).toBeNull();
    });

    it("infers duration from lottie-web totalFrames/frameRate", () => {
      const anim = createLottieWebAnim({ totalFrames: 90, frameRate: 30 });
      lottieWindow.__hfLottie = [anim];
      const adapter = createLottieAdapter();
      expect(adapter.getInferredDurationSeconds?.()).toBe(3);
    });

    it("infers duration from dotlottie player's duration field", () => {
      const player = createDotLottiePlayer({ duration: 4.2 });
      lottieWindow.__hfLottie = [player];
      const adapter = createLottieAdapter();
      expect(adapter.getInferredDurationSeconds?.()).toBe(4.2);
    });

    it("falls back to totalFrames/frameRate when dotlottie duration is absent", () => {
      const player = createDotLottiePlayer({ totalFrames: 150, frameRate: 30, duration: 0 });
      lottieWindow.__hfLottie = [player];
      const adapter = createLottieAdapter();
      expect(adapter.getInferredDurationSeconds?.()).toBe(5);
    });

    it("returns the max across multiple registered animations", () => {
      const short = createLottieWebAnim({ totalFrames: 30, frameRate: 30 });
      const long = createLottieWebAnim({ totalFrames: 300, frameRate: 30 });
      lottieWindow.__hfLottie = [short, long];
      const adapter = createLottieAdapter();
      expect(adapter.getInferredDurationSeconds?.()).toBe(10);
    });

    it("returns null when the animation hasn't loaded yet (totalFrames=0)", () => {
      const anim = createLottieWebAnim({ totalFrames: 0, frameRate: 30 });
      lottieWindow.__hfLottie = [anim];
      const adapter = createLottieAdapter();
      expect(adapter.getInferredDurationSeconds?.()).toBeNull();
    });
  });

  describe("getAnimationCycleEndSeconds", () => {
    afterEach(() => {
      document.body.innerHTML = "";
    });

    it("ends one loop after the start of the player's composition", () => {
      const { adapter, player } = mountedAt("5");
      lottieWindow.__hfLottie = [{ ...createLottieWebAnim({ totalFrames: 60 }), wrapper: player }];
      expect(adapter.getAnimationCycleEndSeconds?.()).toBe(7);
    });

    it("skips a player whose element was removed", () => {
      const { adapter, player } = mountedAt("0");
      const gone = document.body.appendChild(document.createElement("div"));
      gone.remove();
      lottieWindow.__hfLottie = [
        { ...createLottieWebAnim({ totalFrames: 60 }), wrapper: player },
        { ...createLottieWebAnim({ totalFrames: 300 }), wrapper: gone },
      ];
      expect(adapter.getAnimationCycleEndSeconds?.()).toBe(2);
    });

    it("ends one loop in for a player at the root", () => {
      const { adapter } = mountedAt("5");
      const root = document.querySelector('[data-composition-id="root"]')!;
      const player = root.appendChild(document.createElement("div"));
      lottieWindow.__hfLottie = [{ ...createLottieWebAnim({ totalFrames: 60 }), wrapper: player }];
      expect(adapter.getAnimationCycleEndSeconds?.()).toBe(2);
    });
  });
});
