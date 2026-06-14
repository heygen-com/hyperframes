import { useRef, useCallback, useEffect } from "react";
import { usePlayerStore, liveTime, type TimelineElement } from "../store/playerStore";
import { useMountEffect } from "../../hooks/useMountEffect";
import { usePlaybackKeyboard } from "./usePlaybackKeyboard";
import { useTimelineSyncCallbacks } from "./useTimelineSyncCallbacks";

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
  resolveIframe,
} from "../lib/timelineDOM";
export {
  shouldIgnorePlaybackShortcutEvent,
  shouldIgnorePlaybackShortcutTarget,
} from "../lib/playbackShortcuts";

import type { PlaybackAdapter, IframeWindow } from "../lib/playbackTypes";
import {
  getAdapterDuration,
  wrapTimeline,
  getDefaultStaticSeekPlaybackClock,
  releaseStaticSeekCache,
  resolveStaticSeekFallback,
  type StaticSeekCacheEntry,
} from "../lib/playbackAdapter";
import {
  readTimelineDurationFromDocument,
  mergeTimelineElementsPreservingDowngrades,
  parseTimelineFromDOM,
} from "../lib/timelineDOM";
import {
  setPreviewMediaMuted,
  setPreviewPlaybackRate,
  shouldMutePreviewAudio,
} from "../lib/timelineIframeHelpers";
import { scrubMusicAtSeek, stopScrubPreviewAudio } from "../lib/playbackScrub";
import { applyCachedSourceDurations, probeMissingSourceDurations } from "../lib/mediaProbe";
import { shouldResumeForwardPlaybackAfterSeek, shouldStopAfterSeek } from "../lib/playbackSeek";

/**
 * Whether the derived elements differ from the current ones in any field that
 * affects rendering (identity, timing, track, or source length) — used to skip
 * redundant store writes.
 */
function timelineElementsChanged(prev: TimelineElement[], next: TimelineElement[]): boolean {
  if (next.length !== prev.length) return true;
  return next.some((el, i) => {
    const p = prev[i];
    return (
      !p ||
      el.id !== p.id ||
      el.start !== p.start ||
      el.duration !== p.duration ||
      el.track !== p.track ||
      el.sourceDuration !== p.sourceDuration
    );
  });
}

