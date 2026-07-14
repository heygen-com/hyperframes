/**
 * Routes postMessages from the composition iframe to the appropriate handlers.
 *
 * Accepts the raw MessageEvent and delegates through typed callbacks so the
 * web component keeps its state fields private and this module stays stateless.
 */

import {
  applyRuntimeStateMessage,
  type PlaybackState,
  type PlaybackStateCallbacks,
} from "./playback-state.js";
import type { ShaderLoaderState } from "./shader-loader-state.js";
import type { ShaderTransitionState } from "./shader-options.js";
import { inspectRuntimeProtocol } from "@hyperframes/core/runtime/protocol";

type SceneRecord = { id: string; start: number; duration: number };

function extractScenes(raw: unknown): SceneRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (s): s is SceneRecord =>
      typeof s === "object" &&
      s !== null &&
      typeof (s as Record<string, unknown>)["id"] === "string" &&
      typeof (s as Record<string, unknown>)["start"] === "number" &&
      typeof (s as Record<string, unknown>)["duration"] === "number",
  );
}

export interface MessageHandlerCallbacks extends PlaybackStateCallbacks {
  getPlaybackState: () => PlaybackState;
  setPlaybackState: (next: PlaybackState) => void;
  getShaderLoadingMode: () => string;
  shaderLoader: ShaderLoaderState;
  setCompositionSize: (width: number, height: number) => void;
  sendControl: (action: string, extra?: Record<string, unknown>) => void;
  getIframeDoc: () => Document | null;
  /** Invoked when the iframe runtime posts `{type: "ready"}` — the player
   *  uses it to replay current bridge state (mute, volume, playback rate) so
   *  control messages sent before the iframe's listener registered aren't lost. */
  onRuntimeReady: () => void;
  /** Invoked when the runtime posts a finite positive timeline duration. The
   *  player uses this as the cross-origin readiness signal because the
   *  same-origin composition probe cannot inspect CDN iframes. */
  onRuntimeTimelineReady: (duration: number) => void;
  setRuntimeFps?: (fps: number) => void;
  /** Called with the scene list whenever a "timeline" message is received. */
  setScenes: (scenes: SceneRecord[]) => void;
  /** Return false to ignore the iframe runtime's audible-media autoplay fallback.
   *  Slideshow embeds keep iframe media under native element ownership because
   *  presenter/audience sync mirrors those media events directly. */
  shouldPromoteMediaAutoplayFallback?: () => boolean;
}

// fallow-ignore-next-line complexity
export function handleRuntimeMessage(
  event: MessageEvent,
  frameWindow: Window | null,
  callbacks: MessageHandlerCallbacks,
): void {
  if (event.source !== frameWindow) return;
  const data = event.data as Record<string, unknown> | undefined;
  if (!data || data["source"] !== "hf-preview") return;
  const protocol = inspectRuntimeProtocol(data);
  if (protocol.status === "unsupported") {
    callbacks.dispatchEvent(
      new CustomEvent("runtimeprotocolerror", {
        detail: { code: protocol.code, receivedVersion: protocol.receivedVersion },
      }),
    );
    return;
  }
  callbacks.setRuntimeFps?.(protocol.fps);

  if (data["type"] === "shader-transition-state") {
    const state: ShaderTransitionState =
      data["state"] && typeof data["state"] === "object"
        ? (data["state"] as ShaderTransitionState)
        : {};
    callbacks.shaderLoader.update(state, callbacks.getShaderLoadingMode());
    callbacks.dispatchEvent(
      new CustomEvent("shadertransitionstate", {
        detail: { compositionId: data["compositionId"], state },
      }),
    );
    return;
  }

  if (data["type"] === "ready") {
    callbacks.onRuntimeReady();
    return;
  }

  if (data["type"] === "state") {
    callbacks.setPlaybackState(
      applyRuntimeStateMessage(
        { frame: (data["frame"] as number) ?? 0, isPlaying: !!data["isPlaying"] },
        protocol.fps,
        callbacks.getPlaybackState(),
        callbacks,
      ),
    );
    return;
  }

  if (data["type"] === "media-autoplay-blocked") {
    if (callbacks.shouldPromoteMediaAutoplayFallback?.() === false) return;
    let iframeDoc: Document | null = null;
    try {
      iframeDoc = callbacks.getIframeDoc();
    } catch {
      /* cross-origin */
    }
    callbacks.media.promoteToParentProxy(iframeDoc, (t, opts) =>
      callbacks.media.mirrorTime(t, opts),
    );
    callbacks.sendControl("set-media-output-muted", { muted: true });
    return;
  }

  if (data["type"] === "timeline" && (data["durationInFrames"] as number) > 0) {
    if (Number.isFinite(data["durationInFrames"])) {
      const pb = callbacks.getPlaybackState();
      const duration = (data["durationInFrames"] as number) / protocol.fps;
      callbacks.setPlaybackState({ ...pb, duration });
      callbacks.updateControlsTime(pb.currentTime, duration);
      callbacks.onRuntimeTimelineReady(duration);
    }
    callbacks.setScenes(extractScenes(data["scenes"]));
    return;
  }

  if (
    data["type"] === "stage-size" &&
    // Finite-check like the timeline branch above: `> 0` alone lets
    // Infinity through, which scales the iframe to 0 and blanks it.
    Number.isFinite(data["width"]) &&
    (data["width"] as number) > 0 &&
    Number.isFinite(data["height"]) &&
    (data["height"] as number) > 0
  ) {
    callbacks.setCompositionSize(data["width"] as number, data["height"] as number);
  }
}
