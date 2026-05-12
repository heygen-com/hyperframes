/**
 * Pure playback-state update logic for the `state` message from the runtime.
 *
 * Extracted from the web component so the state-transition rules — loop
 * handling, play/pause mirroring, completion detection — can be read and
 * exercised independently.
 */

import type { ParentMediaManager } from "./parent-media.js";

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
  media: ParentMediaManager;
}

/**
 * Process a `state` message from the runtime and return the next state.
 * Side effects (controls updates, events, media mirroring) are fired through
 * `callbacks`. The caller must commit the returned state object.
 */
export function applyRuntimeStateMessage(
  data: { frame: number; isPlaying: boolean },
  fps: number,
  current: PlaybackState,
  callbacks: PlaybackStateCallbacks,
): PlaybackState {
  const rawTime = (data.frame ?? 0) / fps;
  const currentTime = current.duration > 0 ? Math.min(rawTime, current.duration) : rawTime;
  const wasPlaying = !current.paused;
  const nextPaused = !data.isPlaying;
  const completedPlayback =
    current.duration > 0 && currentTime >= current.duration && (wasPlaying || data.isPlaying);

  if (completedPlayback && callbacks.getLoop()) {
    if (callbacks.media.audioOwner === "parent") callbacks.media.pauseAll();
    callbacks.seek(0);
    callbacks.play();
    // play() sets paused=false; reflect that in the returned state so the
    // caller's destructure doesn't overwrite it with the stale nextPaused value.
    return { ...current, currentTime, paused: false };
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
    if (callbacks.media.audioOwner === "parent") callbacks.media.pauseAll();
    next.paused = true;
    callbacks.updateControlsPlaying(false);
    callbacks.dispatchEvent(new Event("ended"));
  }

  return next;
}
