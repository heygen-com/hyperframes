import { installRuntimeControlBridge, postRuntimeMessage } from "./bridge";
import { initRuntimeAnalytics, emitAnalyticsEvent } from "./analytics";
import { createCssAdapter } from "./adapters/css";
import { createGsapAdapter } from "./adapters/gsap";
import { createAnimeJsAdapter } from "./adapters/animejs";
import { createLottieAdapter } from "./adapters/lottie";
import { createThreeAdapter } from "./adapters/three";
import { createWaapiAdapter } from "./adapters/waapi";
import { refreshRuntimeMediaCache, syncRuntimeMedia } from "./media";
import { createPickerModule } from "./picker";
import { createRuntimePlayer } from "./player";
import { createRuntimeState } from "./state";
import { collectRuntimeTimelinePayload } from "./timeline";
import { createRuntimeStartTimeResolver } from "./startResolver";
import { loadExternalCompositions, loadInlineTemplateCompositions } from "./compositionLoader";
import { applyCaptionOverrides } from "./captionOverrides";
import { TransportClock } from "./clock";
import { WebAudioTransport } from "./webAudioTransport";
import { quantizeTimeToFrame } from "../inline-scripts/parityContract";
import type { RuntimeDeterministicAdapter, RuntimeJson, RuntimeTimelineLike } from "./types";
import type { PlayerAPI } from "../core.types";
import { swallow } from "./diagnostics";

const AUTHORED_DURATION_ATTR = "data-hf-authored-duration";
const AUTHORED_END_ATTR = "data-hf-authored-end";

