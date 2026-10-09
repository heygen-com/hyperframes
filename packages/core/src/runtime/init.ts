// fallow-ignore-file code-duplication complexity
import { refreshSvgSelectorAliases } from "../compiler/svgSelectorAliases";
import { RUNTIME_FILLER } from "./protocol";
import {
  preloadMedia,
  prepareUpcomingMedia,
  releaseMedia,
  lengthIsAuthored,
  stopMediaDownload,
} from "./preloadMedia";
import { installRuntimeControlBridge, postRuntimeMessage, setRuntimeProtocolFps } from "./bridge";
import { instantTolerance } from "../clipFacts";
import { isInClipWindow } from "./clipWindow";
import { revealTimedClipsAfterFirstPass, SKIPPED_CLIP, skipsHiddenImages } from "./timedClipHide";
import { STUDIO_PREVIEW_LAZY_ATTR, STUDIO_PREVIEW_UPCOMING_ATTR } from "../studioPreviewMark";
import { initRuntimeAnalytics, emitAnalyticsEvent } from "./analytics";
import { injectCompositionCssVariables } from "./getVariables";
import { createCssAdapter } from "./adapters/css";
import { createGsapAdapter, rerenderGsapTimelineAt } from "./adapters/gsap";
import { createAnimeJsAdapter } from "./adapters/animejs";
import { createLottieAdapter } from "./adapters/lottie";
import { createThreeAdapter } from "./adapters/three";
import { createMapboxAdapter } from "./adapters/mapbox";
import { createLeafletAdapter } from "./adapters/leaflet";
import { createGoogleMapsAdapter } from "./adapters/google-maps";
import { createMaplibreAdapter } from "./adapters/maplibre";
import { createD3Adapter } from "./adapters/d3";
import { createTypegpuAdapter } from "./adapters/typegpu";
import { createFrameSourceAdapter } from "./frameSources";
import {
  patchVideoTextureCompat,
  patchWebGLVideoTextureCompat,
} from "./adapters/video-texture-compat";
import {
  forceDispatchSeekEvent,
  registerSeekCompletion,
  waitForSeekCompletion,
} from "./adapters/seek-dispatch";
import { sourceTimeAt } from "../speedRamp";
import { createWaapiAdapter } from "./adapters/waapi";
import {
  MEDIA_SYNC_TOLERANCE_SECONDS,
  isUnplayable,
  readElementPlaybackRate,
  readElementPlaybackStart,
  readElementRateSpec,
  refreshRuntimeMediaCache,
  resolveNaturalMediaTimelineDuration,
  resolveRuntimeMediaClipDuration,
  syncRuntimeMedia,
  type RuntimeMediaClip,
} from "./media";
import {
  handleErrorForProxy,
  handleMetadataForProxy,
  maybeProxyProactively,
  setProxyDisplayScale,
} from "./mediaProxy";
import { probeAndCacheElementVolume, type VolumeKeyframe } from "./mediaVolumeEnvelope.js";
import { createPickerModule } from "./picker";
import { createRuntimePlayer, resolveRenderSeekTime, type RuntimePlayerTransport } from "./player";
import { createRuntimeState } from "./state";
import {
  collectRuntimeTimelinePayload,
  isRuntimeElementVisibleAt,
  parseAuthoredTrack,
} from "./timeline";
import { findRootCompositionElement, parseLayoutDimension } from "./compositionDimension";
import { resolveCompositionDuration } from "@hyperframes/parsers/composition-duration";
import {
  LOOP_INFLATED_TIMELINE_SECONDS,
  MIN_VALID_TIMELINE_DURATION_SECONDS,
  readCompositionSize,
  resolveAuthoredCompositionFloorSeconds,
  resolveCompositionLengthSeconds,
  resolveContentDerivedDuration as resolveContentDerivedDurationFor,
  resolveMediaWindowDurationSeconds as resolveMediaWindowDurationSecondsIn,
} from "./compositionLength";
import { createRuntimeStartTimeResolver } from "./startResolver";
import { createClipTree } from "./clipTree";
import { loadCompositions } from "./compositionLoader";
import { runScriptsAfterFonts } from "./afterFonts";
import {
  applyCaptionOverrides,
  applyFetchedCaptionOverrides,
  fetchCaptionOverrides,
} from "./captionOverrides";
import {
  SCENE_NO_SWAP_ATTR,
  SCENE_PART_ATTR,
  SCENE_PARTS_META,
  type SceneParts,
} from "../sceneParts";
import {
  applyPositionEdits,
  EDIT_ORIGINAL_TRANSLATE_ATTR,
  forgetPositionEdit,
  installPositionEditsSeekReapply,
} from "./positionEdits";
import { unproxiedSrc } from "./proxySrc";
import { applyVariableBindings, unproxiedMediaSrc } from "./applyVariableBindings";
import { createColorGradingRuntime, type RuntimeColorGradingApi } from "./colorGrading";
import { COLOR_GRADING_AUTHORED_OPACITY_ATTR } from "../colorGrading";
import { initVfx, paintVfx } from "./vfx";
import { TransportClock } from "./clock";
import { WebAudioTransport } from "./webAudioTransport";
import {
  classifyWebAudioMediaRoute,
  isRouteSelectionSettled,
  reportWebAudioMediaRoute,
} from "./webAudioRoute.js";
import {
  audioGroupOf,
  ensureAudioGroupInertStyle,
  HF_AUDIO_GROUP_TAG,
  isMemberGroupHidden,
} from "../audioGroups";
import { clampNativeMediaVolume } from "../audioGain";
import { quantizeTimeToFrame } from "../inline-scripts/parityContract";
import { createManualEditGestureWatch } from "./manualEditGestureWatch";
import type {
  HeldSeek,
  RuntimeDeterministicAdapter,
  RuntimeJson,
  RuntimeSeekOptions,
  RuntimeTimelineChildLike,
  RuntimeTimelineLike,
  SceneAnimation,
} from "./types";
import type { PlayerAPI } from "../core.types";
import { swallow } from "./diagnostics";
import {
  CHANGE_DRIVEN_SERVICE_MIN_INTERVAL_MS,
  MEDIA_BIND_INTERVAL_FRAMES,
  PLAYING_POLL_INTERVAL_MS,
  TIMELINE_POST_INTERVAL_FRAMES,
  shouldAttemptPeriodicTimelineBind,
} from "./timelineRebindPolicy";
import { installStudioCustomEase } from "./customEase";
import { parseStrictFiniteTimingNumber, resolveMediaElementDurationSeconds } from "./playbackRate";
import { MEDIA_START_BASIS_ATTR } from "../mediaTiming";
import { settleFirstFrameCompositionReadiness } from "../compositionReadiness";
import { AUTHORED_DURATION_ATTR, AUTHORED_END_ATTR } from "./authoredTiming";
import {
  clearRuntimeData,
  setRuntimeData,
  setRuntimeDataAppliedReporter,
  setRuntimeDataErrorReporter,
} from "./runtimeData";
import {
  isAudioElement,
  isElementNode,
  isHtmlElement,
  isImageElement,
  isMediaElement,
  isVideoElement,
} from "./domRealm";
import { audibleVideoNeedsWebAudio, isAudibleVideoElement } from "../audibleVideo";

/**
 * A `window.__timelines` entry is authored content and may be a PARTIAL
 * RuntimeTimelineLike — e.g. duration/seek only, no `pause()`. Such
 * compositions render fine (the render path only seeks and never pauses), so
 * timeline resolution stays permissive by design; the interactive transport
 * must not crash on the missing method (top recurring studio:unhandled_error:
 * "E.pause is not a function"). One analytics event per page so the
 * composition author can find the partial timeline.
 */
let warnedTimelineMissingPause = false;
function pauseTimelineIfPossible(tl: RuntimeTimelineLike | null | undefined): void {
  if (!tl) return;
  if (typeof tl.pause !== "function") {
    if (!warnedTimelineMissingPause) {
      warnedTimelineMissingPause = true;
      emitAnalyticsEvent("timeline_missing_pause", {});
    }
    return;
  }
  try {
    tl.pause();
  } catch (err) {
    swallow("runtime.timeline.pause", err);
  }
}

/** A timeline the runtime already padded is padded again from scratch, as a fresh load pads it. */
function dropRuntimeFillers(timeline: RuntimeTimelineLike): void {
  const removable = timeline as RuntimeTimelineLike & { remove?: (child: unknown) => unknown };
  if (typeof removable.remove !== "function") return;
  for (const child of timeline.getChildren?.(false, true, false) ?? []) {
    if (child.data === RUNTIME_FILLER) removable.remove(child);
  }
}

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

function samePromiseSet(a: PromiseLike<unknown>[], b: PromiseLike<unknown>[] | null): boolean {
  return b !== null && a.length === b.length && a.every((p, i) => p === b[i]);
}

// `Promise.all` allocates a fresh promise every call, so comparing ITS
// identity across repeat polls is never stable — that re-arms a `.then()`
// on every poll and never lets the caller observe "settled", even once the
// underlying work is done. Compares the source promises themselves instead.
function createSettledTracker(
  collectPromises: () => PromiseLike<unknown>[],
  onSettled: () => void,
  onError: (err: unknown) => void,
): () => boolean {
  let tracked: PromiseLike<unknown>[] | null = null;
  let settled = true;
  return () => {
    const promises = collectPromises();
    if (promises.length === 0) {
      tracked = null;
      settled = true;
      return true;
    }
    if (samePromiseSet(promises, tracked)) return settled;
    tracked = promises;
    settled = false;
    const combined: PromiseLike<unknown> =
      promises.length === 1 ? promises[0]! : Promise.all(promises);
    void Promise.resolve(combined).then(
      () => {
        if (tracked !== promises) return;
        settled = true;
        onSettled();
      },
      (err) => {
        if (tracked !== promises) return;
        settled = true;
        onError(err);
        onSettled();
      },
    );
    return settled;
  };
}

function readSceneParts(doc: Document): SceneParts | null {
  const content = doc.querySelector(`meta[name="${SCENE_PARTS_META}"]`)?.getAttribute("content");
  if (!content) return null;
  try {
    return JSON.parse(content) as SceneParts;
  } catch {
    return null;
  }
}

// A media element's attributes and content, less the grading capture stamped on it at parse time.
const authoredShape = (el: Element): string =>
  JSON.stringify([
    Array.from(el.attributes, (a) => [a.name, a.value]).filter(
      ([name]) => name !== COLOR_GRADING_AUTHORED_OPACITY_ATTR,
    ),
    el.innerHTML,
  ]);

// What the runtime writes on a video or audio: style (reset on a kept one), preload, the opacity stamp, a moved
// element's original translate and its own __hf- classes. A proxied src is compared as written; a bound one is not.
const RUNTIME_MEDIA_ATTRS = new Set([
  "style",
  "preload",
  "src",
  COLOR_GRADING_AUTHORED_OPACITY_ATTR,
  EDIT_ORIGINAL_TRANSLATE_ATTR,
]);
const ownClasses = (value: string) =>
  value
    .split(/\s+/)
    .filter((c) => c && !c.startsWith("__hf-"))
    .join(" ");
const writtenShape = (el: Element): string =>
  JSON.stringify([
    Array.from(el.attributes, ({ name, value }) => [
      name,
      name === "class" ? ownClasses(value) : value,
    ])
      .filter(([name, value]) => !RUNTIME_MEDIA_ATTRS.has(name!) && !(name === "class" && !value))
      .sort(([a], [b]) => (a! < b! ? -1 : 1)),
    el.hasAttribute("data-var-src") ? null : unproxiedSrc(el),
    el.innerHTML,
  ]);

// Each video and audio as written, recorded as the page parses: a scene script can write to it before init.
const authoredMedia = new WeakMap<Element, string>();
const isMedia = (el: Element) => el.localName === "video" || el.localName === "audio";
const recordAuthoredMedia = (node: Node) => {
  if (!isElementNode(node)) return;
  // The parser adds one childless element at a time, so most nodes stop at the first check.
  const media = isMedia(node)
    ? [node]
    : node.firstElementChild
      ? node.querySelectorAll("video, audio")
      : [];
  for (const el of media) if (!authoredMedia.has(el)) authoredMedia.set(el, authoredShape(el));
};
let authoredMediaObserver: MutationObserver | null = null;

/** On a page with a scene manifest, records media as it parses, before scene scripts run; init stops it. */
export function installAuthoredMediaCapture(): void {
  if (typeof MutationObserver === "undefined" || !readSceneParts(document)) return;
  recordAuthoredMedia(document.documentElement);
  authoredMediaObserver = new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach(recordAuthoredMedia);
      // The parser can yield inside a <video>, so its <source> children may arrive after it.
      const { target } = record;
      if (isElementNode(target) && isMedia(target))
        authoredMedia.set(target, authoredShape(target));
    }
  });
  authoredMediaObserver.observe(document.documentElement, { childList: true, subtree: true });
}

// Mid-tween, GSAP's default force3D writes translate3d, and Chrome snaps a crop edge on it to whole pixels.
// Runs at script evaluation: GSAP is configured as its bundle assigns window.gsap, before a composition's
// set() or from() parses an element. Chains to an accessor already there (the producer's early stub).
export function installFlatGsapTransforms(): void {
  const flatten = (g: Window["gsap"]) => g?.config?.({ force3D: false });
  const prior = Object.getOwnPropertyDescriptor(window, "gsap");
  let loaded = window.gsap;
  flatten(loaded);
  if (prior?.configurable === false || (prior?.get as { hfFlat?: true } | undefined)?.hfFlat)
    return;
  const get = Object.assign(() => (prior?.get ? prior.get.call(window) : loaded), {
    hfFlat: true,
  });
  Object.defineProperty(window, "gsap", {
    configurable: true,
    enumerable: true,
    get,
    set: (g: Window["gsap"]) => {
      if (prior?.set) prior.set.call(window, g);
      else loaded = g;
      flatten(g);
    },
  });
}

// URL attributes a scene swap checks besides src, poster and srcset, by tag.
const MEDIA_URL_ATTRS = new Map([
  ["image", ["href", "xlink:href"]],
  ["object", ["data"]],
]);

const SLOW_IDLE_HEARTBEAT_MS = 1000;

// One document.getAnimations() per seek and the pause after it, read on first use, shared by all adapters.
function pageAnimationsForOnePass(): () => Animation[] {
  let list: Animation[] | undefined;
  return () => (list ??= document.getAnimations());
}

// A `<video>` joins only for a gain `el.volume` cannot express: capture is a one-way door.
const joinsWebAudio = (el: Element): el is HTMLMediaElement =>
  isAudioElement(el) ||
  (isVideoElement(el) &&
    isAudibleVideoElement(el) &&
    audibleVideoNeedsWebAudio({
      volume: Number.parseFloat(el.dataset.volume ?? ""),
      fxChain: el.getAttribute("data-fx-chain"),
      automation: el.getAttribute("data-automation"),
      audioGroup: el.getAttribute("data-audio-group"),
    }));
const WEB_AUDIO_MEDIA = "audio[data-start], video[data-start]";
const webAudioMediaIn = (root: ParentNode): HTMLMediaElement[] =>
  Array.from(root.querySelectorAll(WEB_AUDIO_MEDIA)).filter(joinsWebAudio);

/** Studio's lazy images in `root` load now: a hidden clip has no layout box, so lazy ones would never fetch. */
function loadPreviewImagesIn(root: Element): void {
  const images = root.matches(`[${STUDIO_PREVIEW_LAZY_ATTR}]`)
    ? [root]
    : Array.from(root.querySelectorAll(`img[${STUDIO_PREVIEW_LAZY_ATTR}]`)).filter(
        (img) => img.closest("[data-start]") === root,
      );
  for (const img of images) img.setAttribute("loading", "eager");
}

