import { swallow } from "./diagnostics";
import { interpolateVolumeGain, type VolumeKeyframe } from "./mediaVolumeEnvelope.js";
import { normalizePlaybackRate } from "./playbackRate.js";

export function readElementPlaybackRate(el: Element): number {
  const authored = Number.parseFloat(el.getAttribute("data-playback-rate") ?? "");
  const raw =
    Number.isFinite(authored) && authored > 0
      ? authored
      : el instanceof HTMLMediaElement
        ? el.defaultPlaybackRate
        : 1;
  return normalizePlaybackRate(raw);
}

export function readElementPlaybackStart(el: Element): number {
  const raw = Number.parseFloat(
    el.getAttribute("data-playback-start") ?? el.getAttribute("data-media-start") ?? "",
  );
  return Number.isFinite(raw) && raw >= 0 ? raw : 0;
}

/**
 * Resolve a media element's timeline window without conflating a video's
 * authored display slot with the amount of source left to decode.
 *
 * An explicit video slot may outlive its source and holds the final frame.
 * Audio remains source-bounded because it has no visual hold state.
 */
export function resolveRuntimeMediaClipDuration(params: {
  isVideo: boolean;
  sourceDuration: number | null;
  hostRemaining: number | null;
  explicitDuration: number | null;
}): number | null {
  const mediaDuration = params.isVideo
    ? (params.explicitDuration ?? params.sourceDuration)
    : params.sourceDuration;
  const candidates = (
    params.isVideo
      ? [mediaDuration, params.hostRemaining]
      : [mediaDuration, params.hostRemaining, params.explicitDuration]
  ).filter((value): value is number => value != null && Number.isFinite(value) && value > 0);
  return candidates.length > 0 ? Math.min(...candidates) : null;
}

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
  /**
   * Probed volume keyframes from the GSAP timeline (same probe the renderer
   * uses). When present, `syncRuntimeMedia` drives volume from the envelope
   * rather than from `data-volume` + GSAP-change tracking, eliminating the
   * race between the 60 Hz transport tick and GSAP's own seek.
   */
  volumeKeyframes?: VolumeKeyframe[];
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
    const playbackRate = readElementPlaybackRate(el);
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

// HTMLMediaElement.NETWORK_NO_SOURCE — no usable source (404 / unsupported).
const MEDIA_NETWORK_NO_SOURCE = 3;
// An element that errored or has no source can't play; re-issuing play() every
// tick just floods rejections. Skip it until its state changes (src reload).
function isUnplayable(el: HTMLMediaElement): boolean {
  return el.error != null || el.networkState === MEDIA_NETWORK_NO_SOURCE;
}

const lastRuntimeAppliedVolume = new WeakMap<HTMLMediaElement, number>();

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 1;
  return Math.max(0, Math.min(1, volume));
}

/**
 * Drop every per-source sync baseline tracked for `el` — offset drift
 * samples, the seek-past-buffered-range retry latch, and the last
 * runtime-applied volume — so the next `syncRuntimeMedia` tick treats it as
 * a first tick (hard resync, fresh drift baseline) instead of comparing
 * against state computed for a different file. Used both when a clip leaves
 * its active window (below) and by the runtime's proxy-swap helper
 * (mediaProxy.ts) right after an in-place `src` swap, which points the same
 * element at a different file without ever leaving its active window.
 */
export function evictMediaSyncState(el: HTMLMediaElement): void {
  lastOffset.delete(el);
  strictDriftSamples.delete(el);
  seekLoadRetried.delete(el);
  lastRuntimeAppliedVolume.delete(el);
}

/** Test-only seam: whether any per-source sync state is still tracked for `el`. */
export function hasMediaSyncStateForTest(el: HTMLMediaElement): boolean {
  return (
    lastOffset.has(el) ||
    strictDriftSamples.has(el) ||
    seekLoadRetried.has(el) ||
    lastRuntimeAppliedVolume.has(el)
  );
}