export function initSandboxRuntimeModular(): void {
  const state = createRuntimeState();
  const runtimeWindow = window as Window & {
    __hfRuntimeTeardown?: (() => void) | null;
  };
  let runtimeErrorListener: ((event: ErrorEvent) => void) | null = null;
  let runtimeUnhandledRejectionListener: ((event: PromiseRejectionEvent) => void) | null = null;
  const runtimeCleanupCallbacks: Array<() => void> = [];
  const postedDiagnosticKeys = new Set<string>();
  let rootStageDiagnosticRafId: number | null = null;
  if (typeof runtimeWindow.__hfRuntimeTeardown === "function") {
    try {
      runtimeWindow.__hfRuntimeTeardown();
    } catch (err) {
      // keep runtime resilient across reinits
      swallow("runtime.init.site1", err);
    }
  }
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

  window.__timelines = window.__timelines || {};
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
    seek: (timeSeconds: number) => void;
    getTime: () => number;
    getDuration: () => number;
    isPlaying: () => boolean;
    renderSeek: (timeSeconds: number) => void;
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
  const PLAY_REBIND_HOLD_SECONDS = 2;
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

  const resolveRootCompositionElement = (): HTMLElement | null => {
    // 1. Explicit root marker takes priority
    const explicitRoot = document.querySelector('[data-composition-id][data-root="true"]');
    if (explicitRoot instanceof HTMLElement) {
      return explicitRoot;
    }
    // 3. Topmost composition element (not nested inside another)
    const compositionNodes = Array.from(
      document.querySelectorAll("[data-composition-id]"),
    ) as HTMLElement[];
    if (compositionNodes.length === 0) return null;
    return (
      compositionNodes.find((node) => !node.parentElement?.closest("[data-composition-id]")) ??
      compositionNodes[0] ??
      null
    );
  };

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
      // Non-root compositions derive visible duration from timeline.
      // Strip both data-duration AND data-end so the visibility system
      // falls back to the GSAP timeline duration (parity with preview).
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
      const start = resolveStartForElement(node, 0);
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

  const getSafeTimelineDurationSeconds = (
    timeline: RuntimeTimelineLike | null,
    fallback = 0,
  ): number => {
    const timelineDuration = getTimelineDurationSeconds(timeline);
    const mediaFloor = resolveMediaDurationFloorSeconds();
    const authoredCompositionFloor = resolveAuthoredCompositionDurationFloorSeconds();
    const durationFloor = Math.max(mediaFloor ?? 0, authoredCompositionFloor ?? 0);
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
    const hardDurationCap = Math.max(1, Number(state.maxTimelineDurationSeconds) || 1800);
    return safeDuration > 0 ? Math.max(0, Math.min(safeDuration, hardDurationCap)) : 0;
  };

  const resolveRootTimelineFromDocument = (): TimelineResolution => {
    const timelines = (window.__timelines ?? {}) as Record<string, RuntimeTimelineLike | undefined>;
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
      return { timeline: null };
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
    return { timeline: null };
  };

  // Track whether child composition timelines have been added to the root.
  // This prevents the polling loop from skipping rebind when TARGET_DURATION
  // makes the root "usable" before children register. Assumption: child scripts
  // must register timelines synchronously or in the immediate microtask queue
  // (setTimeout(0)). Scripts using requestAnimationFrame or longer delays may
  // not be discovered.
  let childrenBound = false;
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
    return true;
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
    }
  };

  const syncMediaForCurrentState = () => {
    const resolveMediaCompositionContext = (element: HTMLVideoElement | HTMLAudioElement) => {
      const compositionRoot = element.closest("[data-composition-id]");
      const inheritedStart = compositionRoot ? resolveStartForElement(compositionRoot, 0) : null;
      // Media sync intentionally uses the authored host window here instead of
      // the live child timeline duration. Visibility prefers live truth so a
      // shrinking child composition hides early, but nested media needs a
      // stable authored window so seeks clamp against the host clip timing.
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
        return resolveStartForElement(element, context.inheritedStart ?? 0);
      },
      resolveDurationSeconds: (element) => {
        const context = resolveMediaCompositionContext(element);
        const start = resolveStartForElement(element, context.inheritedStart ?? 0);
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
        if (sourceDuration != null && hostRemaining != null) {
          return Math.min(sourceDuration, hostRemaining);
        }
        return sourceDuration ?? hostRemaining;
      },
    });
    const forceSync = state.mediaForceSyncNextTick;
    if (forceSync) state.mediaForceSyncNextTick = false;
    syncRuntimeMedia({
      clips: cache.mediaClips,
      timeSeconds: state.currentTime,
      playing: state.isPlaying,
      playbackRate: state.playbackRate,
      outputMuted: state.mediaOutputMuted,
      userMuted: state.bridgeMuted,
      userVolume: state.bridgeVolume,
      forceSync,
      onAutoplayBlocked: () => {
        if (state.mediaAutoplayBlockedPosted) return;
        state.mediaAutoplayBlockedPosted = true;
        postRuntimeMessage({ source: "hf-preview", type: "media-autoplay-blocked" });
      },
    });
    const rootCompId =
      document.querySelector("[data-composition-id]")?.getAttribute("data-composition-id") ?? null;
    const visibilityNodes = Array.from(document.querySelectorAll("[data-start]"));
    for (const rawNode of visibilityNodes) {
      if (!(rawNode instanceof HTMLElement)) continue;
      const tag = rawNode.tagName.toLowerCase();
      if (tag === "script" || tag === "style" || tag === "link" || tag === "meta") continue;

      // Skip elements INSIDE sub-compositions — their visibility is managed by GSAP,
      // not the global time-based adapter. Only manage visibility for:
      // 1. Composition host elements (have data-composition-id themselves)
      // 2. Direct children of root composition (audio, etc.)
      // Skip: elements whose nearest composition ancestor is NOT the root
      const ownCompId = rawNode.getAttribute("data-composition-id");
      if (!ownCompId) {
        // Not a composition host — check if it's inside a sub-composition
        const parentComp = rawNode.closest("[data-composition-id]");
        const parentCompId = parentComp?.getAttribute("data-composition-id") ?? null;
        if (parentCompId && parentCompId !== rootCompId) continue;
      }

      const start = resolveStartForElement(rawNode, 0);
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

        // Composition hosts must respect both the authored parent clip window
        // and the child composition's own live timeline duration.
        if (duration != null && duration > 0 && liveDuration != null) {
          duration = Math.min(duration, liveDuration);
        } else if ((duration == null || duration <= 0) && liveDuration != null) {
          duration = liveDuration;
        }
      }
      const computedEnd =
        duration != null && duration > 0 ? start + duration : Number.POSITIVE_INFINITY;
      const isVisibleNow =
        state.currentTime >= start &&
        (Number.isFinite(computedEnd) ? state.currentTime < computedEnd : true);
      rawNode.style.visibility = isVisibleNow ? "visible" : "hidden";
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
      maxTimelineDurationSeconds: state.maxTimelineDurationSeconds,
    });
    window.__clipManifest = payload;
    postRuntimeMessage(payload);
    scheduleRootStageLayoutDiagnostics();
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
          adapter.seek({ time: timeSeconds });
        } catch (err) {
          // ignore seek bootstrap failures
          swallow("runtime.init.site9", err);
        }
      }
    }
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
        runAdapters("discover", state.currentTime);
        bindMediaMetadataListeners();
        installAssetFailureDiagnostics();
        applyCaptionOverrides();
        postTimeline();
        postState(true);
      });
  } else {
    // No external/inline compositions to load — apply caption overrides immediately
    applyCaptionOverrides();
  }

  const picker = createPickerModule({
    postMessage: (payload) => postRuntimeMessage(payload),
  });
  picker.installPickerApi();

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
    onDeterministicSeek: (timeSeconds) => {
      for (const adapter of state.deterministicAdapters) {
        try {
          adapter.seek({ time: Number(timeSeconds) || 0 });
        } catch (err) {
          // ignore adapter failure
          swallow("runtime.init.site11", err);
        }
      }
    },
    onDeterministicPause: () => runAdapters("pause"),
    onDeterministicPlay: () => runAdapters("play"),
    onRenderFrameSeek: () => {},
    onShowNativeVideos: () => {},
    getSafeDuration: () => getSafeTimelineDurationSeconds(state.capturedTimeline, 0),
  });

  window.__player = createPlayerApiCompat(player);
  (window as Window & { __playerReady?: boolean }).__playerReady = true;
  (window as Window & { __renderReady?: boolean }).__renderReady = true;

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
        el.muted = effective;
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
        el.muted = effective;
      }
    },
    onSetPlaybackRate: (rate) => {
      applyPlaybackRate(rate);
      if (state.transportClock) state.transportClock.setRate(state.playbackRate);
    },
    onEnablePickMode: () => picker.enablePickMode(),
    onDisablePickMode: () => picker.disablePickMode(),
  });

  bindRootTimelineIfAvailable();
  if (state.capturedTimeline) {
    player._timeline = state.capturedTimeline;
  }

  // When the bundler inlines compositions, data-composition-src is removed so
  // loadExternalCompositions() is skipped. But inline scripts registering child
  // timelines in __timelines haven't executed yet (they run in the browser's next
  // microtask). Defer a rebinding attempt to catch them.
  if (externalCompositionsReady) {
    setTimeout(() => {
      const prevTimeline = state.capturedTimeline;
      if (bindRootTimelineIfAvailable() && state.capturedTimeline !== prevTimeline) {
        player._timeline = state.capturedTimeline;
      }
      // Re-run adapters to discover new elements
      runAdapters("discover", state.currentTime);
      postTimeline();
      postState(true);
    }, 0);
  }

  state.deterministicAdapters = [
    createWaapiAdapter(),
    createCssAdapter({
      resolveStartSeconds: (element) => resolveStartForElement(element, 0),
    }),
    createAnimeJsAdapter(),
    createLottieAdapter(),
    createThreeAdapter(),
    createGsapAdapter({ getTimeline: () => state.capturedTimeline }),
  ] as RuntimeDeterministicAdapter[];
  installRuntimeErrorDiagnostics();
  runAdapters("discover");
  bindMediaMetadataListeners();
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
  let transportTickCount = 0;
  let inTransportTick = false;

  const seekTimelineAndAdapters = (t: number) => {
    const tl = state.capturedTimeline;
    if (tl) {
      try {
        if (typeof tl.totalTime === "function") {
          tl.totalTime(t, false);
        } else {
          tl.seek(t, false);
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
    }
    for (const adapter of state.deterministicAdapters) {
      try {
        adapter.seek({ time: t });
      } catch (err) {
        swallow("runtime.init.transport.adapter", err);
      }
    }
  };

  const transportTick = () => {
    if (state.tornDown || inTransportTick) return;
    inTransportTick = true;
    try {
      state.transportRafId = window.requestAnimationFrame(transportTick);
      transportTickCount += 1;

      // Slower operations: timeline binding (~every 60 frames / ~1s at 60fps)
      if (transportTickCount % 60 === 0) {
        const shouldHoldRebind =
          clock.isPlaying() &&
          state.capturedTimeline != null &&
          clock.now() < PLAY_REBIND_HOLD_SECONDS;
        if (!shouldHoldRebind) {
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
      }
      if (transportTickCount % 20 === 0) {
        postTimeline();
      }
      if (transportTickCount % 30 === 0) {
        bindMediaMetadataListeners();
      }

      // Keep clock duration in sync with the resolved timeline duration.
      // Cheap (no DOM reads) and catches async timeline rebinds that happen
      // outside the 60-tick branch (metadata hydration, deferred setTimeout).
      if (state.capturedTimeline) {
        const dur = getSafeTimelineDurationSeconds(state.capturedTimeline, 0);
        if (dur > 0) clock.setDuration(dur);
      }

      // Audio-master clock: three tiers of timing precision.
      // 1. WebAudio (AudioContext.currentTime): ~21µs, sample-accurate
      // 2. HTMLMediaElement (audio.currentTime): ~33ms, frame-accurate
      // 3. Monotonic (performance.now()): ~1ms, no audio coupling
      if (clock.isPlaying() && !state.mediaOutputMuted) {
        if (webAudio.isActive() && webAudio.context) {
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
            if (Number.isFinite(start) && state.currentTime >= start && state.currentTime < end) {
              if (!rawEl.paused) {
                clock.attachAudioSource({ el: rawEl, compositionStart: start, mediaStart });
                foundActive = true;
              } else if (rawEl.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
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
      seekTimelineAndAdapters(t);

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
  player.play = () => {
    const tl = state.capturedTimeline;
    if (!tl || clock.isPlaying()) return;
    const dur = getSafeTimelineDurationSeconds(tl, 0);
    if (dur > 0) {
      clock.setDuration(dur);
      if (clock.reachedEnd()) {
        clock.seek(0);
        state.currentTime = 0;
        seekTimelineAndAdapters(0);
      }
    }
    tl.pause();
    if (!clock.play()) return;
    state.isPlaying = true;
    state.mediaForceSyncNextTick = true;
    hardSyncAllMedia(clock.now());
    // Schedule audio through WebAudio for sample-accurate timing.
    // Falls back to HTMLMediaElement playback if WebAudio isn't ready
    // or decoding fails (the syncRuntimeMedia path handles that).
    if (webAudioReady) {
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
          );
        });
      }
    }
    runAdapters("play");
    syncMediaForCurrentState();
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
    postState(true);
  };

  player.renderSeek = (timeSeconds: number) => {
    const quantized = quantizeTimeToFrame(
      Math.max(0, Number(timeSeconds) || 0),
      state.canonicalFps,
    );
    if (clock.isPlaying()) clock.pause();
    clock.seek(quantized);
    state.currentTime = clock.now();
    state.isPlaying = false;
    state.mediaForceSyncNextTick = true;
    seekTimelineAndAdapters(state.currentTime);
    syncMediaForCurrentState();
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
        configurable: true,
      });
    }
  }

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
    if (runtimeWindow.__hfRuntimeTeardown === teardown) {
      runtimeWindow.__hfRuntimeTeardown = null;
    }
  };
  runtimeWindow.__hfRuntimeTeardown = teardown;
  state.beforeUnloadHandler = teardown;
  window.addEventListener("beforeunload", state.beforeUnloadHandler);
}
