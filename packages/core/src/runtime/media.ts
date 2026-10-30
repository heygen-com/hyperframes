import { swallow } from "./diagnostics";
import { isClipVisibleAt, isInClipWindow } from "./clipWindow";
import { mediaElementTime, startsSoundOnlyInsideATap } from "./mediaClock";
import { sameInstant } from "../clipFacts";
import { interpolateVolumeGain } from "./mediaVolumeEnvelope.js";
import { elementVolumeLaneGain } from "./audioAutomationVolume.js";
import { fadeGain, NO_FADES, readElementFades } from "../audioFade.js";
import { readElementPlaybackRate, readElementRateSpec, readMediaStart } from "./playbackRate.js";
import { rateAt, sourceTimeAt, timeAtSourceTime } from "../speedRamp.js";
import type { RuntimeMediaClip } from "./types.js";
import { clampAudioGain, clipGain, gainTimesLane } from "../audioGain.js";
import { isMemberGroupHidden } from "../audioGroups.js";
import { findInjectedRenderFrame } from "./renderFrameSibling.js";
import { isRenderFrameVideo } from "./preloadMedia.js";
import { registerSeekCompletion } from "./adapters/seek-dispatch.js";
import { cutToHostSlots, type HostSlot } from "../mediaTiming.js";
import {
  forgetSteering,
  isSteering,
  MEDIA_HARD_SYNC_SECONDS,
  MEDIA_SYNC_TOLERANCE_SECONDS,
  steerMedia,
} from "./mediaSteer.js";
export { MEDIA_SYNC_TOLERANCE_SECONDS } from "./mediaSteer.js";
export type { RuntimeMediaClip } from "./types.js";
export {
  readElementPlaybackRate,
  readElementRateSpec,
  resolveNaturalMediaTimelineDuration,
} from "./playbackRate.js";

export function readElementPlaybackStart(el: Element): number {
  return readMediaStart(el);
}

const HOLD_END_EVENTS = ["seeked", "loadeddata", "error", "emptied", "abort"] as const;
export const HOLD_CAP_MS = 5000;
const releaseHeldVideo = new WeakMap<HTMLMediaElement, () => void>();

// A seeking video still paints its previous frame, and one still fetching its first data paints none (its seek
// waits for metadata without setting `seeking`); frame captures wait on the barrier until it lands. The 5 s cap is
// the only end for a stalled source (`suspend` also fires between range requests); capture phase catches <source>.
function holdSeekBarrierUntilVideoLands(el: HTMLMediaElement): void {
  const loading =
    el.readyState < el.HAVE_CURRENT_DATA &&
    el.networkState === el.NETWORK_LOADING &&
    !(window as { __HF_EXPORT_RENDER_SEEK_CONFIG?: unknown }).__HF_EXPORT_RENDER_SEEK_CONFIG;
  if (el.tagName !== "VIDEO" || !(el.seeking || loading) || findInjectedRenderFrame(el)) return;
  releaseHeldVideo.get(el)?.();
  registerSeekCompletion(
    new Promise<void>((resolve) => {
      const done = (event?: Event) => {
        if (event?.type === "loadeddata" && el.seeking) return;
        clearTimeout(cap);
        for (const type of HOLD_END_EVENTS) el.removeEventListener(type, done, true);
        if (releaseHeldVideo.get(el) === done) releaseHeldVideo.delete(el);
        resolve();
      };
      const cap = setTimeout(done, HOLD_CAP_MS);
      for (const type of HOLD_END_EVENTS) el.addEventListener(type, done, true);
      releaseHeldVideo.set(el, done);
    }),
    "video-frame",
  );
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
  ).filter((value): value is number => value != null && Number.isFinite(value) && value >= 0);
  return candidates.length > 0 ? Math.min(...candidates) : null;
}

