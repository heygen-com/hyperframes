// fallow-ignore-file code-duplication complexity
import { installRuntimeControlBridge, postRuntimeMessage } from "./bridge";
import { initRuntimeAnalytics, emitAnalyticsEvent } from "./analytics";
import { injectCompositionCssVariables } from "./getVariables";
import { createCssAdapter } from "./adapters/css";
import { createGsapAdapter } from "./adapters/gsap";
import { createAnimeJsAdapter } from "./adapters/animejs";
import { createLottieAdapter } from "./adapters/lottie";
import { createThreeAdapter } from "./adapters/three";
import { createMapboxAdapter } from "./adapters/mapbox";
import { createLeafletAdapter } from "./adapters/leaflet";
import { createGoogleMapsAdapter } from "./adapters/google-maps";
import { createMaplibreAdapter } from "./adapters/maplibre";
import { createD3Adapter } from "./adapters/d3";
import { createTypegpuAdapter } from "./adapters/typegpu";
import {
  patchVideoTextureCompat,
  patchWebGLVideoTextureCompat,
} from "./adapters/video-texture-compat";
import { forceDispatchSeekEvent } from "./adapters/seek-dispatch";
import { createWaapiAdapter } from "./adapters/waapi";
import { refreshRuntimeMediaCache, syncRuntimeMedia } from "./media";
import { probeAndCacheElementVolume, type VolumeKeyframe } from "./mediaVolumeEnvelope.js";
import { createPickerModule } from "./picker";
import { createRuntimePlayer } from "./player";
import { createRuntimeState } from "./state";
import { collectRuntimeTimelinePayload } from "./timeline";
import { createRuntimeStartTimeResolver } from "./startResolver";
import { createClipTree } from "./clipTree";
import { loadExternalCompositions, loadInlineTemplateCompositions } from "./compositionLoader";
import { applyCaptionOverrides } from "./captionOverrides";
import { applyPositionEdits, installPositionEditsSeekReapply } from "./positionEdits";
import { applyVariableBindings } from "./applyVariableBindings";
import { createColorGradingRuntime, type RuntimeColorGradingApi } from "./colorGrading";
import { TransportClock } from "./clock";
import { WebAudioTransport } from "./webAudioTransport";
import { quantizeTimeToFrame } from "../inline-scripts/parityContract";
import { STUDIO_MANUAL_EDIT_GESTURE_ATTR } from "../studio-api/helpers/draftMarkers";
import type {
  RuntimeDeterministicAdapter,
  RuntimeJson,
  RuntimeSeekOptions,
  RuntimeTimelineLike,
} from "./types";
import type { PlayerAPI } from "../core.types";
import { swallow } from "./diagnostics";
import { shouldAttemptPeriodicTimelineBind } from "./timelineRebindPolicy";

const AUTHORED_DURATION_ATTR = "data-hf-authored-duration";
const AUTHORED_END_ATTR = "data-hf-authored-end";

type ExportRenderFpsResolution = {
  fps: number | null;
  source: "render-options" | "default" | "unknown";
  rawFpsSource: unknown;
  rawFps: unknown;
  fallbackReason?: "missing" | "invalid";
};

function resolveExportRenderFps(): ExportRenderFpsResolution {
  const config = window.__HF_EXPORT_RENDER_SEEK_CONFIG;
  const rawFps = config?.fps;
  const rawFpsSource = config?.fpsSource;
  const fps = Number(rawFps);
  if (!config || rawFps == null) {
    return { fps: null, source: "default", rawFpsSource, rawFps, fallbackReason: "missing" };
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    return { fps: null, source: "default", rawFpsSource, rawFps, fallbackReason: "invalid" };
  }
  const source =
    rawFpsSource === "render-options" || rawFpsSource === "default" ? rawFpsSource : "unknown";
  return {
    fps,
    source,
    rawFpsSource,
    rawFps,
    fallbackReason: config.fpsFallbackReason,
  };
}

