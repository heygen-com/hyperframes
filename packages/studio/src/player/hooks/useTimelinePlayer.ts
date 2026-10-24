import { useRef, useCallback, useEffect } from "react";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import { useMountEffect } from "../../hooks/useMountEffect";
import { usePlaybackKeyboard } from "./usePlaybackKeyboard";
import { useTimelineSyncCallbacks } from "./useTimelineSyncCallbacks";
import { useShadowPreviewReload } from "./useShadowPreviewReload";
import { logReload } from "../../utils/reloadDebug";

export type { ClipManifestClip } from "../lib/playbackTypes";
export { createStaticSeekPlaybackAdapter } from "../lib/playbackAdapter";
export {
  buildStandaloneRootTimelineElement,
  createTimelineElementFromManifestClip,
  findTimelineDomNodeForClip,
  getTimelineElementSelector,
  mergeTimelineElementsPreservingDowngrades,
  parseTimelineFromDOM,
  readTimelineDurationFromDocument,
  resolveStandaloneRootCompositionSrc,
} from "../lib/timelineDOM";
export {
  shouldIgnorePlaybackShortcutEvent,
  shouldIgnorePlaybackShortcutTarget,
} from "../lib/playbackShortcuts";

import { releaseStaticSeekCache } from "../lib/playbackAdapter";
import { mergeTimelineElementsPreservingDowngrades } from "../lib/timelineDOM";
import { findTimelineElementInIframe } from "../../hooks/timelineEditingHelpers";
import { normalizeToZones } from "../components/timelineZones";
import { stopScrubPreviewAudio } from "../lib/playbackScrub";
import { hasTimelinePerformanceFixtureLease } from "../lib/timelinePerformanceFixture";
import { applyCachedSourceDurations, probeMissingSourceDurations } from "../lib/mediaProbe";
import { applyPreviewVariablesToUrl } from "../../hooks/previewVariablesStore";
import { isStudioManualEditGestureLiveIn } from "../../components/editor/manualEditsDom";
import { createPreviewMessageHandler } from "./previewMessageRouter";
import { timelineElementsChanged } from "./timelinePlayerSync";
import { safeContentDocument } from "./timelineSyncHydration";
import { sceneSwapFor, supersededByNewerEdit } from "../sceneSwap";
import { whileScriptWrites } from "../previewReloading";
import {
  usePreviewAdapter,
  useTimelineTransport,
  type IframeRef,
  type NumberRef,
  type PreviewAdapter,
  type TimelineTransport,
} from "./useTimelineTransport";

export interface UseTimelinePlayerOptions {
  /** Runs right after a reloaded preview becomes the live iframe. */
  onShadowPromoted?: () => void;
  /** A reload was abandoned (cause in the message); the previous preview is still showing. */
  onPreviewReloadFailed?: (message: string) => void;
}

interface PreviewRefreshDeps {
  iframeRef: IframeRef;
  pendingSeekRef: NumberRef;
  isRefreshingRef: React.MutableRefObject<boolean>;
  transport: TimelineTransport;
  getAdapter: PreviewAdapter["getAdapter"];
  beginShadowReload: (url: string) => void;
  previewGeneration: () => number;
}

