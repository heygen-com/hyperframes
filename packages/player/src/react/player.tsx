import type {
  ColorGradingCompareState,
  ColorGradingTarget,
  HyperframesPlayer as HyperframesPlayerElement,
} from "../hyperframes-player.js";
import type { ShaderLoadingMode } from "../shader-options.js";
import { renderPlayerShadowDomHtml } from "../ssr.js";
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

/**
 * `useLayoutEffect` warns under React 18 server rendering ("useLayoutEffect
 * does nothing on the server"). Effects never run during SSR either way, so
 * substituting `useEffect` on the server is behavior-identical and silences
 * the warning. Exported for the node-environment SSR test.
 */
export const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export type PlayerScene = { id: string; start: number; duration: number };

export type PlayerAudioOwner = "runtime" | "parent";

export type PlayerRuntimeProtocolErrorCode =
  | "unsupported_protocol_version"
  | "invalid_protocol_metadata";

/** Host attributes forwarded verbatim to the `<hyperframes-player>` element. */
export type PlayerElementProps = Omit<React.HTMLAttributes<HTMLElement>, "className" | "style"> & {
  [dataAttribute: `data-${string}`]: string | number | undefined;
};

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
  /**
   * Additional host attributes (`id`, `role`, `tabIndex`, `title`, `aria-*`,
   * `data-*`, DOM event handlers…) forwarded to the element. Player-owned
   * attributes must go through their dedicated props above — values here are
   * passed to React verbatim, so prefer strings for custom attributes to keep
   * React 18 and 19 attribute serialization identical.
   */
  elementProps?: PlayerElementProps;
  /**
   * Server-render the player's shadow DOM as a Declarative Shadow DOM
   * template. The browser parses it during HTML streaming, so the composition
   * iframe starts loading — and paints its first frame — before any client
   * JavaScript runs; on upgrade the element adopts that DOM instead of
   * rebuilding it. The template is emitted only during server rendering (the
   * browser consumes it while parsing, so hydration sees no child either way).
   */
  ssr?: boolean;
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
  /** The composition runtime speaks an incompatible protocol version. */
  onRuntimeProtocolError?: (detail: {
    code: PlayerRuntimeProtocolErrorCode;
    receivedVersion: unknown;
  }) => void;
  /** Audio playback moved between the iframe runtime and parent-frame proxies. */
  onAudioOwnershipChange?: (detail: { owner: PlayerAudioOwner; reason: string }) => void;
  /** A parent-frame media proxy failed to play (e.g. autoplay rejection). */
  onPlaybackError?: (detail: { source: string; error: unknown }) => void;
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
  | "onRuntimeProtocolError"
  | "onAudioOwnershipChange"
  | "onPlaybackError"
>;

/**
 * Every event the `<hyperframes-player>` element dispatches, mapped to its
 * callback prop. The event-surface contract test asserts this map covers every
 * `dispatchEvent` site in the player sources — extend BOTH when the element
 * gains an event, or that test fails the build.
 */
export const PLAYER_EVENT_CALLBACKS = {
  ready: "onReady",
  play: "onPlay",
  pause: "onPause",
  timeupdate: "onTimeUpdate",
  ended: "onEnded",
  error: "onError",
  scenes: "onScenes",
  shadertransitionstate: "onShaderTransitionState",
  ratechange: "onRateChange",
  volumechange: "onVolumeChange",
  runtimeprotocolerror: "onRuntimeProtocolError",
  audioownershipchange: "onAudioOwnershipChange",
  playbackerror: "onPlaybackError",
} as const satisfies Record<string, keyof PlayerCallbacks>;

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

    // EFFECT ORDER MATTERS. Layout effects run in declaration order, and the
    // element dispatches events synchronously while attributes are applied
    // (e.g. `ratechange` from attributeChangedCallback). The sequence must be:
    //   1. refresh the callbacks ref (every commit),
    //   2. bind event listeners (mount),
    //   3. sync attributes (which may fire those listeners).

    // Latest-callback ref, updated in a layout effect rather than during
    // render so an interrupted/discarded render can't publish callbacks that
    // never committed.
    const callbacksRef = useRef<PlayerCallbacks>({});
    useIsomorphicLayoutEffect(() => {
      callbacksRef.current = props;
    });

    // Forward player events to the callback props. Listeners read the latest
    // callbacks through callbacksRef so this binds once, before the attribute
    // sync below can make the element dispatch anything.
    useIsomorphicLayoutEffect(() => {
      const el = elementRef.current;
      if (!el) return;
      const listeners = Object.entries(PLAYER_EVENT_CALLBACKS).map(
        ([type, prop]): [string, EventListener] => [
          type,
          (event) => {
            const callback = callbacksRef.current[prop] as ((detail?: unknown) => void) | undefined;
            callback?.((event as CustomEvent<unknown>).detail);
          },
        ],
      );
      for (const [type, listener] of listeners) el.addEventListener(type, listener);
      return () => {
        for (const [type, listener] of listeners) el.removeEventListener(type, listener);
      };
    }, []);

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
    // Attributes are synced imperatively rather than through JSX: React 18 and
    // 19 disagree on how JSX props map to custom-element attributes (booleans
    // especially), and the player treats boolean attributes as presence-based.
    useIsomorphicLayoutEffect(() => {
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
      // autoplay and loop are deliberately NOT in the element's
      // observedAttributes — it reads them on demand via hasAttribute()
      // (autoplay at readiness, loop at "ended"). Plain attribute writes are
      // the correct integration; do not migrate these to property sets.
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

    // Declarative shadow DOM template, server render only. The browser parses
    // it into the shadow root during HTML streaming and removes it from the
    // light DOM, so client hydration — which renders no child — still matches.
    const serverTemplate =
      props.ssr && typeof window === "undefined"
        ? createElement("template", {
            shadowrootmode: "open",
            dangerouslySetInnerHTML: {
              __html: renderPlayerShadowDomHtml({
                src,
                poster,
                width,
                height,
                shaderCaptureScale,
                shaderLoading,
              }),
            },
          } as unknown as React.HTMLAttributes<HTMLTemplateElement>)
        : null;

    // elementProps spreads first so the binding-owned keys below always win.
    return createElement(
      "hyperframes-player",
      {
        ...props.elementProps,
        ref: elementRef,
        class: props.className,
        style: props.style,
        // With ssr, string attributes go into the markup itself (identical on
        // client renders, so hydration stays clean) — crawlers see them and
        // the upgrade replay recognizes the declarative iframe's src.
        ...(props.ssr ? { src, poster, width, height } : null),
      },
      serverTemplate,
    );
  },
);
