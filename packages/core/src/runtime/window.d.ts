import type { RuntimeTimelineMessage, RuntimeTimelineLike } from "./types";
import type { RuntimeColorGradingApi } from "./colorGrading";
import type { HyperframePickerApi } from "../inline-scripts/pickerApi";
import type { PlayerAPI } from "../core.types";
import type { ClipTree } from "./clipTree";

type ThreeClockLike = {
  elapsedTime: number;
  oldTime: number;
  startTime: number;
  getElapsedTime: () => number;
  getDelta: () => number;
};

type ThreeAnimationMixerLike = {
  setTime?: (time: number) => void;
  update: (deltaTime: number) => ThreeAnimationMixerLike;
};

type ThreeLike = {
  Clock?: {
    prototype: ThreeClockLike;
  };
  AnimationMixer?: {
    prototype: ThreeAnimationMixerLike;
  };
};

declare global {
  interface Window {
    __timelines: Record<string, RuntimeTimelineLike>;
    __player?: PlayerAPI;
    __clipManifest?: RuntimeTimelineMessage;
    __clipTree?: ClipTree;
    __hf?: {
      colorGrading?: RuntimeColorGradingApi;
      onSwallowed?: (label: string, err: unknown) => void;
    };
    __playerReady?: boolean;
    __renderReady?: boolean;
    __hfRuntimeTeardown?: (() => void) | null;
    __HF_PARITY_MODE?: boolean;
    __HF_FPS?: number;
    __HF_MAX_DURATION_SEC?: number;
    __hfThreeTime?: number;
    /**
     * Current seek position in seconds, set by the TypeGPU/WebGPU adapter.
     * Poll this from your WebGPU render loop instead of `performance.now()`
     * to get the deterministic seek position.
     *
     * Also listen for the `"hf-seek"` CustomEvent on `window` for an
     * imperative push signal: `window.addEventListener("hf-seek", e => render(e.detail.time))`.
     */
    __hfTypegpuTime?: number;
    /**
     * Re-render GPU adapters (Three.js / WebGPU) at the given time, bypassing
     * the `"hf-seek"` dedup. Called by the engine after injecting decoded
     * video frames so GPU compositions re-upload their video textures from the
     * freshly-injected `__render_frame__` images. See `forceDispatchSeekEvent`.
     */
    __hfReseekGpu?: (time: number) => void;
    __HF_PICKER_API?: HyperframePickerApi;
    gsap?: {
      timeline: (params?: { paused?: boolean }) => RuntimeTimelineLike;
      ticker?: {
        tick: () => void;
      };
    };
    THREE?: ThreeLike;
    /**
     * Global anime.js instance (set by including the anime.iife.min.js script).
     * The adapter uses `anime.running` for auto-discovery.
     */
    anime?: {
      (params: unknown): unknown;
      timeline?: (params?: unknown) => unknown;
      running: unknown[];
    };
    /**
     * anime.js instances registered by compositions.
     * The adapter seeks all instances when the player is seeked.
     *
     * Push your animation or timeline instance here:
     *   window.__hfAnime = window.__hfAnime || [];
     *   window.__hfAnime.push(anim);
     */
    __hfAnime?: unknown[];
    /**
     * Global lottie-web instance (set by including the lottie.min.js script).
     * The adapter uses `lottie.getRegisteredAnimations()` for auto-discovery.
     */
    lottie?: {
      loadAnimation: (params: unknown) => unknown;
      getRegisteredAnimations: () => unknown[];
    };
    /**
     * Lottie animation instances registered by compositions.
     * The adapter seeks all instances when the player is seeked.
     *
     * Push your animation instance here after calling `lottie.loadAnimation()`:
     *   window.__hfLottie = window.__hfLottie || [];
     *   window.__hfLottie.push(anim);
     */
    __hfLottie?: unknown[];
    /**
     * Mapbox GL JS map instances. Push your map here after creating it:
     *   window.__hfMapbox = window.__hfMapbox || [];
     *   window.__hfMapbox.push(map);
     */
    __hfMapbox?: unknown[];
    /**
     * Leaflet map instances. Push your map here after creating it:
     *   window.__hfLeaflet = window.__hfLeaflet || [];
     *   window.__hfLeaflet.push(map);
     */
    __hfLeaflet?: unknown[];
    /**
     * Google Maps instances. Push your map here after creating it:
     *   window.__hfGoogleMaps = window.__hfGoogleMaps || [];
     *   window.__hfGoogleMaps.push(map);
     */
    __hfGoogleMaps?: unknown[];
    /**
     * MapLibre GL JS map instances. Push your map here after creating it:
     *   window.__hfMaplibre = window.__hfMaplibre || [];
     *   window.__hfMaplibre.push(map);
     */
    __hfMaplibre?: unknown[];
    /**
     * D3 transition instances. Push your transition here after creating it:
     *   window.__hfD3 = window.__hfD3 || [];
     *   window.__hfD3.push(transition);
     */
    __hfD3?: unknown[];
    /**
     * Render-time variable overrides injected by the engine when the user
     * passes `hyperframes render --variables '<json>'`. Read indirectly via
     * `window.__hyperframes.getVariables()` (or the named `getVariables`
     * export from `@hyperframes/core`), which merges these over the
     * declared defaults from `<html data-composition-variables="...">`.
     */
    __hfVariables?: Record<string, unknown>;
    /**
     * Per-instance, pre-merged variables for sub-compositions. Keyed by the
     * sub-composition's `data-composition-id`. Populated by the runtime
     * composition loader at mount time: layers the host element's
     * `data-variable-values` over the sub-comp's declared defaults so the
     * scoped `getVariables()` exposed by `compositionScoping.ts` returns the
     * resolved values for the instance currently executing.
     */
    __hfVariablesByComp?: Record<string, Record<string, unknown>>;
    /**
     * Set to `true` while the GSAP tween-batching interceptor (injected via
     * HF_EARLY_STUB in fileServer.ts) is still draining queued tween calls
     * through requestAnimationFrame batches. Cleared and the "hf-timelines-built"
     * CustomEvent is dispatched when all queues are empty.
     *
     * init.ts uses this to decide whether to defer `bindRootTimelineIfAvailable`:
     * if true at DOMContentLoaded time, it adds a one-shot event listener and
     * rebinds after the event fires.
     */
    __hfTimelinesBuilding?: boolean;
  }
}

export {};
