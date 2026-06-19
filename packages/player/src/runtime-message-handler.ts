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

const FPS = 30;

type SceneRecord = { id: string; start: number; duration: number };

function extractScenes(raw: unknown): SceneRecord[] {
  if (!Array.isArray(raw)) return [];
  return (raw as SceneRecord[]).filter(
    (s) =>
      typeof s.id === "string" && typeof s.start === "number" && typeof s.duration === "number",
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
  /** Called with the scene list whenever a "timeline" message is received. */
  setScenes: (scenes: SceneRecord[]) => void;
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
        FPS,
        callbacks.getPlaybackState(),
        callbacks,
      ),
    );
    return;
  }

  if (data["type"] === "media-autoplay-blocked") {
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
      const duration = (data["durationInFrames"] as number) / FPS;
      callbacks.setPlaybackState({ ...pb, duration });
      callbacks.updateControlsTime(pb.currentTime, duration);
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