export function initSandboxRuntimeModular(): void {
  const state = createRuntimeState();
  // SDK moveElement edits must render even when no usable GSAP timeline ever
  // binds (CSS/WAAPI-animated or fully static compositions) — apply at init.
  // This runs at DOMContentLoaded, after inline composition scripts have
  // parsed their tweens, so GSAP (when present) won't fold the translate.
  // Re-applied on every timeline bind for the rebind/soft-reload paths.
  applyPositionEdits(document);
  // Declarative variable bindings (data-var-src / data-var-text / --{id} CSS
  // custom props) — values are fixed for the page's lifetime, so applying
  // once at init keeps renders deterministic and seeks safe.
  applyVariableBindings(document);
  const exportRenderFps = resolveExportRenderFps();
  state.canonicalFps = exportRenderFps.fps ?? state.canonicalFps;
  if (window.__HF_EXPORT_RENDER_SEEK_CONFIG) {
    console.info("[hyperframes] render runtime fps", {
      canonicalFps: state.canonicalFps,
      source: exportRenderFps.source,
      rawFpsSource: exportRenderFps.rawFpsSource,
      rawFps: exportRenderFps.rawFps,
      fallbackReason: exportRenderFps.fallbackReason,
    });
  }
  let colorGradingRuntime: RuntimeColorGradingApi | null = null;
  let runtimeErrorListener: ((event: ErrorEvent) => void) | null = null;
  let runtimeUnhandledRejectionListener: ((event: PromiseRejectionEvent) => void) | null = null;
  const runtimeCleanupCallbacks: Array<() => void> = [];
  const postedDiagnosticKeys = new Set<string>();
  let rootStageDiagnosticRafId: number | null = null;
  if (typeof window.__hfRuntimeTeardown === "function") {
    try {
      window.__hfRuntimeTeardown();
    } catch (err) {
      // keep runtime resilient across reinits
      swallow("runtime.init.site1", err);
    }
  }
  // `_auto` is a Studio-internal keyframe marker (an auto-tracked endpoint the
  // parser reads back), NOT an animatable property. Register it as a no-op GSAP
  // plugin so GSAP doesn't log "Invalid property _auto" on every tween build —
  // that per-frame warning destabilizes the preview and makes the selection
  // overlay stop tracking the pointer. Idempotent + best-effort.
  const ensureAutoMarkerNoop = (): void => {
    const g = window.gsap as { registerPlugin?: (plugin: unknown) => void } | undefined;
    const w = window as Window & { __hfAutoNoopRegistered?: boolean };
    if (!g?.registerPlugin || w.__hfAutoNoopRegistered) return;
    try {
      g.registerPlugin({ name: "_auto", init: () => false });
      w.__hfAutoNoopRegistered = true;
    } catch {
      // a stray warning is preferable to a broken runtime
    }
  };
  ensureAutoMarkerNoop();
  // Normalize html/body so browser defaults (8px margin, white background) never
  // bleed into renders as white bars. Runs in both preview and render contexts,
  // eliminating the preview/render parity gap that existed when only the React
  // component's normalizePreviewViewport call applied this normalization.
  if (document.documentElement) {
    document.documentElement.style.margin = "0";
    document.documentElement.style.padding = "0";
    document.documentElement.style.overflow = "hidden";
  }
  if (document.body) {
    document.body.style.margin = "0";
    document.body.style.padding = "0";
    document.body.style.overflow = "hidden";
  }

  // figma brand-token chain: define declared composition variables as CSS
  // custom properties so imported var(--slug, literal) fills resolve from the
  // live variable instead of always falling back to the frozen literal.
  try {
    injectCompositionCssVariables(document);
  } catch (err) {
    swallow("runtime.init.cssVariables", err);
  }

  window.__timelines = window.__timelines || {};

  // Resolve the root composition element with the same priority the rest of
  // the runtime uses (explicit `data-root` marker first, then the topmost
  // non-nested composition, then first in DOM order). Defined here so the
  // array-normalization + data-start defaults below pick the same root the
  // closure-based `resolveRootCompositionElement` does on multi-comp pages.
  const findRootCompositionEl = (): HTMLElement | null => {
    const explicitRoot = document.querySelector('[data-composition-id][data-root="true"]');
    if (explicitRoot instanceof HTMLElement) return explicitRoot;
    const nodes = Array.from(document.querySelectorAll("[data-composition-id]")) as HTMLElement[];
    return (
      nodes.find((node) => !node.parentElement?.closest("[data-composition-id]")) ??
      nodes[0] ??
      null
    );
  };

  // Agents often write `window.__timelines = [tl]` (array) instead of the
  // keyed-by-composition-id object the runtime expects. Normalize at init so
  // the rest of the pipeline can assume a Record<string, timeline>.
  if (Array.isArray(window.__timelines)) {
    const arr = window.__timelines as unknown[];
    const rootId = findRootCompositionEl()?.getAttribute("data-composition-id") ?? "root";
    const normalized: Record<string, unknown> = {};
    if (arr.length === 1) {
      normalized[rootId] = arr[0];
    } else {
      for (let i = 0; i < arr.length; i++) normalized[`tl-${i}`] = arr[i];
    }
    (window as unknown as Record<string, unknown>).__timelines = normalized;
  }

  // Agents sometimes omit data-start on the root composition element. The
  // runtime skips timed-visibility for elements without it, making clips
  // invisible and timelines non-seekable. Default to 0 for the root.
  const rootComp = findRootCompositionEl();
  if (rootComp && !rootComp.hasAttribute("data-start")) {
    rootComp.setAttribute("data-start", "0");
  }

  const registerRuntimeCleanup = (callback: () => void) => {
    runtimeCleanupCallbacks.push(callback);
  };
  const postRuntimeDiagnosticOnce = (
    code: string,
    details: Record<string, RuntimeJson>,
    dedupeKey?: string,
  ) => {
    const key = dedupeKey ?? `${code}:${JSON.stringify(details)}`;
    if (postedDiagnosticKeys.has(key)) {
      return;
    }
    postedDiagnosticKeys.add(key);
    postRuntimeMessage({
      source: "hf-preview",
      type: "diagnostic",
      code,
      details,
    });
  };
  const createPlayerApiCompat = (basePlayer: {
    _timeline: RuntimeTimelineLike | null;
    play: () => void;
    pause: () => void;
    seek: (timeSeconds: number, options?: { keepPlaying?: boolean }) => void;
    getTime: () => number;
    getDuration: () => number;
    isPlaying: () => boolean;
    renderSeek: (timeSeconds: number, options?: RuntimeSeekOptions) => void;
  }): PlayerAPI => {
    const defaultStageZoom: ReturnType<PlayerAPI["getStageZoom"]> = {
      scale: 1,
      focusX: 960,
      focusY: 540,
    };
    const emptyStageZoomKeyframes: ReturnType<PlayerAPI["getStageZoomKeyframes"]> = [];
    const emptyVisibleElements: ReturnType<PlayerAPI["getVisibleElements"]> = [];
    const defaultRenderState: ReturnType<PlayerAPI["getRenderState"]> = {
      time: basePlayer.getTime(),
      duration: basePlayer.getDuration(),
      isPlaying: basePlayer.isPlaying(),
      renderMode: false,
      timelineDirty: false,
    };
    return {
      play: basePlayer.play,
      pause: basePlayer.pause,
      seek: basePlayer.seek,
      getTime: basePlayer.getTime,
      getDuration: basePlayer.getDuration,
      isPlaying: basePlayer.isPlaying,
      getMainTimeline: () => null,
      getElementBounds: () => {},
      getElementsAtPoint: () => {},
      setElementPosition: () => {},
      previewElementPosition: () => {},
      setElementKeyframes: () => {},
      setElementScale: () => {},
      setElementFontSize: () => {},
      setElementTextContent: () => {},
      setElementTextColor: () => {},
      setElementTextShadow: () => {},
      setElementTextFontWeight: () => {},
      setElementTextFontFamily: () => {},
      setElementTextOutline: () => {},
      setElementTextHighlight: () => {},
      setElementVolume: () => {},
      setStageZoom: () => {},
      getStageZoom: () => defaultStageZoom,
      setStageZoomKeyframes: () => {},
      getStageZoomKeyframes: () => emptyStageZoomKeyframes,
      addElement: () => false,
      removeElement: () => false,
      updateElementTiming: () => false,
      setElementTiming: () => {},
      updateElementSrc: () => false,
      updateElementLayer: () => false,
      updateElementBasePosition: () => false,
      markTimelineDirty: () => {},
      isTimelineDirty: () => false,
      rebuildTimeline: () => {},
      ensureTimeline: () => {},
      enableRenderMode: () => {},
      disableRenderMode: () => {},
      renderSeek: basePlayer.renderSeek,
      getElementVisibility: () => ({ visible: false }),
      getVisibleElements: () => emptyVisibleElements,
      getRenderState: () => ({
        ...defaultRenderState,
        time: basePlayer.getTime(),
        duration: basePlayer.getDuration(),
        isPlaying: basePlayer.isPlaying(),
      }),
    };
  };

  const MIN_VALID_TIMELINE_DURATION_SECONDS = 1 / 60;
  const TIMELINE_FLOOR_COVERAGE_RATIO = 0.75;
  const METADATA_REBIND_MIN_DURATION_GAIN_SECONDS = 0.05;
  const METADATA_REBIND_DEBOUNCE_MS = 100;
  const MAX_DIAGNOSTIC_MESSAGE_LENGTH = 240;

  const normalizeDiagnosticMessage = (value: unknown): string => {
    if (value instanceof Error) {
      return value.message || String(value);
    }
    if (typeof value === "string") {
      return value;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value ?? "");
    }
  };

  const classifyRuntimeScriptFailure = (
    rawMessage: string,
  ): {
    code: string;
    category: string;
  } => {
    const message = rawMessage.toLowerCase();
    if (
      message.includes("cannot read properties of null") ||
      message.includes("cannot set properties of null")
    ) {
      return { code: "runtime_null_dom_access", category: "dom-null-access" };
    }
    if (message.includes("failed to execute 'queryselector'")) {
      return { code: "runtime_invalid_selector", category: "selector-invalid" };
    }
    if (message.includes("is not defined")) {
      return { code: "runtime_reference_missing", category: "reference-missing" };
    }
    return { code: "runtime_script_error", category: "script-error" };
  };

  const parseDimensionPx = (value: string | null): string | null => {
    if (value == null || value.trim() === "") return null;
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return `${parsed}px`;
  };

  const resolveRootCompositionElement = (): HTMLElement | null => findRootCompositionEl();

  const applyCompositionSizing = () => {
    const rootEl = resolveRootCompositionElement();
    if (!rootEl) return;
    const forcedWidth = parseDimensionPx(rootEl.getAttribute("data-width"));
    const forcedHeight = parseDimensionPx(rootEl.getAttribute("data-height"));
    if (forcedWidth) rootEl.style.width = forcedWidth;
    if (forcedHeight) rootEl.style.height = forcedHeight;
    if (forcedWidth) rootEl.style.setProperty("--comp-width", forcedWidth);
    if (forcedHeight) rootEl.style.setProperty("--comp-height", forcedHeight);
  };

  const sanitizeCompositionDurationAttributes = () => {
    const rootEl = resolveRootCompositionElement();
    const compositionNodes = Array.from(document.querySelectorAll("[data-composition-id]")).filter(
      (n) => n.hasAttribute("data-duration") || n.hasAttribute("data-end"),
    ) as HTMLElement[];
    for (const node of compositionNodes) {
      // Preserve explicit root duration so timeline payload can distinguish
      // authored finite duration from loop-inflated timeline duration.
      if (rootEl && node === rootEl) continue;
      // Preserve authored timing for reference-start resolution in Studio and
      // timeline payload generation. The runtime still strips the public attrs
      // so visibility/parity continues to derive from the live sub-timeline.
      const authoredDuration = node.getAttribute("data-duration");
      const authoredEnd = node.getAttribute("data-end");
      if (authoredDuration != null && !node.hasAttribute(AUTHORED_DURATION_ATTR)) {
        node.setAttribute(AUTHORED_DURATION_ATTR, authoredDuration);
      }
      if (authoredEnd != null && !node.hasAttribute(AUTHORED_END_ATTR)) {
        node.setAttribute(AUTHORED_END_ATTR, authoredEnd);
      }
      // Strip public timing attrs on non-root compositions after preserving
      // authored values privately. Runtime timing can still distinguish
      // authored host windows from live child timeline durations.
      node.removeAttribute("data-duration");
      node.removeAttribute("data-end");
    }
  };

  const applyClipLayout = () => {
    const rootEl = resolveRootCompositionElement();
    if (!rootEl) return;
    if (!rootEl.style.position) {
      rootEl.style.position = "relative";
    }
    rootEl.style.overflow = "hidden";
    const rootWidth = parseDimensionPx(rootEl.getAttribute("data-width"));
    const rootHeight = parseDimensionPx(rootEl.getAttribute("data-height"));
    if (rootWidth) rootEl.style.width = rootWidth;
    if (rootHeight) rootEl.style.height = rootHeight;
    const children = Array.from(rootEl.children) as HTMLElement[];
    for (const el of children) {
      const tag = el.tagName.toLowerCase();
      if (tag === "script" || tag === "style" || tag === "link" || tag === "meta") continue;
      if (!el.hasAttribute("data-start")) continue;
      // Runtime-stamped clips are NOT authored overlay clips. In Studio/preview
      // the runtime stamps `data-start` onto ID'd or GSAP-targeted flow children
      // (a <header>/<footer> in a flex column) so the design panel can discover
      // them — see the stamping pass in bindCapturedTimeline. Forcing those out
      // of document flow collapses the layout: the footer shrink-wraps and its
      // `justify-content: space-between` clusters in the top-left. Leave them in
      // flow so the preview matches the rendered video, which never stamps
      // (production renders run as the top-level page, not in an iframe).
      if (el.hasAttribute("data-hf-autostamped")) continue;
      const hasLegacyAnchoredDefaults =
        (el.style.top === "0px" || el.style.top === "0") &&
        (el.style.left === "0px" || el.style.left === "0") &&
        el.style.width === "100%" &&
        el.style.height === "100%";
      const hasCenteringTransform = /translate\(\s*-50%\s*,\s*-50%\s*\)/.test(el.style.transform);
      if (
        hasLegacyAnchoredDefaults &&
        hasCenteringTransform &&
        !el.hasAttribute("data-width") &&
        !el.hasAttribute("data-height")
      ) {
        const previousTop = el.style.top;
        const previousLeft = el.style.left;
        const previousWidth = el.style.width;
        const previousHeight = el.style.height;
        el.style.top = "";
        el.style.left = "";
        el.style.width = "";
        el.style.height = "";
        const clearedComputed = window.getComputedStyle(el);
        const cssProvidesClipLayout =
          clearedComputed.top !== "auto" ||
          clearedComputed.bottom !== "auto" ||
          clearedComputed.left !== "auto" ||
          clearedComputed.right !== "auto" ||
          clearedComputed.width !== "0px" ||
          clearedComputed.height !== "0px";
        if (!cssProvidesClipLayout) {
          el.style.top = previousTop;
          el.style.left = previousLeft;
          el.style.width = previousWidth;
          el.style.height = previousHeight;
        }
      }
      const computed = window.getComputedStyle(el);
      const computedPosition = computed.position;
      // Root-level timed clips should stack in the same viewport layer.
      // Relative positioning keeps clips in document flow and can push later
      // compositions below the viewport (eg. checkerboard-style overlays).
      const shouldForceAbsolute = computedPosition !== "absolute" && computedPosition !== "fixed";
      if (shouldForceAbsolute) {
        el.style.position = "absolute";
      }
      const hasExplicitVerticalAnchor =
        Boolean(el.style.top) ||
        Boolean(el.style.bottom) ||
        computed.top !== "auto" ||
        computed.bottom !== "auto";
      if (!hasExplicitVerticalAnchor) {
        el.style.top = "0";
      }
      const hasExplicitHorizontalAnchor =
        Boolean(el.style.left) ||
        Boolean(el.style.right) ||
        computed.left !== "auto" ||
        computed.right !== "auto";
      if (!hasExplicitHorizontalAnchor) {
        el.style.left = "0";
      }
      if (tag !== "audio") {
        const forcedWidth = parseDimensionPx(el.getAttribute("data-width"));
        const forcedHeight = parseDimensionPx(el.getAttribute("data-height"));
        const hasMeaningfulComputedWidth = computed.width !== "0px" && computed.width !== "auto";
        const hasMeaningfulComputedHeight = computed.height !== "0px" && computed.height !== "auto";
        if (forcedWidth) {
          if (!el.style.width && !hasMeaningfulComputedWidth) {
            el.style.width = forcedWidth;
          }
        } else if (!el.style.width && computed.width === "0px") {
          el.style.width = "100%";
        }
        if (forcedHeight) {
          if (!el.style.height && !hasMeaningfulComputedHeight) {
            el.style.height = forcedHeight;
          }
        } else if (!el.style.height && computed.height === "0px") {
          el.style.height = "100%";
        }
      }
    }
  };

  const resolveStartForElement = (
    element: Element,
    fallback = 0,
    opts?: { includeAuthoredTimingAttrs?: boolean },
  ): number => {
    const resolver = createRuntimeStartTimeResolver({
      timelineRegistry: (window.__timelines ?? {}) as Record<
        string,
        RuntimeTimelineLike | undefined
      >,
      includeAuthoredTimingAttrs: opts?.includeAuthoredTimingAttrs ?? true,
    });
    return resolver.resolveStartForElement(element, fallback);
  };

  const resolveDurationForElement = (
    element: Element,
    opts?: { includeAuthoredTimingAttrs?: boolean },
  ): number | null => {
    const resolver = createRuntimeStartTimeResolver({
      timelineRegistry: (window.__timelines ?? {}) as Record<
        string,
        RuntimeTimelineLike | undefined
      >,
      includeAuthoredTimingAttrs: opts?.includeAuthoredTimingAttrs ?? true,
    });
    return resolver.resolveDurationForElement(element);
  };

  const resolveMediaStartSeconds = (element: Element, fallback = 0): number => {
    if (!element.hasAttribute("data-hf-auto-start") && element.hasAttribute("data-start")) {
      // `data-start` is authored relative to the media element's OWN sub-
      // composition, not the root timeline — `fallback` carries the host
      // composition's resolved absolute start (see syncMediaForCurrentState's
      // inheritedStart), so it must be added, not discarded. Skipping it made
      // a nested video play from root t=0 instead of holding until its
      // parent scene began (issue #1838) — resolveStartForElement's own
      // absolute-expression branch already adds this same host offset, this
      // fast literal-value path just didn't.
      const own = Math.max(0, Number(element.getAttribute("data-start") ?? 0) || 0);
      return own + fallback;
    }
    return resolveStartForElement(element, fallback);
  };

  const isTimedElementVisibleAt = (rawNode: HTMLElement, currentTime: number): boolean => {
    const tag = rawNode.tagName.toLowerCase();
    if (tag === "script" || tag === "style" || tag === "link" || tag === "meta") {
      return false;
    }

    const start =
      tag === "video" || tag === "audio"
        ? resolveMediaStartSeconds(rawNode, 0)
        : resolveStartForElement(rawNode, 0);
    let duration = resolveDurationForElement(rawNode);
    const compId = rawNode.getAttribute("data-composition-id");
    if (compId) {
      const compTimeline = (window.__timelines ?? {})[compId];
      let liveDuration: number | null = null;
      if (compTimeline && typeof compTimeline.duration === "function") {
        const compDur = Number(compTimeline.duration());
        if (Number.isFinite(compDur) && compDur > 0) {
          liveDuration = compDur;
        }
      }

      const hasAuthoredTiming =
        rawNode.hasAttribute("data-duration") ||
        rawNode.hasAttribute("data-end") ||
        rawNode.hasAttribute(AUTHORED_DURATION_ATTR) ||
        rawNode.hasAttribute(AUTHORED_END_ATTR);

      if (!hasAuthoredTiming && (duration == null || duration <= 0) && liveDuration != null) {
        duration = liveDuration;
      }
    }
    const computedEnd =
      duration != null && duration > 0 ? start + duration : Number.POSITIVE_INFINITY;
    return (
      currentTime >= start && (Number.isFinite(computedEnd) ? currentTime <= computedEnd : true)
    );
  };

  const hasExternalCompositions = !!document.querySelector("[data-composition-src]");
  let hasInlineTemplateCompositions = false;
  {
    const candidates = document.querySelectorAll(
      "[data-composition-id]:not([data-composition-src])",
    );
    for (const el of candidates) {
      const cid = el.getAttribute("data-composition-id");
      if (
        cid &&
        el.children.length === 0 &&
        document.querySelector(`template#${CSS.escape(cid)}-template`)
      ) {
        hasInlineTemplateCompositions = true;
        break;
      }
    }
  }
  let externalCompositionsReady = !hasExternalCompositions && !hasInlineTemplateCompositions;

  const getTimelineDurationSeconds = (timeline: RuntimeTimelineLike | null): number | null => {
    if (!timeline || typeof timeline.duration !== "function") return null;
    try {
      const raw = Number(timeline.duration());
      if (!Number.isFinite(raw)) return null;
      return Math.max(0, raw);
    } catch {
      return null;
    }
  };

  const isUsableTimelineDuration = (durationSeconds: number | null): durationSeconds is number =>
    typeof durationSeconds === "number" &&
    Number.isFinite(durationSeconds) &&
    durationSeconds > MIN_VALID_TIMELINE_DURATION_SECONDS;

  type TimelineResolution = {
    timeline: RuntimeTimelineLike | null;
    selectedTimelineIds?: string[];
    selectedDurationSeconds?: number | null;
    mediaDurationFloorSeconds?: number | null;
    diagnostics?: {
      code: string;
      details: Record<string, string | number | boolean | null | string[]>;
    };
  };

  const resolveMediaElementDurationSeconds = (node: HTMLMediaElement): number | null => {
    const declaredDuration = Number(node.getAttribute("data-duration"));
    if (Number.isFinite(declaredDuration) && declaredDuration > 0) {
      return declaredDuration;
    }
    const playbackStart = Number(
      node.getAttribute("data-playback-start") ?? node.getAttribute("data-media-start") ?? "0",
    );
    const safePlaybackStart = Number.isFinite(playbackStart) ? Math.max(0, playbackStart) : 0;
    if (Number.isFinite(node.duration) && node.duration > safePlaybackStart) {
      return Math.max(0, node.duration - safePlaybackStart);
    }
    return null;
  };

  const resolveMediaWindowDurationSeconds = (): number | null => {
    const mediaNodes = Array.from(
      document.querySelectorAll("video[data-start], audio[data-start]"),
    ) as HTMLMediaElement[];
    if (mediaNodes.length === 0) return null;
    let maxWindowEndSeconds = 0;
    for (const node of mediaNodes) {
      const start = resolveMediaStartSeconds(node, 0);
      if (!Number.isFinite(start)) continue;
      const duration = resolveMediaElementDurationSeconds(node);
      if (duration == null || duration <= MIN_VALID_TIMELINE_DURATION_SECONDS) continue;
      maxWindowEndSeconds = Math.max(maxWindowEndSeconds, Math.max(0, start) + duration);
    }
    return maxWindowEndSeconds > MIN_VALID_TIMELINE_DURATION_SECONDS ? maxWindowEndSeconds : null;
  };

  const resolveAuthoredCompositionDurationFloorSeconds = (): number | null => {
    const rootEl = resolveRootCompositionElement();
    if (!rootEl) return null;
    const timelines = (window.__timelines ?? {}) as Record<string, RuntimeTimelineLike | undefined>;
    const startResolver = createRuntimeStartTimeResolver({
      timelineRegistry: timelines,
      includeAuthoredTimingAttrs: true,
    });
    let maxWindowEndSeconds = 0;
    // The root's own data-duration is the authored source of truth for
    // composition length. Without it in the floor, a GSAP timeline that ends
    // even slightly short of the declared duration shrinks the playable
    // window — and duration-gated consumers (e.g. the studio's adapter
    // selection) silently reject the runtime player, losing audio playback.
    const rootDeclaredSeconds = Number.parseFloat(rootEl.getAttribute("data-duration") ?? "");
    if (Number.isFinite(rootDeclaredSeconds) && rootDeclaredSeconds > 0) {
      maxWindowEndSeconds = rootDeclaredSeconds;
    }
    const compositionNodes = Array.from(
      rootEl.querySelectorAll("[data-composition-id][data-start]"),
    );
    for (const node of compositionNodes) {
      if (!(node instanceof Element)) continue;
      const parentComposition = node.parentElement?.closest("[data-composition-id]");
      if (parentComposition !== rootEl) continue;
      const start = startResolver.resolveStartForElement(node, 0);
      const duration = startResolver.resolveDurationForElement(node);
      if (!Number.isFinite(start) || duration == null || duration <= 0) continue;
      maxWindowEndSeconds = Math.max(maxWindowEndSeconds, Math.max(0, start) + duration);
    }
    return maxWindowEndSeconds > MIN_VALID_TIMELINE_DURATION_SECONDS ? maxWindowEndSeconds : null;
  };

  const resolveMediaDurationFloorSeconds = (): number | null => {
    const mediaWindowDuration = resolveMediaWindowDurationSeconds();
    if (
      typeof mediaWindowDuration !== "number" ||
      !Number.isFinite(mediaWindowDuration) ||
      mediaWindowDuration <= MIN_VALID_TIMELINE_DURATION_SECONDS
    ) {
      return null;
    }
    return mediaWindowDuration;
  };

  const resolveMinCandidateDurationSeconds = (mediaDurationFloorSeconds: number | null): number => {
    if (!isUsableTimelineDuration(mediaDurationFloorSeconds)) {
      return MIN_VALID_TIMELINE_DURATION_SECONDS;
    }
    return Math.max(
      MIN_VALID_TIMELINE_DURATION_SECONDS,
      mediaDurationFloorSeconds * TIMELINE_FLOOR_COVERAGE_RATIO,
    );
  };

  // Non-GSAP runtimes (CSS, WAAPI, Lottie) have no window.__timelines entry
  // and thus no authored source of truth for total duration. Adapters that
  // implement getInferredDurationSeconds() report the longest end time they
  // can discover from their own animations (see runtime/types.ts). Folding
  // that into the duration floor here — the same mechanism data-duration and
  // media windows already use — makes data-duration optional wherever the
  // runtime can figure the duration out on its own, instead of hard-failing
  // capture with "Composition has zero duration".
  const resolveAdapterDurationFloorSeconds = (): number | null => {
    let maxSeconds = 0;
    for (const adapter of state.deterministicAdapters) {
      const getter = adapter.getInferredDurationSeconds;
      if (typeof getter !== "function") continue;
      let inferred: number | null = null;
      try {
        inferred = getter();
      } catch (err) {
        swallow("runtime.init.adapterDuration", err);
      }
      if (typeof inferred === "number" && Number.isFinite(inferred) && inferred > 0) {
        maxSeconds = Math.max(maxSeconds, inferred);
      }
    }
    return maxSeconds > MIN_VALID_TIMELINE_DURATION_SECONDS ? maxSeconds : null;
  };

  const getSafeTimelineDurationSeconds = (
    timeline: RuntimeTimelineLike | null,
    fallback = 0,
  ): number => {
    const timelineDuration = getTimelineDurationSeconds(timeline);
    const mediaFloor = resolveMediaDurationFloorSeconds();
    const authoredCompositionFloor = resolveAuthoredCompositionDurationFloorSeconds();
    const adapterFloor = resolveAdapterDurationFloorSeconds();
    const durationFloor = Math.max(
      mediaFloor ?? 0,
      authoredCompositionFloor ?? 0,
      adapterFloor ?? 0,
    );
    const fallbackDuration =
      Number.isFinite(fallback) && fallback > MIN_VALID_TIMELINE_DURATION_SECONDS ? fallback : 0;
    let safeDuration = 0;
    // Timeline is the source of truth for authored composition duration.
    if (isUsableTimelineDuration(timelineDuration)) {
      safeDuration = Math.max(timelineDuration, durationFloor, fallbackDuration);
    } else if (isUsableTimelineDuration(durationFloor)) {
      safeDuration = Math.max(durationFloor, fallbackDuration);
    } else {
      safeDuration = fallbackDuration;
    }
    return safeDuration > 0 ? Math.max(0, safeDuration) : 0;
  };

  const resolveRootTimelineFromDocument = (): TimelineResolution => {
    const timelines = (window.__timelines ?? {}) as Record<string, RuntimeTimelineLike | undefined>;
    // DX fallback (#6): when the root timeline cannot be resolved by id but
    // EXACTLY ONE usable timeline is registered, bind it rather than silently
    // rendering the frozen t=0 DOM. Safe because with a single registered
    // timeline there is no ambiguity about which one is the composition's
    // root. Multiple registered → ambiguous, so we still return null and let
    // the loud warning fire.
    const resolveSoleTimelineFallback = (reason: string): TimelineResolution => {
      const usable = Object.entries(timelines).filter(
        (entry): entry is [string, RuntimeTimelineLike] =>
          !!entry[1] && typeof entry[1].play === "function" && typeof entry[1].pause === "function",
      );
      if (usable.length !== 1) return { timeline: null };
      const sole = usable[0];
      if (!sole) return { timeline: null };
      const [soleId, soleTimeline] = sole;
      return {
        timeline: soleTimeline,
        selectedTimelineIds: [soleId],
        selectedDurationSeconds: getTimelineDurationSeconds(soleTimeline),
        diagnostics: {
          code: "root_timeline_sole_registered_fallback",
          details: { reason, soleTimelineId: soleId },
        },
      };
    };
    const startResolver = createRuntimeStartTimeResolver({
      timelineRegistry: timelines,
      includeAuthoredTimingAttrs: true,
    });
    const mediaDurationFloorSeconds = resolveMediaDurationFloorSeconds();
    const authoredCompositionDurationFloorSeconds =
      resolveAuthoredCompositionDurationFloorSeconds();
    const durationFloorSeconds =
      Math.max(mediaDurationFloorSeconds ?? 0, authoredCompositionDurationFloorSeconds ?? 0) ||
      null;
    const minCandidateDurationSeconds = resolveMinCandidateDurationSeconds(durationFloorSeconds);
    const resolveCompositionStartSeconds = (compositionId: string): number => {
      const node = document.querySelector(
        `[data-composition-id="${CSS.escape(compositionId)}"]`,
      ) as Element | null;
      if (!node) return 0;
      return startResolver.resolveStartForElement(node, 0);
    };
    const createCompositeTimelineFromCandidates = (
      candidates: Array<{
        compositionId: string;
        timeline: RuntimeTimelineLike;
        durationSeconds: number;
      }>,
    ): RuntimeTimelineLike | null => {
      const gsapApi = window.gsap;
      if (!gsapApi || typeof gsapApi.timeline !== "function") return null;
      const compositeTimeline = gsapApi.timeline({ paused: true }) as RuntimeTimelineLike;
      for (const candidate of candidates) {
        compositeTimeline.add(
          candidate.timeline,
          resolveCompositionStartSeconds(candidate.compositionId),
        );
      }
      return compositeTimeline;
    };
    const createDurationFloorTimeline = (
      durationSeconds: number,
      existingRootTimeline: RuntimeTimelineLike | null,
    ): RuntimeTimelineLike | null => {
      if (!isUsableTimelineDuration(durationSeconds)) return null;
      const gsapApi = window.gsap;
      if (!gsapApi || typeof gsapApi.timeline !== "function") return null;
      const fallbackTimeline = gsapApi.timeline({ paused: true }) as RuntimeTimelineLike;
      if (existingRootTimeline) {
        try {
          fallbackTimeline.add(existingRootTimeline, 0);
        } catch (err) {
          // keep fallback resilient if root add fails
          swallow("runtime.init.site2", err);
        }
      }
      const withTween = fallbackTimeline as RuntimeTimelineLike & {
        to?: (target: object, vars: { duration?: number }) => unknown;
      };
      if (typeof withTween.to === "function") {
        try {
          withTween.to({}, { duration: durationSeconds });
        } catch (err) {
          // no-op; if tween creation fails, caller will discard by unusable duration
          swallow("runtime.init.site3", err);
        }
      }
      return fallbackTimeline;
    };
    const addMissingChildCandidatesToRootTimeline = (
      rootTimeline: RuntimeTimelineLike,
      candidates: Array<{
        compositionId: string;
        timeline: RuntimeTimelineLike;
        durationSeconds: number;
      }>,
    ): string[] => {
      const rootWithChildren = rootTimeline as RuntimeTimelineLike & {
        getChildren?: (...args: unknown[]) => unknown[];
      };
      if (typeof rootWithChildren.getChildren !== "function") return [];
      try {
        const existingChildren = rootWithChildren.getChildren(true, true, true) ?? [];
        if (!Array.isArray(existingChildren)) return [];
        const addedIds: string[] = [];
        for (const candidate of candidates) {
          const alreadyIncluded = existingChildren.some((child) => child === candidate.timeline);
          if (alreadyIncluded) continue;
          try {
            const startSec = resolveCompositionStartSeconds(candidate.compositionId);
            rootTimeline.add(candidate.timeline, startSec);
            addedIds.push(candidate.compositionId);
          } catch (err) {
            // ignore broken child add attempts
            swallow("runtime.init.site4", err);
          }
        }
        return addedIds;
      } catch {
        return [];
      }
    };
    const rootCompositionNode = resolveRootCompositionElement();
    const rootCompositionId = rootCompositionNode?.getAttribute("data-composition-id") ?? null;
    if (!rootCompositionId) {
      return resolveSoleTimelineFallback("root_missing_composition_id");
    }
    const rootTimeline = timelines[rootCompositionId] ?? null;
    const collectRootChildCandidates = (): Array<{
      compositionId: string;
      timeline: RuntimeTimelineLike;
      durationSeconds: number;
    }> => {
      if (!rootCompositionNode) return [];
      const seen = new Set<string>();
      const childNodes = Array.from(rootCompositionNode.querySelectorAll("[data-composition-id]"));
      const candidates: Array<{
        compositionId: string;
        timeline: RuntimeTimelineLike;
        durationSeconds: number;
      }> = [];
      for (const childNode of childNodes) {
        const childId = childNode.getAttribute("data-composition-id");
        if (!childId || childId === rootCompositionId) continue;
        if (seen.has(childId)) continue;
        seen.add(childId);
        const candidateTimeline = timelines[childId] ?? null;
        if (!candidateTimeline) continue;
        if (
          typeof candidateTimeline.play !== "function" ||
          typeof candidateTimeline.pause !== "function"
        ) {
          continue;
        }
        const candidateDuration = getTimelineDurationSeconds(candidateTimeline);
        candidates.push({
          compositionId: childId,
          timeline: candidateTimeline,
          durationSeconds: candidateDuration ?? 0,
        });
      }
      return candidates;
    };
    const rootChildCandidates = collectRootChildCandidates();
    const ensureChildCandidatesActive = (
      candidates: Array<{
        compositionId: string;
        timeline: RuntimeTimelineLike;
        durationSeconds: number;
      }>,
    ): void => {
      for (const candidate of candidates) {
        const timelineWithPaused = candidate.timeline as RuntimeTimelineLike & {
          paused?: (value?: boolean) => unknown;
        };
        if (typeof timelineWithPaused.paused !== "function") continue;
        try {
          timelineWithPaused.paused(false);
        } catch (err) {
          // keep runtime resilient against timeline API quirks
          swallow("runtime.init.site5", err);
        }
      }
    };
    if (rootChildCandidates.length > 0) {
      ensureChildCandidatesActive(rootChildCandidates);
    }
    if (rootTimeline) {
      const autoNestedChildren =
        rootChildCandidates.length > 0
          ? addMissingChildCandidatesToRootTimeline(rootTimeline, rootChildCandidates)
          : [];
      // Mark children as bound so the polling loop stops re-resolving
      if (
        rootChildCandidates.length > 0 ||
        !document.querySelector(
          "[data-composition-id]:not([data-composition-id='" + rootCompositionId + "'])",
        )
      ) {
        childrenBound = true;
      }

      // Force GSAP to render the current frame so child animations show their correct state.
      // Without this, children added after the root was created may still show initial styles.
      if (autoNestedChildren.length > 0) {
        try {
          const currentTime = rootTimeline.time();
          rootTimeline.seek(currentTime, false); // false = don't suppress events
        } catch {
          /* ignore */
        }
      }
      const rootDurationSeconds = getTimelineDurationSeconds(rootTimeline);
      if (!isUsableTimelineDuration(rootDurationSeconds) && rootChildCandidates.length > 0) {
        const selectedTimelineIds = rootChildCandidates.map((candidate) => candidate.compositionId);
        const compositeTimeline = createCompositeTimelineFromCandidates(rootChildCandidates);
        const compositeDurationSeconds = getTimelineDurationSeconds(compositeTimeline);
        if (compositeTimeline && isUsableTimelineDuration(compositeDurationSeconds)) {
          return {
            timeline: compositeTimeline,
            selectedTimelineIds,
            selectedDurationSeconds: compositeDurationSeconds,
            mediaDurationFloorSeconds,
            diagnostics: {
              code: "root_timeline_unusable_fallback",
              details: {
                rootCompositionId,
                rootDurationSeconds,
                fallbackKind: "composite_by_root_children",
                minCandidateDurationSeconds,
                selectedDurationSeconds: compositeDurationSeconds,
                mediaDurationFloorSeconds,
                authoredCompositionDurationFloorSeconds,
                selectedTimelineIds,
                autoNestedChildren,
              },
            },
          };
        }
        const durationFloorTimeline = createDurationFloorTimeline(
          durationFloorSeconds ?? 0,
          rootTimeline,
        );
        const floorTimelineDurationSeconds = getTimelineDurationSeconds(durationFloorTimeline);
        if (durationFloorTimeline && isUsableTimelineDuration(floorTimelineDurationSeconds)) {
          return {
            timeline: durationFloorTimeline,
            selectedTimelineIds: [rootCompositionId],
            selectedDurationSeconds: floorTimelineDurationSeconds,
            mediaDurationFloorSeconds,
            diagnostics: {
              code: "root_timeline_unusable_media_floor_fallback",
              details: {
                rootCompositionId,
                rootDurationSeconds,
                fallbackKind: "media_duration_floor",
                mediaDurationFloorSeconds,
                authoredCompositionDurationFloorSeconds,
                selectedDurationSeconds: floorTimelineDurationSeconds,
                selectedTimelineIds: [rootCompositionId],
                autoNestedChildren,
              },
            },
          };
        }
      }
      if (!isUsableTimelineDuration(rootDurationSeconds) && rootChildCandidates.length === 0) {
        const durationFloorTimeline = createDurationFloorTimeline(
          durationFloorSeconds ?? 0,
          rootTimeline,
        );
        const floorTimelineDurationSeconds = getTimelineDurationSeconds(durationFloorTimeline);
        if (durationFloorTimeline && isUsableTimelineDuration(floorTimelineDurationSeconds)) {
          return {
            timeline: durationFloorTimeline,
            selectedTimelineIds: [rootCompositionId],
            selectedDurationSeconds: floorTimelineDurationSeconds,
            mediaDurationFloorSeconds,
            diagnostics: {
              code: "root_timeline_unusable_media_floor_fallback",
              details: {
                rootCompositionId,
                rootDurationSeconds,
                fallbackKind: "media_duration_floor",
                mediaDurationFloorSeconds,
                authoredCompositionDurationFloorSeconds,
                selectedDurationSeconds: floorTimelineDurationSeconds,
                selectedTimelineIds: [rootCompositionId],
              },
            },
          };
        }
      }
      // If the authored composition schedule meaningfully exceeds the captured
      // GSAP timeline, extend the timeline in-place with a zero-duration no-op
      // tween. Studio previews can inline only part of the timeline registry
      // while preserving the full host schedule in data-hf-authored-duration.
      const rootDeclaredDurAttr = rootCompositionNode?.getAttribute("data-duration");
      const rootDeclaredDur = rootDeclaredDurAttr ? parseFloat(rootDeclaredDurAttr) : null;
      const rootDurationFloorSeconds = Math.max(
        isUsableTimelineDuration(rootDeclaredDur) ? rootDeclaredDur : 0,
        authoredCompositionDurationFloorSeconds ?? 0,
      );
      if (rootDurationFloorSeconds > 0) {
        if (
          isUsableTimelineDuration(rootDurationFloorSeconds) &&
          isUsableTimelineDuration(rootDurationSeconds) &&
          // Only pad when the gap is meaningful (>= 0.5s) to avoid floating-point
          // false positives on compositions whose GSAP duration is already close
          // to data-duration.
          rootDurationFloorSeconds >= rootDurationSeconds + 0.5
        ) {
          const tlWithTo = rootTimeline as RuntimeTimelineLike & {
            to?: (target: object, vars: { duration: number }, position: number) => unknown;
          };
          if (typeof tlWithTo.to === "function") {
            try {
              // Placing a zero-duration tween at the floor extends
              // timeline.duration() to exactly that point.
              tlWithTo.to({}, { duration: 0 }, rootDurationFloorSeconds);
            } catch (err) {
              // keep runtime resilient
              swallow("runtime.init.site6", err);
            }
          }
          const newDur = getTimelineDurationSeconds(rootTimeline);
          if (isUsableTimelineDuration(newDur)) {
            return {
              timeline: rootTimeline,
              selectedTimelineIds: [rootCompositionId],
              selectedDurationSeconds: newDur,
              mediaDurationFloorSeconds,
              diagnostics: {
                code: "root_timeline_padded_to_declared_duration",
                details: {
                  rootCompositionId,
                  rootDurationSeconds,
                  rootDeclaredDur,
                  authoredCompositionDurationFloorSeconds,
                  newDur,
                },
              },
            };
          }
        }
      }
      return {
        timeline: rootTimeline,
        selectedTimelineIds: [rootCompositionId],
        selectedDurationSeconds: rootDurationSeconds,
        mediaDurationFloorSeconds,
        diagnostics:
          autoNestedChildren.length > 0
            ? {
                code: "root_timeline_auto_nested_children",
                details: {
                  rootCompositionId,
                  selectedDurationSeconds: rootDurationSeconds,
                  autoNestedChildren,
                },
              }
            : undefined,
      };
    }
    if (rootChildCandidates.length > 0) {
      const selectedTimelineIds = rootChildCandidates.map((candidate) => candidate.compositionId);
      const compositeTimeline = createCompositeTimelineFromCandidates(rootChildCandidates);
      const compositeDurationSeconds = getTimelineDurationSeconds(compositeTimeline);
      if (compositeTimeline) {
        return {
          timeline: compositeTimeline,
          selectedTimelineIds,
          selectedDurationSeconds: compositeDurationSeconds,
          mediaDurationFloorSeconds,
          diagnostics: {
            code: "root_timeline_missing_fallback",
            details: {
              rootCompositionId,
              fallbackKind: "composite_by_root_children",
              minCandidateDurationSeconds,
              selectedDurationSeconds: compositeDurationSeconds,
              mediaDurationFloorSeconds,
              selectedTimelineIds,
            },
          },
        };
      }
    }
    return resolveSoleTimelineFallback("root_composition_id_unmatched_in_registry");
  };

  // Track whether child composition timelines have been added to the root.
  // This prevents the polling loop from skipping rebind when TARGET_DURATION
  // makes the root "usable" before children register. Assumption: child scripts
  // must register timelines synchronously or in the immediate microtask queue
  // (setTimeout(0)). Scripts using requestAnimationFrame or longer delays may
  // not be discovered.
  let childrenBound = false;
  // fallow-ignore-next-line complexity
  const bindRootTimelineIfAvailable = (): boolean => {
    if (!externalCompositionsReady) return false;
    const currentTimeline = state.capturedTimeline;
    const currentDuration = getTimelineDurationSeconds(currentTimeline);
    const currentTimelineUsable = isUsableTimelineDuration(currentDuration);
    // Skip rebind ONLY if we already have a usable timeline AND children have been bound.
    // Without childrenBound check, the TARGET_DURATION spacer makes the timeline "usable"
    // before child composition timelines are added, causing them to never be discovered.
    if (currentTimeline && currentTimelineUsable && childrenBound) return false;
    const resolution = resolveRootTimelineFromDocument();
    if (!resolution.timeline) return false;
    if (currentTimeline && currentTimeline === resolution.timeline) {
      if (typeof currentTimeline.timeScale === "function") {
        currentTimeline.timeScale(state.playbackRate);
      }
      return false;
    }
    state.capturedTimeline = resolution.timeline;
    if (typeof state.capturedTimeline.timeScale === "function") {
      state.capturedTimeline.timeScale(state.playbackRate);
    }
    const boundDuration = getSafeTimelineDurationSeconds(state.capturedTimeline, 0);
    if (boundDuration <= 0) {
      // No resolvable duration (e.g. a set()-only timeline, or one whose
      // duration isn't known yet). Kick GSAP off the creation position so the
      // set() renders. For a finite-but-zero timeline progress(1) === progress(0);
      // for an infinite-repeat timeline this lands on the first iteration's end
      // frame, which is the best we can do without a known cycle length.
      if (typeof state.capturedTimeline.progress === "function") {
        state.capturedTimeline.progress(1, true);
        state.capturedTimeline.progress(0, false);
        state.capturedTimeline.pause();
      }
    }
    if (boundDuration > 0) {
      try {
        clock.setDuration(boundDuration);
      } catch {
        // clock not yet initialized — duration will be set during TransportClock setup
      }

      if (typeof state.capturedTimeline.totalTime === "function") {
        // GSAP won't render tl.set() at position 0 when the paused timeline
        // starts there — play/pause/seek/totalTime are all no-ops at the
        // creation position. Force the set to render by cycling progress past
        // 0 (when the timeline implements it), then seek to the prior playhead
        // (state.currentTime) so a rebind after a user scrub or soft-reload
        // restore doesn't snap back to 0.
        if (typeof state.capturedTimeline.progress === "function") {
          state.capturedTimeline.progress(0.0001, true);
        }
        const seekTime = Math.max(0, state.currentTime || 0);
        state.capturedTimeline.totalTime(seekTime, false);
        state.capturedTimeline.pause();
      }

      // GSAP bakes the CSS `translate` into style.transform on seek.
      // The Studio seek wrapper (installStudioManualEditSeekReapply) calls
      // reapplyPositionEditsAfterSeek to un-bake it. Call the apply hook
      // directly here as well, since the wrapper may not be installed yet
      // during initial rebind (timing race on first load / soft reload).
      const applyFn = (window as unknown as Record<string, unknown>).__hfStudioManualEditsApply;
      if (typeof applyFn === "function") applyFn();

      // SDK moveElement edits (data-hf-edit-base-x/y markers) render as a
      // CSS translate delta. Must run after the timeline is bound so GSAP has
      // already parsed the elements — a translate present at first parse gets
      // folded into the cached transform and lost per-axis on seek.
      applyPositionEdits(document);
    }
    if (resolution.diagnostics) {
      postRuntimeMessage({
        source: "hf-preview",
        type: "diagnostic",
        code: resolution.diagnostics.code,
        details: resolution.diagnostics.details,
      });
    }
    postRuntimeMessage({
      source: "hf-preview",
      type: "diagnostic",
      code: "timeline_bound",
      details: {
        selectedTimelineIds: resolution.selectedTimelineIds ?? [],
        selectedDurationSeconds: resolution.selectedDurationSeconds ?? null,
        mediaDurationFloorSeconds: resolution.mediaDurationFloorSeconds ?? null,
      },
    });
    // Stamp data-start / data-duration on GSAP-targeted elements that lack
    // them so the Studio timeline can discover individual animated elements.
    // Only when embedded in an iframe (Studio preview) — production renders
    // run as the top-level page and must not mutate element timing.
    if (window.parent !== window) {
      const rootComp = resolveRootCompositionElement();
      const rootDuration = boundDuration > 0 ? boundDuration : 0;
      const dur = String(rootDuration > 0 ? rootDuration : 1);
      const seen = new Set<Element>();

      // Only an AUTHORED clip (data-start already in the source, captured before
      // we stamp anything) should suppress stamping its descendants. An animated
      // scene container we auto-stamp below (e.g. an opacity-crossfaded scene)
      // must NOT suppress its own animated children — otherwise those children
      // never become timeline clips and that scene can't inline-expand.
      const authoredTimed = new Set<Element>(document.querySelectorAll("[data-start]"));
      const hasAuthoredTimedAncestor = (element: HTMLElement): boolean => {
        let node = element.parentElement;
        while (node && node !== rootComp) {
          if (authoredTimed.has(node)) return true;
          node = node.parentElement;
        }
        return false;
      };

      // Stamp GSAP-targeted elements
      if (state.capturedTimeline.getChildren) {
        try {
          for (const child of state.capturedTimeline.getChildren(true)) {
            if (typeof child.targets !== "function") continue;
            for (const target of child.targets()) {
              if (!(target instanceof HTMLElement)) continue;
              if (target === rootComp) continue;
              if (target.hasAttribute("data-start")) continue;
              if (hasAuthoredTimedAncestor(target)) continue;
              if (seen.has(target)) continue;
              seen.add(target);
              target.setAttribute("data-start", "0");
              target.setAttribute("data-duration", dur);
              // Mark as runtime-stamped so applyClipLayout leaves it in document
              // flow instead of treating it as an authored overlay clip.
              target.setAttribute("data-hf-autostamped", "1");
            }
          }
        } catch {
          /* timeline access guard */
        }
      }

      // Stamp all ID'd children of the composition root so they appear
      // in the timeline even without animations. Enables selecting and
      // adding animations from the design panel on a blank canvas.
      if (rootComp instanceof HTMLElement) {
        for (const el of rootComp.querySelectorAll("[id]")) {
          if (!(el instanceof HTMLElement)) continue;
          if (el === rootComp) continue;
          if (el.hasAttribute("data-start")) continue;
          if (hasAuthoredTimedAncestor(el)) continue;
          if (seen.has(el)) continue;
          if (el.tagName === "SCRIPT" || el.tagName === "STYLE" || el.tagName === "LINK") continue;
          seen.add(el);
          el.setAttribute("data-start", "0");
          el.setAttribute("data-duration", dur);
          // Mark as runtime-stamped so applyClipLayout leaves it in document
          // flow instead of treating it as an authored overlay clip.
          el.setAttribute("data-hf-autostamped", "1");
        }
      }
    }

    // (Re-)probe all already-bound media elements against the new timeline.
    // Clear the cache first so elements probed against a prior timeline get fresh keyframes.
    for (const el of metadataBoundMedia) {
      volumeKeyframeCache.delete(el);
      probeAndCacheVolumeKeyframes(el);
    }
    return true;
  };

  (window as Window & { __hfForceTimelineRebind?: () => void }).__hfForceTimelineRebind = () => {
    childrenBound = false;
    bindRootTimelineIfAvailable();
  };

  const emitRootStageLayoutDiagnostics = () => {
    const rootNode = resolveRootCompositionElement();
    if (!(rootNode instanceof HTMLElement)) {
      return;
    }
    const rect = rootNode.getBoundingClientRect();
    const declaredWidth = Number(rootNode.getAttribute("data-width"));
    const declaredHeight = Number(rootNode.getAttribute("data-height"));
    const computedStyle = window.getComputedStyle(rootNode);
    const hasDeclaredDimensions =
      Number.isFinite(declaredWidth) &&
      declaredWidth > 0 &&
      Number.isFinite(declaredHeight) &&
      declaredHeight > 0;
    const looksCollapsed =
      rect.width <= 0 ||
      rect.height <= 0 ||
      rootNode.clientWidth <= 0 ||
      rootNode.clientHeight <= 0;
    if (!hasDeclaredDimensions || !looksCollapsed) {
      return;
    }
    postRuntimeDiagnosticOnce(
      "root_stage_layout_zero",
      {
        compositionId: rootNode.getAttribute("data-composition-id") ?? null,
        declaredWidth,
        declaredHeight,
        rectWidth: Math.round(rect.width),
        rectHeight: Math.round(rect.height),
        clientWidth: rootNode.clientWidth,
        clientHeight: rootNode.clientHeight,
        display: computedStyle.display,
        visibility: computedStyle.visibility,
        overflow: computedStyle.overflow,
      },
      `root-stage-layout-zero:${rootNode.getAttribute("data-composition-id") ?? "unknown"}`,
    );
  };

  const scheduleRootStageLayoutDiagnostics = () => {
    if (state.tornDown) {
      return;
    }
    if (rootStageDiagnosticRafId != null) {
      window.cancelAnimationFrame(rootStageDiagnosticRafId);
    }
    rootStageDiagnosticRafId = window.requestAnimationFrame(() => {
      rootStageDiagnosticRafId = null;
      emitRootStageLayoutDiagnostics();
    });
  };

  const installRuntimeErrorDiagnostics = () => {
    runtimeErrorListener = (event: ErrorEvent) => {
      const normalized = normalizeDiagnosticMessage(event.error ?? event.message).slice(
        0,
        MAX_DIAGNOSTIC_MESSAGE_LENGTH,
      );
      if (!normalized) {
        return;
      }
      const classified = classifyRuntimeScriptFailure(normalized);
      postRuntimeMessage({
        source: "hf-preview",
        type: "diagnostic",
        code: classified.code,
        details: {
          category: classified.category,
          message: normalized,
          filename: event.filename || null,
          line: Number.isFinite(event.lineno) ? event.lineno : null,
          column: Number.isFinite(event.colno) ? event.colno : null,
        },
      });
    };
    runtimeUnhandledRejectionListener = (event: PromiseRejectionEvent) => {
      const normalized = normalizeDiagnosticMessage(event.reason).slice(
        0,
        MAX_DIAGNOSTIC_MESSAGE_LENGTH,
      );
      if (!normalized) {
        return;
      }
      const classified = classifyRuntimeScriptFailure(normalized);
      postRuntimeMessage({
        source: "hf-preview",
        type: "diagnostic",
        code: `${classified.code}_unhandled_rejection`,
        details: {
          category: `${classified.category}-unhandled-rejection`,
          message: normalized,
        },
      });
    };
    window.addEventListener("error", runtimeErrorListener);
    window.addEventListener("unhandledrejection", runtimeUnhandledRejectionListener);
  };

  const installAssetFailureDiagnostics = () => {
    const assetNodes = Array.from(
      document.querySelectorAll("img, video, audio, source, link[rel='stylesheet']"),
    );
    for (const node of assetNodes) {
      const onError = () => {
        if (!(node instanceof Element)) {
          return;
        }
        const tagName = node.tagName.toLowerCase();
        const assetUrl =
          node.getAttribute("src") ??
          node.getAttribute("href") ??
          node.getAttribute("poster") ??
          null;
        const diagnosticCode =
          tagName === "link" ? "runtime_stylesheet_load_failed" : "runtime_asset_load_failed";
        postRuntimeDiagnosticOnce(
          diagnosticCode,
          {
            tagName,
            assetUrl,
            currentSrc:
              node instanceof HTMLImageElement || node instanceof HTMLMediaElement
                ? node.currentSrc || null
                : null,
            readyState: node instanceof HTMLMediaElement ? node.readyState : null,
            networkState: node instanceof HTMLMediaElement ? node.networkState : null,
          },
          `${diagnosticCode}:${tagName}:${assetUrl ?? "unknown"}`,
        );
      };
      node.addEventListener("error", onError);
      registerRuntimeCleanup(() => {
        node.removeEventListener("error", onError);
      });
    }

    const fontSet = document.fonts;
    if (!fontSet) {
      return;
    }
    void fontSet.ready
      .then(() => {
        if (state.tornDown) {
          return;
        }
        const failedFamilies = Array.from(fontSet)
          .filter((face) => face.status === "error")
          .map((face) => face.family)
          .filter((family) => Boolean(family))
          .slice(0, 10);
        if (failedFamilies.length === 0) {
          return;
        }
        postRuntimeDiagnosticOnce(
          "runtime_font_load_issue",
          {
            failedFamilies,
            totalFaces: Array.from(fontSet).length,
          },
          `runtime-font-load-issue:${failedFamilies.join("|")}`,
        );
      })
      .catch(() => {
        // ignore font readiness failures
      });
  };

  const rebindTimelineFromResolution = (
    resolution: TimelineResolution,
    reason: "loop_guard" | "manual",
  ): boolean => {
    if (!resolution.timeline) return false;
    const previousTimeline = state.capturedTimeline;
    if (previousTimeline && previousTimeline === resolution.timeline) {
      return false;
    }
    const previousTime = Math.max(0, state.currentTime || 0);
    const wasPlaying = state.isPlaying;
    state.capturedTimeline = resolution.timeline;
    if (typeof state.capturedTimeline.timeScale === "function") {
      state.capturedTimeline.timeScale(state.playbackRate);
    }
    try {
      state.capturedTimeline.pause();
      state.capturedTimeline.seek(previousTime, false);
      if (wasPlaying) {
        state.capturedTimeline.play();
      }
    } catch (err) {
      // keep runtime resilient even if a timeline implementation throws
      swallow("runtime.init.site7", err);
    }
    postRuntimeMessage({
      source: "hf-preview",
      type: "diagnostic",
      code: "timeline_loop_guard_rebind",
      details: {
        reason,
        previousTime,
        selectedTimelineIds: resolution.selectedTimelineIds ?? [],
        selectedDurationSeconds: resolution.selectedDurationSeconds ?? null,
        mediaDurationFloorSeconds: resolution.mediaDurationFloorSeconds ?? null,
      },
    });
    return true;
  };

  let metadataRebindDebounceTimerId: number | null = null;
  let metadataRebindApplied = false;
  const metadataBoundMedia = new Set<HTMLMediaElement>();
  const volumeKeyframeCache = new WeakMap<HTMLMediaElement, VolumeKeyframe[]>();

  const scheduleMetadataDurationHydration = () => {
    if (state.tornDown) return;
    if (metadataRebindDebounceTimerId != null) {
      window.clearTimeout(metadataRebindDebounceTimerId);
    }
    metadataRebindDebounceTimerId = window.setTimeout(() => {
      if (state.tornDown) return;
      metadataRebindDebounceTimerId = null;
      const resolution = resolveRootTimelineFromDocument();
      if (!resolution.timeline) return;
      const hasResolvedMediaFloor = isUsableTimelineDuration(
        resolution.mediaDurationFloorSeconds ?? null,
      );
      if (!hasResolvedMediaFloor) return;
      if (!state.capturedTimeline) {
        if (bindRootTimelineIfAvailable()) {
          postTimeline();
          postState(true);
        }
        return;
      }
      if (metadataRebindApplied) return;
      const currentDuration = getTimelineDurationSeconds(state.capturedTimeline);
      const nextDuration =
        resolution.selectedDurationSeconds ?? getTimelineDurationSeconds(resolution.timeline);
      const isBetterCandidate =
        isUsableTimelineDuration(nextDuration) &&
        (!isUsableTimelineDuration(currentDuration) ||
          nextDuration >= currentDuration + METADATA_REBIND_MIN_DURATION_GAIN_SECONDS);
      if (!isBetterCandidate) return;
      if (rebindTimelineFromResolution(resolution, "manual")) {
        metadataRebindApplied = true;
        postRuntimeMessage({
          source: "hf-preview",
          type: "diagnostic",
          code: "timeline_rebind_after_media_metadata",
          details: {
            previousDurationSeconds: currentDuration ?? null,
            selectedDurationSeconds: nextDuration ?? null,
            selectedTimelineIds: resolution.selectedTimelineIds ?? [],
            mediaDurationFloorSeconds: resolution.mediaDurationFloorSeconds ?? null,
          },
        });
        postTimeline();
        postState(true);
      }
    }, METADATA_REBIND_DEBOUNCE_MS);
  };

  const unbindMediaMetadataListeners = () => {
    for (const mediaEl of metadataBoundMedia) {
      mediaEl.removeEventListener("loadedmetadata", scheduleMetadataDurationHydration);
      mediaEl.removeEventListener("durationchange", scheduleMetadataDurationHydration);
    }
    metadataBoundMedia.clear();
  };

  const bindMediaMetadataListeners = () => {
    if (state.tornDown) return;
    const mediaEls = Array.from(document.querySelectorAll("video, audio")) as HTMLMediaElement[];
    for (const mediaEl of mediaEls) {
      if (metadataBoundMedia.has(mediaEl)) continue;
      metadataBoundMedia.add(mediaEl);
      const parsedVolume = Number.parseFloat(mediaEl.dataset.volume ?? "");
      if (Number.isFinite(parsedVolume)) {
        mediaEl.volume = Math.max(0, Math.min(1, parsedVolume));
      }
      mediaEl.addEventListener("loadedmetadata", scheduleMetadataDurationHydration);
      mediaEl.addEventListener("durationchange", scheduleMetadataDurationHydration);

      // Eagerly preload media data so audio/video is buffered before the user
      // clicks play. Without this, the first play() call fires on un-fetched
      // media, producing silence or choppy audio until the browser caches it.
      if (mediaEl.preload !== "auto") {
        mediaEl.preload = "auto";
      }
      if (mediaEl.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
        mediaEl.load();
      }

      // Probe volume automation from the GSAP timeline — same approach as the
      // renderer (see discoverAudioVolumeAutomationFromTimeline / audioMixer).
      // Runs only when the timeline is already captured; elements bound before
      // the timeline is ready are re-probed the first time bindMediaMetadataListeners
      // fires after the timeline has been captured (every 30 transport ticks).
      probeAndCacheVolumeKeyframes(mediaEl);
    }
  };

  const probeAndCacheVolumeKeyframes = (mediaEl: HTMLMediaElement) => {
    if (volumeKeyframeCache.has(mediaEl)) return;
    probeAndCacheElementVolume(
      mediaEl,
      state.capturedTimeline,
      getSafeTimelineDurationSeconds(state.capturedTimeline, 0),
      volumeKeyframeCache,
    );
  };

  // fallow-ignore-next-line complexity
  // Whether a timed clip participates in normal flow (static/relative/sticky).
  // In-flow clips must leave the flow when hidden — `visibility:hidden` reserves
  // their layout box, so a split sibling would stack below the active half
  // instead of overlapping it. Positioned clips keep `visibility:hidden` (cheaper,
  // and avoids disturbing absolute media playback). Computed once per element.
  let timedClipInFlow = new WeakMap<Element, boolean>();
  const isTimedClipInFlow = (el: HTMLElement): boolean => {
    const cached = timedClipInFlow.get(el);
    if (cached !== undefined) return cached;
    const pos = window.getComputedStyle(el).position;
    const inFlow = pos === "static" || pos === "relative" || pos === "sticky";
    timedClipInFlow.set(el, inFlow);
    return inFlow;
  };

  // `display:none` is only safe on a LEAF timed clip (no nested timed clips). On a
  // container it removes the whole subtree, hiding descendants that are still inside
  // their OWN visibility window — e.g. an in-flow composition root whose window
  // clamps to the timeline end would black out a child video that should still
  // show. `visibility:hidden` doesn't have this problem (a child can override it
  // with `visibility:visible`), so containers keep that and only leaves leave-flow.
  let timedClipIsLeaf = new WeakMap<Element, boolean>();
  const isTimedClipLeaf = (el: HTMLElement): boolean => {
    const cached = timedClipIsLeaf.get(el);
    if (cached !== undefined) return cached;
    const leaf = el.querySelector("[data-start]") === null;
    timedClipIsLeaf.set(el, leaf);
    return leaf;
  };

  // Both caches key on live DOM facts that change when the timed-element set
  // changes: leaf status flips when a clip gains/loses a nested `[data-start]`
  // descendant (sub-composition load/unload, studio insert/delete), and a swapped
  // element can reuse an identity whose in-flow status differs. WeakMap has no
  // `clear()`, so drop both maps wholesale — re-derived lazily on next access.
  const invalidateTimedClipCaches = () => {
    timedClipInFlow = new WeakMap<Element, boolean>();
    timedClipIsLeaf = new WeakMap<Element, boolean>();
  };
  const dataHiddenDisplayRestores = new WeakMap<HTMLElement, string>();
  const dataHiddenDisplayNodes = new WeakSet<HTMLElement>();

  const syncMediaForCurrentState = () => {
    const resolveMediaCompositionContext = (element: HTMLVideoElement | HTMLAudioElement) => {
      const compositionRoot = element.closest("[data-composition-id]");
      const inheritedStart = compositionRoot ? resolveStartForElement(compositionRoot, 0) : null;
      // Media sync follows the authored host window, matching visibility for
      // authored composition hosts. Live child timeline duration only fills in
      // when no authored timing exists, so seeks clamp against host clip timing.
      const inheritedDuration = compositionRoot
        ? resolveDurationForElement(compositionRoot, { includeAuthoredTimingAttrs: true })
        : null;
      return { compositionRoot, inheritedStart, inheritedDuration };
    };
    const cache = refreshRuntimeMediaCache({
      shouldIncludeElement: (element) =>
        element.hasAttribute("data-start") ||
        Boolean(resolveMediaCompositionContext(element).compositionRoot),
      resolveStartSeconds: (element) => {
        const context = resolveMediaCompositionContext(
          element as HTMLVideoElement | HTMLAudioElement,
        );
        return resolveMediaStartSeconds(element, context.inheritedStart ?? 0);
      },
      resolveDurationSeconds: (element) => {
        const context = resolveMediaCompositionContext(element);
        const start = resolveMediaStartSeconds(element, context.inheritedStart ?? 0);
        const mediaStart =
          Number.parseFloat(element.dataset.playbackStart ?? element.dataset.mediaStart ?? "0") ||
          0;
        const hostRemaining =
          context.inheritedStart != null &&
          context.inheritedDuration != null &&
          context.inheritedDuration > 0
            ? Math.max(0, context.inheritedStart + context.inheritedDuration - start)
            : null;
        const sourceDuration =
          Number.isFinite(element.duration) && element.duration > mediaStart
            ? Math.max(0, element.duration - mediaStart)
            : null;
        // The element's own data-duration is an explicit clip-length trim
        // (the studio writes it when you drag the clip edge). It must bound
        // playback so a trimmed track stops at its edge instead of running on
        // to the source-file or host-composition end. Absent → no cap (an
        // untrimmed clip plays its natural source length).
        const ownDuration = Number.parseFloat(element.dataset.duration ?? "");
        const explicitDuration =
          Number.isFinite(ownDuration) && ownDuration > 0 ? ownDuration : null;
        const candidates = [sourceDuration, hostRemaining, explicitDuration].filter(
          (value): value is number => value != null,
        );
        return candidates.length > 0 ? Math.min(...candidates) : null;
      },
    });
    // Attach probed volume keyframes to clips so syncRuntimeMedia can use the
    // same envelope the renderer uses instead of tracking GSAP-change diffs.
    for (const clip of cache.mediaClips) {
      const kf = volumeKeyframeCache.get(clip.el as HTMLMediaElement);
      if (kf) clip.volumeKeyframes = kf;
    }

    const forceSync = state.mediaForceSyncNextTick;
    if (forceSync) state.mediaForceSyncNextTick = false;
    if (!state.nativeMediaSyncDisabled) {
      syncRuntimeMedia({
        clips: cache.mediaClips,
        timeSeconds: state.currentTime,
        playing: state.isPlaying,
        playbackRate: state.playbackRate,
        outputMuted:
          state.mediaOutputMuted ||
          (!state.webAudioMediaDisabled && !state.nativeMediaSyncDisabled && webAudio.isActive()),
        userMuted: state.bridgeMuted,
        userVolume: state.bridgeVolume,
        forceSync,
        onElementVolume: (el, volume) => webAudio.setElementVolume(el, volume),
        isWebAudioOwned: (el) => webAudio.ownsElement(el),
        onAutoplayBlocked: () => {
          if (state.mediaAutoplayBlockedPosted) return;
          state.mediaAutoplayBlockedPosted = true;
          postRuntimeMessage({ source: "hf-preview", type: "media-autoplay-blocked" });
        },
      });
    }
    const visibilityNodes = Array.from(document.querySelectorAll("[data-start]"));
    const rootComp = resolveRootCompositionElement();
    for (const rawNode of visibilityNodes) {
      if (!(rawNode instanceof HTMLElement)) continue;

      if (rawNode.hasAttribute("data-hidden")) {
        if (!dataHiddenDisplayNodes.has(rawNode)) {
          dataHiddenDisplayRestores.set(rawNode, rawNode.style.getPropertyValue("display"));
          dataHiddenDisplayNodes.add(rawNode);
        }
        rawNode.style.display = "none";
        if (rawNode instanceof HTMLVideoElement || rawNode instanceof HTMLImageElement) {
          colorGradingRuntime?.setSourceVisibility(rawNode, false);
        }
        continue;
      }

      if (dataHiddenDisplayNodes.has(rawNode)) {
        const previousDisplay = dataHiddenDisplayRestores.get(rawNode);
        if (previousDisplay) {
          rawNode.style.display = previousDisplay;
        } else {
          rawNode.style.removeProperty("display");
        }
        dataHiddenDisplayRestores.delete(rawNode);
        dataHiddenDisplayNodes.delete(rawNode);
      }

      let isVisibleNow = isTimedElementVisibleAt(rawNode, state.currentTime);
      // Descendants must not override a hidden ancestor clip. CSS visibility can
      // otherwise leak child pixels through inactive scenes because a descendant
      // with visibility:visible escapes an ancestor's visibility:hidden.
      if (isVisibleNow) {
        let ancestor = rawNode.parentElement;
        while (ancestor) {
          if (ancestor === rootComp) break;
          if (ancestor instanceof HTMLElement && ancestor.hasAttribute("data-start")) {
            if (!isTimedElementVisibleAt(ancestor, state.currentTime)) {
              isVisibleNow = false;
              break;
            }
          }
          ancestor = ancestor.parentElement;
        }
      }
      rawNode.style.visibility = isVisibleNow ? "visible" : "hidden";
      if (rawNode instanceof HTMLVideoElement || rawNode instanceof HTMLImageElement) {
        colorGradingRuntime?.setSourceVisibility(rawNode, isVisibleNow);
      }
      if (isVisibleNow) {
        if (isTimedClipInFlow(rawNode)) rawNode.style.removeProperty("display");
      } else if (isTimedClipInFlow(rawNode) && isTimedClipLeaf(rawNode)) {
        rawNode.style.display = "none";
      }
    }
  };

  const postState = (force: boolean) => {
    const frame = Math.max(0, Math.round((state.currentTime || 0) * state.canonicalFps));
    const now = Date.now();
    const shouldPost =
      force ||
      frame !== state.bridgeLastPostedFrame ||
      state.isPlaying !== state.bridgeLastPostedPlaying ||
      state.bridgeMuted !== state.bridgeLastPostedMuted ||
      now - state.bridgeLastPostedAt >= state.bridgeMaxPostIntervalMs;
    if (!shouldPost) return;
    state.bridgeLastPostedFrame = frame;
    state.bridgeLastPostedPlaying = state.isPlaying;
    state.bridgeLastPostedMuted = state.bridgeMuted;
    state.bridgeLastPostedAt = now;
    postRuntimeMessage({
      source: "hf-preview",
      type: "state",
      frame,
      isPlaying: state.isPlaying,
      muted: state.bridgeMuted,
      playbackRate: state.playbackRate,
    });
  };

  // Signature the live __clipTree was built from; rebuild only when the set of
  // timed elements changes (e.g. a sub-composition finishes loading), not every
  // transport tick. A plain count misses same-count swaps (one sub-comp unloads
  // as another loads), so the signature keys on id+tag in document order.
  let clipTreeSignature = "";
  let liveRootDurationOverrideSeconds = 0;
  const computeClipTreeSignature = (): string => {
    let sig = "";
    for (const el of document.querySelectorAll("[data-start]")) {
      sig += `${el.id}:${el.tagName}|`;
    }
    return sig;
  };
  const postTimeline = () => {
    sanitizeCompositionDurationAttributes();
    applyCompositionSizing();
    applyClipLayout();
    // Post resolved stage size so the parent can scale the iframe container
    const stageSizeRootEl = resolveRootCompositionElement();
    if (stageSizeRootEl) {
      const w = parseDimensionPx(stageSizeRootEl.getAttribute("data-width"));
      const h = parseDimensionPx(stageSizeRootEl.getAttribute("data-height"));
      const width = w ? parseInt(w, 10) : 0;
      const height = h ? parseInt(h, 10) : 0;
      if (width > 0 && height > 0) {
        postRuntimeMessage({ source: "hf-preview", type: "stage-size", width, height });
      }
    }
    bindRootTimelineIfAvailable();
    const payload = collectRuntimeTimelinePayload({
      canonicalFps: state.canonicalFps,
    });
    window.__clipManifest = payload;

    const currentSignature = computeClipTreeSignature();
    if (clipTreeSignature !== currentSignature) {
      // The timed-element set changed — leaf/in-flow caches may be stale.
      invalidateTimedClipCaches();
    }
    if (!window.__clipTree || clipTreeSignature !== currentSignature) {
      const runtimeWindow = window as Window & {
        __timelines?: Record<string, RuntimeTimelineLike | undefined>;
      };
      window.__clipTree = createClipTree({
        startResolver: createRuntimeStartTimeResolver({
          timelineRegistry: runtimeWindow.__timelines ?? {},
          includeAuthoredTimingAttrs: true,
        }),
        timelineRegistry: runtimeWindow.__timelines ?? {},
        rootDuration: payload.durationInFrames / state.canonicalFps,
      });
      clipTreeSignature = currentSignature;
    }

    postRuntimeMessage(payload);
    scheduleRootStageLayoutDiagnostics();
  };

  const finitePositiveDuration = (value: number): number =>
    Number.isFinite(value) && value > 0 ? value : 0;

  const growRootDurationLive = (durationSeconds: number) => {
    const nextDuration = finitePositiveDuration(Number(durationSeconds));
    if (nextDuration <= 0) return;
    const rootEl = resolveRootCompositionElement();
    const rootAttrDuration = finitePositiveDuration(
      Number.parseFloat(rootEl?.getAttribute("data-duration") ?? ""),
    );
    const currentDuration = Math.max(
      liveRootDurationOverrideSeconds,
      finitePositiveDuration(clock.getDuration()),
      rootAttrDuration,
    );
    if (nextDuration <= currentDuration) return;

    liveRootDurationOverrideSeconds = nextDuration;
    rootEl?.setAttribute("data-duration", String(nextDuration));
    clock.setDuration(nextDuration);
    postTimeline();
    postState(true);
  };

  const runAdapters = (method: "discover" | "pause" | "play", timeSeconds = 0) => {
    for (const adapter of state.deterministicAdapters) {
      try {
        if (method === "discover") adapter.discover();
        if (method === "pause") adapter.pause();
        if (method === "play" && adapter.play) adapter.play();
      } catch (err) {
        // keep runtime resilient against adapter-specific failures
        swallow("runtime.init.site8", err);
      }
      if (method === "discover") {
        try {
          adapter.seek({ time: timeSeconds, suppressEvents: true });
        } catch (err) {
          // ignore seek bootstrap failures
          swallow("runtime.init.site9", err);
        }
      }
    }
  };

  let maybePublishRenderReady = () => {
    window.__renderReady = false;
  };
  // Internal adapter-readiness tracking. Adapters with outstanding async work
  // (Three.js `DefaultLoadingManager`, future fetch/font/image detectors) expose
  // a `getReadyPromise()` method; the runtime waits for whatever they return
  // before publishing render-ready. This is purely internal — there is no
  // authored-code-facing flag (LLMs should not need to know about render
  // readiness, the framework handles async asset gating automatically).
  let trackedAdapterReadyPromise: PromiseLike<unknown> | null = null;
  let trackedAdapterReadySettled = true;

  const collectAdapterReadyPromises = (): PromiseLike<unknown>[] => {
    const promises: PromiseLike<unknown>[] = [];
    for (const adapter of state.deterministicAdapters) {
      const getter = adapter.getReadyPromise;
      if (typeof getter !== "function") continue;
      try {
        const p = getter();
        if (p) promises.push(p);
      } catch (err) {
        // A throwing readiness gate must not permanently block render; swallow
        // and continue, matching the rest of the runtime's adapter-resilience
        // pattern.
        swallow("runtime.init.adapterReady", err);
      }
    }
    return promises;
  };

  const isAdapterReadinessSettled = (): boolean => {
    const promises = collectAdapterReadyPromises();
    if (promises.length === 0) {
      trackedAdapterReadyPromise = null;
      trackedAdapterReadySettled = true;
      return true;
    }
    // Combine multiple adapter promises so we only attach a single resume
    // handler. Identity is stable as long as the inputs are stable (each
    // adapter is expected to return the same promise on repeat calls while
    // its work is in flight).
    const firstPromise = promises[0];
    if (!firstPromise) return true;
    const combined: PromiseLike<unknown> =
      promises.length === 1 ? firstPromise : Promise.all(promises);
    if (combined !== trackedAdapterReadyPromise) {
      trackedAdapterReadyPromise = combined;
      trackedAdapterReadySettled = false;
      void Promise.resolve(combined).then(
        () => {
          if (trackedAdapterReadyPromise !== combined) return;
          trackedAdapterReadySettled = true;
          maybePublishRenderReady();
        },
        (err) => {
          if (trackedAdapterReadyPromise !== combined) return;
          trackedAdapterReadySettled = true;
          swallow("runtime.init.adapterReady", err);
          maybePublishRenderReady();
        },
      );
    }
    return trackedAdapterReadySettled;
  };

  if (!externalCompositionsReady) {
    const compositionLoaderParams = {
      injectedStyles: state.injectedCompStyles,
      injectedScripts: state.injectedCompScripts,
      parseDimensionPx,
      onDiagnostic: ({
        code,
        details,
      }: {
        code: string;
        details: Record<string, string | number | boolean | null | string[]>;
      }) => {
        postRuntimeMessage({
          source: "hf-preview",
          type: "diagnostic",
          code,
          details,
        });
      },
    };
    void loadExternalCompositions(compositionLoaderParams)
      .then(() => loadInlineTemplateCompositions(compositionLoaderParams))
      .finally(() => {
        externalCompositionsReady = true;
        bindMediaMetadataListeners();
        installAssetFailureDiagnostics();
        applyCaptionOverrides();
        // Runtime-loaded sub-compositions (and their per-instance scoped
        // values) don't exist at the init-time binding pass — re-apply so
        // data-var-* / --{id} bindings inside them resolve. Idempotent.
        applyVariableBindings(document);
        maybePublishRenderReady();
      });
  } else {
    // No external/inline compositions to load — apply caption overrides immediately
    applyCaptionOverrides();
  }

  const picker = createPickerModule({
    postMessage: (payload) => postRuntimeMessage(payload),
  });
  picker.installPickerApi();

  const colorGrading = createColorGradingRuntime();
  colorGradingRuntime = colorGrading;
  registerRuntimeCleanup(() => {
    colorGrading.destroy();
    colorGradingRuntime = null;
  });

  const applyPlaybackRate = (nextRate: number) => {
    const parsed = Number(nextRate);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      state.playbackRate = 1;
    } else {
      state.playbackRate = Math.max(0.1, Math.min(5, parsed));
    }
    state.mediaForceSyncNextTick = true;
    if (state.capturedTimeline && typeof state.capturedTimeline.timeScale === "function") {
      state.capturedTimeline.timeScale(state.playbackRate);
    }
    const mediaEls = document.querySelectorAll("video, audio");
    for (const el of mediaEls) {
      if (!(el instanceof HTMLMediaElement)) continue;
      try {
        el.playbackRate = state.playbackRate;
      } catch (err) {
        // ignore unsupported values
        swallow("runtime.init.site10", err);
      }
    }
  };

  const player = createRuntimePlayer({
    getTimeline: () => state.capturedTimeline,
    setTimeline: (timeline) => {
      state.capturedTimeline = timeline;
    },
    getTimelineRegistry: () =>
      (window.__timelines ?? {}) as Record<string, RuntimeTimelineLike | undefined>,
    getIsPlaying: () => state.isPlaying,
    setIsPlaying: (playing) => {
      if (state.isPlaying !== playing) state.mediaForceSyncNextTick = true;
      state.isPlaying = playing;
    },
    getPlaybackRate: () => state.playbackRate,
    setPlaybackRate: applyPlaybackRate,
    getCanonicalFps: () => state.canonicalFps,
    onSyncMedia: (timeSeconds, playing) => {
      state.currentTime = Math.max(0, Number(timeSeconds) || 0);
      if (state.isPlaying !== playing) state.mediaForceSyncNextTick = true;
      state.isPlaying = playing;
      syncMediaForCurrentState();
    },
    onStatePost: postState,
    onDeterministicSeek: (timeSeconds, options) => {
      for (const adapter of state.deterministicAdapters) {
        if (adapter.name === "gsap" && state.capturedTimeline) continue;
        try {
          adapter.seek({
            time: Number(timeSeconds) || 0,
            suppressEvents: options?.suppressEvents,
          });
        } catch (err) {
          // ignore adapter failure
          swallow("runtime.init.site11", err);
        }
      }
    },
    onDeterministicPause: () => runAdapters("pause"),
    onDeterministicPlay: () => runAdapters("play"),
    onRenderFrameSeek: () => {
      colorGrading.redraw();
    },
    onShowNativeVideos: () => {},
    getSafeDuration: () => getSafeTimelineDurationSeconds(state.capturedTimeline, 0),
  });

  window.__player = createPlayerApiCompat(player);
  window.__playerReady = true;

  // Wire analytics event emission through the bridge
  initRuntimeAnalytics(postRuntimeMessage as (payload: unknown) => void);
  emitAnalyticsEvent("composition_loaded", {
    duration: player.getDuration(),
    compositionId:
      document.querySelector("[data-composition-id]")?.getAttribute("data-composition-id") ?? null,
  });

  state.controlBridgeHandler = installRuntimeControlBridge({
    onPlay: () => {
      player.play();
      emitAnalyticsEvent("composition_played", { time: player.getTime() });
    },
    onPause: () => {
      player.pause();
      emitAnalyticsEvent("composition_paused", { time: player.getTime() });
    },
    onStopMedia: () => {
      webAudio.stopAll();
      const mediaEls = document.querySelectorAll("video, audio");
      for (const el of mediaEls) {
        if (el instanceof HTMLMediaElement && !el.paused) el.pause();
      }
    },
    onSeek: (frame, _seekMode) => {
      const time = Math.max(0, frame) / state.canonicalFps;
      player.seek(time);
      emitAnalyticsEvent("composition_seeked", { time });
    },
    onSetMuted: (muted) => {
      state.bridgeMuted = muted;
      const effective = muted || state.mediaOutputMuted;
      webAudio.setMuted(effective);
      const mediaEls = document.querySelectorAll("video, audio");
      for (const el of mediaEls) {
        if (!(el instanceof HTMLMediaElement)) continue;
        el.muted = effective || el.defaultMuted;
      }
    },
    onSetVolume: (volume) => {
      state.bridgeVolume = volume;
      webAudio.setVolume(volume);
      const mediaEls = document.querySelectorAll("video, audio");
      for (const el of mediaEls) {
        if (!(el instanceof HTMLMediaElement)) continue;
        const parsed = parseFloat(el.dataset.volume ?? "");
        const clipVolume = Number.isFinite(parsed) ? parsed : 1;
        el.volume = clipVolume * volume;
      }
    },
    onSetMediaOutputMuted: (muted) => {
      state.mediaOutputMuted = muted;
      const effective = muted || state.bridgeMuted;
      webAudio.setMuted(effective);
      const mediaEls = document.querySelectorAll("video, audio");
      for (const el of mediaEls) {
        if (!(el instanceof HTMLMediaElement)) continue;
        el.muted = effective || el.defaultMuted;
      }
    },
    onSetNativeMediaSyncDisabled: (disabled) => {
      if (state.nativeMediaSyncDisabled === disabled) return;
      state.nativeMediaSyncDisabled = disabled;
      state.mediaForceSyncNextTick = true;
      if (disabled) {
        webAudio.stopAll();
        clock.detachAudioSource();
      } else {
        syncMediaForCurrentState();
      }
    },
    onSetWebAudioMediaDisabled: (disabled) => {
      if (state.webAudioMediaDisabled === disabled) return;
      state.webAudioMediaDisabled = disabled;
      state.mediaForceSyncNextTick = true;
      if (disabled) {
        webAudio.stopAll();
        clock.detachAudioSource();
        syncMediaForCurrentState();
      } else {
        syncMediaForCurrentState();
      }
    },
    onSetPlaybackRate: (rate) => {
      applyPlaybackRate(rate);
      if (state.transportClock) state.transportClock.setRate(state.playbackRate);
      applyWebAudioRate();
    },
    onSetRootDuration: growRootDurationLive,
    onSetColorGrading: (target, grading) => {
      colorGrading.setGrading(target, grading);
    },
    onSetColorGradingCompare: (target, compare) => {
      colorGrading.setCompare(target, compare);
    },
    onTick: () => {
      if (state.tornDown || !clock.isPlaying()) return;
      const t = clock.now();
      state.currentTime = t;
      seekTimelineAndAdapters(t);
      if (clock.reachedEnd()) {
        webAudio.stopAll();
        clock.detachAudioSource();
        clock.pause();
        state.isPlaying = false;
        const dur = clock.getDuration();
        if (Number.isFinite(dur)) {
          clock.seek(dur);
          state.currentTime = dur;
          seekTimelineAndAdapters(dur);
        }
        runAdapters("pause");
        syncMediaForCurrentState();
        postState(true);
      }
    },
    onEnablePickMode: () => picker.enablePickMode(),
    onDisablePickMode: () => picker.disablePickMode(),
  });

  state.deterministicAdapters = [
    createWaapiAdapter(),
    createCssAdapter({
      resolveStartSeconds: (element) => resolveStartForElement(element, 0),
    }),
    createAnimeJsAdapter(),
    createLottieAdapter(),
    createThreeAdapter(),
    createMapboxAdapter(),
    createLeafletAdapter(),
    createGoogleMapsAdapter(),
    createMaplibreAdapter(),
    createD3Adapter(),
    createTypegpuAdapter(),
    createGsapAdapter({ getTimeline: () => state.capturedTimeline }),
  ] as RuntimeDeterministicAdapter[];
  patchVideoTextureCompat();
  patchWebGLVideoTextureCompat();
  // Lets the engine re-render GPU compositions after it injects decoded video
  // frames, so video-textured WebGL/WebGPU scenes sample the correct frame.
  window.__hfReseekGpu = (time: number) => {
    const t = Math.max(0, Number(time) || 0);
    window.__hfThreeTime = t;
    window.__hfTypegpuTime = t;
    forceDispatchSeekEvent(t);
  };
  installRuntimeErrorDiagnostics();
  bindMediaMetadataListeners();
  runAdapters("discover");
  // ── Single-clock transport ──
  //
  // TransportClock is the sole time authority. GSAP is always paused —
  // seeked to clock.now() on each rAF tick. This eliminates the
  // two-clock drift problem from issue #668: one clock, zero drift.
  const clock = new TransportClock();
  state.transportClock = clock;
  const webAudio = new WebAudioTransport();
  let webAudioReady = false;
  void webAudio.init().then((ok) => {
    webAudioReady = ok;
  });

  const publishRenderReadyAfterTimelineBinding = () => {
    const prevTimeline = state.capturedTimeline;
    const rebound = bindRootTimelineIfAvailable();
    if (
      state.capturedTimeline &&
      (rebound || state.capturedTimeline !== prevTimeline || !player._timeline)
    ) {
      player._timeline = state.capturedTimeline;
    }
    const boundDuration = getSafeTimelineDurationSeconds(state.capturedTimeline, 0);
    if (boundDuration > 0) {
      clock.setDuration(boundDuration);
    }
    runAdapters("discover", state.currentTime);
    // Loud, specific diagnostic for the #1 "looks fine, ships broken" trap:
    // a root timeline never bound even though timelines ARE registered. Without
    // this the render silently proceeds on the static build-time DOM (frozen at
    // t=0). Only warn when GSAP timelines exist (CSS/WAAPI/Lottie-only
    // compositions legitimately bind no GSAP timeline and use adapters).
    if (!state.capturedTimeline) {
      const registry = (window.__timelines ?? {}) as Record<string, unknown>;
      const registeredKeys = Object.keys(registry).filter((k) => registry[k]);
      if (registeredKeys.length > 0) {
        const rootEl = resolveRootCompositionElement();
        const rootCompositionId = rootEl?.getAttribute("data-composition-id") ?? null;
        postRuntimeDiagnosticOnce(
          "root_timeline_unbound_registry_present",
          {
            reason: rootCompositionId
              ? "root data-composition-id has no matching key in window.__timelines"
              : "root composition element has no data-composition-id attribute",
            rootCompositionId,
            registeredTimelineKeys: registeredKeys,
          },
          "root_timeline_unbound_registry_present",
        );
        // eslint-disable-next-line no-console -- loud author-facing warning; this render would otherwise freeze at t=0
        console.warn(
          `[hyperframes] Root timeline not bound — render will freeze at t=0. ` +
            (rootCompositionId
              ? `Root data-composition-id is "${rootCompositionId}" but window.__timelines has no such key. `
              : `Root composition element has no data-composition-id. `) +
            `Registered timeline keys: [${registeredKeys.join(", ")}]. ` +
            `Register the root timeline under its data-composition-id (window.__timelines["${rootCompositionId ?? "<root-id>"}"] = tl).`,
        );
      }
    }
    // __renderReady = timeline binding attempted, safe for deterministic seeking.
    // Set after any GSAP batching has completed. renderSeek works with or
    // without a GSAP timeline (CSS/WAAPI/Lottie compositions use adapters only).
    window.__renderReady = true;
    postTimeline();
    postState(true);
  };

  maybePublishRenderReady = () => {
    if (!externalCompositionsReady || window.__hfTimelinesBuilding) {
      window.__renderReady = false;
      return;
    }
    // Re-run discover so adapters can refresh their state from the current
    // DOM — e.g. the Three.js adapter only hooks `DefaultLoadingManager` once
    // it sees `window.THREE`, which may have loaded AFTER the initial
    // bootstrap discover. Discover is idempotent in every adapter, so a
    // second call here is cheap.
    runAdapters("discover", state.currentTime);
    if (!isAdapterReadinessSettled()) {
      window.__renderReady = false;
      return;
    }
    publishRenderReadyAfterTimelineBinding();
  };

  // When the GSAP tween-batching interceptor (HF_EARLY_STUB, fileServer.ts) is
  // active, composition scripts queue tl.to() calls instead of executing them
  // synchronously. Wait for the "hf-timelines-built" event before the first
  // binding attempt so the transport clock receives the finished timeline
  // duration instead of permanently publishing duration=0.
  if (window.__hfTimelinesBuilding) {
    window.__renderReady = false;
    const onTimelinesBuilt = () => {
      window.removeEventListener("hf-timelines-built", onTimelinesBuilt);
      maybePublishRenderReady();
    };
    window.addEventListener("hf-timelines-built", onTimelinesBuilt);
  }
  maybePublishRenderReady();

  // When the bundler inlines compositions, data-composition-src is removed so
  // loadExternalCompositions() is skipped. But inline scripts registering child
  // timelines in __timelines haven't executed yet (they run in the browser's next
  // microtask). Defer a rebinding attempt to catch them.
  if (externalCompositionsReady) {
    setTimeout(() => {
      maybePublishRenderReady();
    }, 0);
  }
  let transportTickCount = 0;
  let inTransportTick = false;

  const seekRuntimeTimeline = (
    timeline: RuntimeTimelineLike,
    timeSeconds: number,
    swallowLabel: string,
    options?: RuntimeSeekOptions,
  ) => {
    try {
      const suppressEvents = options?.suppressEvents === true;
      timeline.pause();
      if (typeof timeline.totalTime === "function") {
        timeline.totalTime(timeSeconds, suppressEvents);
      } else {
        timeline.seek(timeSeconds, suppressEvents);
      }
    } catch (err) {
      swallow(swallowLabel, err);
    }
  };

  const seekStandaloneRegisteredTimelines = (timeSeconds: number, options?: RuntimeSeekOptions) => {
    const timelines = (window.__timelines ?? {}) as Record<string, RuntimeTimelineLike | undefined>;
    const rootCompositionId =
      resolveRootCompositionElement()?.getAttribute("data-composition-id") ?? null;
    for (const [compositionId, timeline] of Object.entries(timelines)) {
      if (!timeline || compositionId === rootCompositionId) continue;
      const node = document.querySelector(`[data-composition-id="${CSS.escape(compositionId)}"]`);
      if (!node) continue;
      const start = resolveStartForElement(node, 0);
      if (!Number.isFinite(start)) continue;
      const authoredDuration = resolveDurationForElement(node, {
        includeAuthoredTimingAttrs: true,
      });
      const timelineDuration = getTimelineDurationSeconds(timeline);
      const duration =
        authoredDuration != null && authoredDuration > 0 ? authoredDuration : timelineDuration;
      const localTime = Math.max(
        0,
        duration != null && duration > 0
          ? Math.min(duration, timeSeconds - start)
          : timeSeconds - start,
      );
      seekRuntimeTimeline(timeline, localTime, "runtime.init.transport.childTimeline", options);
    }
  };

  // Unpause all non-root timelines registered in window.__timelines (siblings
  // in the registry, not GSAP child tweens). Matches the naming convention in
  // player.ts:32 (forEachSiblingTimeline) and player.ts:89 (activateSiblingTimelines).
  //
  // Unlike the player's seek path which re-pauses siblings after seeking,
  // render-seek is one-frame-at-a-time with no transport tick between frames,
  // so the residual unpaused state is harmless — the next call re-activates
  // idempotently.
  const activateSiblingTimelines = (masterTimeline: RuntimeTimelineLike) => {
    const timelines = (window.__timelines ?? {}) as Record<string, RuntimeTimelineLike | undefined>;
    for (const tl of Object.values(timelines)) {
      if (!tl || tl === masterTimeline) continue;
      try {
        tl.play();
      } catch (err) {
        swallow("runtime.init.activateSiblings", err);
      }
    }
  };

  const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;

  const gsapCallbackTweenCache = new WeakMap<RuntimeTimelineLike, boolean>();
  const GSAP_CALLBACK_NAMES = [
    "onStart",
    "onUpdate",
    "onComplete",
    "onReverseComplete",
    "onRepeat",
  ];

  const readGsapDuration = (child: Record<string, unknown>, property: string): number | null => {
    const getter = child[property];
    if (typeof getter !== "function") return null;
    try {
      const value = Number(getter.call(child));
      return Number.isFinite(value) ? value : null;
    } catch (err) {
      swallow("runtime.init.gsapCallbackDuration", err);
      return null;
    }
  };

  const hasZeroDurationCallbackTween = (timeline: RuntimeTimelineLike): boolean => {
    const cached = gsapCallbackTweenCache.get(timeline);
    if (cached != null) return cached;

    if (!("getChildren" in timeline) || typeof timeline.getChildren !== "function") {
      return false;
    }

    let children: unknown;
    try {
      children = timeline.getChildren(true, true, true);
    } catch (err) {
      swallow("runtime.init.gsapCallbackChildren", err);
      gsapCallbackTweenCache.set(timeline, false);
      return false;
    }
    if (!Array.isArray(children)) {
      gsapCallbackTweenCache.set(timeline, false);
      return false;
    }

    for (const child of children) {
      if (!isObjectRecord(child)) continue;
      const vars = child.vars;
      if (!isObjectRecord(vars)) continue;
      const hasCallback = GSAP_CALLBACK_NAMES.some((name) => typeof vars[name] === "function");
      if (!hasCallback) continue;

      const totalDuration = readGsapDuration(child, "totalDuration");
      const duration = totalDuration ?? readGsapDuration(child, "duration");
      if (duration != null && duration <= 0.000001) {
        gsapCallbackTweenCache.set(timeline, true);
        return true;
      }
    }

    gsapCallbackTweenCache.set(timeline, false);
    return false;
  };

  const seekTimelineAndAdapters = (
    t: number,
    opts?: { activateChildren?: boolean; suppressEvents?: boolean },
  ) => {
    const tl = state.capturedTimeline;
    const suppressEvents = opts?.suppressEvents === true;
    if (tl) {
      // When rendering frame-by-frame (activateChildren=true), ensure all
      // sibling timelines are unpaused before seeking the root. GSAP
      // does not propagate totalTime() to children that are internally
      // paused, which leaves sub-compositions at their initial CSS state
      // (typically opacity:0). This mirrors the activateSiblingTimelines
      // call in player.ts renderSeek and is critical for sub-compositions
      // whose data-start is at or near 0 — they are added to the root
      // while it is paused and may never receive an explicit play().
      if (opts?.activateChildren) {
        activateSiblingTimelines(tl);
      }
      // #10: when data-duration exceeds the timeline's intrinsic length the
      // engine requests frames past the last tween. Seeking a paused GSAP
      // timeline past its end can revert from()-tweens to their empty initial
      // state, blanking the final poster. Clamp the MASTER seek to the
      // timeline's full extent so it holds the final computed frame instead.
      // Adapters still receive the raw `t` (their media may run longer).
      // totalDuration() includes repeats; Infinity (infinite repeat) → no clamp.
      const tlWithTotal = tl as RuntimeTimelineLike & { totalDuration?: () => number };
      let tlSeekTime = t;
      if (typeof tlWithTotal.totalDuration === "function") {
        try {
          const total = Number(tlWithTotal.totalDuration());
          if (Number.isFinite(total) && total > 0 && t > total) {
            tlSeekTime = total;
          }
        } catch (err) {
          swallow("runtime.init.transport.clampDuration", err);
        }
      }
      try {
        if (typeof tl.totalTime === "function") {
          tl.totalTime(tlSeekTime, suppressEvents);
          if (!suppressEvents && !hasZeroDurationCallbackTween(tl)) {
            // Preserve GSAP's forced-render nudge for root timelines without
            // firing callbacks a second time. The first seek is the only
            // eventful one; the follow-up nudges only refresh computed styles.
            tl.totalTime(tlSeekTime + 0.001, true);
            tl.totalTime(tlSeekTime, true);
          }
        } else {
          tl.seek(tlSeekTime, suppressEvents);
        }
      } catch (err) {
        swallow("runtime.init.transport.seek", err);
      }
      // Sibling timelines (registered in __timelines but not nested under
      // the root) are paused alongside the master. We do NOT seek them to
      // absolute position `t` here — child timelines nested under the root
      // are already propagated via tl.totalTime(), and seeking them again
      // at absolute `t` would clobber their offset-relative position.
      // Play/pause propagation for siblings happens in the player.play()
      // and player.pause() overrides via the adapter layer.
    } else {
      seekStandaloneRegisteredTimelines(t, opts);
    }
    for (const adapter of state.deterministicAdapters) {
      if (adapter.name === "gsap" && tl) continue;
      try {
        adapter.seek({ time: t, suppressEvents });
      } catch (err) {
        swallow("runtime.init.transport.adapter", err);
      }
    }
  };

  // True while the Studio is mid-drag on an element (the gesture marker is
  // stamped on the gestured element for the duration of the drag). During a
  // paused gesture the draft writer owns the element's transform, so the
  // per-frame transport re-seek must yield to it (see transportTick).
  //
  // The query is document-global (fine for today's single-composition Studio;
  // revisit if a multi-composition editor needs to scope this to one root).
  // It only runs while the clock is paused — transportTick short-circuits on
  // isPlaying() — so it is off the playback hot path; one attribute selector
  // per paused frame is negligible.
  const hasActiveStudioManualEditGesture = (): boolean => {
    try {
      return document.querySelector(`[${STUDIO_MANUAL_EDIT_GESTURE_ATTR}]`) != null;
    } catch {
      return false;
    }
  };

  const transportTick = () => {
    if (state.tornDown || inTransportTick) return;
    inTransportTick = true;
    try {
      state.transportRafId = window.requestAnimationFrame(transportTick);
      transportTickCount += 1;

      // Slower operations: timeline binding (~every 60 frames / ~1s at 60fps)
      if (
        shouldAttemptPeriodicTimelineBind({
          tick: transportTickCount,
          isPlaying: clock.isPlaying(),
          hasCapturedTimeline: state.capturedTimeline != null,
          currentTimeSeconds: clock.now(),
        })
      ) {
        const prevTimeline = state.capturedTimeline;
        if (bindRootTimelineIfAvailable()) {
          if (state.capturedTimeline && !player._timeline) {
            player._timeline = state.capturedTimeline;
          }
          if (state.capturedTimeline && state.capturedTimeline !== prevTimeline) {
            state.capturedTimeline.pause();
          }
          const dur = getSafeTimelineDurationSeconds(state.capturedTimeline, 0);
          if (dur > 0) clock.setDuration(dur);
          postTimeline();
        }
      }
      if (transportTickCount % 20 === 0) {
        postTimeline();
      }
      if (transportTickCount % 30 === 0) {
        bindMediaMetadataListeners();
      }

      // Sync clock duration with the resolved timeline each tick (catches async
      // rebinds, live data-duration edits). Never shrink while playing — transient
      // short reads cause reachedEnd() → playhead jumps to end (#1636).
      if (state.capturedTimeline) {
        const dur = getSafeTimelineDurationSeconds(state.capturedTimeline, 0);
        if (dur > 0 && (!clock.isPlaying() || dur >= clock.getDuration())) {
          clock.setDuration(dur);
        }
      }

      // Audio-master clock: three tiers of timing precision.
      // 1. WebAudio (AudioContext.currentTime): ~21µs, sample-accurate
      // 2. HTMLMediaElement (audio.currentTime): ~33ms, frame-accurate
      // 3. Monotonic (performance.now()): ~1ms, no audio coupling
      if (clock.isPlaying() && !state.mediaOutputMuted) {
        if (
          !state.nativeMediaSyncDisabled &&
          !state.webAudioMediaDisabled &&
          webAudio.isActive() &&
          webAudio.context
        ) {
          const webAudioTime = webAudio.getTime();
          if (webAudioTime >= 0) {
            clock.attachAudioSource({ currentTimeSeconds: webAudioTime });
          }
        } else {
          const audioEls = document.querySelectorAll("audio[data-start]");
          let foundActive = false;
          for (const rawEl of audioEls) {
            if (!(rawEl instanceof HTMLMediaElement) || !rawEl.isConnected) continue;
            const start = Number.parseFloat(rawEl.dataset.start ?? "");
            const durAttr = Number.parseFloat(rawEl.dataset.duration ?? "");
            const end = Number.isFinite(durAttr) && durAttr > 0 ? start + durAttr : Infinity;
            const mediaStart =
              Number.parseFloat(rawEl.dataset.playbackStart ?? rawEl.dataset.mediaStart ?? "0") ||
              0;
            if (Number.isFinite(start) && state.currentTime >= start && state.currentTime <= end) {
              if (!rawEl.paused) {
                clock.attachAudioSource({ el: rawEl, compositionStart: start, mediaStart });
                foundActive = true;
              } else if (!rawEl.error && rawEl.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
                // Audio is buffering — freeze visuals at last known position
                // instead of falling through to monotonic (which runs ahead).
                clock.attachAudioSource({ currentTimeSeconds: state.currentTime });
                foundActive = true;
              }
              break;
            }
          }
          if (!foundActive && clock.hasAudioSource()) {
            clock.detachAudioSource();
          }
        }
      } else if (clock.hasAudioSource()) {
        clock.detachAudioSource();
      }

      const t = clock.now();
      state.currentTime = t;
      // During a paused Studio manual-edit drag, the draft writer owns the
      // gestured element's transform (e.g. gsap.set for x/y). Re-seeking the
      // timeline every frame re-applies the animated value and clobbers the
      // draft, freezing the element while only the selection box tracks the
      // cursor. The playhead does not advance during a paused gesture, so
      // skipping the re-seek is a no-op for every other element; it resumes
      // the frame the gesture marker clears (drop/cancel). Playback is never
      // affected — the seek runs whenever the clock is playing.
      if (clock.isPlaying() || !hasActiveStudioManualEditGesture()) {
        seekTimelineAndAdapters(t);
      }

      // Looping is handled at the player layer (<hyperframes-player>),
      // not the runtime. The clock pauses at duration; GSAP's repeat:-1
      // is bypassed because we drive tl.totalTime(t) directly. The
      // parent observes isPlaying=false at end and re-issues seek(0)+play()
      // if its loop attribute is set.
      if (clock.isPlaying() && clock.reachedEnd()) {
        webAudio.stopAll();
        clock.detachAudioSource();
        clock.pause();
        state.isPlaying = false;
        const dur = clock.getDuration();
        if (Number.isFinite(dur)) {
          clock.seek(dur);
          state.currentTime = dur;
          seekTimelineAndAdapters(dur);
        }
        runAdapters("pause");
        syncMediaForCurrentState();
        postState(true);
        return;
      }

      if (clock.isPlaying()) {
        syncMediaForCurrentState();
      }
      postState(false);
    } finally {
      inTransportTick = false;
    }
  };

  const hardSyncAllMedia = (timeSeconds: number) => {
    const mediaEls = document.querySelectorAll("video, audio");
    for (const el of mediaEls) {
      if (!(el instanceof HTMLMediaElement)) continue;
      if (!el.isConnected) continue;
      const start = Number.parseFloat(el.dataset.start ?? "");
      if (!Number.isFinite(start)) continue;
      const durAttr = Number.parseFloat(el.dataset.duration ?? "");
      const end = Number.isFinite(durAttr) && durAttr > 0 ? start + durAttr : Infinity;
      if (timeSeconds < start || timeSeconds >= end) continue;
      const mediaStart =
        Number.parseFloat(el.dataset.playbackStart ?? el.dataset.mediaStart ?? "0") || 0;
      const relTime = timeSeconds - start + mediaStart;
      if (relTime >= 0) {
        try {
          el.currentTime = relTime;
        } catch {
          // ignore seek restrictions
        }
      }
    }
  };

  // Player methods route through the TransportClock.
  // Schedule WebAudio playback for every in-window audio clip, bounding each
  // buffer to its clip window (own data-duration AND the remaining host
  // composition window) so trimmed / sub-composition-nested clips stop at the
  // same edge as the HTMLMedia path. Reused by play() and by the rate-change
  // handler (a rate change can't rescale a bounded source in place).
  const scheduleWebAudioForActiveClips = () => {
    if (state.nativeMediaSyncDisabled || state.webAudioMediaDisabled) return;
    const gen = webAudio.startGeneration();
    const audioEls = document.querySelectorAll("audio[data-start]");
    for (const rawEl of audioEls) {
      if (!(rawEl instanceof HTMLMediaElement) || !rawEl.isConnected) continue;
      const compStart = Number.parseFloat(rawEl.dataset.start ?? "");
      if (!Number.isFinite(compStart)) continue;
      const mediaStart =
        Number.parseFloat(rawEl.dataset.playbackStart ?? rawEl.dataset.mediaStart ?? "0") || 0;
      const volumeAttr = Number.parseFloat(rawEl.dataset.volume ?? "");
      const vol = Number.isFinite(volumeAttr) ? volumeAttr : 1;
      const durationAttr = Number.parseFloat(rawEl.dataset.duration ?? "");
      let clipDuration =
        Number.isFinite(durationAttr) && durationAttr > 0 ? durationAttr : Number.POSITIVE_INFINITY;
      const compositionRoot = rawEl.closest("[data-composition-id]");
      if (compositionRoot) {
        const inheritedStart = resolveStartForElement(compositionRoot, 0);
        const inheritedDuration = resolveDurationForElement(compositionRoot, {
          includeAuthoredTimingAttrs: true,
        });
        if (inheritedDuration != null && inheritedDuration > 0) {
          clipDuration = Math.min(
            clipDuration,
            Math.max(0, inheritedStart + inheritedDuration - compStart),
          );
        }
      }
      void webAudio.decodeAudioElement(rawEl).then((buffer) => {
        if (!buffer || !clock.isPlaying()) return;
        void webAudio.schedulePlayback(
          rawEl,
          buffer,
          compStart,
          mediaStart,
          clock.now(),
          vol * state.bridgeVolume,
          gen,
          state.playbackRate,
          clipDuration,
        );
      });
    }
  };

  // Apply a new playback rate to the WebAudio transport. Unbounded sources are
  // rescaled in place; but a bounded source's window was baked into start()'s
  // duration at its prior rate and can't be rescaled, so when one is active we
  // stopAll()+reschedule at the new rate to keep trimmed clips ending on time.
  const applyWebAudioRate = () => {
    const changed = webAudio.setRate(state.playbackRate);
    if (
      changed &&
      !state.nativeMediaSyncDisabled &&
      !state.webAudioMediaDisabled &&
      webAudioReady &&
      clock.isPlaying() &&
      webAudio.hasBoundedActiveSources()
    ) {
      webAudio.stopAll();
      scheduleWebAudioForActiveClips();
    }
  };

  player.play = () => {
    const tl = state.capturedTimeline;
    if (clock.isPlaying()) return;
    const dur = getSafeTimelineDurationSeconds(tl, 0);
    if (dur > 0) {
      clock.setDuration(dur);
      if (clock.reachedEnd()) {
        clock.seek(0);
        state.currentTime = 0;
        seekTimelineAndAdapters(0);
      }
    } else {
      const rootEl = resolveRootCompositionElement();
      const declaredDur = Number(rootEl?.getAttribute("data-duration") ?? 0);
      if (declaredDur > 0) clock.setDuration(declaredDur);
    }
    if (tl) tl.pause();
    if (!clock.play()) return;
    state.isPlaying = true;
    state.mediaForceSyncNextTick = true;
    hardSyncAllMedia(clock.now());
    // Schedule audio through WebAudio for sample-accurate timing.
    // Falls back to HTMLMediaElement playback if WebAudio isn't ready
    // or decoding fails (the syncRuntimeMedia path handles that).
    if (webAudioReady && !state.nativeMediaSyncDisabled && !state.webAudioMediaDisabled) {
      scheduleWebAudioForActiveClips();
    }
    runAdapters("play");
    syncMediaForCurrentState();
    colorGrading.redraw();
    postState(true);
  };

  player.pause = () => {
    if (!clock.isPlaying()) return;
    webAudio.stopAll();
    clock.detachAudioSource();
    clock.pause();
    state.isPlaying = false;
    state.currentTime = clock.now();
    state.mediaForceSyncNextTick = true;
    hardSyncAllMedia(state.currentTime);
    const tl = state.capturedTimeline;
    if (tl) tl.pause();
    runAdapters("pause");
    syncMediaForCurrentState();
    colorGrading.redraw();
    postState(true);
  };

  player.seek = (timeSeconds: number) => {
    const quantized = quantizeTimeToFrame(
      Math.max(0, Number(timeSeconds) || 0),
      state.canonicalFps,
    );
    webAudio.stopAll();
    clock.detachAudioSource();
    const wasPlaying = clock.isPlaying();
    if (wasPlaying) clock.pause();
    clock.seek(quantized);
    state.currentTime = clock.now();
    state.isPlaying = false;
    state.mediaForceSyncNextTick = true;
    const tl = state.capturedTimeline;
    if (tl) tl.pause();
    seekTimelineAndAdapters(state.currentTime);
    runAdapters("pause");
    syncMediaForCurrentState();
    colorGrading.redraw();
    postState(true);
  };

  player.renderSeek = (timeSeconds: number, options?: RuntimeSeekOptions) => {
    const quantized = quantizeTimeToFrame(
      Math.max(0, Number(timeSeconds) || 0),
      state.canonicalFps,
    );
    if (clock.isPlaying()) clock.pause();
    clock.seek(quantized);
    state.currentTime = clock.now();
    state.isPlaying = false;
    state.mediaForceSyncNextTick = true;
    seekTimelineAndAdapters(state.currentTime, {
      activateChildren: true,
      suppressEvents: options?.suppressEvents,
    });
    syncMediaForCurrentState();
    colorGrading.redraw();
    postState(true);
  };

  player.getTime = () => clock.now();
  player.getDuration = () => {
    const dur = clock.getDuration();
    return Number.isFinite(dur) ? dur : 0;
  };
  player.isPlaying = () => clock.isPlaying();
  player.setPlaybackRate = (rate: number) => {
    applyPlaybackRate(rate);
    clock.setRate(state.playbackRate);
    applyWebAudioRate();
  };

  // Sync clock duration from any captured timeline
  if (state.capturedTimeline) {
    const dur = getSafeTimelineDurationSeconds(state.capturedTimeline, 0);
    if (dur > 0) clock.setDuration(dur);
    state.capturedTimeline.pause();
  }

  // Re-delegate __player methods through the live `player` object so
  // transport clock overrides are visible to iframe consumers reading
  // window.__player. Uses property delegation so future methods added
  // to createPlayerApiCompat are forwarded automatically.
  const playerApi = window.__player;
  if (playerApi) {
    const delegated = [
      "play",
      "pause",
      "seek",
      "renderSeek",
      "getTime",
      "getDuration",
      "isPlaying",
    ] as const;
    for (const key of delegated) {
      Object.defineProperty(playerApi, key, {
        get: () => player[key],
        set: (v: unknown) => {
          (player as Record<string, unknown>)[key] = v;
        },
        configurable: true,
      });
    }
  }

  installPositionEditsSeekReapply(window as Window & typeof globalThis);

  // Start the rAF tick loop
  state.transportRafId = window.requestAnimationFrame(transportTick);
  postTimeline();
  postState(true);

  const teardown = () => {
    if (state.tornDown) return;
    state.tornDown = true;
    if (state.transportRafId != null) {
      window.cancelAnimationFrame(state.transportRafId);
      state.transportRafId = null;
    }
    state.transportClock = null;
    webAudio.destroy();
    if (metadataRebindDebounceTimerId != null) {
      window.clearTimeout(metadataRebindDebounceTimerId);
      metadataRebindDebounceTimerId = null;
    }
    if (rootStageDiagnosticRafId != null) {
      window.cancelAnimationFrame(rootStageDiagnosticRafId);
      rootStageDiagnosticRafId = null;
    }
    unbindMediaMetadataListeners();
    if (state.controlBridgeHandler) {
      window.removeEventListener("message", state.controlBridgeHandler);
      state.controlBridgeHandler = null;
    }
    if (runtimeErrorListener) {
      window.removeEventListener("error", runtimeErrorListener);
      runtimeErrorListener = null;
    }
    if (runtimeUnhandledRejectionListener) {
      window.removeEventListener("unhandledrejection", runtimeUnhandledRejectionListener);
      runtimeUnhandledRejectionListener = null;
    }
    if (state.beforeUnloadHandler) {
      window.removeEventListener("beforeunload", state.beforeUnloadHandler);
      state.beforeUnloadHandler = null;
    }
    picker.disablePickMode();
    for (const adapter of state.deterministicAdapters) {
      if (!adapter || typeof adapter.revert !== "function") continue;
      try {
        adapter.revert();
      } catch (err) {
        // keep runtime resilient against adapter cleanup failures
        swallow("runtime.init.site12", err);
      }
    }
    state.deterministicAdapters = [];
    for (const cleanup of runtimeCleanupCallbacks.splice(0)) {
      try {
        cleanup();
      } catch (err) {
        // ignore cleanup failures
        swallow("runtime.init.site13", err);
      }
    }
    for (const styleEl of state.injectedCompStyles) {
      try {
        styleEl.remove();
      } catch (err) {
        // ignore cleanup failures
        swallow("runtime.init.site14", err);
      }
    }
    state.injectedCompStyles = [];
    for (const scriptEl of state.injectedCompScripts) {
      try {
        scriptEl.remove();
      } catch (err) {
        // ignore cleanup failures
        swallow("runtime.init.site15", err);
      }
    }
    state.injectedCompScripts = [];
    state.capturedTimeline = null;
    if (window.__hfRuntimeTeardown === teardown) {
      window.__hfRuntimeTeardown = null;
    }
  };
  window.__hfRuntimeTeardown = teardown;
  state.beforeUnloadHandler = teardown;
  window.addEventListener("beforeunload", state.beforeUnloadHandler);
}