export function initSandboxRuntimeModular(): void {
  const state = createRuntimeState();
  authoredMediaObserver?.disconnect();
  authoredMediaObserver = null;
  if (readSceneParts(document)) recordAuthoredMedia(document.documentElement);
  // Runtime-data handlers may replace the timeline object they mutate. Keep the
  // reconciliation callback late-bound because the reporter is installed before
  // the timeline resolver/binder is declared below. Delivery cannot complete
  // until after init has installed the final callback.
  let reconcileTimelineAfterRuntimeData: () => void = () => undefined;
  // Own the analytics bridge before any best-effort runtime installation so
  // early failures are observable instead of disappearing before player setup.
  initRuntimeAnalytics(postRuntimeMessage as (payload: unknown) => void);
  setRuntimeDataErrorReporter((channel, requestId, error) => {
    postRuntimeMessage({
      source: "hf-preview",
      type: "runtime-data-error",
      channel,
      requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  });
  setRuntimeDataAppliedReporter((channel, requestId) => {
    try {
      reconcileTimelineAfterRuntimeData();
    } catch (error) {
      postRuntimeMessage({
        source: "hf-preview",
        type: "runtime-data-error",
        channel,
        requestId,
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    postRuntimeMessage({
      source: "hf-preview",
      type: "runtime-data-applied",
      channel,
      requestId,
    });
  });
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
  // `<hf-audio-group>` is metadata, so it must not occupy a box — see
  // ensureAudioGroupInertStyle. Injected here, before timelines bind, so no
  // captured frame ever sees the group as a layout item.
  ensureAudioGroupInertStyle(document);
  const exportRenderFps = resolveExportRenderFps();
  state.canonicalFps = exportRenderFps.fps ?? state.canonicalFps;
  setRuntimeProtocolFps(state.canonicalFps);
  if (window.__HF_EXPORT_RENDER_SEEK_CONFIG) {
    const fpsDetail = JSON.stringify({
      canonicalFps: state.canonicalFps,
      source: exportRenderFps.source,
      rawFpsSource: exportRenderFps.rawFpsSource,
      rawFps: exportRenderFps.rawFps,
      fallbackReason: exportRenderFps.fallbackReason,
    });
    console.info(`[hyperframes] render runtime fps ${fpsDetail}`);
  }
  let colorGradingRuntime: RuntimeColorGradingApi | null = null;
  let runtimeErrorListener: ((event: ErrorEvent) => void) | null = null;
  let runtimeUnhandledRejectionListener: ((event: PromiseRejectionEvent) => void) | null = null;
  const runtimeCleanupCallbacks: Array<() => void> = [];
  const postedDiagnosticKeys = new Set<string>();
  let rootStageDiagnosticRafId: number | null = null;
  const reportedRuntimeIssues = new Set<string>();
  const reportRuntimeIssueOnce = (
    key: string,
    event: "auto_marker_install_failed" | "custom_ease_install_failed",
    properties: Record<string, string>,
  ): void => {
    if (reportedRuntimeIssues.has(key)) return;
    reportedRuntimeIssues.add(key);
    emitAnalyticsEvent(event, properties);
  };
  if (typeof window.__hfRuntimeTeardown === "function") {
    try {
      window.__hfRuntimeTeardown();
    } catch (err) {
      // keep runtime resilient across reinits
      swallow("runtime.init.site1", err);
    }
  }
  // Transport resources are initialized before any player or media closures.
  // This removes the old temporal-dead-zone fallback and lets the public player
  // be constructed once with its final clock-backed behavior.
  const clock = new TransportClock();
  state.transportClock = clock;
  const webAudio = new WebAudioTransport();
  let webAudioReady = false;
  void webAudio.init().then((ok) => {
    webAudioReady = ok;
  });
  window.__hf = window.__hf || {};
  /** Hidden by an ancestor, or by the BUS this clip belongs to. The bus is
   *  never an ancestor — membership is on the member's `data-audio-group` — so
   *  `closest()` alone could not see a muted group, which the render drops. */
  const isSilencedByHidden = (el: Element): boolean =>
    el.closest("[data-hidden]") !== null || isMemberGroupHidden(el.ownerDocument, el);
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
    } catch (err) {
      reportRuntimeIssueOnce("auto_marker_install_failed", "auto_marker_install_failed", {
        reason: "threw",
      });
      swallow("runtime.autoMarker.install", err);
      // a stray warning is preferable to a broken runtime
    }
  };
  const ensureStudioCustomEase = (): void => {
    const g = window.gsap;
    if (!g) {
      reportRuntimeIssueOnce("custom_ease_missing_gsap", "custom_ease_install_failed", {
        reason: "missing_gsap",
      });
      return;
    }
    try {
      if (!installStudioCustomEase(g)) {
        reportRuntimeIssueOnce("custom_ease_no_parse_ease", "custom_ease_install_failed", {
          reason: "no_parseEase",
        });
      }
    } catch (err) {
      reportRuntimeIssueOnce("custom_ease_install_threw", "custom_ease_install_failed", {
        reason: "threw",
      });
      swallow("runtime.customEase.install", err);
      // falling back to GSAP's default ease is preferable to a broken runtime
    }
  };
  ensureAutoMarkerNoop();
  ensureStudioCustomEase();
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

  // Agents often write `window.__timelines = [tl]` (array) instead of the
  // keyed-by-composition-id object the runtime expects. Normalize at init so
  // the rest of the pipeline can assume a Record<string, timeline>.
  if (Array.isArray(window.__timelines)) {
    const arr = window.__timelines as unknown[];
    const rootId = findRootCompositionElement()?.getAttribute("data-composition-id") ?? "root";
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
  const rootComp = findRootCompositionElement();
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
    seek: (timeSeconds: number, options?: { keepPlaying?: boolean }) => HeldSeek;
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
    const parsed = parseLayoutDimension(value);
    return parsed === null ? null : `${parsed}px`;
  };

  const resolveRootCompositionElement = (): HTMLElement | null => findRootCompositionElement();

  const applyCompositionSizing = () => {
    const rootEl = resolveRootCompositionElement();
    if (!rootEl) return;
    const forcedWidth = parseDimensionPx(rootEl.getAttribute("data-width"));
    const forcedHeight = parseDimensionPx(rootEl.getAttribute("data-height"));
    if (forcedWidth) rootEl.style.width = forcedWidth;
    if (forcedHeight) rootEl.style.height = forcedHeight;
    if (forcedWidth) rootEl.style.setProperty("--comp-width", forcedWidth);
    if (forcedHeight) rootEl.style.setProperty("--comp-height", forcedHeight);
    // A scaffolded project's `html, body` CSS is fixed at init time to whatever
    // resolution the template shipped with. An agent that edits ONLY the root's
    // data-width/data-height (without `hyperframes init --resolution`, which
    // rewrites html/body together with the root) leaves body at the stale
    // size, so its `overflow: hidden` (set unconditionally above, to keep
    // browser-default margins from bleeding into renders as white bars)
    // clips this composition — sized correctly above — at the stale height.
    // Mirror the SAME forced values onto documentElement/body (not a second
    // read of the root's own dimensions): once body's own size agrees with
    // the root it contains, `overflow: hidden` clips nothing that matters and
    // the white-bar guard stays intact. `findRootCompositionElement` returns
    // the outermost `[data-root="true"]` composition by convention, not by a
    // structural guarantee — this only ever affects a document whose author
    // marked a NESTED composition `data-root="true"` too, which nothing in
    // this runtime currently validates.
    if (forcedWidth) document.documentElement.style.width = forcedWidth;
    if (forcedHeight) document.documentElement.style.height = forcedHeight;
    if (forcedWidth) document.body.style.width = forcedWidth;
    if (forcedHeight) document.body.style.height = forcedHeight;
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
    const clips = (Array.from(rootEl.children) as HTMLElement[]).filter((el) => {
      const tag = el.tagName.toLowerCase();
      if (tag === "script" || tag === "style" || tag === "link" || tag === "meta") return false;
      if (!el.hasAttribute("data-start")) return false;
      // Runtime-stamped clips are NOT authored overlay clips. In Studio/preview
      // the runtime stamps `data-start` onto ID'd or GSAP-targeted flow children
      // (a <header>/<footer> in a flex column) so the design panel can discover
      // them — see the stamping pass in bindCapturedTimeline. Forcing those out
      // of document flow collapses the layout: the footer shrink-wraps and its
      // `justify-content: space-between` clusters in the top-left. Leave them in
      // flow so the preview matches the rendered video, which never stamps
      // (production renders run as the top-level page, not in an iframe).
      return !el.hasAttribute("data-hf-autostamped");
    });
    const displayNoneLiftedToMeasureShown = clips
      .filter((el) => el.style.getPropertyValue("display") === "none")
      .map((el) => ({ el, priority: el.style.getPropertyPriority("display") }));
    for (const { el } of displayNoneLiftedToMeasureShown) el.style.removeProperty("display");
    for (const el of clips) {
      const tag = el.tagName.toLowerCase();
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
    for (const { el, priority } of displayNoneLiftedToMeasureShown) {
      el.style.setProperty("display", "none", priority);
    }
  };

  const createTimingResolver = (includeAuthoredTimingAttrs: boolean) =>
    createRuntimeStartTimeResolver({
      timelineRegistry: (window.__timelines ?? {}) as Record<
        string,
        RuntimeTimelineLike | undefined
      >,
      includeAuthoredTimingAttrs,
    });

  // `createRuntimeStartTimeResolver` memoizes starts and durations in WeakMaps,
  // but a resolver built per call throws those caches away before the second
  // lookup ever happens, so one pass re-walks every ancestor chain once per
  // element. `withTimingResolver` installs ONE resolver for the duration of a
  // synchronous callback; every resolve inside shares its caches.
  //
  // NEVER widen these into a single scope spanning a whole media pass.
  // `syncRuntimeMedia` calls `el.load()` on the seek-past-buffered-range retry
  // (media.ts), which synchronously resets `el.duration` to NaN, and
  // `resolveDurationForElement` reads `element.duration` (startResolver.ts). A
  // cache living across `refreshRuntimeMediaCache` -> `syncRuntimeMedia` ->
  // `syncTimedElementVisibility` would serve the pre-`load()` duration to a
  // post-`load()` read. Two scopes with the write in between is what makes that
  // impossible. Do not merge them.
  let activeTimingResolver: ReturnType<typeof createTimingResolver> | null = null;

  const withTimingResolver = <T>(fn: () => T): T => {
    const previous = activeTimingResolver;
    activeTimingResolver = createTimingResolver(true);
    try {
      return fn();
    } finally {
      activeTimingResolver = previous;
    }
  };

  // The installed resolver carries authored timing attrs; a caller that opts
  // out gets its own, exactly as before.
  const timingResolverFor = (includeAuthoredTimingAttrs: boolean) =>
    includeAuthoredTimingAttrs && activeTimingResolver
      ? activeTimingResolver
      : createTimingResolver(includeAuthoredTimingAttrs);

  const resolveStartForElement = (
    element: Element,
    fallback = 0,
    opts?: { includeAuthoredTimingAttrs?: boolean },
  ): number =>
    timingResolverFor(opts?.includeAuthoredTimingAttrs ?? true).resolveStartForElement(
      element,
      fallback,
    );

  const resolveDurationForElement = (
    element: Element,
    opts?: { includeAuthoredTimingAttrs?: boolean },
  ): number | null =>
    timingResolverFor(opts?.includeAuthoredTimingAttrs ?? true).resolveDurationForElement(element);

  const resolveMediaCompositionContext = (element: Element) => {
    const compositionRoot = element.closest("[data-composition-id]");
    const inheritedStart = compositionRoot ? resolveStartForElement(compositionRoot, 0) : null;
    const inheritedDuration = compositionRoot
      ? resolveDurationForElement(compositionRoot, { includeAuthoredTimingAttrs: true })
      : null;
    return { compositionRoot, inheritedStart, inheritedDuration };
  };

  // Single owner: `createRuntimeStartTimeResolver` (startResolver.ts). The clip
  // manifest resolves media starts through the same method, so what the studio
  // draws and what the transport plays cannot drift apart.
  const resolveAbsoluteMediaStartSeconds = (element: Element): number =>
    timingResolverFor(true).resolveMediaStartForElement(element);

  window.__hfResolveMediaStartSeconds = resolveAbsoluteMediaStartSeconds;
  runtimeCleanupCallbacks.push(() => {
    if (window.__hfResolveMediaStartSeconds === resolveAbsoluteMediaStartSeconds) {
      delete window.__hfResolveMediaStartSeconds;
    }
  });

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

  // Scope 3 of 3 (see `withTimingResolver`). Every media element resolves its
  // composition ancestry here, and this runs on every transport tick via
  // `getSafeTimelineDurationSeconds`, so it is the heaviest consumer of the
  // per-call resolvers.
  //
  // The scope sits HERE and not on `getSafeTimelineDurationSeconds`, which
  // would look like the tidier boundary: that function also calls
  // `timeline.duration()` (author-supplied GSAP) and every adapter's
  // `getInferredDurationSeconds()` (third-party runtimes). Foreign code inside
  // a cache scope can touch the DOM between two resolves. This loop is DOM
  // reads only, so nothing can change under it.
  const resolveMediaWindowDurationSeconds = (): number | null => {
    const mediaNodes = Array.from(
      document.querySelectorAll("video[data-start], audio[data-start]"),
    ) as HTMLMediaElement[];
    // Checked before the scope opens: a composition with no timed media runs
    // this every tick, and it should not pay for a resolver it never uses.
    if (mediaNodes.length === 0) return null;
    return withTimingResolver(() =>
      resolveMediaWindowDurationSecondsIn(document, {
        mediaStart: resolveAbsoluteMediaStartSeconds,
        mediaDuration: resolveMediaElementDurationSeconds,
      }),
    );
  };

  const resolveAuthoredCompositionDurationFloorSeconds = (): number | null => {
    const rootEl = resolveRootCompositionElement();
    if (!rootEl) return null;
    const timelines = (window.__timelines ?? {}) as Record<string, RuntimeTimelineLike | undefined>;
    const startResolver = createRuntimeStartTimeResolver({
      timelineRegistry: timelines,
      includeAuthoredTimingAttrs: true,
    });
    // getSafeTimelineDurationSeconds returns the declared length first; here it only sizes the
    // stand-in timeline that resolveRootTimelineFromDocument builds for a root timeline with no
    // length.
    return resolveAuthoredCompositionFloorSeconds(rootEl, startResolver);
  };

  /** The last-resort length: the latest end among the root's timed clips, used only when no
   *  timeline, floor or caller-supplied length exists. Pending media is counted, not guessed. */
  // Lottie registers its animations from author scripts, often after the runtime is ready, and
  // nothing in the DOM says when: a loaded library means a length that is still pending.
  const hasLottieLibrary = (): boolean => {
    const lottieWindow = window as Window & { lottie?: unknown; DotLottie?: unknown };
    return Boolean(lottieWindow.lottie || lottieWindow.DotLottie);
  };
  const resolveContentDerivedDuration = () => {
    const rootEl = resolveRootCompositionElement();
    if (!rootEl)
      return resolveCompositionDuration({ authoredDurationSeconds: null, clipEndsSeconds: [] });
    const startResolver = createRuntimeStartTimeResolver({
      timelineRegistry: (window.__timelines ?? {}) as Record<
        string,
        RuntimeTimelineLike | undefined
      >,
      includeAuthoredTimingAttrs: true,
    });
    return resolveContentDerivedDurationFor(rootEl, startResolver, {
      unregisteredLottie: hasLottieLibrary(),
    });
  };

  let contentDerivedCache: {
    revision: number;
    result: ReturnType<typeof resolveContentDerivedDuration>;
  } | null = null;
  /** Cached per timing revision like the floors; the render path never reads a cache. */
  const readContentDerivedDuration = () => {
    if (renderCaptureSeekStarted) return resolveContentDerivedDuration();
    const revision = readCompositionTimingRevision();
    if (contentDerivedCache?.revision !== revision) {
      contentDerivedCache = { revision, result: resolveContentDerivedDuration() };
    }
    return contentDerivedCache.result;
  };

  /** Carries how a length that no timeline supplied was found, for render telemetry. */
  const publishDerivedDuration = (result: ReturnType<typeof resolveCompositionDuration>) => {
    window.__hf = window.__hf || {};
    window.__hf.durationSource = {
      source: result.source,
      seconds: result.seconds,
      pendingClips: result.pendingClips,
    };
    if (result.source !== "derived") return;
    postRuntimeDiagnosticOnce(
      "composition_duration_derived",
      { source: result.source, seconds: result.seconds, pendingClips: result.pendingClips },
      `composition_duration_derived:${result.seconds}`,
    );
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
  const resolveAdapterDurationFloorSeconds = (oneCycle = false): number | null => {
    let maxSeconds = 0;
    for (const adapter of state.deterministicAdapters) {
      const getter = oneCycle
        ? adapter.getAnimationCycleEndSeconds
        : adapter.getInferredDurationSeconds;
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

  // Flips true on the first renderSeek call — the render/producer capture
  // protocol's signal that it has started deterministically driving frames.
  // One-way for this page lifetime; every producer render gets a fresh runtime.
  // See scheduleMetadataDurationHydration for why this gates the async
  // metadata rebind off once set, and resolveDurationFloors for why the
  // derived-duration cache is bypassed entirely once it is set.
  let renderCaptureSeekStarted = false;

  /**
   * An export render is driving frames deterministically.
   *
   * The PAIR, never `renderCaptureSeekStarted` alone: `renderSeek` is also what
   * Studio's own preview falls back to for overhanging timelines
   * (`playbackAdapter.createStaticSeekPlaybackAdapter`), so the flag alone
   * latches on the first Studio scrub of such a project and stays true for the
   * rest of that session. `__HF_EXPORT_RENDER_SEEK_CONFIG` is injected by the
   * producer's page script before a single frame is driven, so the pair is
   * true for a real render and nothing else.
   *
   * Two callers rely on this being one decision with one owner: the async
   * metadata rebind, which must not race the capture loop, and the transport
   * loop, which must not park while a render is in charge of frames.
   */
  const isExportRenderDrivingFrames = (): boolean =>
    renderCaptureSeekStarted && window.__HF_EXPORT_RENDER_SEEK_CONFIG != null;

  // The media and authored-composition duration floors are derived from the
  // DOM and the timeline registry — never from the playhead — so they change
  // only when the composition changes. transportTick asks for them on EVERY
  // animation frame, and deriving them scans every media element and walks
  // each one's composition ancestry, which is the largest single cost of a
  // paused, untouched editor. Derive once and reuse until an input changes.
  //
  // Every input that can change the answer, and the signal that catches it:
  //   - timing attributes edited (Studio live editing, variables re-applied,
  //     the runtime's own autostamping)      -> MutationObserver, attribute filter below
  //   - media or timed elements added/removed (nested compositions mount
  //     asynchronously, well after init)     -> MutationObserver, childList + subtree
  //   - media metadata arriving or being reset (`el.load()` puts `duration`
  //     back to NaN) — no DOM mutation at all -> capture-phase media events below
  //   - a timeline registered, or an existing one's duration changing, in
  //     `window.__timelines` (a plain object, not observable) -> registry
  //     signature compared on read
  // The bias is deliberate: a redundant derivation is a missed optimisation,
  // a missed one is a wrong duration.
  type DurationFloors = { media: number | null; authoredComposition: number | null };
  const DURATION_FLOOR_INPUT_ATTRIBUTES = [
    "data-start",
    "data-duration",
    "data-end",
    "data-composition-id",
    "data-composition-src",
    "data-composition-file",
    "data-root",
    "data-hf-authored-duration",
    "data-hf-authored-end",
    "data-hf-auto-start",
    MEDIA_START_BASIS_ATTR,
    "data-playback-rate",
    "data-automation",
    "data-playback-start",
    "data-media-start",
    // `data-start` may be an expression referencing another element by id, and
    // a media element's `duration` follows its source.
    "id",
    "src",
  ];
  const COMPOSITION_TIMING_MEDIA_EVENTS = ["loadedmetadata", "durationchange", "emptied"] as const;
  let durationFloorsCache: DurationFloors | null = null;
  let durationFloorsRevision = -1;
  let timelineRegistrySignature: string | null = null;
  let compositionTimingObserver: MutationObserver | null = null;

  // Bumped whenever anything above can have moved a clip's window. Two caches
  // read it: the duration floors, and the media clip index below. It is a
  // counter rather than a per-cache flag because DRAINING the observer is what
  // detects a change, and only the first reader in a task gets the records — a
  // second cache checking for itself would be told nothing changed.
  let compositionTimingRevision = 0;

  // Restarts the transport loop when it has parked itself (see
  // `scheduleNextTransportFrame`). Held as a reassignable binding because the
  // invalidation hooks below are installed long before the transport exists,
  // and reaching forward into its `const` would be a temporal-dead-zone throw
  // during init.
  let wakeTransport: () => void = () => {};

  const invalidateCompositionTimingCaches = () => {
    compositionTimingRevision += 1;
    // The same records that stale the duration caches are what a parked
    // transport is waiting for: a timing attribute edited, a sub-composition
    // mounted, media metadata arriving. One signal, two readers.
    wakeTransport();
  };

  const deriveDurationFloors = (): DurationFloors => ({
    media: resolveMediaDurationFloorSeconds(),
    authoredComposition: resolveAuthoredCompositionDurationFloorSeconds(),
  });

  const readTimelineRegistrySignature = (): string => {
    const timelines = (window.__timelines ?? {}) as Record<string, RuntimeTimelineLike | undefined>;
    let signature = "";
    for (const timelineId of Object.keys(timelines)) {
      const timeline = timelines[timelineId];
      if (!timeline) continue;
      signature += `${timelineId}=${getTimelineDurationSeconds(timeline) ?? "?"};`;
    }
    return signature;
  };

  const watchCompositionTimingInputs = () => {
    if (compositionTimingObserver || typeof MutationObserver === "undefined") return;
    compositionTimingObserver = new MutationObserver(invalidateCompositionTimingCaches);
    compositionTimingObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      // Sizing inputs too: postTimeline applies them, and it runs when this revision moves.
      attributeFilter: [...DURATION_FLOOR_INPUT_ATTRIBUTES, "data-width", "data-height"],
    });
    // Media duration changes are published as events, not DOM mutations, and
    // they do not bubble — so listen in the capture phase, which reaches every
    // media element including ones added long after this binds.
    for (const eventType of COMPOSITION_TIMING_MEDIA_EVENTS) {
      document.addEventListener(eventType, invalidateCompositionTimingCaches, true);
    }
    runtimeCleanupCallbacks.push(() => {
      compositionTimingObserver?.disconnect();
      compositionTimingObserver = null;
      invalidateCompositionTimingCaches();
      for (const eventType of COMPOSITION_TIMING_MEDIA_EVENTS) {
        document.removeEventListener(eventType, invalidateCompositionTimingCaches, true);
      }
    });
  };

  /**
   * The current revision, after taking every signal that could have moved it.
   * Call this exactly once per read, and compare it with the revision a cache
   * was built at.
   */
  const readCompositionTimingRevision = (): number => {
    watchCompositionTimingInputs();
    // MutationObserver records are delivered in a microtask, so a caller that
    // edits a timing attribute and reads a window back in the SAME synchronous
    // block would otherwise be served the pre-edit value. Draining the queue
    // here makes the caches correct within a task, not just across tasks.
    // Taking the records suppresses the callback for them, which is exactly
    // equivalent since the callback only bumps the revision.
    if (compositionTimingObserver && compositionTimingObserver.takeRecords().length > 0) {
      invalidateCompositionTimingCaches();
    }
    // `window.__timelines` is a plain object: no MutationObserver and no event
    // can see a composition script registering into it or lengthening what it
    // already registered, so its shape is compared on every read.
    const signature = readTimelineRegistrySignature();
    if (signature !== timelineRegistrySignature) {
      timelineRegistrySignature = signature;
      invalidateCompositionTimingCaches();
    }
    return compositionTimingRevision;
  };

  /**
   * `revision` lets a caller that has ALREADY read the revision in this task
   * hand it over instead of paying for a second read. Reading is not free —
   * it rebuilds a signature over every registered timeline — and it is also
   * what DRAINS the observer, so a second read in the same task is told
   * nothing changed and the work is pure duplication.
   */
  const resolveDurationFloors = (revision?: number): DurationFloors => {
    // The render path never reads a cached floor. Capture depends on the exact
    // duration and a frame that rendered against a wrong one cannot be
    // recovered, so it pays the full derivation on every frame exactly as
    // before — a correct slow render beats a fast wrong one.
    if (renderCaptureSeekStarted) return deriveDurationFloors();
    revision ??= readCompositionTimingRevision();
    if (durationFloorsCache && durationFloorsRevision === revision) return durationFloorsCache;
    durationFloorsRevision = revision;
    durationFloorsCache = deriveDurationFloors();
    return durationFloorsCache;
  };

  const getSafeTimelineDurationSeconds = (
    timeline: RuntimeTimelineLike | null,
    fallback = 0,
    timingRevision?: number,
  ): number => {
    let derivedDuration: ReturnType<typeof resolveContentDerivedDuration> | null = null;
    const seconds = resolveCompositionLengthSeconds({
      declared: parseStrictFiniteTimingNumber(
        resolveRootCompositionElement()?.getAttribute("data-duration"),
      ),
      timeline: () => getTimelineDurationSeconds(timeline),
      floors: () => {
        const { media, authoredComposition } = resolveDurationFloors(timingRevision);
        // Deliberately NOT cached: adapters infer their duration from live animation objects
        // (CSS/WAAPI/Lottie), which can change without any DOM mutation to observe.
        return [media, authoredComposition, resolveAdapterDurationFloorSeconds()];
      },
      fallback,
      derived: () => {
        derivedDuration = readContentDerivedDuration();
        return derivedDuration.seconds ?? 0;
      },
    });
    // The published source describes only a length that was derived; any other source clears it.
    if (derivedDuration) publishDerivedDuration(derivedDuration);
    else if (window.__hf?.durationSource) delete window.__hf.durationSource;
    return seconds;
  };

  // Sub-composition timelines the runtime nested into the root: the host composition id, and where.
  const autoNested = new WeakMap<object, { hostId: string; parent: unknown; at: number }>();
  // The composite that holds the children of a root with no timeline, and how many it holds.
  let missingRootComposite: { timeline: RuntimeTimelineLike; size: number } | null = null;

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
    const {
      media: mediaDurationFloorSeconds,
      authoredComposition: authoredCompositionDurationFloorSeconds,
    } = resolveDurationFloors();
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
    const nestAtHostStart = (
      parent: RuntimeTimelineLike,
      candidate: { compositionId: string; timeline: RuntimeTimelineLike },
    ): void => {
      const at = resolveCompositionStartSeconds(candidate.compositionId);
      parent.add(candidate.timeline, at);
      autoNested.set(candidate.timeline, { hostId: candidate.compositionId, parent, at });
    };
    /** Placed by the runtime in `root` and still there; under another root a re-run script owns its place. */
    const placedIn = (
      root: RuntimeTimelineLike,
      candidate: { compositionId: string; timeline: RuntimeTimelineLike },
    ) => {
      const nested = candidate.timeline as RuntimeTimelineLike & RuntimeTimelineChildLike;
      const placed = autoNested.get(nested);
      return placed && placed.parent === root && nested.parent === (root as unknown)
        ? placed
        : null;
    };
    const atHostStart = (placed: { at: number }, candidate: { compositionId: string }) =>
      Math.abs(placed.at - resolveCompositionStartSeconds(candidate.compositionId)) < 1e-6;
    const followHostStart = (
      root: RuntimeTimelineLike,
      candidate: { compositionId: string; timeline: RuntimeTimelineLike },
    ): void => {
      const placed = placedIn(root, candidate);
      if (!placed || atHostStart(placed, candidate)) return;
      // GSAP takes a child out of its parent before adding it; the rebind's unpause aligns it to the root.
      nestAtHostStart(root, candidate);
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
      for (const candidate of candidates) nestAtHostStart(compositeTimeline, candidate);
      // Before any duration read: GSAP leaves paused children out of the duration it caches.
      ensureChildCandidatesActive(nestedCandidates(compositeTimeline, candidates));
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
          swallow("runtime.init.site2", err);
        }
        // A paused child never renders under its parent's seek; the wrapper drives it now.
        ensureChildCandidatesActive(
          nestedCandidates(fallbackTimeline, [{ timeline: existingRootTimeline }]),
        );
      }
      const withTween = fallbackTimeline as RuntimeTimelineLike & {
        to?: (target: object, vars: { duration?: number; data?: string }) => unknown;
      };
      if (typeof withTween.to === "function") {
        try {
          withTween.to({}, { duration: durationSeconds, data: RUNTIME_FILLER });
        } catch (err) {
          // no-op; if tween creation fails, caller will discard by unusable duration
          swallow("runtime.init.site3", err);
        }
      }
      return fallbackTimeline;
    };
    // Read back from the parent rather than trusting add(): a child the parent
    // does not hold stays on GSAP's global ticker, where unpaused means free-running.
    const nestedCandidates = <C extends { timeline: RuntimeTimelineLike }>(
      parent: RuntimeTimelineLike | null,
      candidates: C[],
    ): C[] => {
      if (!parent || typeof parent.getChildren !== "function") return [];
      try {
        const held = parent.getChildren(true, true, true);
        return Array.isArray(held) ? candidates.filter((c) => held.includes(c.timeline)) : [];
      } catch {
        return [];
      }
    };
    const addMissingChildCandidatesToRootTimeline = (
      rootTimeline: RuntimeTimelineLike,
      candidates: Array<{
        compositionId: string;
        timeline: RuntimeTimelineLike;
        durationSeconds: number;
      }>,
    ): { addedIds: string[]; nested: typeof candidates } => {
      const rootWithChildren = rootTimeline as RuntimeTimelineLike & {
        getChildren?: (...args: unknown[]) => unknown[];
      };
      const none = { addedIds: [], nested: [] };
      if (typeof rootWithChildren.getChildren !== "function") return none;
      try {
        const existingChildren = rootWithChildren.getChildren(true, true, true) ?? [];
        if (!Array.isArray(existingChildren)) return none;
        const addedIds: string[] = [];
        for (const candidate of candidates) {
          if (existingChildren.includes(candidate.timeline)) {
            followHostStart(rootTimeline, candidate);
            continue;
          }
          try {
            nestAtHostStart(rootTimeline, candidate);
            addedIds.push(candidate.compositionId);
          } catch (err) {
            // ignore broken child add attempts
            swallow("runtime.init.site4", err);
          }
        }
        return { addedIds, nested: nestedCandidates(rootTimeline, candidates) };
      } catch {
        return none;
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
      candidates: Array<{ timeline: RuntimeTimelineLike }>,
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
    if (rootTimeline) {
      // Only a child the root actually holds may run unpaused: the paused root
      // drives it. A standalone registry child is re-seeked by the transport and
      // must stay paused, or it free-runs on the global ticker while paused.
      const nesting =
        rootChildCandidates.length > 0
          ? addMissingChildCandidatesToRootTimeline(rootTimeline, rootChildCandidates)
          : { addedIds: [], nested: [] };
      const autoNestedChildren = nesting.addedIds;
      ensureChildCandidatesActive(nesting.nested);
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
      dropRuntimeFillers(rootTimeline);
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
      const rootDeclaredDur = parseStrictFiniteTimingNumber(
        rootCompositionNode?.getAttribute("data-duration"),
      );
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
            to?: (
              target: object,
              vars: { duration: number; data: string },
              position: number,
            ) => unknown;
          };
          if (typeof tlWithTo.to === "function") {
            try {
              // Placing a zero-duration tween at the floor extends
              // timeline.duration() to exactly that point.
              tlWithTo.to({}, { duration: 0, data: RUNTIME_FILLER }, rootDurationFloorSeconds);
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
      // A rebuild re-parents every child at time 0 and paints it there, under a paused drag too,
      // so the same children, each still at its host's start, keep the composite they sit in.
      const held = missingRootComposite;
      const reused =
        held?.size === rootChildCandidates.length &&
        isUsableTimelineDuration(getTimelineDurationSeconds(held.timeline)) &&
        rootChildCandidates.every((candidate) => {
          const placed = placedIn(held.timeline, candidate);
          return placed !== null && atHostStart(placed, candidate);
        })
          ? held.timeline
          : null;
      const compositeTimeline =
        reused ?? createCompositeTimelineFromCandidates(rootChildCandidates);
      const compositeDurationSeconds = getTimelineDurationSeconds(compositeTimeline);
      if (compositeTimeline) {
        if (!reused) {
          missingRootComposite = { timeline: compositeTimeline, size: rootChildCandidates.length };
        }
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
  // A GSAP keyframes tween (`{ keyframes: {...}, ease }`) builds an INNER timeline
  // whose own `_ease` GSAP resolves ONCE, at build time, via the internal
  // `_parseEase(vars.ease)` (gsap-core: `tl._ease = _parseEase(keyframes.ease ||
  // vars.ease || "none")`). On render it calls that inner `timeline._ease(...)`.
  // The composition's inline `<script>` runs and builds these tweens BEFORE this
  // runtime finishes registering the custom eases (hold/spring/wiggle/custom) in
  // GSAP's internal ease map — so for a custom container ease the inner `_ease`
  // bakes to `undefined`, and the first render throws "_ease is not a function"
  // (a masked cross-origin Script error). Registering the eases afterward can't
  // retro-fix that already-baked value, so re-resolve every keyframes tween's
  // inner `_ease` here, once the eases are registered.
  const repairKeyframeInnerEase = (tlLike: unknown): void => {
    const g = (window as unknown as { gsap?: { parseEase?: (e: unknown) => unknown } }).gsap;
    const tl = tlLike as { getChildren?: (a: boolean, b: boolean, c: boolean) => unknown[] } | null;
    if (!tl || typeof tl.getChildren !== "function" || !g || typeof g.parseEase !== "function")
      return;
    for (const child of tl.getChildren(true, true, true)) {
      const k = child as {
        timeline?: { _ease?: unknown };
        vars?: { ease?: unknown; keyframes?: unknown };
      };
      const inner = k.timeline;
      if (!inner || !("_ease" in inner) || typeof inner._ease === "function") continue;
      const kf = k.vars?.keyframes;
      const kfEase = kf && !Array.isArray(kf) ? (kf as { ease?: unknown }).ease : undefined;
      const ease = kfEase ?? k.vars?.ease ?? "none";
      try {
        const resolved = g.parseEase(ease);
        if (typeof resolved === "function") inner._ease = resolved;
      } catch (err) {
        emitAnalyticsEvent("keyframe_ease_repair_failed", {
          ease: typeof ease === "string" ? ease : String(ease),
        });
        swallow("runtime.keyframeEase.repair", err);
      }
    }
  };
  // fallow-ignore-next-line complexity
  const bindRootTimelineIfAvailable = (): boolean => {
    // Custom eases (hold/spring/wiggle/custom) must be registered in GSAP's
    // internal ease map BEFORE this function's prime render (progress/totalTime
    // below), or a keyframe segment using one resolves to a non-function ease
    // and GSAP throws "_ease is not a function" at render. The one-shot call in
    // init runs early, but if GSAP wasn't ready then (load-order race) it's a
    // no-op with no retry — so re-assert here, at the render site. Idempotent.
    ensureStudioCustomEase();
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
    // Repair keyframe inner-timeline eases before any prime render (see helper above).
    repairKeyframeInnerEase(state.capturedTimeline);
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
        pauseTimelineIfPossible(state.capturedTimeline);
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
        pauseTimelineIfPossible(state.capturedTimeline);
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
      // A bus is not a clip. `<hf-audio-group>` carries a group's label, fader,
      // mute and FX chain and has no timing of its own, so stamping it put it in
      // `__clipManifest` as a full-duration element — which the studio drew as an
      // ordinary clip row above the real group header. That row was draggable,
      // trimmable and deletable, and deleting it removed the bus, taking the
      // group's automation lanes and FX rack with it.
      const isAudioGroupBus = (el: Element): boolean =>
        el.tagName.toLowerCase() === HF_AUDIO_GROUP_TAG;
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
              if (!isHtmlElement(target)) continue;
              if (target === rootComp) continue;
              if (isAudioGroupBus(target)) continue;
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
      if (isHtmlElement(rootComp)) {
        for (const el of rootComp.querySelectorAll("[id]")) {
          if (!isHtmlElement(el)) continue;
          if (el === rootComp) continue;
          if (el.hasAttribute("data-start")) continue;
          if (hasAuthoredTimedAncestor(el)) continue;
          if (seen.has(el)) continue;
          if (el.tagName === "SCRIPT" || el.tagName === "STYLE" || el.tagName === "LINK") continue;
          if (isAudioGroupBus(el)) continue;
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

  const reconcileTimeline = () => {
    if (state.tornDown) return;
    const resolution = resolveRootTimelineFromDocument();
    if (!resolution.timeline) {
      // A successful clear must not leave the player seeking a killed timeline.
      state.capturedTimeline = null;
      childrenBound = false;
      clock.setDuration(0);
      syncTimedElementVisibility(state.currentTime);
      return;
    }

    // Avoid needlessly invalidating the child-binding cache when a handler
    // updates data in place. A replacement object is the signal that a rebind
    // is required.
    if (state.capturedTimeline !== resolution.timeline) {
      childrenBound = false;
      bindRootTimelineIfAvailable();
    } else {
      const length = getSafeTimelineDurationSeconds(state.capturedTimeline, 0);
      if (length > 0 && length !== clock.getDuration()) {
        clock.setDuration(length);
        postTimeline();
      }
    }
    syncTimedElementVisibility(state.currentTime);
  };
  reconcileTimelineAfterRuntimeData = () => {
    reconcileTimeline();
    // The parent treats runtime-data-applied as permission to re-seek immediately. Publish the
    // replacement duration first; otherwise that seek is clamped by the bootstrap timeline (often
    // one second) and a style switch appears frozen on the first caption segment until some later
    // polling tick happens to post the rebuilt timeline.
    postTimeline();
  };
  (window as Window & { __hfForceTimelineRebind?: () => void }).__hfForceTimelineRebind =
    reconcileTimeline;

  const emitRootStageLayoutDiagnostics = () => {
    const rootNode = resolveRootCompositionElement();
    if (!isHtmlElement(rootNode)) {
      return;
    }
    const rect = rootNode.getBoundingClientRect();
    const declaredWidth = parseLayoutDimension(rootNode.getAttribute("data-width"));
    const declaredHeight = parseLayoutDimension(rootNode.getAttribute("data-height"));
    const computedStyle = window.getComputedStyle(rootNode);
    const hasDeclaredDimensions = declaredWidth !== null && declaredHeight !== null;
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

  const assetNodesWithDiagnostics = new WeakSet<Element>();
  const installAssetFailureDiagnostics = () => {
    const assetNodes = Array.from(
      document.querySelectorAll("img, video, audio, source, link[rel='stylesheet']"),
    );
    for (const node of assetNodes) {
      if (assetNodesWithDiagnostics.has(node)) continue;
      assetNodesWithDiagnostics.add(node);
      const onError = () => {
        if (!isElementNode(node)) {
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
              isImageElement(node) || isMediaElement(node) ? node.currentSrc || null : null,
            readyState: isMediaElement(node) ? node.readyState : null,
            networkState: isMediaElement(node) ? node.networkState : null,
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
    state.capturedTimeline = resolution.timeline;
    if (typeof state.capturedTimeline.timeScale === "function") {
      state.capturedTimeline.timeScale(state.playbackRate);
    }
    try {
      // pause guarded separately: a PARTIAL timeline without pause() must not
      // abort restoring the transport time below (the catch would swallow it too).
      pauseTimelineIfPossible(state.capturedTimeline);
      if (typeof state.capturedTimeline.seek === "function") {
        state.capturedTimeline.seek(previousTime, false);
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
      // The render/producer capture protocol drives frames deterministically
      // via renderSeek — once it has claimed the timeline, an async
      // loadedmetadata/durationchange rebind racing that loop is exactly the
      // "double composite" hazard from HF#2550: this handler runs off its own
      // debounced browser-side timer, uncoordinated with the capture loop's
      // own seeks, so a rebind mid-capture can reflow the DOM between one
      // BeginFrame call and the next. Render-mode duration correction has
      // already happened deterministically during the probe stage before
      // capture starts, so once frames are being driven there is nothing left
      // for this self-correction to usefully do.
      //
      // Gated on the pair rather than renderCaptureSeekStarted alone, because
      // the flag alone would silently disable this self-correction for a live
      // Studio scrub too, where duration hasn't been pre-resolved by a probe
      // stage and still needs it. See isExportRenderDrivingFrames.
      if (isExportRenderDrivingFrames()) return;
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

  // Reactive/tertiary undecodable-media triggers (see mediaProxy.ts). Wrapped
  // as event listeners here — rather than exported directly — because
  // `addEventListener` hands the listener an `Event`, not the element;
  // `event.currentTarget` recovers it. Bound/unbound alongside the metadata
  // listeners below, reusing `metadataBoundMedia` as the once-per-element
  // dedupe (no separate tracking set needed).
  const onMediaLoadedMetadataForProxy = (event: Event) => {
    if (isMediaElement(event.currentTarget)) {
      handleMetadataForProxy(event.currentTarget);
    }
  };
  const onMediaErrorForProxy = (event: Event) => {
    if (isMediaElement(event.currentTarget)) {
      handleErrorForProxy(event.currentTarget);
    }
  };

  // Only media `joinsWebAudio` admits when a play is scheduled reaches
  // `createMediaElementSource`, so no other cross-origin media may be reported as if it did.
  const reportWebAudioRoute = (mediaEl: HTMLMediaElement) => {
    if (!joinsWebAudio(mediaEl)) return;
    // Before resource selection settles, the verdict is built from `<source>`
    // children the browser might still pass over — good enough for the
    // schedule path's conservative withhold, not good enough to put in front
    // of a human as a diagnostic. Skip; the `loadedmetadata` call to this same
    // function (see below) always has a settled `currentSrc` and will report
    // for real once the guess would no longer be one.
    if (!isRouteSelectionSettled(mediaEl)) return;
    reportWebAudioMediaRoute(mediaEl, classifyWebAudioMediaRoute(mediaEl));
  };

  const onMediaLoadedMetadataForRoute = (event: Event) => {
    const target = event.currentTarget;
    if (isMediaElement(target)) reportWebAudioRoute(target);
  };

  const unbindMedia = (mediaEl: HTMLMediaElement) => {
    mediaEl.removeEventListener("loadedmetadata", scheduleMetadataDurationHydration);
    mediaEl.removeEventListener("durationchange", scheduleMetadataDurationHydration);
    mediaEl.removeEventListener("loadedmetadata", onMediaLoadedMetadataForProxy);
    mediaEl.removeEventListener("loadedmetadata", onMediaLoadedMetadataForRoute);
    mediaEl.removeEventListener("error", onMediaErrorForProxy);
    metadataBoundMedia.delete(mediaEl);
  };
  const unbindMediaMetadataListeners = () => {
    for (const mediaEl of metadataBoundMedia) unbindMedia(mediaEl);
  };
  // A swapped-out scene's media is detached but still buffering: stop it and drop its sources.
  const releaseDetachedMedia = () => {
    for (const mediaEl of metadataBoundMedia) {
      if (mediaEl.isConnected) continue;
      unbindMedia(mediaEl);
      mediaEl.pause();
      stopMediaDownload(mediaEl);
    }
  };

  const authoredMediaVolume = (el: HTMLMediaElement): number | null => {
    const parsed = Number.parseFloat(el.dataset.volume ?? "");
    return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : null;
  };

  const bindMediaMetadataListeners = () => {
    if (state.tornDown) return;
    const mediaEls = Array.from(document.querySelectorAll("video, audio")) as HTMLMediaElement[];
    const nearPlayheadPending: HTMLMediaElement[] = [];
    for (const mediaEl of mediaEls) {
      if (metadataBoundMedia.has(mediaEl)) continue;
      metadataBoundMedia.add(mediaEl);
      const volume = authoredMediaVolume(mediaEl);
      if (volume !== null) mediaEl.volume = volume;
      mediaEl.addEventListener("loadedmetadata", scheduleMetadataDurationHydration);
      mediaEl.addEventListener("durationchange", scheduleMetadataDurationHydration);
      // Web Audio eligibility, reported at DISCOVERY rather than only at
      // schedule time. `hyperframes check` seeks, it never calls play(), so a
      // diagnostic raised from the transport would be invisible to the one
      // gate whose job is to surface exactly this class of silent failure.
      // Bound twice on purpose: now, for a `src`/committed-`currentSrc`
      // element so a composition that never plays still reports promptly, and
      // again at `loadedmetadata`, when `currentSrc` is unconditionally
      // authoritative. `reportWebAudioRoute` itself skips the "now" call when
      // selection hasn't settled (see `isRouteSelectionSettled`) — with only
      // `<source>` children to go on, the browser could still pick a
      // different one than the classifier just judged, and a diagnostic is a
      // claim of fact, not a guess. `reportWebAudioMediaRoute` latches per
      // element, so the deferred-to-`loadedmetadata` case still reports once.
      mediaEl.addEventListener("loadedmetadata", onMediaLoadedMetadataForRoute);
      reportWebAudioRoute(mediaEl);
      // Reactive (zero-videoWidth) + tertiary (error event) proxy-fallback
      // triggers. Inert in render mode / when the codec map is absent /
      // for <audio> — all guarded inside mediaProxy.ts itself.
      mediaEl.addEventListener("loadedmetadata", onMediaLoadedMetadataForProxy);
      mediaEl.addEventListener("error", onMediaErrorForProxy);

      // Proactive proxy-fallback trigger: consult the codec map and swap
      // BEFORE the eager load() below, so a known-hostile asset never even
      // attempts to load (and error-flash) the original. No-op in render
      // mode, for <audio>, or when the codec map is absent.
      maybeProxyProactively(mediaEl);

      // Studio's preview loads a timed clip only near the playhead; the visibility pass decides.
      if (inPreloadWindow(mediaEl)) nearPlayheadPending.push(mediaEl);
      else preloadMedia(mediaEl);

      // Probe volume automation from the GSAP timeline — same approach as the
      // renderer (see discoverAudioVolumeAutomationFromTimeline / audioMixer).
      // Runs only when the timeline is already captured; elements bound before
      // the timeline is ready are re-probed the first time bindMediaMetadataListeners
      // fires after the timeline has been captured (every 30 transport ticks).
      probeAndCacheVolumeKeyframes(mediaEl);
    }
    if (nearPlayheadPending.length > 0)
      syncTimedElementVisibility(state.currentTime, nearPlayheadPending);
  };

  const probeAndCacheVolumeKeyframes = (mediaEl: HTMLMediaElement) => {
    if (volumeKeyframeCache.has(mediaEl)) return;
    probeAndCacheElementVolume(
      mediaEl,
      state.capturedTimeline,
      getSafeTimelineDurationSeconds(state.capturedTimeline, 0),
      volumeKeyframeCache,
      {
        allowLiveTimelineSeek: !(window as Window & { __HF_RENDER_CAPTURE_MODE?: boolean })
          .__HF_RENDER_CAPTURE_MODE,
      },
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

  // The author's inline display (value and priority) under each `display:none` the
  // visibility pass applied, so showing the element puts exactly that back. Keyed on
  // what was applied, not on `isTimedClipInFlow`: that answer can flip between the hide
  // and the show pass once `applyClipLayout` force-absolutizes the clip.
  const displayBeforeHide = new WeakMap<HTMLElement, { value: string; priority: string }>();
  const hideByDisplay = (el: HTMLElement, plainNoneMayBeLeftover: boolean) => {
    if (!displayBeforeHide.has(el)) {
      const value = el.style.getPropertyValue("display");
      const priority = el.style.getPropertyPriority("display");
      // On the timed hide, a plain none may be a hide left behind (a Studio reveal restoring ours).
      const isLeftoverHide = plainNoneMayBeLeftover && value === "none" && !priority;
      displayBeforeHide.set(el, isLeftoverHide ? { value: "", priority: "" } : { value, priority });
    }
    el.style.display = "none";
  };
  const restoreDisplay = (el: HTMLElement) => {
    const before = displayBeforeHide.get(el);
    if (!before) return;
    displayBeforeHide.delete(el);
    if (before.value) el.style.setProperty("display", before.value, before.priority);
    else el.style.removeProperty("display");
  };
  const dataHiddenDisplayNodes = new WeakSet<HTMLElement>();
  // A data-hidden toggle on (or affecting) an audio element must re-schedule
  // WebAudio playback so the hidden clip's source is dropped/restored mid-
  // playback. Batched to one call per syncTimedElementVisibility pass, not
  // one per toggled node.
  //
  // The reschedule is paired with `stopAll()` below, for the reason
  // `applyWebAudioRate` already spells out: scheduling does
  // NOT replace the active set. It bumps a generation, which only rejects
  // stale schedules still in flight — every source already started keeps
  // playing, and there is no per-element dedup. This comment used to claim the
  // opposite and the call site trusted it, so muting a track mid-playback
  // started a second buffer source for every in-window clip on top of the ones
  // still sounding: the whole mix audibly doubled, slightly out of phase.
  let hiddenAudioDirty = false;
  const affectsAudio = (el: Element): boolean =>
    isMediaElement(el) &&
    el.hasAttribute("data-start") &&
    (joinsWebAudio(el) || webAudio.routesElement(el));
  const nodeAffectsAudio = (node: HTMLElement): boolean =>
    affectsAudio(node) || Array.from(node.querySelectorAll(WEB_AUDIO_MEDIA)).some(affectsAudio);

  // An `<hf-audio-group>` carries no `data-start`, so it is never among
  // `visibilityNodes` above — group mute needs its own small diff pass.
  // Preview-side only (render reads the group's `data-hidden` directly at
  // export time, per B4); this just keeps the live WebAudio group bus in
  // sync with a `data-hidden` toggle made mid-playback.
  const groupHiddenLast = new WeakMap<Element, boolean>();
  const groupHasUncapturedMember = (groupId: string, currentTime: number): boolean => {
    for (const el of webAudioMediaIn(document)) {
      if (audioGroupOf(el) !== groupId) continue;
      if (webAudio.routesElement(el) || isSilencedByHidden(el)) continue;
      const start = resolveAbsoluteMediaStartSeconds(el);
      const duration = parseStrictFiniteTimingNumber(el.dataset.duration);
      const end = duration != null && duration > 0 ? start + duration : Infinity;
      if (Number.isFinite(start) && currentTime < end) return true;
    }
    return false;
  };
  /** The bus gain owns a group's mute; true when an unmute leaves a member still to play outside the graph. */
  const syncAudioGroupMute = (currentTime: number): boolean => {
    let needsCapture = false;
    for (const groupEl of document.querySelectorAll(HF_AUDIO_GROUP_TAG)) {
      const hidden = groupEl.hasAttribute("data-hidden");
      const last = groupHiddenLast.get(groupEl);
      if (last === hidden) continue;
      groupHiddenLast.set(groupEl, hidden);
      if (!groupEl.id) continue;
      webAudio.setGroupMuted(groupEl.id, hidden);
      if (last && !hidden && groupHasUncapturedMember(groupEl.id, currentTime)) needsCapture = true;
    }
    return needsCapture;
  };

  const timedVisibilityAt = (timingRevision?: number) => {
    const compositionDuration = getSafeTimelineDurationSeconds(
      state.capturedTimeline,
      0,
      timingRevision,
    );
    return (node: HTMLElement, time: number) =>
      isRuntimeElementVisibleAt(node, {
        currentTime: time,
        compositionDuration,
        canonicalFps: state.canonicalFps,
        exportRenderSeek: Boolean(window.__HF_EXPORT_RENDER_SEEK_CONFIG),
        timelineRegistry: window.__timelines ?? {},
        resolver: timingResolverFor(true),
      });
  };

  const clipChainVisibleAt = (
    from: Element | null,
    time: number,
    visibleAt: ReturnType<typeof timedVisibilityAt>,
    rootComp: HTMLElement | null,
  ) => {
    for (let node = from; node && node !== rootComp; node = node.parentElement)
      if (isHtmlElement(node) && node.hasAttribute("data-start") && !visibleAt(node, time))
        return false;
    return true;
  };

  const hiddenImagesSkipped = skipsHiddenImages();
  const LOOKAHEAD_SECONDS = 2;
  const RELEASE_LOOKAHEAD_SECONDS = 4;
  // Unskipped while within the window on either side of the playhead, so a step or shuttle back
  // across a cut finds the clip it left still loaded; the edge checks catch a clip shorter than it.
  const dueSoon = (
    node: HTMLElement,
    visibleAt: ReturnType<typeof timedVisibilityAt>,
    t: number,
    ahead = LOOKAHEAD_SECONDS,
  ) => {
    const start = isMediaElement(node)
      ? resolveAbsoluteMediaStartSeconds(node)
      : resolveStartForElement(node, Number.NaN);
    const end = start + (resolveDurationForElement(node) ?? Number.NaN);
    return (
      (start > t && start <= t + ahead) ||
      (end <= t && end >= t - ahead) ||
      visibleAt(node, t + ahead)
    );
  };
  // Where Studio's loop wraps to (window.__hf.setLoopStart); null when it does not loop.
  let loopStartSeconds: number | null = null;
  // A clip with no authored length loads as in a render: a reload would drop the duration it is
  // timed by.
  const inPreloadWindow = (el: HTMLMediaElement) =>
    hiddenImagesSkipped && el.hasAttribute("data-start") && lengthIsAuthored(el);

  // Media on screen or due within the look-ahead loads; the rest stops holding a connection to
  // the origin that also serves Studio's thumbnails.
  const mediaNearPlayhead = new WeakMap<HTMLMediaElement, boolean>();
  // During playback a clip that starts arms the next clip on its track, which a cold 2 s look-ahead
  // cannot fetch in time on a slow link.
  const armedBy = new WeakMap<HTMLMediaElement, HTMLMediaElement>();
  const armedFrom = new WeakSet<HTMLMediaElement>();
  const approachingMedia = new WeakSet<HTMLMediaElement>();
  const prepareInWindow = (el: HTMLMediaElement) =>
    prepareUpcomingMedia(
      el,
      () =>
        !state.tornDown &&
        mediaNearPlayhead.get(el) === true &&
        resolveAbsoluteMediaStartSeconds(el) > clock.now(),
    );
  const preloadInWindow = (el: HTMLMediaElement) => {
    preloadMedia(el);
    prepareInWindow(el);
  };
  // An untracked clip (NaN) shares a track with nothing, as in the timeline payload.
  const hostOf = (el: Element) => el.parentElement?.closest("[data-composition-id]");
  const armNextOnTrack = (el: HTMLMediaElement) => {
    const track = parseAuthoredTrack(el, Number.NaN);
    const clips = buildRuntimeMediaCache(
      Array.from(metadataBoundMedia).filter(
        (m) =>
          m.isConnected && parseAuthoredTrack(m, Number.NaN) === track && hostOf(m) === hostOf(el),
      ),
    ).mediaClips;
    const end = clips.find((clip) => clip.el === el)?.end ?? Number.NaN;
    let next: (typeof clips)[number] | undefined;
    for (const clip of clips)
      if (
        clip.el !== el &&
        clip.start >= end - instantTolerance(end) &&
        !(next && next.start <= clip.start)
      )
        next = clip;
    if (!next || !inPreloadWindow(next.el)) return;
    armedBy.set(next.el, el);
    if (mediaNearPlayhead.get(next.el) !== true) {
      mediaNearPlayhead.set(next.el, true);
      preloadInWindow(next.el);
    }
  };
  const preloadNearPlayhead = (el: HTMLMediaElement, visible: boolean, upcoming: boolean) => {
    const playing = clock.isPlaying();
    if (!(visible && playing)) armedFrom.delete(el);
    else if (!armedFrom.has(el)) {
      armedFrom.add(el);
      armNextOnTrack(el);
    }
    // An arm lasts while the clip that set it plays on screen, so a jump away drops it.
    const armer = armedBy.get(el);
    const near = visible || upcoming || (armer !== undefined && armedFrom.has(armer));
    const approaching = near && !visible && resolveAbsoluteMediaStartSeconds(el) > clock.now();
    const wasApproaching = approachingMedia.has(el);
    if (approaching) approachingMedia.add(el);
    else approachingMedia.delete(el);
    const decided = mediaNearPlayhead.get(el);
    if (decided === near) {
      if (approaching && !wasApproaching) prepareInWindow(el);
      return;
    }
    mediaNearPlayhead.set(el, near);
    if (!near) {
      if (el.preload !== "none") {
        el.preload = "none";
        // Frees a clip the window armed; on one the parser started, it would only restart the fetch.
        if (decided) releaseMedia(el);
      }
    } else if (!visible || decided === undefined) {
      // Not a clip a jump lands on: the media sync arms that one, and load() would undo its seek.
      preloadInWindow(el);
    }
  };
  // Held past the look-ahead so a scrub across its edge does not refetch, and while playing when
  // due at the loop start.
  const mediaStaysDue = (
    el: HTMLMediaElement,
    visibleAt: ReturnType<typeof timedVisibilityAt>,
    t: number,
  ) =>
    (mediaNearPlayhead.get(el) === true && dueSoon(el, visibleAt, t, RELEASE_LOOKAHEAD_SECONDS)) ||
    (loopStartSeconds !== null &&
      clock.isPlaying() &&
      (visibleAt(el, loopStartSeconds) ||
        dueSoon(el, visibleAt, loopStartSeconds, RELEASE_LOOKAHEAD_SECONDS)));

  const applyTimedElementVisibility = (
    currentTime: number,
    visibilityNodes: Element[],
    timingRevision?: number,
  ) => {
    const rootComp = resolveRootCompositionElement();
    let decidedTimedClip = false;
    const visibleAt = timedVisibilityAt(timingRevision);
    for (const rawNode of visibilityNodes) {
      if (!isHtmlElement(rawNode)) continue;

      if (rawNode.hasAttribute("data-hidden")) {
        if (!dataHiddenDisplayNodes.has(rawNode)) {
          dataHiddenDisplayNodes.add(rawNode);
          if (nodeAffectsAudio(rawNode)) hiddenAudioDirty = true;
        }
        hideByDisplay(rawNode, false);
        if (isVideoElement(rawNode) || isImageElement(rawNode)) {
          colorGradingRuntime?.setSourceVisibility(rawNode, false);
        }
        continue;
      }

      if (dataHiddenDisplayNodes.has(rawNode)) {
        restoreDisplay(rawNode);
        dataHiddenDisplayNodes.delete(rawNode);
        if (nodeAffectsAudio(rawNode)) hiddenAudioDirty = true;
      }

      // Descendants must not override a hidden ancestor clip. CSS visibility can
      // otherwise leak child pixels through inactive scenes because a descendant
      // with visibility:visible escapes an ancestor's visibility:hidden.
      const isVisibleNow =
        visibleAt(rawNode, currentTime) &&
        clipChainVisibleAt(rawNode.parentElement, currentTime, visibleAt, rootComp);
      rawNode.style.visibility = isVisibleNow ? "visible" : "hidden";
      const upcoming =
        hiddenImagesSkipped && !isVisibleNow && dueSoon(rawNode, visibleAt, currentTime);
      if (upcoming && !rawNode.hasAttribute(STUDIO_PREVIEW_UPCOMING_ATTR))
        loadPreviewImagesIn(rawNode);
      rawNode.toggleAttribute(STUDIO_PREVIEW_UPCOMING_ATTR, upcoming);
      if (isMediaElement(rawNode) && metadataBoundMedia.has(rawNode) && inPreloadWindow(rawNode))
        preloadNearPlayhead(
          rawNode,
          isVisibleNow,
          upcoming || mediaStaysDue(rawNode, visibleAt, currentTime),
        );
      if (!isMediaElement(rawNode) && !isImageElement(rawNode)) decidedTimedClip = true;
      if (isVideoElement(rawNode) || isImageElement(rawNode)) {
        colorGradingRuntime?.setSourceVisibility(rawNode, isVisibleNow);
      }
      if (isVisibleNow) {
        restoreDisplay(rawNode);
      } else if (isTimedClipInFlow(rawNode) && isTimedClipLeaf(rawNode)) {
        hideByDisplay(rawNode, true);
      }
    }
    if (decidedTimedClip && revealTimedClipsAfterFirstPass()) colorGradingRuntime?.refresh();
    // Only when a `data-hidden` mutation actually moved something: the skips
    // this reschedule exists to re-run are what change the active set, so
    // firing it otherwise was an audible stop-and-restart across the whole mix
    // that rebuilt an identical set.
    const groupNeedsCapture = syncAudioGroupMute(currentTime);
    if ((hiddenAudioDirty || groupNeedsCapture) && clock.isPlaying()) {
      webAudio.stopAll();
      for (const el of webAudioMediaIn(document)) {
        if (isSilencedByHidden(el)) el.volume = 0;
      }
      scheduleWebAudioForActiveClips();
    }
    hiddenAudioDirty = false;
  };

  // Scope 2 of 3 (see `withTimingResolver`). One resolver for the whole
  // visibility pass: every node costs 2 x (1 + ancestor depth) resolves, and
  // ancestor chains are shared between siblings. Its `el.load()` calls reach only clips timed by an
  // authored length, and it never awaits, so no duration the cache read can change.
  const syncTimedElementVisibility = (
    currentTime: number,
    visibilityNodes: Element[] = Array.from(document.querySelectorAll("[data-start]")),
    timingRevision?: number,
  ) =>
    withTimingResolver(() =>
      applyTimedElementVisibility(currentTime, visibilityNodes, timingRevision),
    );

  // Images a seek to `time` would reveal undecoded: skipped with their hidden clip, or still loading.
  const undecodedImagesShownAt = (time: number): HTMLImageElement[] =>
    withTimingResolver(() => {
      if (!hiddenImagesSkipped) return [];
      const rootComp = resolveRootCompositionElement();
      const visibleAt = timedVisibilityAt();
      return Array.from(document.images).filter(
        (img) =>
          img.closest('[data-start][style*="visibility: hidden"]') !== null &&
          (img.closest(SKIPPED_CLIP) !== null || !img.complete) &&
          clipChainVisibleAt(img, time, visibleAt, rootComp),
      );
    });

  /**
   * Clip windows sorted by each endpoint, so a seek can ask which windows it
   * crossed instead of asking every clip whether it is active.
   *
   * Rebuilt whenever the composition's timing inputs move — the same revision
   * the duration floors ride on, because the two are derived from the same
   * attributes, the same media metadata events and the same timeline registry.
   */
  interface MediaClipIndex {
    revision: number;
    clips: RuntimeMediaClip[];
    byStart: RuntimeMediaClip[];
    byEnd: RuntimeMediaClip[];
  }
  let mediaClipIndex: MediaClipIndex | null = null;
  // The transport time the last sync ran at, and the clips whose authored window
  // contained it. `null` means "unknown": the next pass visits everything and
  // reseeds. Only ever advanced when `syncRuntimeMedia` actually ran, so a pass
  // skipped for any reason widens the next sweep rather than skipping the
  // boundaries crossed in between.
  let lastSyncedMediaTimeSeconds: number | null = null;
  let mediaClipsInWindow: RuntimeMediaClip[] = [];

  // The one definition of "media the transport drives": timed itself, or hosted
  // by a composition whose timing it inherits. Both the media cache and the
  // paused-side enforcement read it, so neither can be narrower than the other.
  const isTransportManagedMedia = (element: HTMLMediaElement): boolean =>
    element.hasAttribute("data-start") ||
    Boolean(resolveMediaCompositionContext(element).compositionRoot);

  const buildRuntimeMediaCache = (elements?: Array<HTMLVideoElement | HTMLAudioElement>) =>
    refreshRuntimeMediaCache({
      elements,
      shouldIncludeElement: isTransportManagedMedia,
      resolveStartSeconds: (element) => {
        return resolveAbsoluteMediaStartSeconds(element);
      },
      resolveDurationSeconds: (element) => {
        const context = resolveMediaCompositionContext(element);
        const start = resolveAbsoluteMediaStartSeconds(element);
        const hostRemaining =
          context.inheritedStart != null &&
          context.inheritedDuration != null &&
          context.inheritedDuration > 0
            ? Math.max(0, context.inheritedStart + context.inheritedDuration - start)
            : null;
        const sourceDuration = Number.isFinite(element.duration)
          ? resolveNaturalMediaTimelineDuration(element, element.duration)
          : null;
        // The element's own data-duration is an explicit clip-length trim
        // (the studio writes it when you drag the clip edge). It must bound
        // playback so a trimmed track stops at its edge instead of running on
        // to the source-file or host-composition end. Absent → no cap (an
        // untrimmed clip plays its natural source length).
        const ownDuration = parseStrictFiniteTimingNumber(element.dataset.duration);
        const explicitDuration = ownDuration != null && ownDuration > 0 ? ownDuration : null;
        return resolveRuntimeMediaClipDuration({
          isVideo: element.tagName === "VIDEO",
          sourceDuration,
          hostRemaining,
          explicitDuration,
        });
      },
    });

  const resolveMediaClipIndex = (): MediaClipIndex => {
    const revision = readCompositionTimingRevision();
    if (mediaClipIndex && mediaClipIndex.revision === revision) return mediaClipIndex;
    const clips = buildRuntimeMediaCache().mediaClips;
    mediaClipIndex = {
      revision,
      clips,
      byStart: [...clips].sort((a, b) => a.start - b.start),
      byEnd: [...clips].sort((a, b) => a.end - b.end),
    };
    // The windows moved, so what the sweep remembers being in-window is about
    // clips that no longer describe this composition. Reseed on the next pass.
    lastSyncedMediaTimeSeconds = null;
    mediaClipsInWindow = [];
    return mediaClipIndex;
  };

  /** Clips whose `endpoint` lies in [lo, hi], via binary search on the sorted
   *  array. Inclusive at both ends: over-visiting is free, under-visiting is a
   *  clip left playing. */
  const clipsWithEndpointBetween = (
    sorted: RuntimeMediaClip[],
    endpoint: (clip: RuntimeMediaClip) => number,
    lo: number,
    hi: number,
  ): RuntimeMediaClip[] => {
    let low = 0;
    let high = sorted.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (endpoint(sorted[mid]!) < lo) low = mid + 1;
      else high = mid;
    }
    const crossed: RuntimeMediaClip[] = [];
    for (let i = low; i < sorted.length && endpoint(sorted[i]!) <= hi; i += 1)
      crossed.push(sorted[i]!);
    return crossed;
  };

  /**
   * The media elements this pass must visit, and the argument that the rest can
   * be skipped.
   *
   * `isActive` requires `isInClipWindow` (or, for audio, a start within the early-start
   * margin), so a clip outside that is inactive there whatever its element state. A clip that
   * is in neither the previous in-window set nor the set of windows whose
   * endpoint the transport just crossed was therefore out of window BEFORE and
   * is out of window NOW — the pass would only have evicted sync state that is
   * already empty and paused an element already paused, both of which it was
   * left in the last time it went out of window, by a pass that did visit it.
   *
   * The endpoint search is what makes a jump honest rather than lucky: seeking
   * over a hundred clips visits the hundred boundaries it crossed, and a
   * single-frame step visits the one or two that flip.
   */
  const collectMediaElementsToVisit = (
    index: MediaClipIndex,
    toSeconds: number,
    cueAheadSeconds: number,
  ): Array<HTMLVideoElement | HTMLAudioElement> => {
    const fromSeconds = lastSyncedMediaTimeSeconds;
    if (fromSeconds === null) return index.clips.map((clip) => clip.el);
    const sameInstantMargin =
      2 * instantTolerance(Math.max(Math.abs(fromSeconds), Math.abs(toSeconds)));
    const lo = Math.min(fromSeconds, toSeconds) - sameInstantMargin;
    const hi = Math.max(fromSeconds, toSeconds) + sameInstantMargin;
    const visiting = new Set<HTMLVideoElement | HTMLAudioElement>();
    for (const clip of mediaClipsInWindow) visiting.add(clip.el);
    for (const clip of clipsWithEndpointBetween(
      index.byStart,
      (c) => c.start,
      lo,
      hi + cueAheadSeconds,
    )) {
      visiting.add(clip.el);
    }
    for (const clip of clipsWithEndpointBetween(index.byEnd, (c) => c.end, lo, hi)) {
      visiting.add(clip.el);
    }
    return [...visiting];
  };

  /** Elements whose paused-time playback is borrowed by a feature that legitimately
   *  runs media with the clock stopped: the grading preview, the Studio's scrub.
   *  Anything playing while paused without a lease is the defect the enforcement
   *  exists for. On `window.__hf` because the Studio is across the iframe boundary. */
  const pausedMediaLeases = new WeakSet<HTMLMediaElement>();
  const leasePausedMedia = (el: HTMLMediaElement): void => {
    pausedMediaLeases.add(el);
  };
  const releasePausedMedia = (el: HTMLMediaElement): void => {
    pausedMediaLeases.delete(el);
    wakeTransport();
  };
  window.__hf.leasePausedMedia = leasePausedMedia;
  window.__hf.releasePausedMedia = releasePausedMedia;
  window.__hf.setLoopStart = (seconds) => {
    loopStartSeconds = seconds != null && Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
  };
  // A sub-composition is hidden after its host clip, so its animation counts only until then.
  const autoNestedHostEndSeconds = (child: RuntimeTimelineChildLike): number => {
    const hostId = autoNested.get(child)?.hostId;
    const host = hostId
      ? document.querySelector(`[data-composition-id="${CSS.escape(hostId)}"]`)
      : null;
    const duration = host ? resolveDurationForElement(host) : null;
    return host && duration ? resolveStartForElement(host, 0) + duration : Infinity;
  };
  // GSAP's duration() of a tween is one iteration; a timeline's duration() counts its children's repeats.
  const readOneCycleEndSeconds = (children: RuntimeTimelineChildLike[]): number => {
    let end = 0;
    for (const child of children) {
      if (child.data === RUNTIME_FILLER) continue;
      // A stagger or keyframes tween runs an inner timeline; its duration() counts per-item repeats.
      const nested = child.getChildren
        ? child
        : (child as { timeline?: RuntimeTimelineChildLike }).timeline;
      // GSAP plays a tween's inner timeline stretched to the tween's own duration() (1 for a timeline).
      const stretch = Number(child.duration?.()) / Number(nested?.duration?.());
      const cycle = nested?.getChildren
        ? readOneCycleEndSeconds(nested.getChildren(false, true, true)) *
          (Number.isFinite(stretch) && stretch > 0 ? stretch : 1)
        : Number(child.duration?.()) || 0;
      // startTime() is in the parent's time, the cycle in the child's own; reversed reports -1.
      const scale = Math.abs(Number((child as { timeScale?: () => number }).timeScale?.()) || 1);
      const childEnd = (Number(child.startTime?.()) || 0) + cycle / scale;
      // A child still endless here reports ~1e10 s; skip it, as the adapters skip loops.
      if (childEnd >= LOOP_INFLATED_TIMELINE_SECONDS) continue;
      end = Math.max(end, Math.min(childEnd, autoNestedHostEndSeconds(child)));
    }
    return end;
  };
  window.__hf.animationEnd = () => {
    const timeline = state.capturedTimeline;
    const timelineEnd = timeline?.getChildren
      ? readOneCycleEndSeconds(timeline.getChildren(false, true, true))
      : (getTimelineDurationSeconds(timeline) ?? 0);
    const end = Math.max(timelineEnd, resolveAdapterDurationFloorSeconds(true) ?? 0);
    return end > 0 && end < LOOP_INFLATED_TIMELINE_SECONDS ? end : null;
  };
  window.__hf.audioMeter = {
    start: () => webAudio.startMetering(),
    stop: () => webAudio.stopMetering(),
    read: () => webAudio.readLevels(),
  };

  // Same predicate the media cache uses, so the paused side sees exactly the
  // media the transport drives. Reads attributes only; no cache rebuild.
  const hasRunningTimedMedia = (): boolean => {
    for (const el of document.querySelectorAll("video, audio")) {
      if (
        isMediaElement(el) &&
        !el.paused &&
        isTransportManagedMedia(el) &&
        !pausedMediaLeases.has(el)
      ) {
        return true;
      }
    }
    return false;
  };

  // A parked transport runs no ticks, so the check above would never see a media
  // element that starts while the preview sits idle. `play` does not bubble;
  // capture-phase on the document reaches every element, including later ones
  // (same reasoning as the media events watchCompositionTimingInputs binds).
  const onMediaPlayWakeTransport = () => wakeTransport();
  document.addEventListener("play", onMediaPlayWakeTransport, true);
  runtimeCleanupCallbacks.push(() => {
    document.removeEventListener("play", onMediaPlayWakeTransport, true);
  });

  const syncMediaForCurrentState = (timingRevision?: number) => {
    // Scope 1 of 3 (see `withTimingResolver`). Closes before `syncRuntimeMedia`,
    // which may call `el.load()` and invalidate every cached duration.
    //
    // The render/export path never consults the index: capture depends on the
    // exact state of every element on every frame and a frame captured against a
    // stale one cannot be recovered, so it visits all of them exactly as before.
    // Same reasoning, and the same latch, as the duration floors above.
    const indexed = !renderCaptureSeekStarted;
    const cueAheadSeconds =
      state.isPlaying && !state.mediaForceSyncNextTick && lastSyncedMediaTimeSeconds !== null
        ? Math.min(
            Math.max(0, state.currentTime - lastSyncedMediaTimeSeconds),
            MEDIA_SYNC_TOLERANCE_SECONDS * Math.min(1, state.playbackRate),
          )
        : 0;
    const mediaClips = withTimingResolver(() => {
      if (!indexed) return buildRuntimeMediaCache().mediaClips;
      const index = resolveMediaClipIndex();
      // Windows come from the index, but every field handed to `syncRuntimeMedia`
      // is re-read here: `el.duration` is reset by any `el.load()` the retry path
      // made last pass, and a cached copy of it would be exactly the stale
      // duration the two-scope rule exists to prevent.
      return buildRuntimeMediaCache(
        collectMediaElementsToVisit(index, state.currentTime, cueAheadSeconds),
      ).mediaClips;
    });
    // Attach probed volume keyframes to clips so syncRuntimeMedia can use the
    // same envelope the renderer uses instead of tracking GSAP-change diffs.
    for (const clip of mediaClips) {
      const kf = volumeKeyframeCache.get(clip.el as HTMLMediaElement);
      if (kf) clip.volumeKeyframes = kf;
    }

    // A leased element is not the transport's to touch while the clock is paused;
    // during playback the transport owns everything again. Filtered here rather
    // than out of `mediaClips` so the in-window bookkeeping below still records it
    // and the pass after its release visits it normally.
    const syncedClips = state.isPlaying
      ? mediaClips
      : mediaClips.filter((clip) => !pausedMediaLeases.has(clip.el));

    const forceSync = state.mediaForceSyncNextTick;
    if (forceSync) state.mediaForceSyncNextTick = false;
    if (!state.nativeMediaSyncDisabled) {
      syncRuntimeMedia({
        clips: syncedClips,
        timeSeconds: state.currentTime,
        playing: state.isPlaying,
        playbackRate: state.playbackRate,
        outputMuted: state.mediaOutputMuted,
        userMuted: state.bridgeMuted,
        userVolume: state.bridgeVolume,
        forceSync,
        cueAheadSeconds,
        getCompositionDuration: () =>
          getSafeTimelineDurationSeconds(state.capturedTimeline, 0, timingRevision),
        onElementVolume: (el, _effectiveVolume, authorVolume) =>
          webAudio.setElementVolume(el, authorVolume),
        isWebAudioOwned: (el) => webAudio.ownsElement(el),
        isWebAudioRouted: (el) => webAudio.routesElement(el),
        onAutoplayBlocked: () => {
          if (state.mediaAutoplayBlockedPosted) return;
          state.mediaAutoplayBlockedPosted = true;
          postRuntimeMessage({ source: "hf-preview", type: "media-autoplay-blocked" });
        },
      });
      if (indexed) {
        lastSyncedMediaTimeSeconds = state.currentTime;
        // Every clip not visited was out of window at both ends of this seek, so
        // the visited ones are the only possible members.
        mediaClipsInWindow = mediaClips.filter((clip) =>
          isInClipWindow(state.currentTime, clip.start - MEDIA_SYNC_TOLERANCE_SECONDS, clip.end),
        );
      } else {
        lastSyncedMediaTimeSeconds = null;
        mediaClipsInWindow = [];
      }
    }
    syncTimedElementVisibility(state.currentTime, undefined, timingRevision);
  };

  const postState = (force: boolean) => {
    // Every transport mutation — play, pause, seek, renderSeek, a control-bridge
    // command, the player's own state posts — ends in a forced post. That makes
    // this the one place a parked transport needs to hear about, instead of a
    // wake call bolted onto each mutator (and forgotten on the next one).
    if (force) wakeTransport();
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
      currentTime: state.currentTime || 0,
      ended: clock.reachedEnd(),
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
  let assetsReadyStarted = false;
  let assetsSettled = false;
  let liveRootDurationOverrideSeconds = 0;
  let lastPostedManifest = "";
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
      const { width, height } = readCompositionSize(stageSizeRootEl);
      if (width !== null && height !== null) {
        postRuntimeMessage({ source: "hf-preview", type: "stage-size", width, height });
      }
    }
    bindRootTimelineIfAvailable();
    const payload = collectRuntimeTimelinePayload({
      canonicalFps: state.canonicalFps,
    });
    window.__clipManifest = payload;
    lastPostedManifest = JSON.stringify(payload);

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

    postRuntimeMessage({ ...payload, assetsReady: assetsSettled });
    if (!assetsReadyStarted) {
      assetsReadyStarted = true;
      settleFirstFrameCompositionReadiness(document, ({ timedOut }) => {
        if (state.tornDown) return;
        assetsSettled = true;
        postRuntimeMessage({ source: "hf-preview", type: "assets-ready", timedOut });
      });
    }
    scheduleRootStageLayoutDiagnostics();
  };

  // What no observer sees (a label, a track or an inline z-index edited on a playing clip) still reaches Studio.
  const postTimelineIfManifestChanged = () => {
    const manifest = JSON.stringify(
      collectRuntimeTimelinePayload({ canonicalFps: state.canonicalFps }),
    );
    if (manifest !== lastPostedManifest) postTimeline();
  };

  const finitePositiveDuration = (value: number | null | undefined): number =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

  const growRootDurationLive = (durationSeconds: number) => {
    const nextDuration = finitePositiveDuration(Number(durationSeconds));
    if (nextDuration <= 0) return;
    const rootEl = resolveRootCompositionElement();
    const rootAttrDuration = finitePositiveDuration(
      parseStrictFiniteTimingNumber(rootEl?.getAttribute("data-duration")),
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

  const runAdapters = (
    method: "discover" | "pause" | "play",
    timeSeconds = 0,
    pageAnimations?: () => Animation[],
  ) => {
    for (const adapter of state.deterministicAdapters) {
      try {
        if (method === "discover") adapter.discover();
        if (method === "pause") adapter.pause({ pageAnimations });
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
  const isAdapterReadinessSettled = createSettledTracker(
    () => {
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
    },
    () => maybePublishRenderReady(),
    (err) => swallow("runtime.init.adapterReady", err),
  );

  // window.__hf.buildReady[key]: a piece registers a promise for setup no
  // adapter can observe (mesh building, shader compiles). Waited the same
  // way as adapter readiness, so render and preview both hold on it.
  const isBuildReadinessSettled = createSettledTracker(
    () => {
      const registry = window.__hf?.buildReady;
      if (!registry) return [];
      return Object.values(registry).filter(
        (p): p is PromiseLike<unknown> =>
          p != null && typeof (p as PromiseLike<unknown>).then === "function",
      );
    },
    () => maybePublishRenderReady(),
    (err) => swallow("runtime.init.buildReady", err),
  );

  // Passes that must see scene DOM, which arrives after init: when scenes mount, or when one is
  // swapped. Resolves when caption overrides have landed.
  const settleSceneDom = (): Promise<void> => {
    bindMediaMetadataListeners();
    installAssetFailureDiagnostics();
    const captionsApplied = applyCaptionOverrides();
    // Per-instance scoped values: data-var-* / --{id} bindings inside scenes. Idempotent.
    applyVariableBindings(document);
    // An unregistered vfx chain paints nothing and logs nothing, so re-scan the new DOM.
    initVfx(document.body, state.canonicalFps);
    return captionsApplied;
  };
  if (!externalCompositionsReady) {
    const compositionLoaderParams = {
      injectedStyles: state.injectedCompStyles,
      injectedScripts: state.injectedCompScripts,
      injectedLinks: state.injectedCompLinks,
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
    void loadCompositions(compositionLoaderParams).finally(() => {
      externalCompositionsReady = true;
      void settleSceneDom();
      maybePublishRenderReady();
    });
  } else {
    // No external/inline compositions to load — apply caption overrides immediately
    void applyCaptionOverrides();
  }

  const sceneUrls = (parts: Element[]): Set<string> => {
    const urls = new Set<string>();
    const addCssUrls = (css: string | null) => {
      for (const m of (css ?? "").matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)|@import\s+(['"])(.*?)\3/gi))
        urls.add(m[2] ?? m[4]!);
      for (const set of (css ?? "").matchAll(/image-set\((?:[^()]|\([^()]*\))*\)/gi))
        for (const m of set[0].matchAll(/(['"])(.*?)\1/g)) urls.add(m[2]!);
    };
    for (const part of parts) {
      if (part.tagName === "STYLE") addCssUrls(part.textContent);
      if (part.tagName === "STYLE" || part.tagName === "SCRIPT") continue;
      for (const el of [part, ...part.querySelectorAll("*")]) {
        const attrs = MEDIA_URL_ATTRS.get(el.localName) ?? [];
        const values = [
          unproxiedMediaSrc(el),
          ...[...attrs, "poster", "srcset"].map((a) => el.getAttribute(a)),
        ];
        for (const value of values) if (value) urls.add(value);
        addCssUrls(el.getAttribute("style"));
      }
    }
    return urls;
  };
  let sceneSwapGeneration = 0;
  // A video or audio the edit left as written keeps playing, unless the scene's scripts changed: what the
  // old script wrote to it directly is unknown. A rebuilt one is recorded from the new markup.
  const keepUnchangedMedia = (oldHost: Element, host: Element, sameScripts: boolean) => {
    const byShape = new Map<string, Element[]>();
    for (const el of sameScripts ? oldHost.querySelectorAll("video, audio") : []) {
      const shape = authoredMedia.get(el);
      // Its grading canvas sits beside it in the old scene and cannot follow it.
      if (!shape || colorGradingRuntime?.isGraded(el)) continue;
      // A stream, output device or key session a script gave it is not in the markup.
      const { srcObject, sinkId, mediaKeys } = el as HTMLMediaElement;
      if (srcObject || sinkId || mediaKeys) continue;
      byShape.set(shape, [...(byShape.get(shape) ?? []), el]);
    }
    for (const el of host.querySelectorAll("video, audio")) {
      const shape = authoredShape(el);
      const kept = byShape.get(shape)?.shift();
      // Anything a script wrote on it, under the old markup or not, is not in a fresh load's copy.
      if (!kept || writtenShape(kept) !== writtenShape(el)) {
        authoredMedia.set(el, shape);
        continue;
      }
      el.replaceWith(kept);
      // Back as written, the tween cache emptied, so the new script's tweens read what a fresh load's do.
      window.gsap?.set?.(kept, { clearProps: "all" });
      const style = el.getAttribute("style");
      if (style === null) kept.removeAttribute("style");
      else kept.setAttribute("style", style);
      // The swap's closing pass puts its move back, as a load's first pass does.
      forgetPositionEdit(kept as HTMLElement);
      // Properties no attribute shows, as a load sets them.
      const media = kept as HTMLMediaElement;
      media.volume = authoredMediaVolume(media) ?? 1;
      media.muted = state.bridgeMuted || state.mediaOutputMuted || media.defaultMuted;
      media.defaultPlaybackRate = 1;
      media.playbackRate = state.playbackRate;
      media.preservesPitch = true;
    }
  };
  const compositionIdsIn = (host: Element) =>
    [host, ...host.querySelectorAll("[data-composition-id]")].flatMap(
      (el) => el.getAttribute("data-composition-id") || [],
    );
  // gsap binds a tween to elements, so one from outside the scene would go on moving the replaced copy.
  const refuseOutsideTweens = (
    name: string,
    host: Element,
    timelines: Record<string, RuntimeTimelineLike | undefined>,
    sceneAnimations: Record<string, SceneAnimation[]>,
  ) => {
    const own = new Set<unknown>(
      compositionIdsIn(host).flatMap((id) => [timelines[id], ...(sceneAnimations[id] ?? [])]),
    );
    const inScene = new Set<unknown>([host, ...host.querySelectorAll("*")]);
    for (const tween of window.gsap?.globalTimeline?.getChildren?.(true, true, false) ?? []) {
      if (!tween.targets?.().some((target) => inScene.has(target))) continue;
      let owner: RuntimeTimelineChildLike | undefined = tween;
      while (owner && !own.has(owner)) owner = owner.parent;
      if (!owner) {
        throw new Error(
          `scene ${name} cannot be swapped: an animation outside it moves its elements`,
        );
      }
    }
    // A revert can leave a value on what the swap keeps; kept media are reset, page nodes outside are refused.
    const outside = (target: unknown) =>
      typeof (target as Node | null)?.nodeType === "number" && !inScene.has(target);
    for (const animation of own as Set<SceneAnimation | undefined>) {
      for (const tween of animation
        ? [animation, ...(animation.getChildren?.(true, true, false) ?? [])]
        : []) {
        if (tween.targets?.().some(outside)) {
          throw new Error(
            `scene ${name} cannot be swapped: its animations write outside the scene`,
          );
        }
      }
    }
  };
  // Swap edited scenes in place from a rebuilt preview document. Refuses before changing anything unless
  // the documents differ only inside existing scenes; a later failure is left to the caller's reload.
  const swapScenes = async (html: string, signal?: AbortSignal): Promise<void> => {
    const generation = sceneSwapGeneration;
    const next = new DOMParser().parseFromString(html, "text/html");
    const liveParts = readSceneParts(document);
    const nextParts = readSceneParts(next);
    if (!liveParts || !nextParts) throw new Error("no scene manifest");
    if (liveParts.shared !== nextParts.shared)
      throw new Error("the film changed outside its scenes");
    const names = Object.keys(nextParts.scenes);
    if (
      names.length !== Object.keys(liveParts.scenes).length ||
      names.some((name) => !(name in liveParts.scenes))
    ) {
      throw new Error("scenes were added or removed");
    }
    const changed = names.filter((name) => nextParts.scenes[name] !== liveParts.scenes[name]);
    if (changed.length === 0) throw new Error("no scene changed");
    const swaps = changed.map((name) => {
      const partsIn = (doc: Document) =>
        Array.from(doc.querySelectorAll(`[${SCENE_PART_ATTR}="${CSS.escape(name)}"]`));
      const isHost = (el: Element) => el.tagName !== "STYLE" && el.tagName !== "SCRIPT";
      const oldParts = partsIn(document);
      const newParts = partsIn(next);
      const oldHosts = oldParts.filter(isHost);
      const newHosts = newParts.filter(isHost);
      const oldHost = oldHosts[0];
      const newHost = newHosts[0];
      if (!oldHost || !newHost || oldHosts.length > 1 || newHosts.length > 1) {
        throw new Error(`scene ${name} cannot be swapped: it has no single host`);
      }
      // A duplicated scene's script also registers under its shared original id.
      if (oldHost.hasAttribute("data-hf-original-composition-id")) {
        throw new Error(`scene ${name} cannot be swapped: it is a duplicated instance`);
      }
      const refusal =
        oldHost.getAttribute(SCENE_NO_SWAP_ATTR) ?? newHost.getAttribute(SCENE_NO_SWAP_ATTR);
      if (refusal !== null) throw new Error(`scene ${name} cannot be swapped: ${refusal}`);
      const loaded = sceneUrls(oldParts);
      if ([...sceneUrls(newParts)].some((url) => !loaded.has(url))) {
        throw new Error(
          `scene ${name} cannot be swapped: it loads media this scene has not loaded`,
        );
      }
      const styleCount = (parts: Element[]) => parts.filter((el) => el.tagName === "STYLE").length;
      if (styleCount(oldParts) !== styleCount(newParts)) {
        throw new Error(`scene ${name} cannot be swapped: its styles moved`);
      }
      return {
        name,
        oldParts,
        homes: oldParts.map((el) => el.parentNode),
        newParts,
        oldHost,
        newHost,
      };
    });
    // Each parent on a scene host's way up to the film root, once, with its children in order. The runtime marks
    // what it inserts beside media, such as grading canvases, as ignored.
    const sceneLayout = () => {
      const film = resolveRootCompositionElement();
      const parents = new Set<Element>();
      for (const el of document.querySelectorAll(`[${SCENE_PART_ATTR}]`)) {
        if (el.tagName === "STYLE" || el.tagName === "SCRIPT") continue;
        let node = el.parentElement;
        for (; node; node = node === film ? null : node.parentElement) {
          parents.add(node);
        }
      }
      return [...parents].flatMap((parent) => [
        parent,
        ...Array.from(parent.children).filter((child) => !child.hasAttribute("data-hf-ignore")),
        null,
      ]);
    };
    const layout = sceneLayout();
    // Fetched before the first write, so a stalled or failed request leaves the page as it was.
    const captionOverrides = swaps.some(({ newHost }) => newHost.querySelector(".caption-group"))
      ? await fetchCaptionOverrides()
      : [];
    if (state.tornDown) throw new Error("the preview was torn down during the swap");
    if (signal?.aborted) throw new Error("the swap was cancelled");
    if (generation !== sceneSwapGeneration) {
      throw new Error("the preview changed while this swap waited");
    }
    // A data handler or a revert callback can replace or move a scene's parts; the swap would then lose the scene.
    const refuseReplacedScenes = () => {
      const moved = ({ oldParts, homes }: (typeof swaps)[number]) =>
        oldParts.some((el, i) => !el.isConnected || el.parentNode !== homes[i]);
      const now = sceneLayout();
      const relaidOut = now.length !== layout.length || now.some((node, i) => node !== layout[i]);
      if (relaidOut || swaps.some(moved)) {
        throw new Error("a scene changed while this swap waited");
      }
    };
    refuseReplacedScenes();
    // Read at each use: a data handler or an animation's callback may replace the registry mid-swap.
    const timelines = () =>
      (window.__timelines ??= {}) as Record<string, RuntimeTimelineLike | undefined>;
    const sceneAnimations = () => (window.__hfSceneAnimations ??= {});
    const refuseAnyOutsideTweens = () => {
      for (const { name, oldHost } of swaps)
        refuseOutsideTweens(name, oldHost, timelines(), sceneAnimations());
    };
    // Checked after the wait, which a tween could start in, and before anything changes.
    refuseAnyOutsideTweens();
    sceneSwapGeneration += 1;
    const root = state.capturedTimeline as
      | (RuntimeTimelineLike & { remove?: (child: unknown) => unknown })
      | null;
    // Overrides re-dim every word they touch, so only the swapped scenes' captions get them.
    const captionHosts: Element[] = [];
    const swappedHosts: Element[] = [];
    const oldIds = swaps.flatMap(({ oldHost }) => compositionIdsIn(oldHost));
    const stopped = new Set<unknown>();
    const stopOldAnimations = () => {
      const before = stopped.size;
      for (const id of oldIds) {
        // Newest first: each revert restores what the animation before it wrote.
        for (const previous of [
          ...(sceneAnimations()[id] ?? []).slice().reverse(),
          timelines()[id],
        ]) {
          if (!previous || stopped.has(previous)) continue;
          stopped.add(previous);
          const old = previous as SceneAnimation;
          if (old.revert) old.revert();
          else old.totalTime?.(0, true);
          root?.remove?.(previous);
          // revert() has already killed it; a second kill() fires onInterrupt again.
          if (!old.revert) old.kill?.();
        }
      }
      return stopped.size > before;
    };
    // A revert fires the animation's onInterrupt, which can register more; stop those too, until none appear.
    let passes = 0;
    while (stopOldAnimations()) {
      if (++passes > 8) throw new Error("the old scene keeps starting animations as they stop");
    }
    refuseReplacedScenes();
    refuseAnyOutsideTweens();
    for (const id of oldIds) {
      delete timelines()[id];
      delete sceneAnimations()[id];
    }
    // Released before kept media is reset: a later stop puts back the mute and volume it saved under the old script.
    webAudio.stopAll();
    clock.detachAudioSource();
    for (const { oldParts, newParts, oldHost, newHost } of swaps) {
      // Each new style takes its own old one's place: same-named @keyframes resolve by order.
      const newStyles = newParts.filter((el) => el.tagName === "STYLE");
      oldParts
        .filter((el) => el.tagName === "STYLE")
        .forEach((el, i) => el.replaceWith(document.importNode(newStyles[i]!, true)));
      for (const el of oldParts) if (el !== oldHost) el.remove();
      const host = document.importNode(newHost, true);
      // Text only: a live script that ran no longer carries the deferred type its new copy has.
      const scripts = (parts: Element[]) =>
        JSON.stringify(parts.flatMap((el) => (el.tagName === "SCRIPT" ? el.textContent : [])));
      keepUnchangedMedia(oldHost, host, scripts(oldParts) === scripts(newParts));
      oldHost.replaceWith(host);
      swappedHosts.push(host);
      if (host.querySelector(".caption-group")) captionHosts.push(host);
    }
    // Run once every host is replaced, so no new script binds to a scene still to be swapped.
    refreshSvgSelectorAliases();
    const sceneScripts = swaps.flatMap(({ newParts }) =>
      newParts
        .filter((el) => el.tagName === "SCRIPT")
        .map((el) => document.body.appendChild(document.importNode(el, true))),
    );
    await runScriptsAfterFonts(sceneScripts);
    if (state.tornDown) throw new Error("the preview was torn down during the swap");
    document
      .querySelector(`meta[name="${SCENE_PARTS_META}"]`)
      ?.setAttribute("content", JSON.stringify(nextParts));
    // Boot's order: bindings settle each src before media binding proxies and loads it.
    for (const host of swappedHosts) applyVariableBindings(document, host);
    bindMediaMetadataListeners();
    // Rewound before the rewrite, so each rewritten tween re-reads its start from the reset word.
    const rewindCaptionTimelines = () => {
      for (const host of captionHosts) {
        for (const el of [host, ...host.querySelectorAll("[data-composition-id]")]) {
          const id = el.getAttribute("data-composition-id");
          if (id) window.__timelines?.[id]?.totalTime?.(0, true);
        }
      }
    };
    initVfx(document.body, state.canonicalFps);
    applyFetchedCaptionOverrides(captionOverrides, captionHosts, rewindCaptionTimelines);
    releaseDetachedMedia();
    childrenBound = false;
    bindRootTimelineIfAvailable();
    // Probed before the scene was nested, so the new media found no volume envelope.
    for (const host of swappedHosts) {
      for (const el of host.querySelectorAll<HTMLMediaElement>("video, audio")) {
        volumeKeyframeCache.delete(el);
        probeAndCacheVolumeKeyframes(el);
      }
    }
    const duration = getSafeTimelineDurationSeconds(state.capturedTimeline, 0);
    if (duration > 0) clock.setDuration(duration);
    // Adapters drive only the elements they found at discover time; the new scene's are new.
    runAdapters("discover", state.currentTime);
    // The rebind above skips these when the root timeline object did not change.
    applyPositionEdits(document);
    // Redraw the current frame as a seek does; a playing film cut to end at or before it stops there, as at its end.
    const cutShort = clock.isPlaying() && duration > 0 && state.currentTime >= duration;
    transport.seek(cutShort ? duration : state.currentTime, { keepPlaying: !cutShort });
    syncTimedElementVisibility(state.currentTime);
    postTimeline();
  };
  // Only a preview served with a scene manifest can swap; elsewhere the caller reloads directly.
  if (readSceneParts(document)) {
    window.__hfSwapScenes = swapScenes;
    registerRuntimeCleanup(() => {
      delete window.__hfSwapScenes;
    });
  }

  const picker = createPickerModule({
    postMessage: (payload) => postRuntimeMessage(payload),
  });
  picker.installPickerApi();

  syncTimedElementVisibility(
    state.currentTime,
    Array.from(document.querySelectorAll("video[data-start], img[data-start]")),
  );
  const colorGrading = createColorGradingRuntime({
    lease: leasePausedMedia,
    release: releasePausedMedia,
  });
  colorGradingRuntime = colorGrading;
  registerRuntimeCleanup(() => {
    colorGrading.destroy();
    colorGradingRuntime = null;
  });
  // Per-pixel effect chains: compile once here, repaint on every seek below.
  initVfx(document.body, state.canonicalFps);

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
      if (!isMediaElement(el)) continue;
      try {
        el.playbackRate = state.playbackRate;
      } catch (err) {
        // ignore unsupported values
        swallow("runtime.init.site10", err);
      }
    }
  };

  // A paused seek that would reveal undecoded images holds the previous picture until they decode.
  // Capped: a request that never settles must not freeze the preview; measured jumps settle in ~200 ms.
  const SEEK_HOLD_CAP_MS = 1000;
  let heldSeek: { time: number; apply: () => void } | null = null;
  const flushHeldSeek = () => {
    const held = heldSeek;
    heldSeek = null;
    held?.apply();
  };
  const applySeek = (quantized: number, options?: { keepPlaying?: boolean }) => {
    webAudio.stopAll();
    clock.detachAudioSource();
    const wasPlaying = clock.isPlaying();
    if (wasPlaying) clock.pause();
    clock.seek(quantized);
    state.currentTime = clock.now();
    state.isPlaying = false;
    state.mediaForceSyncNextTick = true;
    const tl = state.capturedTimeline;
    pauseTimelineIfPossible(tl);
    const pageAnimations = seekTimelineAndAdapters(state.currentTime);
    runAdapters("pause", 0, pageAnimations);
    if (options?.keepPlaying && wasPlaying) {
      transport.play();
      return;
    }
    syncMediaForCurrentState();
    colorGrading.redraw();
    paintVfx(state.currentTime);
    postState(true);
  };

  const transport: RuntimePlayerTransport = {
    play: () => {
      flushHeldSeek();
      const tl = state.capturedTimeline;
      if (clock.isPlaying()) return;
      const dur = getSafeTimelineDurationSeconds(tl, 0);
      if (dur > 0) {
        clock.setDuration(dur);
        if (clock.reachedEnd()) {
          const start = clock.getPlayStart();
          clock.seek(start);
          state.currentTime = start;
          seekTimelineAndAdapters(start);
        }
      } else {
        const rootEl = resolveRootCompositionElement();
        const declaredDur = Number(rootEl?.getAttribute("data-duration") ?? 0);
        if (declaredDur > 0) clock.setDuration(declaredDur);
      }
      pauseTimelineIfPossible(tl);
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
    },
    pause: () => {
      if (!clock.isPlaying()) return;
      webAudio.stopAll();
      clock.detachAudioSource();
      clock.pause();
      state.isPlaying = false;
      state.currentTime = clock.now();
      state.mediaForceSyncNextTick = true;
      hardSyncAllMedia(state.currentTime);
      const tl = state.capturedTimeline;
      pauseTimelineIfPossible(tl);
      runAdapters("pause");
      syncMediaForCurrentState();
      colorGrading.redraw();
      postState(true);
    },
    seek: (timeSeconds, options) => {
      const quantized = quantizeTimeToFrame(
        Math.max(0, Number(timeSeconds) || 0),
        state.canonicalFps,
      );
      heldSeek = null;
      const undecoded = clock.isPlaying() ? [] : undecodedImagesShownAt(quantized);
      if (undecoded.length === 0) {
        applySeek(quantized, options);
        return;
      }
      const held = { time: quantized, apply: () => applySeek(quantized, options) };
      heldSeek = held;
      for (const img of undecoded) {
        loadPreviewImagesIn(img);
        for (let clip = img.closest(SKIPPED_CLIP); clip; clip = img.closest(SKIPPED_CLIP))
          clip.setAttribute(STUDIO_PREVIEW_UPCOMING_ATTR, "");
      }
      let capTimer = 0;
      const capped = new Promise<void>((resolve) => {
        capTimer = window.setTimeout(() => {
          if (heldSeek === held) swallow("runtime.init.seekHoldCap", undecoded);
          resolve();
        }, SEEK_HOLD_CAP_MS);
      });
      const decoded = Promise.all(
        undecoded.map((img) => (img.decode ? img.decode().catch(() => {}) : undefined)),
      );
      const landed = Promise.race([decoded, capped]).then(() => {
        window.clearTimeout(capTimer);
        if (heldSeek === held) flushHeldSeek();
      });
      registerSeekCompletion(landed);
      return landed;
    },
    renderSeek: (timeSeconds, options) => {
      heldSeek = null;
      renderCaptureSeekStarted = true;
      const seekTime = resolveRenderSeekTime(
        Math.max(0, Number(timeSeconds) || 0),
        state.canonicalFps,
        options,
      );
      webAudio.stopAll();
      clock.detachAudioSource();
      if (clock.isPlaying()) clock.pause();
      clock.seek(seekTime);
      state.currentTime = clock.now();
      state.isPlaying = false;
      state.mediaForceSyncNextTick = true;
      const pageAnimations = seekTimelineAndAdapters(state.currentTime, {
        activateChildren: true,
        suppressEvents: options?.suppressEvents,
      });
      runAdapters("pause", 0, pageAnimations);
      syncMediaForCurrentState();
      colorGrading.redraw();
      paintVfx(state.currentTime, { engineMode: true });
      postState(true);
    },
    getTime: () => heldSeek?.time ?? clock.now(),
    getDuration: () => {
      const dur = clock.getDuration();
      return Number.isFinite(dur) ? dur : 0;
    },
    isPlaying: () => clock.isPlaying(),
    setPlaybackRate: (rate) => {
      applyPlaybackRate(rate);
      clock.setRate(state.playbackRate);
      applyWebAudioRate();
    },
    getPlaybackRate: () => state.playbackRate,
  };

  const initialDuration = getSafeTimelineDurationSeconds(state.capturedTimeline, 0);
  if (initialDuration > 0) clock.setDuration(initialDuration);

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
    transport,
  });

  window.__player = createPlayerApiCompat(player);
  window.__playerReady = true;

  emitAnalyticsEvent("composition_loaded", {
    duration: player.getDuration(),
    compositionId: findRootCompositionElement()?.getAttribute("data-composition-id") ?? null,
  });

  state.deterministicAdapters = [
    createFrameSourceAdapter({
      start: (element) => resolveStartForElement(element, 0),
      duration: (element) => resolveDurationForElement(element),
      compositionDuration: () => getSafeTimelineDurationSeconds(state.capturedTimeline, 0),
      canonicalFps: () => state.canonicalFps,
      exportRenderSeek: () => Boolean(window.__HF_EXPORT_RENDER_SEEK_CONFIG),
    }),
    createWaapiAdapter(),
    createCssAdapter({
      resolveStartSeconds: (element) => resolveStartForElement(element, 0),
    }),
    createAnimeJsAdapter(),
    createLottieAdapter({
      resolveStartSeconds: (element) => resolveStartForElement(element, 0),
    }),
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
  window.__hfWaitForSeekCompletion = waitForSeekCompletion;
  runtimeCleanupCallbacks.push(() => {
    if (window.__hfWaitForSeekCompletion === waitForSeekCompletion) {
      delete window.__hfWaitForSeekCompletion;
    }
  });
  installRuntimeErrorDiagnostics();
  bindMediaMetadataListeners();
  runAdapters("discover");
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
    // Nothing else hides out-of-window clips on a paused page until someone seeks, so readiness does.
    // Media is left to init's media pass and to seeks: they own color grading and audio scheduling.
    syncTimedElementVisibility(
      state.currentTime,
      Array.from(document.querySelectorAll("[data-start]:not(video, audio, img)")),
    );
    // __renderReady = timeline binding attempted, safe for deterministic seeking.
    // Set after any GSAP batching has completed. renderSeek works with or
    // without a GSAP timeline (CSS/WAAPI/Lottie compositions use adapters only).
    window.__renderReady = true;
    postTimeline();
    postState(true);
  };

  let timelinesBuiltListener: (() => void) | null = null;
  const waitForTimelinesBuilt = () => {
    if (timelinesBuiltListener) return;
    const onTimelinesBuilt = () => {
      window.removeEventListener("hf-timelines-built", onTimelinesBuilt);
      timelinesBuiltListener = null;
      maybePublishRenderReady();
    };
    timelinesBuiltListener = onTimelinesBuilt;
    window.addEventListener("hf-timelines-built", onTimelinesBuilt);
  };
  registerRuntimeCleanup(() => {
    if (!timelinesBuiltListener) return;
    window.removeEventListener("hf-timelines-built", timelinesBuiltListener);
    timelinesBuiltListener = null;
  });

  maybePublishRenderReady = () => {
    if (state.tornDown) return;
    if (!externalCompositionsReady) {
      window.__renderReady = false;
      return;
    }
    if (window.__hfTimelinesBuilding) {
      window.__renderReady = false;
      waitForTimelinesBuilt();
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
    if (!isBuildReadinessSettled()) {
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
  maybePublishRenderReady();

  // When the bundler inlines compositions, data-composition-src is removed so
  // loadCompositions() is skipped. But inline scripts registering child
  // timelines in __timelines haven't executed yet (they run in the browser's next
  // microtask). Defer a rebinding attempt to catch them.
  if (externalCompositionsReady) {
    setTimeout(() => {
      maybePublishRenderReady();
    }, 0);
  }
  let transportTickCount = 0;
  let inTransportTick = false;
  // Reuse a completed seek only for the exact requested time and captured timeline.
  // Paused players and host ticks can share the frame without suppressing a newer time.
  let lastTransportSeekTime = Number.NaN;
  let lastTransportSeekTimeline: RuntimeTimelineLike | null = null;
  let pausedSeekDeferredByManualGesture = false;
  // Set while the transport is parked (see scheduleNextTransportFrame).
  let transportParkTimerId: number | null = null;
  let slowIdleHeartbeat = false;
  let transportWakeRequested = false;
  let parkedPollWitness = "";
  let lastSeenTimingRevision = -1;
  /** A composition change has been seen and not yet carried to consumers. */
  let compositionChangePending = false;
  let lastChangeDrivenServiceAtMs = Number.NEGATIVE_INFINITY;
  let lastPlayingPollAtMs = Number.NEGATIVE_INFINITY;
  let playingPollWitness = "";
  let lastTickPlaying = false;

  const seekRuntimeTimeline = (
    timeline: RuntimeTimelineLike,
    timeSeconds: number,
    swallowLabel: string,
    options?: RuntimeSeekOptions,
  ) => {
    try {
      const suppressEvents = options?.suppressEvents === true;
      // Guarded: a partial timeline without pause() must still get its seek.
      pauseTimelineIfPossible(timeline);
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
      const timelineDuration = getTimelineDurationSeconds(timeline);
      const sourceTime =
        readElementPlaybackStart(node) +
        sourceTimeAt(readElementRateSpec(node), Math.max(0, timeSeconds - start));
      const localTime = Math.max(
        0,
        timelineDuration != null && timelineDuration > 0
          ? Math.min(timelineDuration, sourceTime)
          : sourceTime,
      );
      seekRuntimeTimeline(timeline, localTime, "runtime.init.transport.childTimeline", options);
    }
  };

  // Unpause all non-root timelines registered in window.__timelines (siblings
  // in the registry, not GSAP child tweens). Matches the naming convention in
  // player.ts:32 (forEachSiblingTimeline) and player.ts:89 (activateSiblingTimelines).
  //
  // The rearm is a means, not a resting state: GSAP will not propagate the root's
  // totalTime() into a paused child. Returns what it touched so the caller can
  // re-pause it; a sibling parented to gsap.globalTimeline free-runs on the global
  // ticker the moment it is left unpaused. Mirrors player.ts's seek helper.
  const activateSiblingTimelines = (masterTimeline: RuntimeTimelineLike): RuntimeTimelineLike[] => {
    const timelines = (window.__timelines ?? {}) as Record<string, RuntimeTimelineLike | undefined>;
    const rearmed: RuntimeTimelineLike[] = [];
    for (const tl of Object.values(timelines)) {
      if (!tl || tl === masterTimeline) continue;
      // Recorded before the call: a play() that throws can still have unpaused.
      rearmed.push(tl);
      try {
        tl.play();
      } catch (err) {
        swallow("runtime.init.activateSiblings", err);
      }
    }
    return rearmed;
  };

  const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;

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
    if (!("getChildren" in timeline) || typeof timeline.getChildren !== "function") {
      return false;
    }

    let children: unknown;
    try {
      children = timeline.getChildren(true, true, true);
    } catch (err) {
      swallow("runtime.init.gsapCallbackChildren", err);
      return false;
    }
    if (!Array.isArray(children)) return false;

    for (const child of children) {
      if (!isObjectRecord(child)) continue;
      const vars = child.vars;
      if (!isObjectRecord(vars)) continue;
      const hasCallback = GSAP_CALLBACK_NAMES.some((name) => typeof vars[name] === "function");
      if (!hasCallback) continue;

      const totalDuration = readGsapDuration(child, "totalDuration");
      const duration = totalDuration ?? readGsapDuration(child, "duration");
      if (duration != null && duration <= 0.000001) return true;
    }
    return false;
  };

  /**
   * Borrow, seek, return. Siblings are unpaused only across the seek; restored in
   * `finally`, because a throw mid-seek is when a leaked one starts free-running.
   */
  function seekTimelineAndAdapters(
    t: number,
    opts?: { activateChildren?: boolean; suppressEvents?: boolean },
  ): () => Animation[] {
    const tl = state.capturedTimeline;
    // Critical for a sub-composition whose data-start is at or near 0: it is added
    // to the root while the root is paused and may never receive an explicit
    // play(), so without the rearm it holds its initial CSS state (opacity:0).
    const rearmed = tl && opts?.activateChildren ? activateSiblingTimelines(tl) : [];
    try {
      const animations = seekRootChildrenAndAdapters(tl, t, opts);
      lastTransportSeekTime = t;
      lastTransportSeekTimeline = tl;
      return animations;
    } finally {
      for (const sibling of rearmed) pauseTimelineIfPossible(sibling);
    }
  }

  function seekRootChildrenAndAdapters(
    tl: RuntimeTimelineLike | null,
    t: number,
    opts?: { activateChildren?: boolean; suppressEvents?: boolean },
  ): () => Animation[] {
    const suppressEvents = opts?.suppressEvents === true;
    if (tl) {
      // #10: when data-duration exceeds the timeline's intrinsic length the
      // engine requests frames past the last tween. Seeking a paused GSAP
      // timeline past its end can revert from()-tweens to their empty initial
      // state, blanking the final poster. Clamp the MASTER seek to the
      // timeline's full extent so it holds the final computed frame instead.
      // Adapters still receive the raw `t` (their media may run longer).
      // totalDuration() includes repeats; Infinity (infinite repeat) → no clamp.
      let tlSeekTime = t;
      if (typeof tl.totalDuration === "function") {
        try {
          const total = Number(tl.totalDuration());
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
            // The first seek is the only eventful one; the re-render only refreshes styles.
            rerenderGsapTimelineAt(
              {
                totalTime: tl.totalTime.bind(tl),
                totalDuration: tl.totalDuration?.bind(tl),
                getChildren: tl.getChildren?.bind(tl),
              },
              tlSeekTime,
            );
          }
        } else {
          tl.seek(tlSeekTime, suppressEvents);
        }
      } catch (err) {
        swallow("runtime.init.transport.seek", err);
      }
      // Root propagation cannot represent an authored child source offset or
      // playback rate. Re-seek registered children below with their host's
      // explicit source-time contract.
    }
    // A second `activateSiblingTimelines` used to follow this call. Dropping it is
    // safe because nothing between frames READS a sibling's paused() — grepped over
    // the deterministic adapters, syncTimedElementVisibility, the hf-timelines-built
    // handler and __hfReseekGpu. It only ever moved the state the seek left behind.
    seekStandaloneRegisteredTimelines(t, opts);
    const pageAnimations = pageAnimationsForOnePass();
    for (const adapter of state.deterministicAdapters) {
      if (adapter.name === "gsap" && tl) continue;
      try {
        adapter.seek({ time: t, suppressEvents, pageAnimations });
      } catch (err) {
        swallow("runtime.init.transport.adapter", err);
      }
    }
    return pageAnimations;
  }

  // True while the Studio is mid-drag on an element (the gesture marker is
  // stamped on the gestured element for the duration of the drag). During a
  // paused gesture the draft writer owns the element's transform, so the
  // per-frame transport re-seek must yield to it (see transportTick).
  //
  // The watch is document-global (fine for today's single-composition Studio;
  // revisit if a multi-composition editor needs to scope this to one root).
  // It used to be a `document.querySelector` on every paused frame, described
  // here as negligible; measured, it was 1.8 ms/s on a 1689-element project and
  // 3.0 ms/s — 6.4% of the whole paused main-thread budget — on a media-heavy
  // one. An attribute-filtered observer answers the same question in O(edits),
  // and its change callback is also what un-parks the transport when a drag
  // starts or ends.
  const manualEditGestureWatch = createManualEditGestureWatch(document, () => {
    wakeTransport();
  });
  runtimeCleanupCallbacks.push(() => manualEditGestureWatch.disconnect());
  const hasActiveStudioManualEditGesture = (): boolean => {
    try {
      return manualEditGestureWatch.isActive();
    } catch {
      return false;
    }
  };

  /**
   * Nothing a tick would discover can change without one of the wake signals
   * firing, so the loop may stand down until one does.
   */
  const canParkTransport = (): boolean =>
    !clock.isPlaying() &&
    !isExportRenderDrivingFrames() &&
    // Without MutationObserver nothing can PUSH a DOM change: neither the
    // composition-timing watcher nor the gesture watch attaches, and both fall
    // back to answering from the document only when asked. Looking every frame
    // is then the only correct behaviour, so such a host keeps the loop it had.
    //
    // Unreachable today, and the reason is worth recording rather than
    // trusting: `createColorGradingRuntime` constructs a MutationObserver
    // unconditionally earlier in this same init (colorGrading.ts, the
    // `document.body` branch), so a host without one never gets as far as a
    // running transport. This stays as the explicit statement of the
    // invariant, one boolean, for the day that guard is added there.
    manualEditGestureWatch.observing &&
    // A drop/cancel owes one reconciling seek; the gesture watch wakes the loop when it clears.
    (!pausedSeekDeferredByManualGesture || hasActiveStudioManualEditGesture()) &&
    // A composition change is owed a manifest post that the rate limit has
    // deferred. Parking here would strand it until the next unrelated change,
    // so the loop stays awake — for at most one cadence interval — until the
    // post goes out.
    !compositionChangePending &&
    // The playhead and the bound timeline are both where the last seek left
    // them, so re-seeking on the next frame would render the same frame again.
    state.currentTime === lastTransportSeekTime &&
    state.capturedTimeline === lastTransportSeekTimeline;

  /**
   * The parked loop has two jobs:
   *
   * 1. Keep the control bridge's paused heartbeat on its documented interval
   *    (`state.bridgeMaxPostIntervalMs`; a second after `set-idle-heartbeat`,
   *    once the whole timeline is bound) so a paused timeline confirms its position.
   * 2. Re-read everything nothing can push (`readParkedPollWitness`) on that
   *    same beat: a timer, not a frame loop, is what keeps a paused runtime
   *    cheap.
   */
  /**
   * Everything a parked transport still has to LOOK at, because no observer
   * and no event can tell it.
   *
   * Two inputs qualify, and both are documented at their source:
   *   - the timeline registry, a plain object a composition script writes into
   *     (see `readCompositionTimingRevision`); and
   *   - the adapter duration floor, which adapters infer from live animation
   *     objects — CSS, WAAPI, Lottie — that can lengthen with no DOM mutation
   *     and no media event (see the comment on `resolveAdapterDurationFloorSeconds`
   *     in `getSafeTimelineDurationSeconds`).
   *
   * Calling `readCompositionTimingRevision` here is also what DRAINS the
   * mutation observer, so a record that arrived without its callback running
   * is caught on this path too.
   */
  const readParkedPollWitness = (): string =>
    `${readCompositionTimingRevision()}|${resolveAdapterDurationFloorSeconds() ?? ""}`;

  const armParkTimer = () => {
    transportParkTimerId = window.setTimeout(
      parkedTransportHeartbeat,
      slowIdleHeartbeat && state.capturedTimeline && childrenBound
        ? SLOW_IDLE_HEARTBEAT_MS
        : state.bridgeMaxPostIntervalMs,
    );
  };

  const parkedTransportHeartbeat = () => {
    transportParkTimerId = null;
    if (state.tornDown) return;
    // The page can go away with the timer still armed — an embedder discarding
    // the frame, or a test environment torn down around an abandoned runtime.
    // Stop rather than re-arm: there is nothing left to report a state change
    // to, and every read below would throw on a missing global.
    if (typeof window === "undefined" || typeof document === "undefined") return;
    if (readParkedPollWitness() !== parkedPollWitness) {
      // Through wakeTransport, not straight to rAF: reading the witness can
      // itself wake us (the registry compare bumps the revision, and that
      // invalidation hook calls wakeTransport).
      wakeTransport();
      return;
    }
    postState(false);
    armParkTimer();
  };

  const scheduleNextTransportFrame = () => {
    state.transportRafId = null;
    if (state.tornDown) return;
    const woken = transportWakeRequested;
    transportWakeRequested = false;
    if (woken || !canParkTransport()) {
      state.transportRafId = window.requestAnimationFrame(transportTick);
      return;
    }
    // Read fresh rather than reusing the tick's own `timingRevision`: the tick
    // may have run postTimeline, which stamps authored-timing attributes the
    // observer watches. Parking on the pre-postTimeline revision would make
    // the very first heartbeat see a change and wake for the loop's own writes.
    parkedPollWitness = readParkedPollWitness();
    armParkTimer();
  };

  wakeTransport = () => {
    if (state.tornDown) return;
    // Inside a tick the tail is the only scheduler; setting the flag there is
    // what stops it parking on work it has just been told about.
    transportWakeRequested = true;
    if (inTransportTick || state.transportRafId != null) return;
    if (transportParkTimerId != null) {
      window.clearTimeout(transportParkTimerId);
      transportParkTimerId = null;
    }
    transportWakeRequested = false;
    state.transportRafId = window.requestAnimationFrame(transportTick);
  };

  const followedOrLongestRunningAudio = (
    followed: HTMLMediaElement | null,
  ): { el: HTMLMediaElement; start: number } | null => {
    const audioEls = document.querySelectorAll("audio[data-start]");
    let longest: { el: HTMLMediaElement; start: number; runsUntil: number } | null = null;
    for (const el of followed ? [followed, ...audioEls] : audioEls) {
      if (!isMediaElement(el) || !el.isConnected) continue;
      if (isSilencedByHidden(el) || isUnplayable(el) || (el.ended && !el.loop)) continue;
      if (!el.hasAttribute("src") && !el.querySelector("source[src]")) continue;
      const start = resolveAbsoluteMediaStartSeconds(el);
      const durAttr = parseStrictFiniteTimingNumber(el.dataset.duration);
      const end = durAttr != null && durAttr > 0 ? start + durAttr : Infinity;
      if (!Number.isFinite(start) || !isInClipWindow(state.currentTime, start, end)) continue;
      if (el === followed) return { el, start };
      const runsUntil = start + (resolveMediaElementDurationSeconds(el) ?? Infinity);
      if (!longest || runsUntil > longest.runsUntil) longest = { el, start, runsUntil };
    }
    return longest;
  };

  function refreshTransportClockSource(): void {
    // Audio-master clock: three tiers of timing precision.
    // 1. WebAudio (AudioContext.currentTime) while it plays a decoded buffer: ~21µs, sample-accurate
    // 2. HTMLMediaElement (audio.currentTime): ~33ms, frame-accurate
    // 3. Monotonic (performance.now()): ~1ms, no audio coupling
    if (clock.isPlaying() && !state.mediaOutputMuted) {
      if (
        !state.nativeMediaSyncDisabled &&
        !state.webAudioMediaDisabled &&
        webAudio.ownsClock() &&
        webAudio.context
      ) {
        const webAudioTime = webAudio.getTime();
        if (webAudioTime >= 0) {
          clock.attachAudioSource({ currentTimeSeconds: webAudioTime });
        }
      } else {
        const source = followedOrLongestRunningAudio(clock.audioElement());
        if (source && !source.el.paused) {
          clock.attachAudioSource({
            el: source.el,
            compositionStart: source.start,
            mediaStart: readElementPlaybackStart(source.el),
            rate: readElementRateSpec(source.el),
          });
        } else if (source && source.el.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
          // Audio is buffering — freeze visuals at last known position
          // instead of falling through to monotonic (which runs ahead).
          clock.attachAudioSource({ currentTimeSeconds: state.currentTime });
        } else if (clock.hasAudioSource()) {
          clock.detachAudioSource();
        }
      }
    } else if (clock.hasAudioSource()) {
      clock.detachAudioSource();
    }
  }

  const transportTick = () => {
    if (state.tornDown || inTransportTick) return;
    inTransportTick = true;
    try {
      transportTickCount += 1;

      // The jobs below run when the composition revision moves (rate-limited). What no
      // observer sees is polled: on the frame counter paused, on a timer playing.
      const timingRevision = readCompositionTimingRevision();
      if (timingRevision !== lastSeenTimingRevision) {
        lastSeenTimingRevision = timingRevision;
        compositionChangePending = true;
      }
      const nowMs = Date.now();
      const playing = clock.isPlaying();
      const playingPollDue = playing && nowMs - lastPlayingPollAtMs >= PLAYING_POLL_INTERVAL_MS;
      const stoppedPlaying = lastTickPlaying && !playing;
      lastTickPlaying = playing;
      if (playingPollDue) {
        lastPlayingPollAtMs = nowMs;
        const witness = readParkedPollWitness();
        if (witness !== playingPollWitness) {
          playingPollWitness = witness;
          compositionChangePending = true;
        }
      }
      const changeDrivenService =
        compositionChangePending &&
        nowMs - lastChangeDrivenServiceAtMs >= CHANGE_DRIVEN_SERVICE_MIN_INTERVAL_MS;
      if (changeDrivenService) lastChangeDrivenServiceAtMs = nowMs;
      const pausedCounterDue = (interval: number) =>
        !playing && transportTickCount % interval === 0;

      // Slower operations: timeline binding (~every 60 frames / ~1s at 60fps).
      // `compositionChanged` goes IN to the policy, never around it: the policy
      // owns the hold that keeps an async rebind off the first two seconds of
      // playback, and ORing past it removed that hold.
      if (
        shouldAttemptPeriodicTimelineBind({
          tick: transportTickCount,
          isPlaying: playing,
          hasCapturedTimeline: state.capturedTimeline != null,
          currentTimeSeconds: clock.now(),
          compositionChanged: changeDrivenService,
          playingPollDue,
        })
      ) {
        const prevTimeline = state.capturedTimeline;
        if (bindRootTimelineIfAvailable()) {
          if (state.capturedTimeline && !player._timeline) {
            player._timeline = state.capturedTimeline;
          }
          if (state.capturedTimeline && state.capturedTimeline !== prevTimeline) {
            pauseTimelineIfPossible(state.capturedTimeline);
          }
          const dur = getSafeTimelineDurationSeconds(state.capturedTimeline, 0, timingRevision);
          if (dur > 0) clock.setDuration(dur);
          postTimeline();
        }
      }
      if (changeDrivenService || pausedCounterDue(TIMELINE_POST_INTERVAL_FRAMES)) {
        // The manifest is what carries a composition change to its consumers,
        // so posting it is what discharges the pending flag — whichever path
        // got here. Clearing it when the change is merely SEEN would drop it
        // whenever the rate limit deferred the post.
        //
        // And clearing it AFTER the post, not before: postTimeline walks author
        // DOM and can throw. The tail scheduler runs in this tick's `finally`
        // either way, so clearing first would let it see nothing owed and park
        // with the change undelivered — permanently, until some unrelated
        // change happens to wake the loop again.
        postTimeline();
        compositionChangePending = false;
      } else if (playingPollDue || stoppedPlaying) {
        postTimelineIfManifestChanged();
      }
      if (changeDrivenService || pausedCounterDue(MEDIA_BIND_INTERVAL_FRAMES)) {
        bindMediaMetadataListeners();
      }

      // Sync clock duration with the resolved timeline each tick (catches async
      // rebinds, live data-duration edits). Never shrink while playing — transient
      // short reads cause reachedEnd() → playhead jumps to end (#1636).
      if (state.capturedTimeline) {
        const dur = getSafeTimelineDurationSeconds(state.capturedTimeline, 0, timingRevision);
        if (dur > 0 && (!clock.isPlaying() || dur >= clock.getDuration())) {
          clock.setDuration(dur);
        }
      }

      refreshTransportClockSource();

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
      const isPlaying = clock.isPlaying();
      const manualEditOwnsPausedFrame = !isPlaying && hasActiveStudioManualEditGesture();
      if (manualEditOwnsPausedFrame) {
        // Force one reconciliation after drop/cancel even though the playhead did not move.
        pausedSeekDeferredByManualGesture = true;
      } else if (
        isPlaying ||
        pausedSeekDeferredByManualGesture ||
        t !== lastTransportSeekTime ||
        state.capturedTimeline !== lastTransportSeekTimeline
      ) {
        seekTimelineAndAdapters(t);
        if (!isPlaying) pausedSeekDeferredByManualGesture = false;
      }
      if (isPlaying) {
        colorGrading.redrawAnimated();
      }

      // The clock stops at its end (GSAP's repeat:-1 is bypassed: we drive
      // tl.totalTime(t) directly); the parent loops by seeking to its range
      // start, or 0, and playing again.
      if (clock.isPlaying() && clock.reachedEnd()) {
        webAudio.stopAll();
        clock.detachAudioSource();
        clock.pause();
        state.isPlaying = false;
        const stop = clock.getStopTime();
        if (Number.isFinite(stop)) {
          clock.seek(stop);
          state.currentTime = stop;
          seekTimelineAndAdapters(stop);
        }
        runAdapters("pause");
        syncMediaForCurrentState(timingRevision);
        postState(true);
        return;
      }

      if (clock.isPlaying()) {
        syncMediaForCurrentState(timingRevision);
      } else if (hasRunningTimedMedia()) {
        // Nothing may run while the clock is paused, and the paused side used to
        // police nothing. Dropping the cursor forces a full visit: the seek-window
        // index skips an element that started outside the current window, which is
        // exactly the one to stop.
        lastSyncedMediaTimeSeconds = null;
        syncMediaForCurrentState(timingRevision);
      }
      postState(false);
    } finally {
      inTransportTick = false;
      // Re-arm here, not at the top: the reached-end branch returns early and
      // must still schedule, and the decision to park can only be made once
      // the tick has settled the playhead.
      scheduleNextTransportFrame();
    }
  };

  const hardSyncAllMedia = (timeSeconds: number) => {
    const mediaEls = document.querySelectorAll("video, audio");
    for (const el of mediaEls) {
      if (!isMediaElement(el)) continue;
      if (!el.isConnected) continue;
      if (!el.hasAttribute("data-start")) continue;
      const start = resolveAbsoluteMediaStartSeconds(el);
      if (!Number.isFinite(start)) continue;
      const durAttr = parseStrictFiniteTimingNumber(el.dataset.duration);
      const end = durAttr != null && durAttr > 0 ? start + durAttr : Infinity;
      if (!isInClipWindow(timeSeconds, start, end)) continue;
      const mediaStart = readElementPlaybackStart(el);
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
    for (const rawEl of webAudioMediaIn(document)) {
      if (isSilencedByHidden(rawEl)) continue;
      const compStart = resolveAbsoluteMediaStartSeconds(rawEl);
      if (!Number.isFinite(compStart)) continue;
      const mediaStart = readElementPlaybackStart(rawEl);
      const volumeAttr = Number.parseFloat(rawEl.dataset.volume ?? "");
      const vol = Number.isFinite(volumeAttr) ? volumeAttr : 1;
      const durationAttr = parseStrictFiniteTimingNumber(rawEl.dataset.duration);
      let clipDuration =
        durationAttr != null && durationAttr > 0 ? durationAttr : Number.POSITIVE_INFINITY;
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
      // Decided BEFORE the transport is asked, because the two verdicts want
      // two different fallback chains — and only one of them is the chain
      // that existed before (#3458).
      const route = classifyWebAudioMediaRoute(rawEl);
      reportWebAudioMediaRoute(rawEl, route);
      // The cross-origin verdict's BEST outcome is decode, since a CDN that
      // sends `Access-Control-Allow-Origin` (the author just never wrote the
      // `crossorigin` attribute) decodes fine and keeps the whole FX graph.
      const capture =
        route.kind === "web-audio"
          ? webAudio.scheduleMediaElementPlayback(
              rawEl,
              compStart,
              mediaStart,
              clock.now(),
              vol,
              gen,
              state.playbackRate,
            )
          : Promise.resolve(null);
      void capture.then((scheduled) => {
        const replacedByNewerPass = gen !== webAudio.currentGeneration();
        // A video's picture must keep playing from the element, so it has no decode fallback.
        if (scheduled || !isAudioElement(rawEl) || !clock.isPlaying() || replacedByNewerPass)
          return;
        // Decoded buffers cannot follow a rate curve without shifting pitch; the media element can.
        if (typeof readElementRateSpec(rawEl) !== "number") return;
        const effectiveRate = state.playbackRate * readElementPlaybackRate(rawEl);
        // Deliberately the FX/automation pair and NOT
        // `nativeUnexpressibleProcessing()`, which this route's diagnostic uses.
        // The two answer different questions: the diagnostic lists everything
        // native output cannot carry (group bus and above-unity gain included),
        // while this decides whether losing the graph is worse than silence.
        // Widening it here would newly mute tracks that play today — a grouped
        // clip at a non-unit rate among them — which is a behaviour change
        // #3458 does not call for.
        const hasProcessing =
          rawEl.hasAttribute("data-fx-chain") || rawEl.hasAttribute("data-automation");
        // A decoded AudioBufferSourceNode changes pitch whenever its playback
        // rate is non-unit. Bare tracks may safely stay on native output; a
        // processed track must fail closed rather than silently lose its graph.
        if (Math.abs(effectiveRate - 1) > 1e-9) {
          // ...but only when the transport TRIED and failed. On the
          // cross-origin route capture was withheld on purpose, and native
          // output is the fix — muting here would hand back the exact
          // silence #3458 is about, now with the runtime's own blessing. The
          // dropped processing is reported instead (`reportWebAudioMediaRoute`).
          if (route.kind === "web-audio" && hasProcessing) rawEl.muted = true;
          return;
        }
        void webAudio.decodeAudioElement(rawEl).then((buffer) => {
          if (!buffer || !clock.isPlaying()) return;
          void webAudio.schedulePlayback(
            rawEl,
            buffer,
            compStart,
            mediaStart,
            () => clock.now(),
            vol,
            gen,
            state.playbackRate,
            clipDuration,
          );
        });
      });
    }
  };

  // Apply a new playback rate to the WebAudio transport. Unbounded sources are
  // rescaled in place; but a bounded source's window was baked into start()'s
  // duration at its prior rate and can't be rescaled, so when one is active we
  // stopAll()+reschedule at the new rate to keep trimmed clips ending on time.
  function applyWebAudioRate() {
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
  }

  // Sync clock duration from any captured timeline
  if (state.capturedTimeline) {
    const dur = getSafeTimelineDurationSeconds(state.capturedTimeline, 0);
    if (dur > 0) clock.setDuration(dur);
    pauseTimelineIfPossible(state.capturedTimeline);
  }

  installPositionEditsSeekReapply(window as Window & typeof globalThis);

  // Start the rAF tick loop
  state.transportRafId = window.requestAnimationFrame(transportTick);
  postTimeline();
  postState(true);

  // Wire the control bridge LAST — after every transport helper its handlers
  // dispatch to (seekTimelineAndAdapters, applyWebAudioRate, ...) is declared.
  // The runtime's external control surface only goes live once all of its
  // dependencies exist, so a load-time seek / set-playback-rate can never reach
  // a not-yet-initialized helper (the 'before initialization' TDZ this fixes).
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
        if (isMediaElement(el) && !el.paused) el.pause();
      }
    },
    onSeek: (timeSeconds, _seekMode) => {
      player.seek(timeSeconds);
      emitAnalyticsEvent("composition_seeked", { time: timeSeconds });
    },
    onSetMuted: (muted) => {
      state.bridgeMuted = muted;
      const effective = muted || state.mediaOutputMuted;
      webAudio.setMuted(effective);
      const mediaEls = document.querySelectorAll("video, audio");
      for (const el of mediaEls) {
        if (!isMediaElement(el)) continue;
        el.muted = effective || el.defaultMuted;
      }
    },
    onSetVolume: (volume) => {
      state.bridgeVolume = volume;
      webAudio.setVolume(volume);
      const mediaEls = document.querySelectorAll("video, audio");
      for (const el of mediaEls) {
        if (!isMediaElement(el)) continue;
        const parsed = parseFloat(el.dataset.volume ?? "");
        const clipVolume = Number.isFinite(parsed) ? parsed : 1;
        // `data-volume` carries authored gain, which goes above unity now that
        // the ceiling is 12 dB — and `el.volume` is spec-pinned to [0,1], so
        // assigning the product raw THROWS IndexSizeError and takes the rest of
        // the loop with it. The element carries the legal part; the boost above
        // unity belongs to Web Audio, which already has it from `setVolume`.
        //
        // Through `clampNativeMediaVolume` rather than an inline clamp: that
        // helper exists in `audioGain.ts` for exactly this bound and is what
        // `withUnclampedVolume` uses, so the two cannot drift.
        el.volume = clampNativeMediaVolume(clipVolume * volume);
      }
    },
    onSetMediaOutputMuted: (muted) => {
      state.mediaOutputMuted = muted;
      const effective = muted || state.bridgeMuted;
      webAudio.setMuted(effective);
      const mediaEls = document.querySelectorAll("video, audio");
      for (const el of mediaEls) {
        if (!isMediaElement(el)) continue;
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
    onSetDisplayScale: setProxyDisplayScale,
    onSetIdleHeartbeat: (slow) => {
      slowIdleHeartbeat = slow;
      wakeTransport();
    },
    onSetRootDuration: growRootDurationLive,
    onSetPlayRange: (startSeconds, endSeconds) => {
      clock.setPlayRange(startSeconds, endSeconds, state.canonicalFps);
      const start = clock.getPlayStart();
      if (clock.isPlaying() && (clock.now() < start || clock.reachedEnd())) {
        transport.seek(start, { keepPlaying: true });
        return;
      }
      postState(true);
    },
    onSetColorGrading: (target, grading) => {
      colorGrading.setGrading(target, grading);
    },
    onSetColorGradingCompare: (target, compare) => {
      colorGrading.setCompare(target, compare);
    },
    onTick: () => {
      if (state.tornDown || !clock.isPlaying()) return;
      refreshTransportClockSource();
      const t = clock.now();
      state.currentTime = t;
      if (t !== lastTransportSeekTime || state.capturedTimeline !== lastTransportSeekTimeline) {
        seekTimelineAndAdapters(t);
      }
      if (clock.reachedEnd()) {
        webAudio.stopAll();
        clock.detachAudioSource();
        clock.pause();
        state.isPlaying = false;
        const stop = clock.getStopTime();
        if (Number.isFinite(stop)) {
          clock.seek(stop);
          state.currentTime = stop;
          seekTimelineAndAdapters(stop);
        }
        runAdapters("pause");
        syncMediaForCurrentState();
        postState(true);
      }
    },
    onEnablePickMode: () => picker.enablePickMode(),
    onDisablePickMode: () => picker.disablePickMode(),
    onSetRuntimeData: setRuntimeData,
    onClearRuntimeData: clearRuntimeData,
    getCanonicalFps: () => state.canonicalFps,
  });

  const teardown = () => {
    if (state.tornDown) return;
    state.tornDown = true;
    if (state.transportRafId != null) {
      window.cancelAnimationFrame(state.transportRafId);
      state.transportRafId = null;
    }
    if (transportParkTimerId != null) {
      window.clearTimeout(transportParkTimerId);
      transportParkTimerId = null;
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
    // A stale, never-resolved buildReady promise from the torn-down composition
    // would otherwise permanently block render-ready for whatever loads next
    // into this window, since window.__hf itself is never reset.
    if (window.__hf?.buildReady) window.__hf.buildReady = {};
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
    for (const linkEl of state.injectedCompLinks) {
      try {
        linkEl.remove();
      } catch (err) {
        // ignore cleanup failures
        swallow("runtime.init.site15", err);
      }
    }
    state.injectedCompLinks = [];
    for (const scriptEl of state.injectedCompScripts) {
      try {
        scriptEl.remove();
      } catch (err) {
        // ignore cleanup failures
        swallow("runtime.init.site16", err);
      }
    }
    state.injectedCompScripts = [];
    state.capturedTimeline = null;
    reconcileTimelineAfterRuntimeData = () => undefined;
    if (window.__hfRuntimeTeardown === teardown) {
      window.__hfRuntimeTeardown = null;
    }
  };
  window.__hfRuntimeTeardown = teardown;
  state.beforeUnloadHandler = teardown;
  window.addEventListener("beforeunload", state.beforeUnloadHandler);
}