export function refreshRuntimeMediaCache(params?: {
  resolveStartSeconds?: (element: Element) => number;
  resolveDurationSeconds?: (element: HTMLVideoElement | HTMLAudioElement) => number | null;
  resolveHostSlots?: (element: HTMLVideoElement | HTMLAudioElement) => HostSlot[];
  shouldIncludeElement?: (element: HTMLVideoElement | HTMLAudioElement) => boolean;
  /**
   * Build clips for exactly these elements instead of scanning the document for
   * them. For a caller that already knows which media it needs this pass — the
   * per-seek sync only touches the clips whose active state can change — and so
   * should not pay to re-derive the window of every clip in the composition.
   *
   * Every field is still read FRESH from the element. This narrows which
   * elements are visited, never how current the answer is: `el.duration` can be
   * reset under the caller by an `el.load()` it did not make.
   */
  elements?: Array<HTMLVideoElement | HTMLAudioElement>;
}): {
  timedMediaEls: Array<HTMLVideoElement | HTMLAudioElement>;
  mediaClips: RuntimeMediaClip[];
  videoClips: RuntimeMediaClip[];
  maxMediaEnd: number;
} {
  const mediaEls =
    params?.elements ??
    (Array.from(document.querySelectorAll("video, audio")) as Array<
      HTMLVideoElement | HTMLAudioElement
    >);
  const timedMediaEls = params?.shouldIncludeElement
    ? mediaEls.filter((el) => params.shouldIncludeElement?.(el))
    : mediaEls.filter((el) => el.hasAttribute("data-start"));
  const mediaClips: RuntimeMediaClip[] = [];
  const videoClips: RuntimeMediaClip[] = [];
  let maxMediaEnd = 0;
  for (const el of timedMediaEls) {
    let start = params?.resolveStartSeconds
      ? params.resolveStartSeconds(el)
      : Number.parseFloat(el.dataset.start ?? "0");
    if (!Number.isFinite(start)) continue;
    const mediaStart = readElementPlaybackStart(el);
    const playbackRate = readElementPlaybackRate(el);
    const rate = readElementRateSpec(el);
    const loop = el.loop;
    const sourceDuration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null;
    let duration =
      params?.resolveDurationSeconds?.(el) ?? Number.parseFloat(el.dataset.duration ?? "");
    if ((!Number.isFinite(duration) || duration < 0) && sourceDuration != null) {
      // Effective duration accounts for playback rate:
      // at 0.5x, a 10s source plays for 20s on the timeline
      duration = Math.max(0, timeAtSourceTime(rate, sourceDuration - mediaStart));
    }
    const hasKnownDuration = Number.isFinite(duration) && duration >= 0;
    let end = hasKnownDuration ? start + duration : Number.POSITIVE_INFINITY;
    const origin = start;
    const kept = cutToHostSlots({ start, end }, params?.resolveHostSlots?.(el) ?? []);
    if (kept.start !== start || kept.end !== end) {
      ({ start, end } = kept);
      duration = end - start;
    }
    const volumeRaw = Number.parseFloat(el.dataset.volume ?? "");
    const clip: RuntimeMediaClip = {
      el,
      start,
      origin,
      mediaStart,
      duration: Number.isFinite(end) ? duration : Number.POSITIVE_INFINITY,
      end,
      volume: Number.isFinite(volumeRaw) ? volumeRaw : null,
      playbackRate,
      rate,
      loop,
      sourceDuration,
      fades: readElementFades(el),
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
// Desired source time from the previous active tick. Unlike `forceSync`, which
// also covers play/pause and rate changes, a decrease here identifies an actual
// backward transport seek within an audio clip.
const lastRelativeTime = new WeakMap<HTMLMediaElement, number>();

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
const startedEarly = new WeakSet<HTMLMediaElement>();
function markPlayRequested(el: HTMLMediaElement): void {
  if (playRequested.has(el)) return;
  playRequested.add(el);
  const clear = () => playRequested.delete(el);
  el.addEventListener("playing", clear, { once: true });
  el.addEventListener("pause", clear, { once: true });
  el.addEventListener("error", clear, { once: true });
}

// iOS refuses an unmuted start ~5 s after the tap unless that element played inside a tap: play-then-pause
// each idle unmuted one from the tap's own call stack. Authored-muted clips start freely and stay deferred.
export function primeMediaForLaterStarts(els: Iterable<HTMLMediaElement>): void {
  if (!startsSoundOnlyInsideATap()) return;
  for (const el of els) {
    if (el.defaultMuted || !el.paused || playRequested.has(el) || isUnplayable(el)) continue;
    el.play().catch(() => {});
    el.pause();
  }
}

// HTMLMediaElement.NETWORK_NO_SOURCE — no usable source (404 / unsupported).
const MEDIA_NETWORK_NO_SOURCE = 3;
// An element that errored or has no source can't play; re-issuing play() every
// tick just floods rejections. Skip it until its state changes (src reload).
export function isUnplayable(el: HTMLMediaElement): boolean {
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
  lastRelativeTime.delete(el);
  strictDriftSamples.delete(el);
  seekLoadRetried.delete(el);
  lastRuntimeAppliedVolume.delete(el);
  forgetSteering(el);
  heldAhead.delete(el);
  videoStarts.delete(el);
}

/** Whether the clip is inside its window at the playhead right now: the sync tick keeps its time while it is. */
export function isActiveAtPlayhead(el: HTMLMediaElement): boolean {
  return lastRelativeTime.has(el);
}

/** Test-only seam: whether any per-source sync state is still tracked for `el`. */
export function hasMediaSyncStateForTest(el: HTMLMediaElement): boolean {
  return (
    lastOffset.has(el) ||
    lastRelativeTime.has(el) ||
    strictDriftSamples.has(el) ||
    seekLoadRetried.has(el) ||
    lastRuntimeAppliedVolume.has(el) ||
    isSteering(el)
  );
}

export const MEDIA_PRESEEK_SECONDS = 1.5;

export function mediaSourceTimeAt(clip: RuntimeMediaClip, timeSeconds: number): number {
  const elapsed = Math.max(0, Math.min(timeSeconds, clip.end) - (clip.origin ?? clip.start));
  const target = clip.mediaStart + sourceTimeAt(clip.rate ?? clip.playbackRate, elapsed);
  if (clip.sourceDuration == null) return target;
  const loopLength = clip.sourceDuration - clip.mediaStart;
  if (clip.loop && loopLength > 0 && target >= clip.sourceDuration)
    return clip.mediaStart + ((target - clip.mediaStart) % loopLength);
  // A non-loop video past its source holds the last frame.
  if (!clip.loop && clip.el.tagName === "VIDEO") return Math.min(target, clip.sourceDuration);
  return target;
}

function prepareUpcomingMedia(
  clip: RuntimeMediaClip,
  time: number,
  playing: boolean,
  rate: number,
): void {
  const { el } = clip;
  const dueIn = clip.start - time;
  if (
    !playing ||
    dueIn <= 0 ||
    dueIn > MEDIA_PRESEEK_SECONDS * rate ||
    !el.paused ||
    el.seeking ||
    el.readyState < el.HAVE_METADATA ||
    findInjectedRenderFrame(el) ||
    ("__HF_EXPORT_RENDER_SEEK_CONFIG" in window && window.__HF_EXPORT_RENDER_SEEK_CONFIG)
  )
    return;
  const target = mediaSourceTimeAt(clip, clip.start);
  if (!Number.isFinite(target) || target < 0 || Math.abs(el.currentTime - target) <= 0.001) return;
  try {
    // A trimmed clip seeked as it opens shows no frame and plays late, then is seeked again while it sounds.
    // Hidden preparation must not hold the visible-frame seek barrier.
    el.currentTime = mediaElementTime(target);
  } catch (err) {
    swallow("runtime.media.preseek", err);
  }
}

// Chromium refuses a slower playbackRate (NotSupportedError).
const MIN_NATIVE_PLAYBACK_RATE = 1 / 16;

// A video this far ahead of the playhead, or at its out-point, is held until the playhead reaches it:
// steering a lead of a few hundred ms takes seconds and shows frames past the cut.
const VIDEO_LEAD_HOLD_SECONDS = 0.1;
const heldAhead = new WeakSet<HTMLMediaElement>();

// A muted video's clock is its audio track, which starts tens of ms after play(), so an upcoming
// video starts that early, hidden, by the delay learned from earlier starts.
let videoStartLatency: number | null = null;
const videoStarts = new WeakMap<HTMLMediaElement, { offset: number; lead: number; at: number }>();

/** Test-only seam. */
export function resetVideoStartLatency(): void {
  videoStartLatency = null;
}

/** A quarter second in: its lag plus how early it started, capped at 0.1 s. */
function learnVideoStartLatency(el: HTMLMediaElement, time: number, offset: number, rate: number) {
  const start = videoStarts.get(el);
  if (!start || time < start.at) return;
  videoStarts.delete(el);
  const sample = (offset - start.offset) / rate + start.lead;
  const averaged = videoStartLatency === null ? sample : (videoStartLatency + sample) / 2;
  videoStartLatency = Math.min(0.1, Math.max(0, averaged));
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
  /** `clipGain` is `data-volume` for a routed clip, played ahead of its FX; 1 otherwise. */
  onElementVolume?: (
    el: HTMLMediaElement,
    effectiveVolume: number,
    authorVolume: number,
    clipGain: number,
    unfadedVolume?: number,
  ) => void;
  /** Is THIS element owned by the Web Audio transport? Owned → mute it (transport
   *  plays it); not owned → leave audible (HTMLMedia fallback). Per-element, not a
   *  global flag, so a not-yet-claimed track isn't muted by other tracks. */
  isWebAudioOwned?: (el: HTMLMediaElement) => boolean;
  /** Native media routed through WebAudio keeps its upstream element volume at
   * unity; do not mistake that transport write for an authored volume edit. */
  isWebAudioRouted?: (el: HTMLMediaElement) => boolean;
  forceSync?: boolean;
  /** False while the playhead is not moving (audio output has not started): a paused video waits for it. */
  clockAdvancing?: boolean;
  /** How far the next tick will move the playhead: an audio clip due within it starts now. */
  cueAheadSeconds?: number;
  /** Seeks a sounding element under a gain dip; false when it has no dip stage and the sync seeks it plainly. */
  seekUnderDip?: (el: HTMLMediaElement, target: number) => boolean;
  /** Lets a video clip that runs to the composition end hold its last frame at the terminal time.
   *  A thunk, because deriving the duration is only worth it for a clip past its own end. */
  getCompositionDuration: () => number;
}): void {
  const forceMuteAll = !!(params.outputMuted || params.userMuted);
  for (const clip of params.clips) {
    const { el } = clip;
    if (!el.isConnected) continue;
    const clipRate = clip.rate ?? clip.playbackRate;
    const origin = clip.origin ?? clip.start;
    const isNonLoopVideo = el.tagName === "VIDEO" && !clip.loop;
    const inWindow = isInClipWindow(params.timeSeconds, clip.start, clip.end);
    const dueIn = clip.start - params.timeSeconds;
    const cueAhead =
      el.tagName === "AUDIO"
        ? (params.cueAheadSeconds ?? 0)
        : params.playing && videoStartLatency !== null
          ? // Half a tick: it starts on the tick nearest its lead.
            videoStartLatency * params.playbackRate + (params.cueAheadSeconds ?? 0) / 2
          : 0;
    const startsEarly =
      !inWindow &&
      dueIn > 0 &&
      dueIn * Math.max(1, rateAt(clipRate, clip.start - origin)) <=
        Math.max(cueAhead, startedEarly.has(el) ? MEDIA_SYNC_TOLERANCE_SECONDS : 0);
    if (startsEarly) startedEarly.add(el);
    else startedEarly.delete(el);
    // A video that runs to the composition end stays the visible frame at and past it, so it
    // is held on the frame it shows at its own end rather than left on a stale one.
    const isTerminalVideo =
      isNonLoopVideo &&
      !inWindow &&
      (params.timeSeconds >= clip.end || sameInstant(params.timeSeconds, clip.end)) &&
      isClipVisibleAt(params.timeSeconds, clip.start, clip.end, params.getCompositionDuration());
    const relTime = mediaSourceTimeAt(clip, params.timeSeconds);
    const isHeldVideoTail =
      isTerminalVideo ||
      (isNonLoopVideo && clip.sourceDuration != null && relTime >= clip.sourceDuration && inWindow);
    const previousRelativeTime = lastRelativeTime.get(el);
    const audioReenteredAfterBackwardSeek =
      el.tagName === "AUDIO" &&
      (previousRelativeTime === undefined || relTime < previousRelativeTime - 0.04);
    const canSeekEndedMediaBackward =
      !clip.loop &&
      clip.sourceDuration != null &&
      relTime >= clip.mediaStart &&
      relTime < clip.sourceDuration &&
      (isNonLoopVideo || audioReenteredAfterBackwardSeek);
    // Ended media can re-enter playable source after a backward timeline seek
    // without depending on the browser having reset `ended` first. Audio needs
    // a fresh activation or a measured backward transport seek so ordinary EOF
    // and non-seek force-sync transitions cannot replay its tail. A non-loop
    // video additionally remains an active visual through
    // its authored window, with tail seeks clamped to the final frame.
    const isActive =
      (inWindow || isTerminalVideo || startsEarly) &&
      relTime >= 0 &&
      (!el.ended || clip.loop || isHeldVideoTail || canSeekEndedMediaBackward);
    if (isActive) {
      lastRelativeTime.set(el, relTime);
      const userVol = clampVolume(params.userVolume ?? 1);
      const fallbackAuthorVolume = clampAudioGain(clip.volume ?? 1);
      const previousRuntimeVolume = lastRuntimeAppliedVolume.get(el);
      const currentElementVolume = clampVolume(el.volume);

      let authorVolume: number;
      // An explicit volume lane, times `data-volume`, sets the level. Checked before the probed
      // keyframes because the two would otherwise fight, and it is the one the
      // author drew — `lint` warns when a track carries both.
      // Clip-local, NOT `relTime`. A lane's `t` is "seconds from the start of
      // the clip" (see HfAutomationPoint), and the render honours that: the wav
      // is already cut with `-ss mediaStart`, so its t=0 IS the clip's start.
      // `relTime` is MEDIA time — it carries mediaStart, scales by playbackRate
      // and wraps on a loop — so feeding it here played the envelope at a
      // different position than it renders, or ran it off the end entirely on a
      // trimmed clip. The FX lanes on this same feature use clip-local elapsed;
      // there is one time base, and this is it.
      const laneGain = elementVolumeLaneGain(el, params.timeSeconds - origin);
      const routed = params.isWebAudioRouted?.(el) === true;
      const tweened = laneGain === null && (clip.volumeKeyframes?.length ?? 0) > 0;
      const preFxGain = routed ? clipGain(fallbackAuthorVolume, tweened) : 1;
      if (laneGain !== null) {
        authorVolume = routed ? 1 : gainTimesLane(fallbackAuthorVolume, laneGain);
      } else if (clip.volumeKeyframes && clip.volumeKeyframes.length > 0) {
        // Keyframes probed from the GSAP timeline — same source as the renderer.
        // Use the interpolated envelope value directly; no need to track GSAP changes.
        // Index by elapsed time on the TIMELINE since the clip began, which is what
        // a normalised envelope is keyed by (and what the renderer's PCM baker uses).
        // `relTime` is a position inside the media SOURCE — it carries `mediaStart`
        // and the playback rate — so it only coincides with the envelope's time base
        // for an untrimmed clip playing at 1x from t=0.
        const elapsedInClip = params.timeSeconds - origin;
        authorVolume = clampAudioGain(interpolateVolumeGain(clip.volumeKeyframes, elapsedInClip));
      } else if (routed) {
        authorVolume = 1;
      } else if (previousRuntimeVolume === undefined) {
        // First tick this clip is active. The transport has already seeked GSAP
        // to the current time (seekTimelineAndAdapters runs before syncRuntimeMedia),
        // so el.volume reflects the animated value — trust it rather than falling
        // back to data-volume, which would clobber the GSAP-seeked position.
        //
        // Except above unity. `el.volume` is spec-bound to [0,1], so it cannot
        // represent an authored boost, and reading it back can only lose the
        // gain. Without this, a boosted clip opened at 0 dB for one tick and
        // then jumped once the unchanged-since-last-tick branch below took over
        // — audible, and invisible to any test that ticks more than once.
        authorVolume = fallbackAuthorVolume > 1 ? fallbackAuthorVolume : currentElementVolume;
      } else if (Math.abs(currentElementVolume - previousRuntimeVolume) > 0.0001) {
        // GSAP (or user code) changed el.volume between ticks — track it.
        //
        // Unity-capped on purpose, and it is not a hole in the ceiling: this
        // reads back through `el.volume`, which the spec pins to [0,1], so it
        // cannot observe an above-unity value however wide the clamp gets. A
        // clip whose volume is actually animated takes the probed-keyframes
        // branch above, which carries the authored gain unclamped; this branch
        // is the fallback for elements no probe ran on.
        authorVolume = currentElementVolume;
      } else {
        // Volume unchanged since last tick — use data-volume as the baseline.
        authorVolume = fallbackAuthorVolume;
      }

      // Clip-local fade on top of the resolved level, matching render's afade-after-volume.
      const unfadedVolume = authorVolume;
      const fades = clip.fades ?? NO_FADES;
      if (fades.fadeIn > 0 || fades.fadeOut > 0) {
        authorVolume *= fadeGain(
          params.timeSeconds - origin,
          clip.duration + clip.start - origin,
          fades,
        );
      }

      // A data-hidden ancestor is silent in the export (audioMixer.ts drops
      // it), so preview matches. Folded into the per-tick volume, not
      // el.muted (RULES trap: el.muted is the transport's ownership flag).
      // Two independent ways to be silent, and the second is not an ancestor
      // question: membership lives on the MEMBER's `data-audio-group`, so a
      // muted BUS is invisible to `closest()`. The render drops such members
      // (`memberGroupHidden`), so without this the export was silent where the
      // fallback played at full level.
      const silencedByHidden =
        el.closest("[data-hidden]") !== null || isMemberGroupHidden(el.ownerDocument, el);
      const effectiveVolume = silencedByHidden ? 0 : clampVolume(authorVolume * userVol);
      if (Math.abs(el.volume - effectiveVolume) > 1e-6) el.volume = effectiveVolume;
      lastRuntimeAppliedVolume.set(el, effectiveVolume);
      if (unfadedVolume === authorVolume)
        params.onElementVolume?.(el, effectiveVolume, authorVolume, preFxGain);
      else params.onElementVolume?.(el, effectiveVolume, authorVolume, preFxGain, unfadedVolume);
      // Mute only when force-muted or the transport owns this element; an unclaimed
      // track stays audible via the HTMLMedia fallback.
      if ((forceMuteAll || params.isWebAudioOwned?.(el)) && !el.muted) el.muted = true;
      // Ensure full preload for every active media element. Streaming
      // formats (MP3) may arrive with preload="metadata", which only
      // buffers the first few seconds and causes seeks to silently fail
      // past the buffered range. Setting this on every tick is cheap
      // (no-op when already "auto") and catches elements whose preload
      // was overridden after init.ts set it.
      if (el.preload !== "auto" && !isRenderFrameVideo(el)) el.preload = "auto";
      // Per-element rate × global transport rate
      const baseRate = rateAt(clipRate, params.timeSeconds - origin) * params.playbackRate;
      // Too slow for the browser to play: kept paused and stepped onto the playhead by seeks.
      const playing = params.playing && baseRate >= MIN_NATIVE_PLAYBACK_RATE;
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
      const STRICT_REQUIRED_SAMPLES = 2;

      const currentElTime = el.currentTime || 0;
      const drift = Math.abs(currentElTime - relTime);
      const offset = relTime - currentElTime;
      const prevOffset = lastOffset.get(el);
      lastOffset.set(el, offset);
      const firstTickOfClip = prevOffset === undefined;
      const offsetJumped = !firstTickOfClip && Math.abs(offset - prevOffset!) > 0.5;
      const catastrophicDrift = drift > 3;
      // A short audio clip can leave its native element paused just before EOF.
      // When the timeline re-enters the clip, rewind stale forward state at the
      // strict threshold; do not force cold audio forward while it buffers.
      const staleAudioOnFirstTick =
        el.tagName === "AUDIO" &&
        firstTickOfClip &&
        currentElTime - relTime > MEDIA_SYNC_TOLERANCE_SECONDS;
      const hardSync =
        (isHeldVideoTail && drift > 0.001) ||
        (el.ended && canSeekEndedMediaBackward && drift > 0.001) ||
        staleAudioOnFirstTick ||
        (drift > MEDIA_HARD_SYNC_SECONDS && (firstTickOfClip || offsetJumped || catastrophicDrift));
      // Seeking playing media resets a video's decoder (a ~150ms freeze that loops into a
      // seek→freeze→drift→seek stutter) and jumps sounding audio (a click). So playing media skips
      // strict and force sync and is steered by rate; hard sync (>0.5s) and audio past its steer
      // limit seek. A paused transport pauses it below, so a seek that pauses mid-playback lands it.
      if (el.tagName === "VIDEO" && !isHeldVideoTail) {
        // A loop's playhead wraps before its element, so its offset jumps by a lap: steering owns loops.
        const ahead =
          !clip.loop &&
          (offset < -VIDEO_LEAD_HOLD_SECONDS ||
            currentElTime >= mediaSourceTimeAt(clip, clip.end) - MEDIA_SYNC_TOLERANCE_SECONDS);
        if (!playing || (!ahead && offset >= -MEDIA_SYNC_TOLERANCE_SECONDS)) heldAhead.delete(el);
        else if (ahead && !el.paused) {
          heldAhead.add(el);
          el.pause();
        }
      }
      const holdingAhead = heldAhead.has(el);
      const isPlayingMedia = !el.paused && playing;
      if (isPlayingMedia) learnVideoStartLatency(el, params.timeSeconds, offset, baseRate);
      // Only apply strict sync when offset has stabilized (not growing).
      // During initial buffering, offset grows ~16ms/tick as the timeline
      // advances while media stays at 0. Accumulated drift from pause/play
      // toggling shows up as a stable, non-zero offset (delta near 0).
      const heldBelowFloor = params.playing && !playing;
      const offsetStabilized =
        heldBelowFloor || (prevOffset !== undefined && Math.abs(offset - prevOffset) < 0.004);
      let strictSync = false;
      if (
        !isPlayingMedia &&
        !holdingAhead &&
        !hardSync &&
        !firstTickOfClip &&
        offsetStabilized &&
        drift > MEDIA_SYNC_TOLERANCE_SECONDS
      ) {
        const samples = (strictDriftSamples.get(el) ?? 0) + 1;
        strictDriftSamples.set(el, samples);
        if (samples >= STRICT_REQUIRED_SAMPLES) {
          strictSync = true;
          strictDriftSamples.set(el, 0);
        }
      } else if (drift <= MEDIA_SYNC_TOLERANCE_SECONDS) {
        strictDriftSamples.set(el, 0);
      }
      const forceSync = !isPlayingMedia && !holdingAhead && params.forceSync && drift > 0.02;
      const steered =
        isPlayingMedia && !hardSync ? steerMedia(el, offset, baseRate, offsetStabilized) : null;
      const steerSeeks = steered?.seek === true;
      const dipped = steerSeeks && params.seekUnderDip?.(el, relTime) === true;
      try {
        // A hard sync lands the element on the playhead, so its pre-seek offset says nothing.
        if (!steered) forgetSteering(el);
        const rate = Math.max(MIN_NATIVE_PLAYBACK_RATE, steered?.rate ?? baseRate);
        // Some engines read a rate back at lower precision; an equal-enough rate is not rewritten.
        if (Math.abs(el.playbackRate - rate) > 1e-6) el.playbackRate = rate;
      } catch (err) {
        // ignore unsupported playbackRate
        swallow("runtime.media.site1", err);
      }
      if (hardSync || strictSync || forceSync || (steerSeeks && !dipped)) {
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
        const skipForInjectedVideo = el.tagName === "VIDEO" && !!findInjectedRenderFrame(el);
        if (!skipForInjectedVideo) {
          try {
            el.currentTime = mediaElementTime(relTime);
          } catch (err) {
            swallow("runtime.media.site2", err);
          }
          if (Math.abs(el.currentTime - relTime) > 0.5 && !seekLoadRetried.has(el)) {
            seekLoadRetried.add(el);
            el.load();
            try {
              el.currentTime = mediaElementTime(relTime);
            } catch (err) {
              swallow("runtime.media.site3", err);
            }
          }
          holdSeekBarrierUntilVideoLands(el);
        }
        playRequested.delete(el);
        heldAhead.delete(el);
        videoStarts.delete(el);
      } else if (!playing) {
        holdSeekBarrierUntilVideoLands(el);
      }
      if (isHeldVideoTail) {
        if (!el.paused) el.pause();
      } else if (
        playing &&
        !heldAhead.has(el) &&
        params.clockAdvancing !== false &&
        el.paused &&
        !playRequested.has(el) &&
        !isUnplayable(el)
      ) {
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
        // Offset read after any seek above; a loop could wrap a lap before the sample.
        if (isNonLoopVideo)
          videoStarts.set(el, {
            offset: relTime - (el.currentTime || 0),
            lead: Math.max(0, clip.start - params.timeSeconds) / params.playbackRate,
            at: Math.max(params.timeSeconds, clip.start) + 0.25 * params.playbackRate,
          });
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
      } else if (!playing && !el.paused) {
        el.pause();
      }
      continue;
    }
    // Drop drift state when the element is not playable. If native audio EOF
    // arrived slightly before the authored boundary, preserve only its desired
    // source time while the transport remains inside that boundary. Otherwise
    // the next poll would mistake the cleared baseline for a fresh activation
    // and replay the tail. A real backward seek still decreases relTime, and a
    // true outside-window transition clears every baseline as before.
    const remainsInsideAuthoredWindow = isInClipWindow(params.timeSeconds, clip.start, clip.end);
    evictMediaSyncState(el);
    if (remainsInsideAuthoredWindow) lastRelativeTime.set(el, relTime);
    if (!el.paused) el.pause();
    prepareUpcomingMedia(clip, params.timeSeconds, params.playing, params.playbackRate);
  }
}
