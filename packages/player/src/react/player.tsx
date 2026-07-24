import type {
  ColorGradingCompareState,
  ColorGradingTarget,
  HyperframesPlayer as HyperframesPlayerElement,
} from "../hyperframes-player.js";
import type { ShaderLoadingMode } from "../shader-options.js";
import type * as React from "react";
import {
  createElement,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
import { ensurePlayerDefined } from "./register.js";

export type PlayerScene = { id: string; start: number; duration: number };

export interface HyperframesPlayerProps {
  /** URL to the composition HTML file. */
  src?: string;
  /** Inline composition HTML (alternative to `src`). */
  srcdoc?: string;
  /** Audio URL preloaded for parent-frame playback (mobile). */
  audioSrc?: string;
  /** Composition width in pixels — aspect ratio only, not display size. */
  width?: number;
  /** Composition height in pixels — aspect ratio only, not display size. */
  height?: number;
  /** Show play/pause, scrubber, and time display. */
  controls?: boolean;
  /** Mute audio playback. */
  muted?: boolean;
  /** Force-mute and hide volume controls so the viewer cannot enable sound. */
  audioLocked?: boolean;
  /** Volume in the 0-1 range. */
  volume?: number;
  /** Image URL shown before playback starts. */
  poster?: string;
  /** Speed multiplier (0.5 = half, 2 = double). */
  playbackRate?: number;
  /** Start playing when the composition is ready. */
  autoPlay?: boolean;
  /** Restart when the composition ends. */
  loop?: boolean;
  /** Shader transition snapshot scale (0.25-1). */
  shaderCaptureScale?: number;
  /** Shader transition prep loading UI ownership. */
  shaderLoading?: ShaderLoadingMode;
  className?: string;
  style?: React.CSSProperties;
  /** Composition loaded and duration determined. */
  onReady?: (detail: { duration: number }) => void;
  onPlay?: () => void;
  onPause?: () => void;
  /** Playback position changed (~10 fps). */
  onTimeUpdate?: (detail: { currentTime: number }) => void;
  /** Reached the end (when not looping). */
  onEnded?: () => void;
  /** Composition failed to load (or the player element failed to register). */
  onError?: (detail: { message: string }) => void;
  /** Scene list received from the composition runtime. */
  onScenes?: (detail: { scenes: PlayerScene[] }) => void;
  /** Shader transition cache/capture progress. */
  onShaderTransitionState?: (detail: {
    compositionId: string | undefined;
    state: Record<string, unknown>;
  }) => void;
  onRateChange?: () => void;
  onVolumeChange?: () => void;
}

export interface HyperframesPlayerHandle {
  /** The underlying `<hyperframes-player>` element, or null before mount. */
  readonly element: HyperframesPlayerElement | null;
  /** The inner composition iframe, or null before the element upgrades. */
  readonly iframeElement: HTMLIFrameElement | null;
  readonly currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly ready: boolean;
  readonly scenes: PlayerScene[];
  play(): void;
  pause(): void;
  seek(timeInSeconds: number): void;
  /** Stop all timed media inside the composition. */
  stopMedia(): void;
  setColorGrading(target: ColorGradingTarget, grading: unknown): void;
  clearColorGrading(target: ColorGradingTarget): void;
  setColorGradingCompare(target: ColorGradingTarget, compare: ColorGradingCompareState): void;
  clearColorGradingCompare(target: ColorGradingTarget): void;
}

type PlayerCallbacks = Pick<
  HyperframesPlayerProps,
  | "onReady"
  | "onPlay"
  | "onPause"
  | "onTimeUpdate"
  | "onEnded"
  | "onError"
  | "onScenes"
  | "onShaderTransitionState"
  | "onRateChange"
  | "onVolumeChange"
>;

function syncAttribute(el: Element, name: string, value: string | number | undefined) {
  if (value === undefined) el.removeAttribute(name);
  else if (el.getAttribute(name) !== String(value)) el.setAttribute(name, String(value));
}

function syncBooleanAttribute(el: Element, name: string, value: boolean | undefined) {
  if (value) {
    if (!el.hasAttribute(name)) el.setAttribute(name, "");
  } else {
    el.removeAttribute(name);
  }
}

/** The element until upgrade — properties/methods may not exist yet. */
type MaybeUpgraded = Partial<HyperframesPlayerElement> & HTMLElement;

function detail<T>(event: Event): T {
  return (event as CustomEvent<T>).detail;
}

/**
 * React wrapper for the `<hyperframes-player>` web component.
 *
 * Registers the custom element on mount (SSR-safe — `@hyperframes/player` is
 * only imported in the browser), mirrors props to player attributes, and
 * forwards player events to callback props. Imperative playback control is
 * available through the ref handle.
 */
export const HyperframesPlayer = forwardRef<HyperframesPlayerHandle, HyperframesPlayerProps>(
  function HyperframesPlayer(props, ref) {
    const elementRef = useRef<MaybeUpgraded | null>(null);

    const callbacksRef = useRef<PlayerCallbacks>({});
    callbacksRef.current = props;

    useImperativeHandle(
      ref,
      () => ({
        get element() {
          return (elementRef.current as HyperframesPlayerElement | null) ?? null;
        },
        get iframeElement() {
          return elementRef.current?.iframeElement ?? null;
        },
        get currentTime() {
          return elementRef.current?.currentTime ?? 0;
        },
        get duration() {
          return elementRef.current?.duration ?? 0;
        },
        get paused() {
          return elementRef.current?.paused ?? true;
        },
        get ready() {
          return elementRef.current?.ready ?? false;
        },
        get scenes() {
          return elementRef.current?.scenes ?? [];
        },
        play: () => elementRef.current?.play?.(),
        pause: () => elementRef.current?.pause?.(),
        seek: (timeInSeconds) => elementRef.current?.seek?.(timeInSeconds),
        stopMedia: () => elementRef.current?.stopMedia?.(),
        setColorGrading: (target, grading) =>
          elementRef.current?.setColorGrading?.(target, grading),
        clearColorGrading: (target) => elementRef.current?.clearColorGrading?.(target),
        setColorGradingCompare: (target, compare) =>
          elementRef.current?.setColorGradingCompare?.(target, compare),
        clearColorGradingCompare: (target) =>
          elementRef.current?.clearColorGradingCompare?.(target),
      }),
      [],
    );

    // Register the custom element. Attributes set before the upgrade are
    // replayed by attributeChangedCallback when the definition lands.
    useEffect(() => {
      let cancelled = false;
      ensurePlayerDefined().catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        callbacksRef.current.onError?.({ message });
      });
      return () => {
        cancelled = true;
      };
    }, []);

    // Forward player events to the callback props. Listeners read the latest
    // callbacks through callbacksRef so this only binds once.
    useEffect(() => {
      const el = elementRef.current;
      if (!el) return;
      const listeners: [string, EventListener][] = [
        ["ready", (e) => callbacksRef.current.onReady?.(detail(e))],
        ["play", () => callbacksRef.current.onPlay?.()],
        ["pause", () => callbacksRef.current.onPause?.()],
        ["timeupdate", (e) => callbacksRef.current.onTimeUpdate?.(detail(e))],
        ["ended", () => callbacksRef.current.onEnded?.()],
        ["error", (e) => callbacksRef.current.onError?.(detail(e))],
        ["scenes", (e) => callbacksRef.current.onScenes?.(detail(e))],
        ["shadertransitionstate", (e) => callbacksRef.current.onShaderTransitionState?.(detail(e))],
        ["ratechange", () => callbacksRef.current.onRateChange?.()],
        ["volumechange", () => callbacksRef.current.onVolumeChange?.()],
      ];
      for (const [type, listener] of listeners) el.addEventListener(type, listener);
      return () => {
        for (const [type, listener] of listeners) el.removeEventListener(type, listener);
      };
    }, []);

    // Attributes are synced imperatively rather than through JSX: React 18 and
    // 19 disagree on how JSX props map to custom-element attributes (booleans
    // especially), and the player treats boolean attributes as presence-based.
    const {
      src,
      srcdoc,
      audioSrc,
      width,
      height,
      controls,
      muted,
      audioLocked,
      volume,
      poster,
      playbackRate,
      autoPlay,
      loop,
      shaderCaptureScale,
      shaderLoading,
    } = props;
    useLayoutEffect(() => {
      const el = elementRef.current;
      if (!el) return;
      syncAttribute(el, "src", src);
      syncAttribute(el, "srcdoc", srcdoc);
      syncAttribute(el, "audio-src", audioSrc);
      syncAttribute(el, "width", width);
      syncAttribute(el, "height", height);
      syncBooleanAttribute(el, "controls", controls);
      syncBooleanAttribute(el, "muted", muted);
      syncBooleanAttribute(el, "audio-locked", audioLocked);
      syncAttribute(el, "volume", volume);
      syncAttribute(el, "poster", poster);
      syncAttribute(el, "playback-rate", playbackRate);
      syncBooleanAttribute(el, "autoplay", autoPlay);
      syncBooleanAttribute(el, "loop", loop);
      syncAttribute(el, "shader-capture-scale", shaderCaptureScale);
      syncAttribute(el, "shader-loading", shaderLoading);
    }, [
      src,
      srcdoc,
      audioSrc,
      width,
      height,
      controls,
      muted,
      audioLocked,
      volume,
      poster,
      playbackRate,
      autoPlay,
      loop,
      shaderCaptureScale,
      shaderLoading,
    ]);

    return createElement("hyperframes-player", {
      ref: elementRef,
      class: props.className,
      style: props.style,
    });
  },
);
