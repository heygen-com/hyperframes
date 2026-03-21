export type RuntimeMediaClip = {
  el: HTMLVideoElement | HTMLAudioElement;
  start: number;
  mediaStart: number;
  duration: number;
  end: number;
  volume: number | null;
};

export function refreshRuntimeMediaCache(params?: { resolveStartSeconds?: (element: Element) => number }): {
  timedMediaEls: Array<HTMLVideoElement | HTMLAudioElement>;
  mediaClips: RuntimeMediaClip[];
  videoClips: RuntimeMediaClip[];
  maxMediaEnd: number;
} {
  const mediaEls = Array.from(document.querySelectorAll("video[data-start], audio[data-start]")) as Array<
    HTMLVideoElement | HTMLAudioElement
  >;
  const mediaClips: RuntimeMediaClip[] = [];
  const videoClips: RuntimeMediaClip[] = [];
  let maxMediaEnd = 0;
  for (const el of mediaEls) {
    const start = params?.resolveStartSeconds
      ? params.resolveStartSeconds(el)
      : Number.parseFloat(el.dataset.start ?? "0");
    if (!Number.isFinite(start)) continue;
    const mediaStart = Number.parseFloat(el.dataset.playbackStart ?? el.dataset.mediaStart ?? "0") || 0;
    let duration = Number.parseFloat(el.dataset.duration ?? "");
    if ((!Number.isFinite(duration) || duration <= 0) && Number.isFinite(el.duration) && el.duration > 0) {
      duration = Math.max(0, el.duration - mediaStart);
    }
    const end = Number.isFinite(duration) && duration > 0 ? start + duration : Number.POSITIVE_INFINITY;
    const volumeRaw = Number.parseFloat(el.dataset.volume ?? "");
    const clip: RuntimeMediaClip = {
      el,
      start,
      mediaStart,
      duration: Number.isFinite(duration) && duration > 0 ? duration : Number.POSITIVE_INFINITY,
      end,
      volume: Number.isFinite(volumeRaw) ? volumeRaw : null,
    };
    mediaClips.push(clip);
    if (el.tagName === "VIDEO") videoClips.push(clip);
    if (Number.isFinite(end)) maxMediaEnd = Math.max(maxMediaEnd, end);
  }
  return { timedMediaEls: mediaEls, mediaClips, videoClips, maxMediaEnd };
}

export function syncRuntimeMedia(params: {
  clips: RuntimeMediaClip[];
  timeSeconds: number;
  playing: boolean;
  playbackRate: number;
}): void {
  for (const clip of params.clips) {
    const { el } = clip;
    if (!el.isConnected) continue;
    const relTime = params.timeSeconds - clip.start + clip.mediaStart;
    const isActive = params.timeSeconds >= clip.start && params.timeSeconds < clip.end && relTime >= 0;
    if (isActive) {
      if (clip.volume != null) el.volume = clip.volume;
      try {
        el.playbackRate = params.playbackRate;
      } catch {
        // ignore unsupported playbackRate
      }
      if (Math.abs((el.currentTime || 0) - relTime) > 0.3) {
        try {
          el.currentTime = relTime;
        } catch {
          // ignore browser seek restrictions
        }
      }
      if (params.playing && el.paused) {
        void el.play().catch(() => {});
      } else if (!params.playing && !el.paused) {
        el.pause();
      }
      continue;
    }
    if (!el.paused) el.pause();
  }
}
