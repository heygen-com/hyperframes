import { swallow } from "./diagnostics";
export type RuntimeMediaClip = {
  el: HTMLVideoElement | HTMLAudioElement;
  start: number;
  mediaStart: number;
  duration: number;
  end: number;
  volume: number | null;
  playbackRate: number;
  loop: boolean;
  /** Source media duration in seconds (from el.duration). Used for loop wrapping. */
  sourceDuration: number | null;
};

export function refreshRuntimeMediaCache(params?: {
  resolveStartSeconds?: (element: Element) => number;
  resolveDurationSeconds?: (element: HTMLVideoElement | HTMLAudioElement) => number | null;
  shouldIncludeElement?: (element: HTMLVideoElement | HTMLAudioElement) => boolean;
}): {
  timedMediaEls: Array<HTMLVideoElement | HTMLAudioElement>;
  mediaClips: RuntimeMediaClip[];
  videoClips: RuntimeMediaClip[];
  maxMediaEnd: number;
} {
  const mediaEls = Array.from(document.querySelectorAll("video, audio")) as Array<
    HTMLVideoElement | HTMLAudioElement
  >;
  const timedMediaEls = params?.shouldIncludeElement
    ? mediaEls.filter((el) => params.shouldIncludeElement?.(el))
    : mediaEls.filter((el) => el.hasAttribute("data-start"));
  const mediaClips: RuntimeMediaClip[] = [];
  const videoClips: RuntimeMediaClip[] = [];
  let maxMediaEnd = 0;
  for (const el of timedMediaEls) {
    const start = params?.resolveStartSeconds
      ? params.resolveStartSeconds(el)
      : Number.parseFloat(el.dataset.start ?? "0");
    if (!Number.isFinite(start)) continue;
    const mediaStart =
      Number.parseFloat(el.dataset.playbackStart ?? el.dataset.mediaStart ?? "0") || 0;
    // Read per-element rate from the native defaultPlaybackRate property.
    // LLMs set this via el.defaultPlaybackRate = 0.5 in a <script> tag.
    const rawRate = el.defaultPlaybackRate;
    const playbackRate =
      Number.isFinite(rawRate) && rawRate > 0 ? Math.max(0.1, Math.min(5, rawRate)) : 1;
    const loop = el.loop;
    const sourceDuration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null;
    let duration =
      params?.resolveDurationSeconds?.(el) ?? Number.parseFloat(el.dataset.duration ?? "");
    if ((!Number.isFinite(duration) || duration <= 0) && sourceDuration != null) {
      // Effective duration accounts for playback rate:
      // at 0.5x, a 10s source plays for 20s on the timeline
      duration = Math.max(0, (sourceDuration - mediaStart) / playbackRate);
    }
    const end =
      Number.isFinite(duration) && duration > 0 ? start + duration : Number.POSITIVE_INFINITY;
    const volumeRaw = Number.parseFloat(el.dataset.volume ?? "");
    const clip: RuntimeMediaClip = {
      el,
      start,
      mediaStart,
      duration: Number.isFinite(duration) && duration > 0 ? duration : Number.POSITIVE_INFINITY,
      end,
      volume: Number.isFinite(volumeRaw) ? volumeRaw : null,
      playbackRate,
      loop,
      sourceDuration,
    };
    mediaClips.push(clip);
    if (el.tagName === "VIDEO") videoClips.push(clip);
    if (Number.isFinite(end)) maxMediaEnd = Math.max(maxMediaEnd, end);
  }
  return { timedMediaEls, mediaClips, videoClips, maxMediaEnd };
}

// Per-element timeline→media offset from the previous tick. Used to tell a
// gradual drift (initial buffer catch-up, where offset grows ~16ms/tick) from
// a scrub (where offset jumps in one tick). Cleared when a clip becomes
// inactive so the next activation gets a hard resync on its first tick.
const lastOffset = new WeakMap<HTMLMediaElement, number>();

const strictDriftSamples = new WeakMap<HTMLMediaElement, number>();

// Elements that had a seek past their buffered range (common with streaming
// MP3 where preload="metadata" only fetches the first few seconds). After
// setting preload="auto" and calling load(), we mark the element so subsequent
// ticks don't restart the fetch in a loop while the browser downloads data.
// Cleared when the clip leaves its active window.
const seekLoadRetried = new WeakSet<HTMLMediaElement>();

