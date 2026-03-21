import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLottieAdapter } from "./lottie";

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

function createDotLottiePlayer(opts?: { totalFrames?: number; frameRate?: number; duration?: number }) {
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

  describe("seek", () => {
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

  describe("play", () => {
    it("plays lottie-web animation", () => {
      const anim = createLottieWebAnim();
      lottieWindow.__hfLottie = [anim];
      const adapter = createLottieAdapter();
      adapter.play!();
      expect(anim.play).toHaveBeenCalled();
    });
  });

  describe("revert", () => {
    it("does not throw", () => {
      const adapter = createLottieAdapter();
      expect(() => adapter.revert!()).not.toThrow();
    });
  });
});
