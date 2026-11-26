/**
 * Pure playback-state update logic for the `state` message from the runtime.
 *
 * Extracted from the web component so the state-transition rules — loop
 * handling, play/pause mirroring, completion detection — can be read and
 * exercised independently.
 */

import type { ParentMediaManager } from "./parent-media.js";
import { type PlayRange, playRangeStopTime } from "./play-range.js";

const UI_UPDATE_INTERVAL_MS = 100;
export const PLAY_START_GRACE_MS = 200;

export interface PlaybackState {
  currentTime: number;
  duration: number;
  paused: boolean;
  lastUpdateMs: number;
  enteringRange?: boolean;
  awaitingPlaySeq?: number;
  awaitingPlayUntilMs?: number;
}

export interface PlaybackStateCallbacks {
  updateControlsTime: (current: number, duration: number) => void;
  updateControlsPlaying: (playing: boolean) => void;
  dispatchEvent: (event: Event) => void;
  seek: (t: number) => void;
  play: () => number | void;
  getLoop: () => boolean;
  getPlayRange?: () => PlayRange | null;
  media: ParentMediaManager;
  onRuntimeStopped?: () => void;
}

type RuntimeStateData = {
  frame: number;
  isPlaying: boolean;
  currentTime?: number;
  ended?: boolean;
  ownsRange?: boolean;
  playSeq?: number;
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

type PlayBounds = {
  start: number;
  shownAtEnd: number;
  atEnd: boolean;
  stopRuntime: boolean;
  entering: boolean;
};

/** A `play-range` runtime says when a range ended. For an older one the player reads the time,
 *  and after it jumps into the range only from a state inside it, never a stale one. */
function playBounds(
  data: RuntimeStateData,
  time: number,
  current: PlaybackState,
  playing: boolean,
  range: PlayRange | null | undefined,
  fps: number,
): PlayBounds {
  const { duration } = current;
  if (!range) {
    const atEnd = isAtEnd(data, time, duration);
    return { start: 0, shownAtEnd: duration, atEnd, stopRuntime: false, entering: false };
  }
  if (data.ownsRange) {
    const atEnd = playing && data.ended === true && !data.isPlaying;
    return { start: range.start, shownAtEnd: time, atEnd, stopRuntime: false, entering: false };
  }
  return olderRuntimeBounds(data, time, current, playing, range, fps);
}

function olderRuntimeBounds(
  data: RuntimeStateData,
  time: number,
  current: PlaybackState,
  playing: boolean,
  range: PlayRange,
  fps: number,
): PlayBounds {
  const end = range.end ?? current.duration;
  const entering = current.enteringRange === true && (time < range.start || time >= end);
  return {
    start: range.start,
    shownAtEnd: playRangeStopTime(range, current.duration, fps),
    atEnd: playing && !entering && isAtEnd(data, time, end),
    stopRuntime: data.isPlaying,
    entering,
  };
}

function mirrorParentMedia(
  callbacks: PlaybackStateCallbacks,
  wasPlaying: boolean,
  nextPaused: boolean,
  currentTime: number,
): void {
  if (callbacks.media.audioOwner !== "parent") return;
  if (wasPlaying && nextPaused) callbacks.media.pauseAll();
  else if (!wasPlaying && !nextPaused) callbacks.media.playAll();
  callbacks.media.mirrorTime(currentTime);
}

function reportTime(
  callbacks: PlaybackStateCallbacks,
  current: PlaybackState,
  next: PlaybackState,
  nextPaused: boolean,
  currentTime: number,
  now: number,
): void {
  const playStateChanged = nextPaused !== current.paused;
  if (now - current.lastUpdateMs <= UI_UPDATE_INTERVAL_MS && !playStateChanged) return;
  next.lastUpdateMs = now;
  callbacks.updateControlsTime(currentTime, current.duration);
  callbacks.updateControlsPlaying(!nextPaused);
  callbacks.dispatchEvent(new CustomEvent("timeupdate", { detail: { currentTime } }));
}

function isStalePrePlayState(data: RuntimeStateData, current: PlaybackState, now: number): boolean {
  const awaitingSeq = current.awaitingPlaySeq ?? 0;
  if (awaitingSeq <= 0) return false;
  if (typeof data.playSeq === "number") return data.playSeq < awaitingSeq;
  return current.awaitingPlayUntilMs !== undefined && current.awaitingPlayUntilMs > now;
}

function nextAwaitingPlay(
  data: RuntimeStateData,
  current: PlaybackState,
  completedPlayback: boolean,
): { awaitingPlaySeq: number; awaitingPlayUntilMs: number } {
  const awaitingSeq = current.awaitingPlaySeq ?? 0;
  if (!completedPlayback && typeof data.playSeq === "number" && data.playSeq < awaitingSeq) {
    return {
      awaitingPlaySeq: awaitingSeq,
      awaitingPlayUntilMs: current.awaitingPlayUntilMs ?? 0,
    };
  }
  return { awaitingPlaySeq: 0, awaitingPlayUntilMs: 0 };
}

function restartLoopedPlayback(
  current: PlaybackState,
  loopStart: number,
  now: number,
  callbacks: PlaybackStateCallbacks,
): PlaybackState {
  if (callbacks.media.audioOwner === "parent") callbacks.media.pauseAll();
  callbacks.seek(loopStart);
  const nextSeq = callbacks.play();
  return {
    ...current,
    currentTime: loopStart,
    paused: false,
    enteringRange: true,
    awaitingPlaySeq: typeof nextSeq === "number" ? nextSeq : (current.awaitingPlaySeq ?? 0),
    awaitingPlayUntilMs: now + PLAY_START_GRACE_MS,
  };
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
  const now = performance.now();
  const rawTime = runtimeTime(data, fps);
  const wasPlaying = !current.paused;
  const playing = wasPlaying || data.isPlaying;
  const range = callbacks.getPlayRange?.();
  const bounds = playBounds(data, rawTime, current, playing, range, fps);
  const { atEnd, start: loopStart } = bounds;
  const clampedTime = current.duration > 0 ? Math.min(rawTime, current.duration) : rawTime;
  const currentTime = atEnd ? bounds.shownAtEnd : clampedTime;
  const nextPaused = !data.isPlaying;
  const completedPlayback = atEnd && playing;

  // Drop pre-play paused heartbeats until the runtime echoes playSeq (or legacy grace expires).
  if (nextPaused && !completedPlayback && isStalePrePlayState(data, current, now)) return current;
  if (completedPlayback && callbacks.getLoop()) {
    return restartLoopedPlayback(current, loopStart, now, callbacks);
  }

  const next = {
    ...current,
    currentTime,
    paused: nextPaused,
    enteringRange: bounds.entering,
    ...nextAwaitingPlay(data, current, completedPlayback),
  };
  if (wasPlaying && (nextPaused || completedPlayback)) callbacks.onRuntimeStopped?.();

  mirrorParentMedia(callbacks, wasPlaying, nextPaused, currentTime);
  reportTime(callbacks, current, next, nextPaused, currentTime, now);

  if (completedPlayback) endPlayback(callbacks, next, bounds.stopRuntime, currentTime);
  return next;
}

function endPlayback(
  callbacks: PlaybackStateCallbacks,
  next: PlaybackState,
  stopRuntime: boolean,
  currentTime: number,
): void {
  // A runtime without play-range plays on past the range: stop it on the last frame inside.
  if (stopRuntime) callbacks.seek(currentTime);
  if (callbacks.media.audioOwner === "parent") callbacks.media.pauseAll();
  next.paused = true;
  callbacks.updateControlsPlaying(false);
  callbacks.dispatchEvent(new Event("ended"));
}
