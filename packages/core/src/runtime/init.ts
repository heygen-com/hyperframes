import { installRuntimeControlBridge, postRuntimeMessage } from "./bridge";
import { initRuntimeAnalytics, emitAnalyticsEvent } from "./analytics";
import { createCssAdapter } from "./adapters/css";
import { createGsapAdapter } from "./adapters/gsap";
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
import type { RuntimeDeterministicAdapter, RuntimeJson, RuntimeTimelineLike } from "./types";
import type { PlayerAPI } from "../core.types";

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
    } catch {
      // keep runtime resilient across reinits
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
  const LOOP_WRAP_PREVIOUS_TIME_THRESHOLD_SECONDS = 0.75;
  const LOOP_WRAP_CURRENT_TIME_THRESHOLD_SECONDS = 0.35;
  const LOOP_GUARD_SEEK_GRACE_PERIOD_MS = 900;
  const LOOP_GUARD_CONSECUTIVE_WRAP_THRESHOLD = 3;
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
      // Non-root compositions derive duration from timeline.
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

  const resolveStartForElement = (element: Element, fallback = 0): number => {
    const resolver = createRuntimeStartTimeResolver({
      timelineRegistry: (window.__timelines ?? {}) as Record<
        string,
        RuntimeTimelineLike | undefined
      >,
    });
    return resolver.resolveStartForElement(element, fallback);
  };

  const resolveDurationForElement = (element: Element): number | null => {
    const resolver = createRuntimeStartTimeResolver({
      timelineRegistry: (window.__timelines ?? {}) as Record<
        string,
        RuntimeTimelineLike | undefined
      >,
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
    const fallbackDuration =
      Number.isFinite(fallback) && fallback > MIN_VALID_TIMELINE_DURATION_SECONDS ? fallback : 0;
    let safeDuration = 0;
    // Timeline is the source of truth for authored composition duration.
    if (isUsableTimelineDuration(timelineDuration)) {
      safeDuration = Math.max(timelineDuration, fallbackDuration);
    } else if (isUsableTimelineDuration(mediaFloor)) {
      safeDuration = Math.max(mediaFloor, fallbackDuration);
    } else {
      safeDuration = fallbackDuration;
    }
    const hardDurationCap = Math.max(1, Number(state.maxTimelineDurationSeconds) || 1800);
    return safeDuration > 0 ? Math.max(0, Math.min(safeDuration, hardDurationCap)) : 0;
  };

  const resolveRootTimelineFromDocument = (): TimelineResolution => {
    const timelines = (window.__timelines ?? {}) as Record<string, RuntimeTimelineLike | undefined>;
    const startResolver = createRuntimeStartTimeResolver({ timelineRegistry: timelines });
    const mediaDurationFloorSeconds = resolveMediaDurationFloorSeconds();
    const minCandidateDurationSeconds =
      resolveMinCandidateDurationSeconds(mediaDurationFloorSeconds);
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
        } catch {
          // keep fallback resilient if root add fails
        }
      }
      const withTween = fallbackTimeline as RuntimeTimelineLike & {
        to?: (target: object, vars: { duration?: number }) => unknown;
      };
      if (typeof withTween.to === "function") {
        try {
          withTween.to({}, { duration: durationSeconds });
        } catch {
          // no-op; if tween creation fails, caller will discard by unusable duration
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
          } catch {
            // ignore broken child add attempts
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
        } catch {
          // keep runtime resilient against timeline API quirks
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
                selectedTimelineIds,
                autoNestedChildren,
              },
            },
          };
        }
        const durationFloorTimeline = createDurationFloorTimeline(
          mediaDurationFloorSeconds ?? 0,
          rootTimeline,
        );
        const durationFloorSeconds = getTimelineDurationSeconds(durationFloorTimeline);
        if (durationFloorTimeline && isUsableTimelineDuration(durationFloorSeconds)) {
          return {
            timeline: durationFloorTimeline,
            selectedTimelineIds: [rootCompositionId],
            selectedDurationSeconds: durationFloorSeconds,
            mediaDurationFloorSeconds,
            diagnostics: {
              code: "root_timeline_unusable_media_floor_fallback",
              details: {
                rootCompositionId,
                rootDurationSeconds,
                fallbackKind: "media_duration_floor",
                mediaDurationFloorSeconds,
                selectedDurationSeconds: durationFloorSeconds,
                selectedTimelineIds: [rootCompositionId],
                autoNestedChildren,
              },
            },
          };
        }
      }
      if (!isUsableTimelineDuration(rootDurationSeconds) && rootChildCandidates.length === 0) {
        const durationFloorTimeline = createDurationFloorTimeline(
          mediaDurationFloorSeconds ?? 0,
          rootTimeline,
        );
        const durationFloorSeconds = getTimelineDurationSeconds(durationFloorTimeline);
        if (durationFloorTimeline && isUsableTimelineDuration(durationFloorSeconds)) {
          return {
            timeline: durationFloorTimeline,
            selectedTimelineIds: [rootCompositionId],
            selectedDurationSeconds: durationFloorSeconds,
            mediaDurationFloorSeconds,
            diagnostics: {
              code: "root_timeline_unusable_media_floor_fallback",
              details: {
                rootCompositionId,
                rootDurationSeconds,
                fallbackKind: "media_duration_floor",
                mediaDurationFloorSeconds,
                selectedDurationSeconds: durationFloorSeconds,
                selectedTimelineIds: [rootCompositionId],
              },
            },
          };
        }
      }
      // If the root composition declares an explicit data-duration that meaningfully
      // exceeds the captured GSAP timeline, extend the timeline in-place by placing
      // a zero-duration no-op tween at the declared end position. This makes
      // timeline.duration() report the declared length without creating a composite
      // (which would double-count the original duration).
      const rootDeclaredDurAttr = rootCompositionNode?.getAttribute("data-duration");
      if (rootDeclaredDurAttr) {
        const rootDeclaredDur = parseFloat(rootDeclaredDurAttr);
        if (
          isUsableTimelineDuration(rootDeclaredDur) &&
          isUsableTimelineDuration(rootDurationSeconds) &&
          // Only pad when the gap is meaningful (>= 0.5s) to avoid floating-point
          // false positives on compositions whose GSAP duration is already close
          // to data-duration.
          rootDeclaredDur >= rootDurationSeconds + 0.5
        ) {
          const tlWithTo = rootTimeline as RuntimeTimelineLike & {
            to?: (target: object, vars: { duration: number }, position: number) => unknown;
          };
          if (typeof tlWithTo.to === "function") {
            try {
              // Placing a zero-duration tween AT rootDeclaredDur extends
              // timeline.duration() to exactly rootDeclaredDur.
              tlWithTo.to({}, { duration: 0 }, rootDeclaredDur);
            } catch {
              // keep runtime resilient
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

  const syncCurrentTimeFromTimeline = () => {
    const timeline = state.capturedTimeline;
    if (!timeline || typeof timeline.time !== "function") return;
    const nextTime = Number(timeline.time());
    if (!Number.isFinite(nextTime)) return;
    state.currentTime = Math.max(0, nextTime);
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
    } catch {
      // keep runtime resilient even if a timeline implementation throws
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
    }
  };

  const syncMediaForCurrentState = () => {
    const cache = refreshRuntimeMediaCache({
      resolveStartSeconds: (element) => resolveStartForElement(element, 0),
    });
    syncRuntimeMedia({
      clips: cache.mediaClips,
      timeSeconds: state.currentTime,
      playing: state.isPlaying,
      playbackRate: state.playbackRate,
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
      const duration = resolveDurationForElement(rawNode);
      const end = duration != null && duration > 0 ? start + duration : Number.POSITIVE_INFINITY;
      // For composition hosts, use the composition timeline's duration to compute end
      let computedEnd = end;
      const compId = rawNode.getAttribute("data-composition-id");
      if (compId && !Number.isFinite(end)) {
        const compTimeline = (window.__timelines ?? {})[compId];
        if (compTimeline && typeof compTimeline.duration === "function") {
          const compDur = compTimeline.duration();
          if (compDur > 0) computedEnd = start + compDur;
        }
      }
      const isVisibleNow =
        state.currentTime >= start &&
        (Number.isFinite(computedEnd) ? state.currentTime < computedEnd : true);
      rawNode.style.visibility = isVisibleNow ? "visible" : "hidden";
    }
  };

  const postState = (force: boolean) => {
    syncCurrentTimeFromTimeline();
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
      } catch {
        // keep runtime resilient against adapter-specific failures
      }
      if (method === "discover") {
        try {
          adapter.seek({ time: timeSeconds });
        } catch {
          // ignore seek bootstrap failures
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
        postTimeline();
        postState(true);
      });
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
    if (state.capturedTimeline && typeof state.capturedTimeline.timeScale === "function") {
      state.capturedTimeline.timeScale(state.playbackRate);
    }
    const mediaEls = document.querySelectorAll("video, audio");
    for (const el of mediaEls) {
      if (!(el instanceof HTMLMediaElement)) continue;
      try {
        el.playbackRate = state.playbackRate;
      } catch {
        // ignore unsupported values
      }
    }
  };

  const player = createRuntimePlayer({
    getTimeline: () => state.capturedTimeline,
    setTimeline: (timeline) => {
      state.capturedTimeline = timeline;
    },
    getIsPlaying: () => state.isPlaying,
    setIsPlaying: (playing) => {
      state.isPlaying = playing;
    },
    getPlaybackRate: () => state.playbackRate,
    setPlaybackRate: applyPlaybackRate,
    getCanonicalFps: () => state.canonicalFps,
    onSyncMedia: (timeSeconds, playing) => {
      state.currentTime = Math.max(0, Number(timeSeconds) || 0);
      state.isPlaying = playing;
      syncMediaForCurrentState();
    },
    onStatePost: postState,
    onDeterministicSeek: (timeSeconds) => {
      for (const adapter of state.deterministicAdapters) {
        try {
          adapter.seek({ time: Number(timeSeconds) || 0 });
        } catch {
          // ignore adapter failure
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
      const mediaEls = document.querySelectorAll("video, audio");
      for (const el of mediaEls) {
        if (!(el instanceof HTMLMediaElement)) continue;
        el.muted = muted;
      }
    },
    onSetPlaybackRate: (rate) => applyPlaybackRate(rate),
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
    createCssAdapter({
      resolveStartSeconds: (element) => resolveStartForElement(element, 0),
    }),
    createWaapiAdapter(),
    createLottieAdapter(),
    createThreeAdapter(),
    createGsapAdapter({ getTimeline: () => state.capturedTimeline }),
  ] as RuntimeDeterministicAdapter[];
  installRuntimeErrorDiagnostics();
  runAdapters("discover");
  bindMediaMetadataListeners();
  if (state.timelinePollIntervalId) {
    clearInterval(state.timelinePollIntervalId);
  }
  let timelinePollTick = 0;
  let lastObservedTimelineTime: number | null = null;
  let lastExplicitSeekAtMs = 0;
  let loopGuardRebindTriggered = false;
  let loopWrapCandidateCount = 0;
  const markExplicitSeek = () => {
    lastExplicitSeekAtMs = Date.now();
    loopGuardRebindTriggered = false;
    loopWrapCandidateCount = 0;
  };
  state.timelinePollIntervalId = setInterval(() => {
    timelinePollTick += 1;
    const shouldHoldRebindDuringEarlyPlay =
      state.isPlaying &&
      state.capturedTimeline != null &&
      Math.max(0, state.currentTime || 0) < PLAY_REBIND_HOLD_SECONDS;
    const timelineBoundThisTick = shouldHoldRebindDuringEarlyPlay
      ? false
      : bindRootTimelineIfAvailable();
    if (state.capturedTimeline && !player._timeline) {
      player._timeline = state.capturedTimeline;
    }
    if (timelineBoundThisTick || timelinePollTick % 20 === 0) {
      postTimeline();
    }
    if (timelinePollTick % 10 === 0) {
      bindMediaMetadataListeners();
    }
    syncCurrentTimeFromTimeline();
    if (state.isPlaying && state.capturedTimeline) {
      const currentObserved = Math.max(0, state.currentTime || 0);
      const previousObserved = lastObservedTimelineTime;
      const safeDuration = getSafeTimelineDurationSeconds(state.capturedTimeline, 0);
      if (safeDuration > 0 && currentObserved >= safeDuration) {
        player.pause();
        player.seek(safeDuration);
        lastObservedTimelineTime = safeDuration;
        loopWrapCandidateCount = 0;
        postState(true);
        return;
      }
      const isWrapCandidate =
        previousObserved != null &&
        previousObserved >= LOOP_WRAP_PREVIOUS_TIME_THRESHOLD_SECONDS &&
        currentObserved <= LOOP_WRAP_CURRENT_TIME_THRESHOLD_SECONDS;
      if (isWrapCandidate) {
        loopWrapCandidateCount += 1;
      } else {
        loopWrapCandidateCount = 0;
      }
      if (
        !loopGuardRebindTriggered &&
        loopWrapCandidateCount >= LOOP_GUARD_CONSECUTIVE_WRAP_THRESHOLD &&
        Date.now() - lastExplicitSeekAtMs > LOOP_GUARD_SEEK_GRACE_PERIOD_MS
      ) {
        const resolution = resolveRootTimelineFromDocument();
        if (rebindTimelineFromResolution(resolution, "loop_guard")) {
          loopGuardRebindTriggered = true;
          loopWrapCandidateCount = 0;
        }
      }
      lastObservedTimelineTime = Math.max(0, state.currentTime || 0);
    } else {
      lastObservedTimelineTime = Math.max(0, state.currentTime || 0);
    }
    if (state.isPlaying) {
      syncMediaForCurrentState();
    }
    postState(false);
  }, 50);
  postTimeline();
  postState(true);

  const originalSeek = player.seek;
  player.seek = (timeSeconds: number) => {
    markExplicitSeek();
    originalSeek(timeSeconds);
  };
  const originalRenderSeek = player.renderSeek;
  player.renderSeek = (timeSeconds: number) => {
    markExplicitSeek();
    originalRenderSeek(timeSeconds);
  };

  const teardown = () => {
    if (state.tornDown) return;
    state.tornDown = true;
    if (state.timelinePollIntervalId) {
      clearInterval(state.timelinePollIntervalId);
      state.timelinePollIntervalId = null;
    }
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
      } catch {
        // keep runtime resilient against adapter cleanup failures
      }
    }
    state.deterministicAdapters = [];
    for (const cleanup of runtimeCleanupCallbacks.splice(0)) {
      try {
        cleanup();
      } catch {
        // ignore cleanup failures
      }
    }
    for (const styleEl of state.injectedCompStyles) {
      try {
        styleEl.remove();
      } catch {
        // ignore cleanup failures
      }
    }
    state.injectedCompStyles = [];
    for (const scriptEl of state.injectedCompScripts) {
      try {
        scriptEl.remove();
      } catch {
        // ignore cleanup failures
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
