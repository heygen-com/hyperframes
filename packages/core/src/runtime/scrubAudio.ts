// Plays a brief slice of the music track while Studio drags the playhead, like an NLE scrub. Repeated calls keep it
// playing; it pauses 140 ms after the last one and gives the element back its muted state and volume.
import { previewElementFinder, type PreviewTarget } from "../studioPreviewMark";
import { isAudioElement } from "./domRealm";
import { mediaElementTime } from "./mediaClock";
import { wallClearTimeout, wallSetTimeout } from "./wallClock";

const SCRUB_VOLUME = 0.25;
const SCRUB_HOLD_MS = 140;

interface PausedMediaLease {
  lease: (el: HTMLMediaElement) => void;
  release: (el: HTMLMediaElement) => void;
}

/** The music row's own track, else the one marked as music. Never the first <audio>: that is often the voiceover. */
function musicTrack(target: PreviewTarget | null): HTMLAudioElement | null {
  const byRow = target && previewElementFinder(document, "audio")(target);
  if (isAudioElement(byRow)) return byRow;
  return document.querySelector<HTMLAudioElement>("audio[data-timeline-role='music']");
}

export function createScrubAudio({ lease, release }: PausedMediaLease) {
  let playing: HTMLAudioElement | null = null;
  let stopTimer: ReturnType<typeof wallSetTimeout> | null = null;
  let prevMuted: boolean | null = null;
  let prevVolume: number | null = null;

  const stop = (): void => {
    wallClearTimeout(stopTimer);
    stopTimer = null;
    const el = playing;
    playing = null;
    if (!el) return;
    release(el);
    try {
      el.pause();
      if (prevMuted !== null) el.muted = prevMuted;
      if (prevVolume !== null) el.volume = prevVolume;
    } catch {
      /* ignore */
    }
    prevMuted = null;
    prevVolume = null;
  };

  const play = (el: HTMLAudioElement, time: number, volume: number): void => {
    if (playing && playing !== el) stop();
    prevMuted ??= el.muted;
    prevVolume ??= el.volume;
    playing = el;
    // The runtime stops media that runs under a paused clock unless it is leased.
    lease(el);
    try {
      el.muted = false;
      el.volume = SCRUB_VOLUME * volume;
      if (Math.abs(el.currentTime - time) > 0.04) el.currentTime = mediaElementTime(time);
      if (el.paused) void el.play().catch(() => {});
    } catch {
      /* element not ready */
    }
    wallClearTimeout(stopTimer);
    stopTimer = wallSetTimeout(stop, SCRUB_HOLD_MS);
  };

  /** `time` is seconds into the track's file; null stops. */
  const scrub = (target: PreviewTarget | null, time: number | null, volume: number): void => {
    if (time === null) return stop();
    const el = musicTrack(target);
    if (el) play(el, time, volume);
  };

  return { scrub, stop };
}