function usePreviewRefresh(deps: PreviewRefreshDeps) {
  const { iframeRef, pendingSeekRef, isRefreshingRef, getAdapter, beginShadowReload } = deps;
  const { shuttleDirectionRef, stopRAFLoop, stopReverseLoop } = deps.transport;
  const { previewGeneration } = deps;
  const { setIsPlaying } = usePlayerStore.getState();
  const saveSeekPosition = useCallback(() => {
    // Never DEGRADE the saved position. Overlapping reloads (e.g. an external
    // file drop = upload reload + insert reload back-to-back) call this while
    // the iframe from the FIRST reload is mid-teardown: getAdapter() can still
    // return that dying document's adapter, whose getTime() reads 0 — and the
    // store's currentTime can lag the visual playhead. Overwriting the
    // still-unconsumed pendingSeek with either value puts the playhead at 0
    // after a Finder drop. So: while a refresh is already in flight and a
    // save exists, keep it; otherwise trust the live adapter, then the store.
    const refreshInFlight = isRefreshingRef.current && pendingSeekRef.current != null;
    if (!refreshInFlight) {
      const adapter = getAdapter();
      if (adapter) {
        pendingSeekRef.current = adapter.getTime();
      } else if (pendingSeekRef.current == null) {
        pendingSeekRef.current = usePlayerStore.getState().currentTime ?? 0;
      }
    }
    isRefreshingRef.current = true;
    // Forward playback runs on in the live frame; the promotion hands it to the new document.
    const keepPlaying =
      usePlayerStore.getState().isPlaying && shuttleDirectionRef.current !== "backward";
    stopReverseLoop();
    if (keepPlaying) return true;
    stopRAFLoop();
    setIsPlaying(false);
    return false;
  }, [
    getAdapter,
    stopRAFLoop,
    setIsPlaying,
    stopReverseLoop,
    isRefreshingRef,
    pendingSeekRef,
    shuttleDirectionRef,
  ]);
  const reloadWholeFilm = useCallback(
    (url: string) => {
      // The old iframe is no longer navigated away, so stop its playback (and audio) here.
      if (!saveSeekPosition()) getAdapter()?.pause();
      // The live iframe is never hidden; the reload loads in a shadow and is promoted once painted.
      beginShadowReload(url);
    },
    [saveSeekPosition, getAdapter, beginShadowReload],
  );
  const refreshGenRef = useRef(0);
  const swapCancelRef = useRef<AbortController | null>(null);
  const refreshPlayer = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    swapCancelRef.current?.abort(supersededByNewerEdit());
    const cancel = new AbortController();
    swapCancelRef.current = cancel;
    logReload("refreshPlayer", () => ({ stack: new Error("refreshPlayer").stack }));
    const url = new URL(iframe.src, window.location.origin);
    url.searchParams.set("_t", String(Date.now()));
    applyPreviewVariablesToUrl(url);
    const gen = ++refreshGenRef.current;
    const slot = previewGeneration();
    // A newer edit, or anything replacing the live preview (a reload, a composition switch), wins.
    const isCurrent = () => gen === refreshGenRef.current && slot === previewGeneration();
    const swap = sceneSwapFor(iframe);
    const swapWouldReplaceGestureNode =
      !!iframe.contentDocument && isStudioManualEditGestureLiveIn(iframe.contentDocument);
    if (!swap || isRefreshingRef.current || swapWouldReplaceGestureNode)
      return reloadWholeFilm(url.toString());
    whileScriptWrites(() => swap(url.toString(), isCurrent, cancel.signal)).catch(
      (error: unknown) => {
        if (!isCurrent()) return;
        logReload("scene-swap-refused", { reason: String(error) });
        reloadWholeFilm(url.toString());
      },
    );
  }, [reloadWholeFilm, previewGeneration, iframeRef, isRefreshingRef]);
  return { saveSeekPosition, refreshPlayer };
}

interface PlayerListenerDeps {
  iframeRef: IframeRef;
  iframeShortcutCleanupRef: React.MutableRefObject<(() => void) | null>;
  playbackKeyDownRef: React.MutableRefObject<(e: KeyboardEvent) => void>;
  playbackKeyUpRef: React.MutableRefObject<(e: KeyboardEvent) => void>;
  processTimelineMessageRef: Parameters<
    typeof createPreviewMessageHandler
  >[0]["processTimelineMessageRef"];
  enrichMissingCompositionsRef: Parameters<
    typeof createPreviewMessageHandler
  >[0]["enrichMissingCompositionsRef"];
  syncTimelineElements: (elements: TimelineElement[], nextDuration?: number) => void;
  cancelPendingLoad: () => void;
  preview: PreviewAdapter;
  transport: TimelineTransport;
}

