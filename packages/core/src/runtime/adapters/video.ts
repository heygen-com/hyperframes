import type { RuntimeDeterministicAdapter } from "../types";

export function createVideoAdapter(): RuntimeDeterministicAdapter {
  let videos: HTMLVideoElement[] = [];
  return {
    name: "video",
    discover(): void {
      videos = Array.from(
        document.querySelectorAll<HTMLVideoElement>("video.clip, video[class*='clip']"),
      );
    },
    pause(): void {
      for (const el of videos) {
        if (el.isConnected && !el.paused) {
          try {
            el.pause();
          } catch {}
        }
      }
    },
    seek({ time }: { time: number }): void {
      for (const el of videos) {
        if (!el.isConnected) continue;
        const hasStart = el.hasAttribute("data-start");
        const start = hasStart ? parseFloat(el.dataset.start ?? "") || 0 : 0;
        const mediaStart =
          parseFloat(el.dataset.playbackStart ?? el.dataset.mediaStart ?? "0") || 0;
        const rawDuration = parseFloat(el.dataset.duration ?? "");
        const sourceDuration = isFinite(el.duration) && el.duration > 0 ? el.duration : null;
        const duration =
          isFinite(rawDuration) && rawDuration > 0
            ? rawDuration
            : sourceDuration != null
              ? Math.max(0, sourceDuration - mediaStart)
              : Infinity;
        const end = isFinite(duration) && duration > 0 ? start + duration : Infinity;
        const relTime = time - start + mediaStart;
        const isActive = time >= start && time < end && relTime >= 0;
        if (!isActive) continue;
        const drift = Math.abs((el.currentTime || 0) - relTime);
        if (drift > 0.05) {
          try {
            el.currentTime = relTime;
          } catch {}
        }
      }
    },
  };
}
