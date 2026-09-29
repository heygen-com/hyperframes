// Video mode: a `<video playsinline>` behind the direct-timeline adapter a same-origin
// `__timelines` composition uses, so play, seek, loop and `ended` share one code path.

import type { DirectTimelineAdapter } from "./timeline-adapters.js";

export function isVideoType(type: string | null): boolean {
  return type?.trim().toLowerCase().startsWith("video/") ?? false;
}

export interface VideoSourceCallbacks {
  onMetadata: (video: HTMLVideoElement) => void;
  onDurationChange: (video: HTMLVideoElement) => void;
  onResize: (video: HTMLVideoElement) => void;
  onPlay: (video: HTMLVideoElement) => void;
  onPause: (video: HTMLVideoElement) => void;
  onTimeUpdate: () => void;
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

  const listening = new AbortController();
  const { signal } = listening;
  video.addEventListener("loadedmetadata", () => callbacks.onMetadata(video), { signal });
  video.addEventListener("durationchange", () => callbacks.onDurationChange(video), { signal });
  video.addEventListener("resize", () => callbacks.onResize(video), { signal });
  video.addEventListener("play", () => callbacks.onPlay(video), { signal });
  video.addEventListener("pause", () => callbacks.onPause(video), { signal });
  video.addEventListener("timeupdate", () => callbacks.onTimeUpdate(), { signal });
  video.addEventListener(
    "error",
    () =>
      callbacks.onError(video.error?.message || "Video failed to load", video.error?.code ?? null),
    { signal },
  );

  const adapter: DirectTimelineAdapter = {
    duration: () => video.duration,
    time: () => video.currentTime,
    seek: (timeInSeconds) => {
      video.currentTime = timeInSeconds;
    },
    // A rejection that lands after destroy() belongs to a source that is gone.
    play: () =>
      video.play().catch((error: unknown) => {
        if (!signal.aborted) callbacks.onPlayRejected(error);
      }),
    pause: () => video.pause(),
    // The default rate survives a new src; the current rate alone would reset to it.
    timeScale: (rate) => {
      video.defaultPlaybackRate = rate;
      video.playbackRate = rate;
    },
  };

  return {
    video,
    adapter,
    destroy: () => {
      listening.abort();
      video.pause();
      video.removeAttribute("src");
      video.load();
      video.remove();
    },
  };
}