function usePlayerListeners(deps: PlayerListenerDeps) {
  const { iframeRef, iframeShortcutCleanupRef, playbackKeyDownRef, playbackKeyUpRef } = deps;
  const { processTimelineMessageRef, enrichMissingCompositionsRef, syncTimelineElements } = deps;
  const { cancelPendingLoad } = deps;
  const { staticSeekAdapterRef, staticSeekWarnedRef, getAdapter } = deps.preview;
  const { applyPlaybackRate, applyPreviewAudioState } = deps.preview;
  const { pause, stopRAFLoop, stopReverseLoop } = deps.transport;
  const lastTimelineMessageRef = useRef<number>(0);
  const pauseRef = useRef(pause);
  pauseRef.current = pause;

  useMountEffect(() => {
    const handleWindowKeyDown = (e: KeyboardEvent) => playbackKeyDownRef.current(e);
    const handleWindowKeyUp = (e: KeyboardEvent) => playbackKeyUpRef.current(e);

    const handleMessage = createPreviewMessageHandler({
      iframeRef,
      processTimelineMessageRef,
      enrichMissingCompositionsRef,
      lastTimelineMessageRef,
      getAdapter,
      syncTimelineElements,
    });

    const handleVisibilityChange = () => {
      if (document.hidden && usePlayerStore.getState().isPlaying) pauseRef.current();
    };

    window.addEventListener("keydown", handleWindowKeyDown, true);
    window.addEventListener("keyup", handleWindowKeyUp, true);
    window.addEventListener("message", handleMessage);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown, true);
      window.removeEventListener("keyup", handleWindowKeyUp, true);
      iframeShortcutCleanupRef.current?.();
      iframeShortcutCleanupRef.current = null;
      window.removeEventListener("message", handleMessage);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      stopRAFLoop();
      stopReverseLoop();
      stopScrubPreviewAudio();
      releaseStaticSeekCache(staticSeekAdapterRef, staticSeekWarnedRef);
      cancelPendingLoad();
    };
  });

  useEffect(() => {
    return usePlayerStore.subscribe((state, prev) => {
      const playbackRateChanged = state.playbackRate !== prev.playbackRate;
      const audioMutedChanged = state.audioMuted !== prev.audioMuted;
      const audioVolumeChanged = state.audioVolume !== prev.audioVolume;
      if (!playbackRateChanged && !audioMutedChanged && !audioVolumeChanged) return;

      if (playbackRateChanged) {
        applyPlaybackRate(state.playbackRate);
      }
      applyPreviewAudioState();
    });
  }, [applyPlaybackRate, applyPreviewAudioState]);
}

