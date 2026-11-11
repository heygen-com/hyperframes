/**
 * Playback for a preview frame Studio cannot script, such as a preview on an
 * opaque origin. Commands go over the runtime's control bridge. Time, play state
 * and duration mirror the `state` and `timeline` messages the runtime posts.
 *
 * The listener is installed when this module loads, before any preview runs. A
 * runtime posts its first `timeline` while it boots, and a later listener would miss it.
 */
import type { PlaybackAdapter } from "./playbackTypes";
import { inspectStudioRuntimeMessage, postRuntimeControlMessage } from "./runtimeProtocol";

interface PlaybackMirror {
  time: number;
  duration: number;
  playing: boolean;
}

/** Keyed by the frame's window, which a frame keeps across its loads. */
const mirrors = new WeakMap<object, PlaybackMirror>();

function mirrorFor(frame: object): PlaybackMirror {
  let mirror = mirrors.get(frame);
  if (!mirror) {
    mirror = { time: 0, duration: 0, playing: false };
    mirrors.set(frame, mirror);
  }
  return mirror;
}

const finiteAtLeastZero = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/** A `state` or `timeline` post from a frame's runtime, with the frame that sent it. */
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
  if (finiteAtLeastZero(message.currentTime)) mirror.time = message.currentTime;
  mirror.playing = message.isPlaying === true;
}

if (typeof window !== "undefined") window.addEventListener("message", mirrorRuntimePlayback);

/** A PlaybackAdapter that drives the frame's runtime through control messages. */
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
      mirror.time = time;
    },
    getTime: () => mirror.time,
    getDuration: () => mirror.duration,
    isPlaying: () => mirror.playing,
  };
}
