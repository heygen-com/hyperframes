import type { FrameAdapter } from "./types";

export interface GSAPTimelineLike {
  // Base timeline span excluding repeats.
  duration: () => number;
  // Full span including repeats/yoyo when available.
  totalDuration?: () => number;
  seek: (timeInSeconds: number, suppressEvents?: boolean) => unknown;
  pause?: () => unknown;
}

export interface CreateGSAPFrameAdapterOptions {
  id?: string;
  fps: number;
  timeline: GSAPTimelineLike;
}

export function createGSAPFrameAdapter(options: CreateGSAPFrameAdapterOptions): FrameAdapter {
  const { fps, timeline } = options;
  const adapterId = options.id ?? "gsap";

  const getDurationSeconds = (): number => {
    const totalDuration = typeof timeline.totalDuration === "function" ? timeline.totalDuration() : timeline.duration();
    return Number.isFinite(totalDuration) && totalDuration > 0 ? totalDuration : 0;
  };

  return {
    id: adapterId,
    init: () => {
      timeline.pause?.();
    },
    getDurationFrames: () => {
      const durationSeconds = getDurationSeconds();
      return Math.max(0, Math.ceil(durationSeconds * fps));
    },
    seekFrame: (frame: number) => {
      const clampedFrame = Number.isFinite(frame) ? Math.max(0, frame) : 0;
      const targetSeconds = clampedFrame / fps;
      timeline.pause?.();
      timeline.seek(targetSeconds, false);
    },
  };
}
