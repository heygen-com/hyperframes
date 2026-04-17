import type { FrameAdapter } from "./types";

interface LottieAnimationItem {
  play: () => void;
  pause: () => void;
  goToAndStop: (value: number, isFrame: boolean) => void;
  totalFrames: number;
  frameRate: number;
}

interface DotLottiePlayer {
  play: () => void;
  pause: () => void;
  seek?: (percentage: number) => void;
  setCurrentRawFrameValue?: (frame: number) => void;
  totalFrames?: number;
  frameRate?: number;
  duration?: number;
}

export type LottieAnimationLike = LottieAnimationItem | DotLottiePlayer;

export interface CreateLottieFrameAdapterOptions {
  id?: string;
  fps: number;
  animation: LottieAnimationLike;
}

export function createLottieFrameAdapter(options: CreateLottieFrameAdapterOptions): FrameAdapter {
  const { fps, animation } = options;
  const adapterId = options.id ?? "lottie";

  return {
    id: adapterId,
    init: () => {
      animation.pause();
    },
    getDurationFrames: () => {
      if ("totalFrames" in animation && typeof animation.totalFrames === "number") {
        const lottieFps = animation.frameRate ?? 30;
        const durationSeconds = animation.totalFrames / lottieFps;
        return Math.max(0, Math.ceil(durationSeconds * fps));
      }
      if ("duration" in animation && typeof animation.duration === "number") {
        return Math.max(0, Math.ceil((animation.duration || 0) * fps));
      }
      return 0;
    },
    seekFrame: (frame: number) => {
      const targetSeconds = Math.max(0, frame) / fps;
      animation.pause();

      if ("goToAndStop" in animation && typeof animation.goToAndStop === "function") {
        animation.goToAndStop(targetSeconds * 1000, false);
      } else if (
        "setCurrentRawFrameValue" in animation &&
        typeof animation.setCurrentRawFrameValue === "function"
      ) {
        const lottieFps = animation.frameRate ?? 30;
        animation.setCurrentRawFrameValue(targetSeconds * lottieFps);
      } else if ("seek" in animation && typeof animation.seek === "function") {
        const duration = animation.duration ?? 1;
        const percentage = Math.min(100, (targetSeconds / duration) * 100);
        animation.seek(percentage);
      }
    },
  };
}
