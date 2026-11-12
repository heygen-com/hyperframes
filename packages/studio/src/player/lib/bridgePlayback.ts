// Playback of a frame Studio cannot script: control-bridge commands, with time and duration mirrored
// from the runtime's `state` and `timeline` posts. The listener starts at module load because a
// runtime posts its first `timeline` while it boots.
import type { PlaybackAdapter } from "./playbackTypes";
import { inspectStudioRuntimeMessage, postRuntimeControlMessage } from "./runtimeProtocol";

interface PlaybackMirror {
  time: number;
  duration: number;
  playing: boolean;
  /** A seek the runtime has not confirmed yet, and until when to wait for it. */
  seekTo: number | null;
  seekUntil: number;
}

const SEEK_CONFIRM_MS = 500;

/** Keyed by the frame's window, which a frame keeps across its loads. */
const mirrors = new WeakMap<object, PlaybackMirror>();

function mirrorFor(frame: object): PlaybackMirror {
  let mirror = mirrors.get(frame);
  if (!mirror) {
    mirror = { time: 0, duration: 0, playing: false, seekTo: null, seekUntil: 0 };
    mirrors.set(frame, mirror);
  }
  return mirror;
}

const finiteAtLeastZero = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

function playbackPost(
  event: MessageEvent,
): { frame: object; message: Record<string, unknown> } | null {
  const data: unknown = event.data;
  if (!event.source || typeof data !== "object" || data === null) return null;
  const message = data as Record<string, unknown>;
  const mirrored = message.type === "state" || message.type === "timeline";
  if (message.source !== "hf-preview" || !mirrored) return null;
  if (inspectStudioRuntimeMessage(message).status === "unsupported") return null;
  return { frame: event.source, message };
}

function mirrorRuntimePlayback(event: MessageEvent): void {
  const post = playbackPost(event);
  if (!post) return;
  const { frame, message } = post;
  const mirror = mirrorFor(frame);
  if (message.type === "timeline") {
    if (finiteAtLeastZero(message.durationSeconds)) mirror.duration = message.durationSeconds;
    return;
  }
  if (!finiteAtLeastZero(message.currentTime)) return;
  // A state posted before the runtime handled our seek would put the playhead back.
  if (mirror.seekTo !== null && performance.now() < mirror.seekUntil) {
    if (Math.abs(message.currentTime - mirror.seekTo) > 0.001) return;
  }
  mirror.seekTo = null;
  mirror.time = message.currentTime;
  mirror.playing = message.isPlaying === true;
}

if (typeof window !== "undefined") window.addEventListener("message", mirrorRuntimePlayback);

export function bridgePlaybackAdapter(iframe: HTMLIFrameElement): PlaybackAdapter | null {
  const frame = iframe.contentWindow;
  if (!frame) return null;
  const mirror = mirrorFor(frame);
  const send = (action: string, payload?: Record<string, unknown>) =>
    postRuntimeControlMessage(frame, action, payload);
  return {
    play: () => {
      send("play");
      mirror.playing = true;
    },
    pause: () => {
      send("pause");
      mirror.playing = false;
    },
    // The bridge's seek takes no keepPlaying or settled option yet.
    seek: (time) => {
      send("seek", { timeSeconds: time });
      Object.assign(mirror, { time, seekTo: time, seekUntil: performance.now() + SEEK_CONFIRM_MS });
    },
    getTime: () => mirror.time,
    getDuration: () => mirror.duration,
    isPlaying: () => mirror.playing,
  };
}
