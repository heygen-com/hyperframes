// Playback of a frame Studio cannot script: control-bridge commands, with time and duration mirrored
// from the runtime's `state` and `timeline` posts. Player registers each frame before it loads,
// because a runtime posts its first `timeline` while it boots.
import type { PlaybackAdapter } from "./playbackTypes";
import { inspectStudioRuntimeMessage, postRuntimeControlMessage } from "./runtimeProtocol";

interface PlaybackMirror {
  iframe: HTMLIFrameElement;
  time: number;
  duration: number;
  playing: boolean;
  /** A seek the runtime has not confirmed yet, and until when to wait for it. */
  seekTo: number | null;
  seekUntil: number;
  /** The composition's declared size from the runtime's `stage-size` post. */
  stageSize: { width: number; height: number } | null;
}

const SEEK_CONFIRM_MS = 500;
// A post without fps metadata is matched within half a frame of the lowest frame rate a film may use.
const LOWEST_FPS = 1;

/** Keyed by the frame's window, which a frame keeps across its loads. */
const mirrors = new WeakMap<object, PlaybackMirror>();

function mirrorOf(iframe: HTMLIFrameElement): PlaybackMirror | null {
  const frame = iframe.contentWindow;
  if (!frame) return null;
  let mirror = mirrors.get(frame);
  if (!mirror) {
    mirror = {
      iframe,
      time: 0,
      duration: 0,
      playing: false,
      seekTo: null,
      seekUntil: 0,
      stageSize: null,
    };
    mirrors.set(frame, mirror);
  }
  mirror.iframe = iframe;
  return mirror;
}

/** Starts mirroring a preview frame Studio built; call it before the frame loads. */
export function watchPreviewFrame(iframe: HTMLIFrameElement): void {
  mirrorOf(iframe);
}

/** The composition size a registered frame's runtime last posted. */
export function previewStageSize(
  iframe: HTMLIFrameElement,
): { width: number; height: number } | null {
  const frame = iframe.contentWindow;
  return (frame && mirrors.get(frame)?.stageSize) ?? null;
}

/** The origins a post from this frame can carry, given its sandbox and what it loads. */
export function frameOrigins(iframe: HTMLIFrameElement): string[] {
  const sandbox = iframe.getAttribute("sandbox")?.toLowerCase().split(/\s+/);
  if (sandbox && !sandbox.includes("allow-same-origin")) return ["null"];
  const src = iframe.getAttribute("src");
  if (iframe.hasAttribute("srcdoc") || !src) return [window.location.origin];
  try {
    const url = new URL(src, window.location.href);
    if (url.protocol === "about:") return [window.location.origin];
    return [url.protocol === "data:" ? "null" : url.origin];
  } catch {
    return [];
  }
}

const finiteAtLeastZero = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const finitePositive = (value: unknown): value is number => finiteAtLeastZero(value) && value > 0;

/** The runtime lands a seek on the frame at or before it, so only that frame confirms it. */
function confirmsSeek(currentTime: number, seekTo: number, fps: number | null): boolean {
  if (fps === null) return Math.abs(currentTime - seekTo) <= 0.5 / LOWEST_FPS;
  return Math.abs(currentTime - Math.floor(seekTo * fps + 1e-9) / fps) < 0.5 / fps;
}

/** The runtime's playback post and its frame rate, or null for anything else. */
function runtimePost(
  data: unknown,
): { message: Record<string, unknown>; fps: number | null } | null {
  if (typeof data !== "object" || data === null) return null;
  const message = data as Record<string, unknown>;
  if (message.source !== "hf-preview") return null;
  const inspection = inspectStudioRuntimeMessage(message);
  if (inspection.status === "unsupported") return null;
  return { message, fps: inspection.status === "supported" ? inspection.fps : null };
}

function mirrorState(
  mirror: PlaybackMirror,
  currentTime: number,
  playing: boolean,
  fps: number | null,
) {
  // A state posted before the runtime handled our seek would put the playhead back.
  const { seekTo } = mirror;
  const waiting = seekTo !== null && performance.now() < mirror.seekUntil;
  if (waiting && !confirmsSeek(currentTime, seekTo, fps)) return;
  mirror.seekTo = null;
  mirror.time = currentTime;
  mirror.playing = playing;
}

function mirrorPost(mirror: PlaybackMirror, message: Record<string, unknown>, fps: number | null) {
  if (message.type === "timeline" && finiteAtLeastZero(message.durationSeconds)) {
    mirror.duration = message.durationSeconds;
  } else if (message.type === "state" && finiteAtLeastZero(message.currentTime)) {
    mirrorState(mirror, message.currentTime, message.isPlaying === true, fps);
  } else if (message.type === "stage-size") {
    const { width, height } = message;
    if (finitePositive(width) && finitePositive(height)) mirror.stageSize = { width, height };
  }
}

function mirrorRuntimePlayback(event: MessageEvent): void {
  // Only a frame Studio built, posting from an origin that frame can have.
  const mirror = event.source ? mirrors.get(event.source) : undefined;
  if (!mirror || !frameOrigins(mirror.iframe).includes(event.origin)) return;
  const post = runtimePost(event.data);
  if (post) mirrorPost(mirror, post.message, post.fps);
}

if (typeof window !== "undefined") window.addEventListener("message", mirrorRuntimePlayback);

export function bridgePlaybackAdapter(iframe: HTMLIFrameElement): PlaybackAdapter | null {
  const frame = iframe.contentWindow;
  const mirror = mirrorOf(iframe);
  if (!frame || !mirror) return null;
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
