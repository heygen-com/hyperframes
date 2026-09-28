/**
 * Pure playback-state update logic for the `state` message from the runtime.
 *
 * Extracted from the web component so the state-transition rules — loop
 * handling, play/pause mirroring, completion detection — can be read and
 * exercised independently.
 */

import type { ParentMediaManager } from "./parent-media.js";
import type { PlayRange } from "./play-range.js";

const UI_UPDATE_INTERVAL_MS = 100;

export interface PlaybackState {
  currentTime: number;
  duration: number;
  paused: boolean;
  lastUpdateMs: number;
}

export interface PlaybackStateCallbacks {
  updateControlsTime: (current: number, duration: number) => void;
  updateControlsPlaying: (playing: boolean) => void;
  dispatchEvent: (event: Event) => void;
  seek: (t: number) => void;
  play: () => void;
  getLoop: () => boolean;
  getPlayRange?: () => PlayRange | null;
  media: ParentMediaManager;
}

type RuntimeStateData = {
  frame: number;
  isPlaying: boolean;
  currentTime?: number;
  ended?: boolean;
};

/** The runtime's exact time when it sends one (older runtimes send only the whole frame). */
function runtimeTime(data: RuntimeStateData, fps: number): number {
  return typeof data.currentTime === "number" && Number.isFinite(data.currentTime)
    ? data.currentTime
    : (data.frame ?? 0) / fps;
}

/** A stopped runtime's `ended: false` is a pause; otherwise reaching the length is the end. */
function isAtEnd(data: RuntimeStateData, time: number, duration: number): boolean {
  if (duration <= 0) return false;
  if (data.ended === true) return true;
  if (data.ended === false && !data.isPlaying) return false;
  return time >= duration;
}

/** Loop start and end, a range's or the film's; past a range end is its end only while playing. */
function playBounds(
  data: RuntimeStateData,
  time: number,
  duration: number,
  playing: boolean,
  range: PlayRange | null | undefined,
): { start: number; end: number; atEnd: boolean; ranged: boolean } {
  if (!range)
    return { start: 0, end: duration, atEnd: isAtEnd(data, time, duration), ranged: false };
  const end = range.end ?? duration;
  return { start: range.start, end, atEnd: playing && isAtEnd(data, time, end), ranged: true };
}

/**
 * Process a `state` message from the runtime and return the next state.
 * Side effects (controls updates, events, media mirroring) are fired through
 * `callbacks`. The caller must commit the returned state object.
 */
export function applyRuntimeStateMessage(
  data: RuntimeStateData,
  fps: number,
  current: PlaybackState,
  callbacks: PlaybackStateCallbacks,
): PlaybackState {
  const rawTime = runtimeTime(data, fps);
  const wasPlaying = !current.paused;
  const playing = wasPlaying || data.isPlaying;
  const range = callbacks.getPlayRange?.();
  const bounds = playBounds(data, rawTime, current.duration, playing, range);
  const { end, atEnd, start: loopStart } = bounds;
  const clampedTime = current.duration > 0 ? Math.min(rawTime, current.duration) : rawTime;
  const currentTime = atEnd ? end : clampedTime;
  const nextPaused = !data.isPlaying;
  const completedPlayback = atEnd && playing;

  if (completedPlayback && callbacks.getLoop()) {
    if (callbacks.media.audioOwner === "parent") callbacks.media.pauseAll();
    callbacks.seek(loopStart);
    callbacks.play();
    // play() sets paused=false; reflect that in the returned state so the
    // caller's destructure doesn't overwrite it with the stale nextPaused value.
    return { ...current, currentTime: loopStart, paused: false };
  }

  const next: PlaybackState = { ...current, currentTime, paused: nextPaused };

  if (callbacks.media.audioOwner === "parent") {
    if (wasPlaying && nextPaused) {
      callbacks.media.pauseAll();
    } else if (!wasPlaying && !nextPaused) {
      callbacks.media.playAll();
    }
    callbacks.media.mirrorTime(currentTime);
  }

  const now = performance.now();
  const playStateChanged = nextPaused !== current.paused;
  if (now - current.lastUpdateMs > UI_UPDATE_INTERVAL_MS || playStateChanged) {
    next.lastUpdateMs = now;
    callbacks.updateControlsTime(currentTime, current.duration);
    callbacks.updateControlsPlaying(!nextPaused);
    callbacks.dispatchEvent(new CustomEvent("timeupdate", { detail: { currentTime } }));
  }

  if (completedPlayback) {
    // A runtime older than set-play-range plays on past the range: stop it on the end.
    if (bounds.ranged && data.isPlaying) callbacks.seek(end);
    if (callbacks.media.audioOwner === "parent") callbacks.media.pauseAll();
    next.paused = true;
    callbacks.updateControlsPlaying(false);
    callbacks.dispatchEvent(new Event("ended"));
  }

  return next;
}
