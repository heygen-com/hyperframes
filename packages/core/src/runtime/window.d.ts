import type { RuntimeTimelineMessage, RuntimeTimelineLike } from "./types";
import type { HyperframePickerApi } from "../inline-scripts/pickerApi";
import type { PlayerAPI } from "../core.types";

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
    __playerReady?: boolean;
    __renderReady?: boolean;
    __HF_PARITY_MODE?: boolean;
    __HF_FPS?: number;
    __HF_MAX_DURATION_SEC?: number;
    __hfThreeTime?: number;
    __HF_PICKER_API?: HyperframePickerApi;
    gsap?: {
      timeline: (params?: { paused?: boolean }) => RuntimeTimelineLike;
      ticker?: {
        tick: () => void;
      };
    };
    THREE?: ThreeLike;
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
  }
}

export {};