export function useTimelinePlayer({
  onShadowPromoted,
  onPreviewReloadFailed,
}: UseTimelinePlayerOptions = {}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const probeIntervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const pendingSeekRef = useRef<number | null>(null);
  const isRefreshingRef = useRef(false);
  const iframeShortcutCleanupRef = useRef<(() => void) | null>(null);

  const { setIsPlaying, setCurrentTime, setDuration, requestTimelineReady, setElements } =
    usePlayerStore.getState();

  // The fixture lease belongs at this shared synchronization boundary so every
  // iframe discovery path has the same owner for deciding whether it may write.
  const syncTimelineElements = useCallback(
    // The lease guard adds one deliberate branch at the shared synchronization boundary.
    // fallow-ignore-next-line complexity
    (elements: TimelineElement[], nextDuration?: number) => {
      if (hasTimelinePerformanceFixtureLease()) return;
      const state = usePlayerStore.getState();
      const resolvedDuration = nextDuration ?? state.duration;
      // applyCachedSourceDurations re-applies the cached probe duration: re-derived
      // elements (e.g. after a clip move) can arrive without sourceDuration, which
      // otherwise makes trimmed waveforms lose their window.
      // Enforced CapCut zoning (overlay → main → audio): normalize track indices
      // on every discovery. Idempotent — already-zoned input is returned as-is, so
      // drops persist zoned indices and reloads re-zone to the same (no drift).
      const mergedElements = normalizeToZones(
        applyCachedSourceDurations(
          mergeTimelineElementsPreservingDowngrades(
            state.elements,
            elements,
            state.duration,
            resolvedDuration,
            (element) =>
              findTimelineElementInIframe(iframeRef.current, {
                ...element,
                kind: "composition",
              }) !== null,
          ),
          state.timelineProjectId,
        ),
      );

      if (timelineElementsChanged(state.elements, mergedElements)) {
        setElements(mergedElements);
      }
      if (
        Number.isFinite(nextDuration) &&
        (nextDuration ?? 0) > 0 &&
        nextDuration !== state.duration
      ) {
        setDuration(nextDuration ?? 0);
      }
      if (!state.timelineReady) {
        // Same gate as initializeAdapter's own readiness wait: this is the
        // message-based fallback for compositions that report their duration
        // via clip manifest rather than the direct adapter, and it must not
        // enable Play any earlier than that path does.
        requestTimelineReady(safeContentDocument(iframeRef.current));
      }

      // Asynchronously enrich media elements still missing sourceDuration
      // (header-only probe, cheap), applying each resolved value to the store.
      void probeMissingSourceDurations(
        mergedElements,
        state.timelineProjectId,
        (keys, durationSeconds) => {
          const wanted = new Set(keys);
          usePlayerStore.setState((state) => {
            let changed = false;
            const patched = state.elements.map((e) => {
              if (e.sourceDuration != null || !wanted.has(e.key ?? e.id)) return e;
              changed = true;
              return { ...e, sourceDuration: durationSeconds };
            });
            return changed ? { elements: patched } : {};
          });
        },
      );
    },
    [setElements, requestTimelineReady, setDuration],
  );

  const preview = usePreviewAdapter(iframeRef);
  const { getAdapter, applyPreviewAudioState } = preview;
  const transport = useTimelineTransport(iframeRef, pendingSeekRef, preview);
  const { shuttleDirectionRef, shuttleSpeedIndexRef, play, playBackward, pause, seek } = transport;
  const { stopRAFLoop, stopReverseLoop } = transport;
  const { playbackKeyDownRef, playbackKeyUpRef, attachIframeShortcutListeners, togglePlay } =
    usePlaybackKeyboard({
      iframeRef,
      shuttleDirectionRef,
      shuttleSpeedIndexRef,
      iframeShortcutCleanupRef,
      getAdapter,
      play,
      playBackward,
      pause,
      seek,
    });

  const {
    processTimelineMessageRef,
    enrichMissingCompositionsRef,
    onIframeLoad,
    cancelPendingLoad,
  } = useTimelineSyncCallbacks({
    iframeRef,
    probeIntervalRef,
    pendingSeekRef,
    isRefreshingRef,
    getAdapter,
    syncTimelineElements,
    setDuration,
    setCurrentTime,
    requestTimelineReady,
    setIsPlaying,
    attachIframeShortcutListeners,
    applyPreviewAudioState,
  });

  // Full-reload edits load behind a hidden shadow iframe (useShadowPreviewReload.ts).
  const {
    previewSlots,
    onShadowIframeLoad,
    onShadowReadyChange,
    onShadowError,
    setShadowIframeNode,
    beginShadowReload,
    resetPreviewSlots,
    previewGeneration,
  } = useShadowPreviewReload({
    iframeRef,
    getAdapter,
    pendingSeekRef,
    isRefreshingRef,
    syncTimelineElements,
    setDuration,
    setCurrentTime,
    requestTimelineReady,
    setIsPlaying,
    attachIframeShortcutListeners,
    applyPreviewAudioState,
    onPromoted: onShadowPromoted,
    onReloadFailed: onPreviewReloadFailed,
    handOverPlayback: (time, playing) => {
      // keepPlaying: move the playhead without the paused-seek audio scrub.
      seek(time, { keepPlaying: true, follow: false });
      const adapter = getAdapter();
      // An edit that cut the film short of the live time stops it at the new end, as playback does.
      if (playing && adapter && adapter.getTime() < adapter.getDuration()) play();
    },
  });

  const { saveSeekPosition, refreshPlayer } = usePreviewRefresh({
    iframeRef,
    pendingSeekRef,
    isRefreshingRef,
    transport,
    getAdapter,
    beginShadowReload,
    previewGeneration,
  });

  usePlayerListeners({
    iframeRef,
    iframeShortcutCleanupRef,
    playbackKeyDownRef,
    playbackKeyUpRef,
    processTimelineMessageRef,
    enrichMissingCompositionsRef,
    syncTimelineElements,
    cancelPendingLoad,
    preview,
    transport,
  });

  const resetPlayer = useCallback(() => {
    stopRAFLoop();
    stopReverseLoop();
    cancelPendingLoad();
    usePlayerStore.getState().reset();
  }, [stopRAFLoop, stopReverseLoop, cancelPendingLoad]);

  return {
    iframeRef,
    play,
    pause,
    togglePlay,
    seek,
    onIframeLoad,
    refreshPlayer,
    saveSeekPosition,
    resetPlayer,
    previewSlots,
    onShadowIframeLoad,
    onShadowReadyChange,
    onShadowError,
    setShadowIframeNode,
    resetPreviewSlots,
  };
}
