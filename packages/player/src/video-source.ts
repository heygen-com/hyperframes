/**
 * Video mode: a `<video playsinline>` driven through the same direct-timeline
 * adapter as a same-origin `__timelines` composition, so play/pause/seek, the
 * timeupdate clock, loop and `ended` stay one code path.
 */

import type { DirectTimelineAdapter } from "./timeline-adapters.js";

export function isVideoType(type: string | null): boolean {
  return type !== null && type.startsWith("video/");
}

export interface VideoSourceCallbacks {
  onMetadata: (video: HTMLVideoElement) => void;
  onDurationChange: (video: HTMLVideoElement) => void;
  onResize: (video: HTMLVideoElement) => void;
  onError: (message: string, code: number | null) => void;
  onPlayRejected: (error: unknown) => void;
}

export interface VideoSource {
  video: HTMLVideoElement;
  adapter: DirectTimelineAdapter;
  destroy: () => void;
}

export function createVideoSource(callbacks: VideoSourceCallbacks): VideoSource {
  const video = document.createElement("video");
  video.className = "hfp-video";
  video.playsInline = true;
  video.preload = "metadata";

  const listeners: Array<[string, () => void]> = [
    ["loadedmetadata", () => callbacks.onMetadata(video)],
    ["durationchange", () => callbacks.onDurationChange(video)],
    ["resize", () => callbacks.onResize(video)],
    [
      "error",
      () =>
        callbacks.onError(
          video.error?.message || "Video failed to load",
          video.error ? video.error.code : null,
        ),
    ],
  ];
  for (const [type, listener] of listeners) video.addEventListener(type, listener);

  const adapter: DirectTimelineAdapter = {
    duration: () => video.duration,
    time: () => video.currentTime,
    seek: (timeInSeconds) => {
      video.currentTime = timeInSeconds;
    },
    play: () => video.play().catch(callbacks.onPlayRejected),
    pause: () => video.pause(),
    timeScale: (rate) => {
      video.playbackRate = rate;
    },
  };

  return {
    video,
    adapter,
    destroy: () => {
      for (const [type, listener] of listeners) video.removeEventListener(type, listener);
      video.pause();
      video.removeAttribute("src");
      video.load();
      video.remove();
    },
  };
}