// Elements whose play() is in flight. The sync runs on a 50 ms poll and with
// a 1–2 s buffer that would fire 20–40 spurious play() calls per element —
// noise in devtools and, worse, each `.catch(() => {})` would swallow a real
// AbortError / NotAllowedError that should surface. Cleared on the `playing`
// event (actual playback started) or on `pause`/`error` (state ended).
const playRequested = new WeakSet<HTMLMediaElement>();
function markPlayRequested(el: HTMLMediaElement): void {
  if (playRequested.has(el)) return;
  playRequested.add(el);
  const clear = () => playRequested.delete(el);
  el.addEventListener("playing", clear, { once: true });
  el.addEventListener("pause", clear, { once: true });
  el.addEventListener("error", clear, { once: true });
}

export function syncRuntimeMedia(params: {
  clips: RuntimeMediaClip[];
  timeSeconds: number;
  playing: boolean;
  playbackRate: number;
  /**
   * Parent-frame audio-owner has taken over audible playback. Assert
   * `el.muted = true` on every active media element per tick so that any
   * sub-composition media inserted mid-playback inherits the silence.
   */
  outputMuted?: boolean;
  /**
   * User's explicit mute preference (set via `onSetMuted`). Symmetric to
   * `outputMuted` — also asserted per tick — so a sub-composition that
   * activates after the user mutes doesn't briefly play at author volume
   * before the next bridge message lands.
   */
  userMuted?: boolean;
  /**
   * User's volume preference (0–1, set via `onSetVolume`). Multiplied with the
   * per-clip author volume so `data-volume="0.5"` at user volume 0.8 yields 0.4.
   */
  userVolume?: number;
  /**
   * Invoked at most once when a media element's `play()` promise rejects with
   * `NotAllowedError`. The caller is expected to latch and post a single
   * outbound message; further invocations are suppressed by the caller.
   */
  onAutoplayBlocked?: () => void;
  forceSync?: boolean;
}): void {
  // Either flag silences output. Combined up front so the per-clip loop is
  // a single branch instead of two.
  const shouldMute = !!(params.outputMuted || params.userMuted);
  for (const clip of params.clips) {
    const { el } = clip;
    if (!el.isConnected) continue;
    let relTime = (params.timeSeconds - clip.start) * clip.playbackRate + clip.mediaStart;
    const isActive =
      params.timeSeconds >= clip.start && params.timeSeconds < clip.end && relTime >= 0;
    if (isActive) {
      // Loop wrapping: when media reaches end, restart from mediaStart
      if (clip.loop && clip.sourceDuration != null && clip.sourceDuration > 0) {
        const loopLength = clip.sourceDuration - clip.mediaStart;
        if (loopLength > 0 && relTime >= clip.sourceDuration) {
          relTime = clip.mediaStart + ((relTime - clip.mediaStart) % loopLength);
        }
      }
      const userVol = params.userVolume ?? 1;
      el.volume = (clip.volume ?? 1) * userVol;
      if (shouldMute) el.muted = true;
      // Ensure full preload for every active media element. Streaming
      // formats (MP3) may arrive with preload="metadata", which only
      // buffers the first few seconds and causes seeks to silently fail
      // past the buffered range. Setting this on every tick is cheap
      // (no-op when already "auto") and catches elements whose preload
      // was overridden after init.ts set it.
      if (el.preload !== "auto") el.preload = "auto";
      try {
        // Per-element rate × global transport rate
        el.playbackRate = clip.playbackRate * params.playbackRate;
      } catch (err) {
        // ignore unsupported playbackRate
        swallow("runtime.media.site1", err);
      }
      // Drift correction — three tiers:
      //
      // 1. Hard sync (0.5s): first tick, timeline jumps (scrub), catastrophic
      //    drift (>3s). Unconditional seek — accepts brief rebuffer cost.
      //    Forcing el.currentTime every frame causes audible seek hiccups
      //    (readyState drops briefly), so we only hard-seek when necessary.
      //
      // 2. Strict sync (40ms, 2 consecutive samples): catches accumulated
      //    drift from pause/play toggling or browser media pipeline latency.
      //    Offset-stabilization guard (4ms/tick) prevents false corrections
      //    during initial buffering where offset grows naturally.
      //
      // 3. Force sync (20ms): on play/pause/seek/rate transitions, correct
      //    any drift >20ms immediately via the forceSync one-shot flag.
      //
      // The first tick a clip is active has no previous offset to compare —
      // treated as hard resync so sub-compositions with non-zero mediaStart
      // land on the right frame.
      const STRICT_DRIFT_THRESHOLD = 0.04;
      const STRICT_REQUIRED_SAMPLES = 2;

      const currentElTime = el.currentTime || 0;
      const drift = Math.abs(currentElTime - relTime);
      const offset = relTime - currentElTime;
      const prevOffset = lastOffset.get(el);
      lastOffset.set(el, offset);
      const firstTickOfClip = prevOffset === undefined;
      const offsetJumped = !firstTickOfClip && Math.abs(offset - prevOffset!) > 0.5;
      const catastrophicDrift = drift > 3;
      const hardSync = drift > 0.5 && (firstTickOfClip || offsetJumped || catastrophicDrift);
      // Only apply strict sync when offset has stabilized (not growing).
      // During initial buffering, offset grows ~16ms/tick as the timeline
      // advances while media stays at 0. Accumulated drift from pause/play
      // toggling shows up as a stable, non-zero offset (delta near 0).
      const offsetStabilized = prevOffset !== undefined && Math.abs(offset - prevOffset) < 0.004;
      let strictSync = false;
      if (!hardSync && !firstTickOfClip && offsetStabilized && drift > STRICT_DRIFT_THRESHOLD) {
        const samples = (strictDriftSamples.get(el) ?? 0) + 1;
        strictDriftSamples.set(el, samples);
        if (samples >= STRICT_REQUIRED_SAMPLES) {
          strictSync = true;
          strictDriftSamples.set(el, 0);
        }
      } else if (drift <= STRICT_DRIFT_THRESHOLD) {
        strictDriftSamples.set(el, 0);
      }
      if (hardSync || strictSync || (params.forceSync && drift > 0.02)) {
        try {
          el.currentTime = relTime;
        } catch (err) {
          swallow("runtime.media.site2", err);
        }
        if (Math.abs(el.currentTime - relTime) > 0.5 && !seekLoadRetried.has(el)) {
          seekLoadRetried.add(el);
          el.load();
          try {
            el.currentTime = relTime;
          } catch (err) {
            swallow("runtime.media.site3", err);
          }
        }
        playRequested.delete(el);
      }
      if (params.playing && el.paused && !playRequested.has(el)) {
        // `HTMLMediaElement.play()` is spec'd to queue playback and resolve
        // once enough data is buffered, so we can unconditionally call it —
        // no need to gate on `readyState` or defer to a `canplay` listener.
        //
        // The old `readyState < HAVE_FUTURE_DATA` branch called `el.load()`
        // inside the listener, which *aborts* the in-flight fetch that
        // `bindMediaMetadataListeners` already started at init time and
        // restarts from zero. On slow networks this delayed playback by
        // seconds. The canplay listener was also racey — the event could
        // fire between `load()` and `addEventListener` attachment, wedging
        // the element waiting for a callback that never came.
        markPlayRequested(el);
        void el.play().catch((err: unknown) => {
          // If play() rejects — e.g. autoplay blocked, element removed
          // mid-flight — drop the in-flight flag so a future sync tick can
          // retry rather than getting stuck waiting for `playing`/`pause`.
          playRequested.delete(el);
          // `NotAllowedError` is the autoplay-gating browser response when
          // the iframe has no user activation. Signal the parent exactly
          // once so it can promote to parent-frame audio proxies. Retries
          // here would be pointless — nothing the runtime does fixes it.
          const name =
            err && typeof err === "object" && "name" in err
              ? String((err as { name?: unknown }).name ?? "")
              : "";
          if (name === "NotAllowedError") params.onAutoplayBlocked?.();
        });
      } else if (!params.playing && !el.paused) {
        el.pause();
      }
      continue;
    }
    // Clip left its active window — drop the offset baseline so the next
    // activation (e.g. re-entering a sub-composition) gets a hard resync.
    lastOffset.delete(el);
    strictDriftSamples.delete(el);
    seekLoadRetried.delete(el);
    if (!el.paused) el.pause();
  }
}