// fallow-ignore-next-line complexity
export function syncRuntimeMedia(params: {
  clips: RuntimeMediaClip[];
  timeSeconds: number;
  playing: boolean;
  playbackRate: number;
  /** Force-mute every element (parent-frame proxy owns all audio). Asserted per
   *  tick so sub-composition media added mid-playback inherits the silence. */
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
  onElementVolume?: (el: HTMLMediaElement, volume: number) => void;
  /** Is THIS element owned by the Web Audio transport? Owned → mute it (transport
   *  plays it); not owned → leave audible (HTMLMedia fallback). Per-element, not a
   *  global flag, so a not-yet-claimed track isn't muted by other tracks. */
  isWebAudioOwned?: (el: HTMLMediaElement) => boolean;
  forceSync?: boolean;
}): void {
  const forceMuteAll = !!(params.outputMuted || params.userMuted);
  for (const clip of params.clips) {
    const { el } = clip;
    if (!el.isConnected) continue;
    let relTime = (params.timeSeconds - clip.start) * clip.playbackRate + clip.mediaStart;
    const isNonLoopVideo = el.tagName === "VIDEO" && !clip.loop;
    const isHeldVideoTail =
      isNonLoopVideo &&
      clip.sourceDuration != null &&
      relTime >= clip.sourceDuration &&
      params.timeSeconds >= clip.start &&
      params.timeSeconds < clip.end;
    if (isHeldVideoTail && clip.sourceDuration != null) {
      relTime = clip.sourceDuration;
    }
    const canSeekEndedVideoBackward =
      isNonLoopVideo &&
      clip.sourceDuration != null &&
      relTime >= clip.mediaStart &&
      relTime < clip.sourceDuration;
    // Audio that ended naturally stays silent. A non-loop video remains an
    // active visual through its authored window: tail seeks clamp to the final
    // frame, and backward seeks can re-enter playable source without depending
    // on the browser having reset `ended` first.
    const isActive =
      params.timeSeconds >= clip.start &&
      params.timeSeconds < clip.end &&
      relTime >= 0 &&
      (!el.ended || clip.loop || isHeldVideoTail || canSeekEndedVideoBackward);
    if (isActive) {
      // Loop wrapping: when media reaches end, restart from mediaStart
      if (clip.loop && clip.sourceDuration != null && clip.sourceDuration > 0) {
        const loopLength = clip.sourceDuration - clip.mediaStart;
        if (loopLength > 0 && relTime >= clip.sourceDuration) {
          relTime = clip.mediaStart + ((relTime - clip.mediaStart) % loopLength);
        }
      }
      const userVol = clampVolume(params.userVolume ?? 1);
      const fallbackAuthorVolume = clampVolume(clip.volume ?? 1);
      const previousRuntimeVolume = lastRuntimeAppliedVolume.get(el);
      const currentElementVolume = clampVolume(el.volume);

      let authorVolume: number;
      if (clip.volumeKeyframes && clip.volumeKeyframes.length > 0) {
        // Keyframes probed from the GSAP timeline — same source as the renderer.
        // Use the interpolated envelope value directly; no need to track GSAP changes.
        authorVolume = clampVolume(interpolateVolumeGain(clip.volumeKeyframes, relTime));
      } else if (previousRuntimeVolume === undefined) {
        // First tick this clip is active. The transport has already seeked GSAP
        // to the current time (seekTimelineAndAdapters runs before syncRuntimeMedia),
        // so el.volume reflects the animated value — trust it rather than falling
        // back to data-volume, which would clobber the GSAP-seeked position.
        authorVolume = currentElementVolume;
      } else if (Math.abs(currentElementVolume - previousRuntimeVolume) > 0.0001) {
        // GSAP (or user code) changed el.volume between ticks — track it.
        authorVolume = currentElementVolume;
      } else {
        // Volume unchanged since last tick — use data-volume as the baseline.
        authorVolume = fallbackAuthorVolume;
      }

      const effectiveVolume = clampVolume(authorVolume * userVol);
      el.volume = effectiveVolume;
      lastRuntimeAppliedVolume.set(el, effectiveVolume);
      params.onElementVolume?.(el, effectiveVolume);
      // Mute only when force-muted or the transport owns this element; an unclaimed
      // track stays audible via the HTMLMedia fallback.
      if (forceMuteAll || params.isWebAudioOwned?.(el)) el.muted = true;
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
      const hardSync =
        (isHeldVideoTail && drift > 0.001) ||
        (el.ended && canSeekEndedVideoBackward && drift > 0.001) ||
        (drift > 0.5 && (firstTickOfClip || offsetJumped || catastrophicDrift));
      // Playing video elements use the browser's native decoder pipeline for
      // timing. Seeking a playing video resets the decoder, causing a ~150ms
      // freeze while it re-buffers — during which the monotonic clock advances,
      // creating a perpetual seek→freeze→drift→seek stutter loop. Skip strict
      // and force sync for playing videos; only hard sync (>0.5s) warrants
      // the decoder-reset cost.
      const isPlayingVideo = el.tagName === "VIDEO" && !el.paused;
      // Only apply strict sync when offset has stabilized (not growing).
      // During initial buffering, offset grows ~16ms/tick as the timeline
      // advances while media stays at 0. Accumulated drift from pause/play
      // toggling shows up as a stable, non-zero offset (delta near 0).
      const offsetStabilized = prevOffset !== undefined && Math.abs(offset - prevOffset) < 0.004;
      let strictSync = false;
      if (
        !isPlayingVideo &&
        !hardSync &&
        !firstTickOfClip &&
        offsetStabilized &&
        drift > STRICT_DRIFT_THRESHOLD
      ) {
        const samples = (strictDriftSamples.get(el) ?? 0) + 1;
        strictDriftSamples.set(el, samples);
        if (samples >= STRICT_REQUIRED_SAMPLES) {
          strictSync = true;
          strictDriftSamples.set(el, 0);
        }
      } else if (drift <= STRICT_DRIFT_THRESHOLD) {
        strictDriftSamples.set(el, 0);
      }
      const forceSync = !isPlayingVideo && params.forceSync && drift > 0.02;
      if (hardSync || strictSync || forceSync) {
        // Skip the per-tick seek (and the `el.load()` drift-recovery retry
        // below) for `<video>` elements that have a sibling
        // `<img id="__render_frame_<id>__">`. The sibling is created only
        // by the producer's frame-injection pipeline during render — its
        // presence means the visual is painted from the `<img>` and the
        // `<video>` is `visibility: hidden`. Audio is mixed by ffmpeg from
        // source files in `runAudioStage`, never via Chrome's in-browser
        // audio path. So the `<video>`'s `currentTime` has no observable
        // effect during render, and the per-tick set just kicks Chrome's
        // media pipeline for nothing. Preview is unaffected (the sibling
        // only exists during render).
        const skipForInjectedVideo =
          el.tagName === "VIDEO" && el.id && !!document.getElementById(`__render_frame_${el.id}__`);
        if (!skipForInjectedVideo) {
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
        }
        playRequested.delete(el);
      }
      if (isHeldVideoTail) {
        if (!el.paused) el.pause();
      } else if (params.playing && el.paused && !playRequested.has(el) && !isUnplayable(el)) {
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
    evictMediaSyncState(el);
    if (!el.paused) el.pause();
  }
}