export function useTimelinePlayer() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const rafRef = useRef<number>(0);
  const probeIntervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const pendingSeekRef = useRef<number | null>(null);
  const isRefreshingRef = useRef(false);
  const reverseRafRef = useRef<number>(0);
  const shuttleDirectionRef = useRef<"forward" | "backward" | null>(null);
  const shuttleSpeedIndexRef = useRef(0);
  const iframeShortcutCleanupRef = useRef<(() => void) | null>(null);
  const lastTimelineMessageRef = useRef<number>(0);
  const staticSeekAdapterRef = useRef<StaticSeekCacheEntry | null>(null);
  const staticSeekWarnedRef = useRef(false);

  const { setIsPlaying, setCurrentTime, setDuration, setTimelineReady, setElements } =
    usePlayerStore.getState();

  const syncTimelineElements = useCallback(
    (elements: TimelineElement[], nextDuration?: number) => {
      const state = usePlayerStore.getState();
      const resolvedDuration = nextDuration ?? state.duration;
      // applyCachedSourceDurations re-applies the cached probe duration: re-derived
      // elements (e.g. after a clip move) can arrive without sourceDuration, which
      // otherwise makes trimmed waveforms lose their window.
      const mergedElements = applyCachedSourceDurations(
        mergeTimelineElementsPreservingDowngrades(
          state.elements,
          elements,
          state.duration,
          resolvedDuration,
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
        setTimelineReady(true);
      }

      // Asynchronously enrich media elements still missing sourceDuration
      // (header-only probe, cheap), applying each resolved value to the store.
      void probeMissingSourceDurations(mergedElements, (key, durationSeconds) => {
        usePlayerStore.setState((state) => {
          const idx = state.elements.findIndex((e) => (e.key ?? e.id) === key);
          if (idx === -1 || state.elements[idx].sourceDuration != null) return {};
          const patched = state.elements.slice();
          patched[idx] = { ...state.elements[idx], sourceDuration: durationSeconds };
          return { elements: patched };
        });
      });
    },
    [setElements, setTimelineReady, setDuration],
  );

  const getAdapter = useCallback((): PlaybackAdapter | null => {
    try {
      const iframe = iframeRef.current;
      const win = iframe?.contentWindow as IframeWindow | null;
      if (!iframe || !win) return null;

      const playerAdapter =
        win.__player && typeof win.__player.play === "function" ? win.__player : null;
      const docDuration = readTimelineDurationFromDocument(iframe.contentDocument);
      const adapterDur = getAdapterDuration(playerAdapter);

      if (adapterDur > 0 && docDuration <= adapterDur) {
        releaseStaticSeekCache(staticSeekAdapterRef, staticSeekWarnedRef);
        return playerAdapter;
      }

      let timelineAdapter: PlaybackAdapter | null = null;
      if (win.__timeline) {
        const adapter = wrapTimeline(win.__timeline);
        const dur = getAdapterDuration(adapter);
        if (dur > 0 && docDuration <= dur) {
          releaseStaticSeekCache(staticSeekAdapterRef, staticSeekWarnedRef);
          return adapter;
        }
        if (dur > 0) timelineAdapter ??= adapter;
      }

      if (win.__timelines) {
        const keys = Object.keys(win.__timelines);
        if (keys.length > 0) {
          // Resolve the root composition id from the DOM — the outermost [data-composition-id]
          // is the master; otherwise Object.keys() order lets a sub-composition hijack transport.
          const rootId = iframe?.contentDocument
            ?.querySelector("[data-composition-id]")
            ?.getAttribute("data-composition-id");
          const key = rootId && rootId in win.__timelines ? rootId : keys[keys.length - 1];
          const adapter = wrapTimeline(win.__timelines[key]);
          const dur = getAdapterDuration(adapter);
          if (dur > 0 && docDuration <= dur) {
            releaseStaticSeekCache(staticSeekAdapterRef, staticSeekWarnedRef);
            return adapter;
          }
          if (dur > 0) timelineAdapter ??= adapter;
        }
      }

      // The document timeline extends past every native adapter's duration.
      // Wrap the best available adapter with the effective duration so the
      // seek slider, seek clamping, and duration display cover the full range.
      const bestAdapter = playerAdapter ?? timelineAdapter;
      const effectiveDuration = Math.max(
        usePlayerStore.getState().duration,
        docDuration,
        adapterDur,
      );
      if (
        bestAdapter &&
        effectiveDuration > 0 &&
        ("renderSeek" in bestAdapter || typeof bestAdapter.seek === "function")
      ) {
        return resolveStaticSeekFallback({
          cache: staticSeekAdapterRef,
          warned: staticSeekWarnedRef,
          bestAdapter,
          effectiveDuration,
          docDuration,
          clock: getDefaultStaticSeekPlaybackClock(win),
          getPlaybackRate: () => usePlayerStore.getState().playbackRate,
        });
      }

      return bestAdapter;
    } catch (err) {
      console.warn("[useTimelinePlayer] Could not get playback adapter (cross-origin)", err);
      return null;
    }
  }, []);

  const stopReverseLoop = useCallback(() => {
    cancelAnimationFrame(reverseRafRef.current);
  }, []);

  const startRAFLoop = useCallback(() => {
    const tick = () => {
      const adapter = getAdapter();
      if (adapter) {
        const rawTime = adapter.getTime();
        const dur = adapter.getDuration();
        const time = dur > 0 ? Math.min(rawTime, dur) : rawTime;
        liveTime.notify(time); // direct DOM updates, no React re-render
        const { inPoint, outPoint } = usePlayerStore.getState();
        const rawLoopEnd = outPoint !== null ? Math.min(outPoint, dur) : dur;
        const rawLoopStart = inPoint !== null ? inPoint : 0;
        const loopEnd = rawLoopStart < rawLoopEnd ? rawLoopEnd : dur;
        const loopStart = rawLoopStart < rawLoopEnd ? rawLoopStart : 0;
        if (time >= loopEnd) {
          if (usePlayerStore.getState().loopEnabled && dur > 0) {
            // keepPlaying skips the adapter's implicit pause; play() below is then a no-op.
            adapter.seek(loopStart, { keepPlaying: true });
            liveTime.notify(loopStart);
            adapter.play();
            setIsPlaying(true);
            rafRef.current = requestAnimationFrame(tick);
            return;
          }
          if (adapter.isPlaying()) adapter.pause();
          setCurrentTime(time); // sync Zustand once at end
          setIsPlaying(false);
          cancelAnimationFrame(rafRef.current);
          return;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [getAdapter, setCurrentTime, setIsPlaying]);

  const stopRAFLoop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
  }, []);
  const applyPlaybackRate = useCallback((rate: number) => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    setPreviewPlaybackRate(iframe, rate);
    // Also set directly on GSAP timeline if accessible
    try {
      const win = iframe.contentWindow as IframeWindow | null;
      if (win?.__timelines) {
        for (const tl of Object.values(win.__timelines)) {
          if (
            tl &&
            typeof (tl as unknown as { timeScale?: (v: number) => void }).timeScale === "function"
          ) {
            (tl as unknown as { timeScale: (v: number) => void }).timeScale(rate);
          }
        }
      }
    } catch (err) {
      console.warn("[useTimelinePlayer] Could not set playback rate (cross-origin)", err);
    }
  }, []);
  const applyPreviewAudioState = useCallback((playbackRateOverride?: number) => {
    const { audioMuted, playbackRate } = usePlayerStore.getState();
    const effectivePlaybackRate = playbackRateOverride ?? playbackRate;
    setPreviewMediaMuted(
      iframeRef.current,
      shouldMutePreviewAudio(audioMuted, effectivePlaybackRate),
    );
  }, []);
  const play = useCallback(() => {
    stopRAFLoop();
    stopReverseLoop();
    stopScrubPreviewAudio();
    const adapter = getAdapter();
    if (!adapter) return;
    if (adapter.getTime() >= adapter.getDuration()) {
      adapter.seek(usePlayerStore.getState().inPoint ?? 0);
    }
    applyPlaybackRate(usePlayerStore.getState().playbackRate);
    applyPreviewAudioState();
    adapter.play();
    shuttleDirectionRef.current = "forward";
    setIsPlaying(true);
    startRAFLoop();
  }, [
    getAdapter,
    setIsPlaying,
    startRAFLoop,
    applyPlaybackRate,
    applyPreviewAudioState,
    stopRAFLoop,
    stopReverseLoop,
  ]);
  const playBackward = useCallback(
    (rate: number) => {
      stopRAFLoop();
      stopReverseLoop();
      const adapter = getAdapter();
      if (!adapter) return;
      const duration = Math.max(0, adapter.getDuration());
      const initialTime = adapter.getTime() <= 0 && duration > 0 ? duration : adapter.getTime();
      adapter.pause();
      if (initialTime !== adapter.getTime()) adapter.seek(initialTime);
      const speed = Math.max(0.1, Math.min(4, rate));
      applyPlaybackRate(speed);
      applyPreviewAudioState(speed);
      let startTime = initialTime;
      let startedAt = performance.now();

      const tick = (now: number) => {
        const elapsed = ((now - startedAt) / 1000) * speed;
        let nextTime = startTime - elapsed;
        const { inPoint, outPoint } = usePlayerStore.getState();
        const rawLoopEnd = outPoint !== null ? Math.min(outPoint, duration) : duration;
        const rawLoopStart = inPoint !== null ? inPoint : 0;
        const loopEnd = rawLoopStart < rawLoopEnd ? rawLoopEnd : duration;
        const loopStart = rawLoopStart < rawLoopEnd ? rawLoopStart : 0;
        if (nextTime <= loopStart) {
          if (usePlayerStore.getState().loopEnabled && duration > 0) {
            startTime = loopEnd;
            startedAt = now;
            nextTime = loopEnd;
          } else {
            adapter.seek(loopStart);
            liveTime.notify(loopStart);
            setCurrentTime(loopStart);
            setIsPlaying(false);
            shuttleDirectionRef.current = null;
            reverseRafRef.current = 0;
            return;
          }
        }
        adapter.seek(Math.max(0, nextTime));
        liveTime.notify(Math.max(0, nextTime));
        setIsPlaying(true);
        reverseRafRef.current = requestAnimationFrame(tick);
      };

      setIsPlaying(true);
      shuttleDirectionRef.current = "backward";
      reverseRafRef.current = requestAnimationFrame(tick);
    },
    [
      getAdapter,
      setCurrentTime,
      setIsPlaying,
      applyPlaybackRate,
      applyPreviewAudioState,
      stopRAFLoop,
      stopReverseLoop,
    ],
  );
  const pause = useCallback(() => {
    stopReverseLoop();
    const adapter = getAdapter();
    if (!adapter) return;
    adapter.pause();
    setCurrentTime(adapter.getTime()); // sync store so Split/Delete have accurate time
    setIsPlaying(false);
    shuttleDirectionRef.current = null;
    shuttleSpeedIndexRef.current = 0;
    stopRAFLoop();
  }, [getAdapter, setCurrentTime, setIsPlaying, stopRAFLoop, stopReverseLoop]);
  const seek = useCallback(
    (time: number, options?: { keepPlaying?: boolean }) => {
      const wasReverseShuttle = shuttleDirectionRef.current === "backward";
      stopReverseLoop();
      const adapter = getAdapter();
      if (!adapter) {
        pendingSeekRef.current = Math.max(0, time);
        return false;
      }
      const duration = Math.max(0, adapter.getDuration());
      const nextTime = Math.max(0, duration > 0 ? Math.min(duration, time) : time);
      const keepPlaying = options?.keepPlaying === true;
      const shouldResumeAfterSeek = shouldResumeForwardPlaybackAfterSeek({
        keepPlaying,
        wasReverseShuttle,
        storeWasPlaying: usePlayerStore.getState().isPlaying,
        duration,
        nextTime,
      });
      adapter.seek(nextTime, options);
      liveTime.notify(nextTime); // Direct DOM updates (playhead, timecode, progress) — no re-render
      setCurrentTime(nextTime); // sync store so Split/Delete have accurate time
      if (!shouldResumeAfterSeek && !keepPlaying) scrubMusicAtSeek(iframeRef.current, nextTime);
      if (shouldResumeAfterSeek) {
        stopRAFLoop();
        applyPlaybackRate(usePlayerStore.getState().playbackRate);
        applyPreviewAudioState();
        adapter.play();
        setIsPlaying(true);
        shuttleDirectionRef.current = "forward";
        shuttleSpeedIndexRef.current = 0;
        startRAFLoop();
      } else if (shouldStopAfterSeek({ keepPlaying, wasReverseShuttle })) {
        stopRAFLoop();
        if (usePlayerStore.getState().isPlaying) setIsPlaying(false);
        shuttleDirectionRef.current = null;
        shuttleSpeedIndexRef.current = 0;
      }
      return true;
    },
    [
      getAdapter,
      pendingSeekRef,
      setCurrentTime,
      setIsPlaying,
      startRAFLoop,
      stopRAFLoop,
      stopReverseLoop,
      applyPlaybackRate,
      applyPreviewAudioState,
      shuttleDirectionRef,
      shuttleSpeedIndexRef,
    ],
  );

  useEffect(() => {
    return usePlayerStore.subscribe((state, prev) => {
      if (state.requestedSeekTime !== null && state.requestedSeekTime !== prev.requestedSeekTime) {
        seek(state.requestedSeekTime);
        usePlayerStore.getState().clearSeekRequest();
      }
    });
  }, [seek]);
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

  const { processTimelineMessageRef, enrichMissingCompositionsRef, onIframeLoad } =
    useTimelineSyncCallbacks({
      iframeRef,
      probeIntervalRef,
      pendingSeekRef,
      isRefreshingRef,
      getAdapter,
      syncTimelineElements,
      setDuration,
      setCurrentTime,
      setTimelineReady,
      setIsPlaying,
      attachIframeShortcutListeners,
      applyPreviewAudioState,
    });
  const saveSeekPosition = useCallback(() => {
    const adapter = getAdapter();
    pendingSeekRef.current = adapter
      ? adapter.getTime()
      : (usePlayerStore.getState().currentTime ?? 0);
    isRefreshingRef.current = true;
    stopRAFLoop();
    stopReverseLoop();
    setIsPlaying(false);
  }, [getAdapter, stopRAFLoop, setIsPlaying, stopReverseLoop]);
  const refreshPlayer = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    saveSeekPosition();
    const src = iframe.src;
    const url = new URL(src, window.location.origin);
    url.searchParams.set("_t", String(Date.now()));
    iframe.src = url.toString();
  }, [saveSeekPosition]);
  const getAdapterRef = useRef(getAdapter);
  getAdapterRef.current = getAdapter;

  useMountEffect(() => {
    const handleWindowKeyDown = (e: KeyboardEvent) => playbackKeyDownRef.current(e);
    const handleWindowKeyUp = (e: KeyboardEvent) => playbackKeyUpRef.current(e);

    const handleMessage = (e: MessageEvent) => {
      const data = e.data;
      const ourIframe = iframeRef.current;
      if (e.source && ourIframe && e.source !== ourIframe.contentWindow) {
        return;
      }
      if (data?.source === "hf-preview" && data?.type === "state") {
        try {
          if (usePlayerStore.getState().elements.length === 0) {
            const iframeWin = ourIframe?.contentWindow as IframeWindow | null;
            const manifest = iframeWin?.__clipManifest;
            if (manifest && manifest.clips.length > 0) {
              processTimelineMessageRef.current(manifest);
            }
          }
          const msSinceTimeline = Date.now() - lastTimelineMessageRef.current;
          if (msSinceTimeline > 500) {
            enrichMissingCompositionsRef.current();
          }
        } catch (err) {
          console.warn("[useTimelinePlayer] Could not read clip manifest from iframe", err);
        }
      }
      if (data?.source === "hf-preview" && data?.type === "timeline" && Array.isArray(data.clips)) {
        lastTimelineMessageRef.current = Date.now();
        processTimelineMessageRef.current(data);
        enrichMissingCompositionsRef.current();
        if (usePlayerStore.getState().elements.length === 0) {
          try {
            const doc = ourIframe?.contentDocument;
            const adapter = getAdapter();
            if (doc && adapter) {
              const els = parseTimelineFromDOM(doc, adapter.getDuration());
              if (els.length > 0) {
                syncTimelineElements(els);
              }
            }
          } catch (err) {
            console.warn(
              "[useTimelinePlayer] Could not read timeline elements on navigate (cross-origin)",
              err,
            );
          }
        }
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden && usePlayerStore.getState().isPlaying) {
        const adapter = getAdapterRef.current?.();
        if (adapter) {
          adapter.pause();
          setIsPlaying(false);
          stopRAFLoop();
        }
      }
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
      if (probeIntervalRef.current) clearInterval(probeIntervalRef.current);
    };
  });

  const resetPlayer = useCallback(() => {
    stopRAFLoop();
    stopReverseLoop();
    if (probeIntervalRef.current) clearInterval(probeIntervalRef.current);
    usePlayerStore.getState().reset();
  }, [stopRAFLoop, stopReverseLoop]);

  useEffect(() => {
    return usePlayerStore.subscribe((state, prev) => {
      const playbackRateChanged = state.playbackRate !== prev.playbackRate;
      const audioMutedChanged = state.audioMuted !== prev.audioMuted;
      if (!playbackRateChanged && !audioMutedChanged) return;

      if (playbackRateChanged) {
        applyPlaybackRate(state.playbackRate);
      }
      applyPreviewAudioState();
    });
  }, [applyPlaybackRate, applyPreviewAudioState]);

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
  };
}
