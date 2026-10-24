import { useRef, useCallback, useEffect } from "react";
import { usePlayerStore, liveTime } from "../store/playerStore";
import { resolvePlaybackAdapter } from "./playbackAdapterResolution";
import { subscribePreviewFrame, transportAdapter } from "../store/previewFrameStore";
import { clampToDuration } from "../lib/time";
import { useTimelinePlayerLoop } from "./useTimelinePlayerLoop";
import type { PlaybackAdapter, IframeWindow } from "../lib/playbackTypes";
import type { StaticSeekCacheEntry } from "../lib/playbackAdapter";
import { applyPreviewAudioFlags, setPreviewPlaybackRate } from "../lib/timelineIframeHelpers";
import { scrubMusicAtSeek, stopScrubPreviewAudio } from "../lib/playbackScrub";
import { shouldResumeForwardPlaybackAfterSeek, shouldStopAfterSeek } from "../lib/playbackSeek";

const publishSeek = (time: number, options?: { follow?: boolean }) =>
  options?.follow === false ? liveTime.notify(time) : liveTime.notifySeek(time);

export type IframeRef = React.MutableRefObject<HTMLIFrameElement | null>;
export type NumberRef = React.MutableRefObject<number | null>;

export function usePreviewAdapter(iframeRef: IframeRef) {
  const staticSeekAdapterRef = useRef<StaticSeekCacheEntry | null>(null);
  const staticSeekWarnedRef = useRef(false);
  const getAdapter = useCallback(
    (overrideIframe?: HTMLIFrameElement | null): PlaybackAdapter | null => {
      try {
        // undefined means "no override"; an explicit null override means "no adapter".
        const iframe = overrideIframe !== undefined ? overrideIframe : iframeRef.current;
        const win = iframe?.contentWindow as IframeWindow | null;
        if (!iframe || !win) return null;
        const adapter = resolvePlaybackAdapter(iframe, win, {
          cache: staticSeekAdapterRef,
          warned: staticSeekWarnedRef,
        });
        return transportAdapter(adapter);
      } catch {
        return null;
      }
    },
    [iframeRef],
  );

  const setLoopStart = useCallback(
    (seconds: number | null) => {
      try {
        (iframeRef.current?.contentWindow as IframeWindow | null)?.__hf?.setLoopStart?.(seconds);
      } catch {}
    },
    [iframeRef],
  );
  const applyPlaybackRate = useCallback(
    (rate: number) => {
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
      } catch {}
    },
    [iframeRef],
  );
  const applyPreviewAudioState = useCallback(() => {
    const { audioMuted, audioVolume } = usePlayerStore.getState();
    applyPreviewAudioFlags(iframeRef.current, audioMuted, audioVolume);
  }, [iframeRef]);
  return {
    staticSeekAdapterRef,
    staticSeekWarnedRef,
    getAdapter,
    setLoopStart,
    applyPlaybackRate,
    applyPreviewAudioState,
  };
}

export type PreviewAdapter = ReturnType<typeof usePreviewAdapter>;

export function useTimelineTransport(
  iframeRef: IframeRef,
  pendingSeekRef: NumberRef,
  preview: PreviewAdapter,
) {
  const { getAdapter, setLoopStart, applyPlaybackRate, applyPreviewAudioState } = preview;
  const { setIsPlaying, setCurrentTime } = usePlayerStore.getState();
  const rafRef = useRef<number>(0);
  const reverseRafRef = useRef<number>(0);
  const shuttleDirectionRef = useRef<"forward" | "backward" | null>(null);
  const shuttleSpeedIndexRef = useRef(0);
  const { startRAFLoop, stopRAFLoop, stopReverseLoop } = useTimelinePlayerLoop({
    rafRef,
    reverseRafRef,
    getAdapter,
    setCurrentTime,
    setIsPlaying,
    setLoopStart,
  });
  const play = useCallback(() => {
    const { timelineReady, playLocked } = usePlayerStore.getState();
    if (!timelineReady || playLocked) return;
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
      applyPreviewAudioState();
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
    adapter?.pause();
    if (adapter) setCurrentTime(adapter.getTime()); // sync store so Split/Delete have accurate time
    setIsPlaying(false);
    shuttleDirectionRef.current = null;
    shuttleSpeedIndexRef.current = 0;
    stopRAFLoop();
  }, [getAdapter, setCurrentTime, setIsPlaying, stopRAFLoop, stopReverseLoop]);
  const seek = useCallback(
    (time: number, options?: { keepPlaying?: boolean; follow?: boolean }) => {
      const wasReverseShuttle = shuttleDirectionRef.current === "backward";
      stopReverseLoop();
      const adapter = getAdapter();
      if (!adapter) {
        pendingSeekRef.current = Math.max(0, time);
        return false;
      }
      const duration = Math.max(0, adapter.getDuration());
      const nextTime = clampToDuration(time, duration);
      const keepPlaying = options?.keepPlaying === true;
      const { playLocked, isPlaying: storeWasPlaying } = usePlayerStore.getState();
      const shouldResumeAfterSeek = shouldResumeForwardPlaybackAfterSeek({
        keepPlaying,
        wasReverseShuttle,
        storeWasPlaying,
        duration,
        nextTime,
        playLocked,
      });
      adapter.seek(nextTime, options);
      publishSeek(nextTime, options); // Direct DOM updates (playhead, timecode, progress) — no re-render
      setCurrentTime(nextTime); // sync store so Split/Delete have accurate time
      if (!keepPlaying && !playLocked) scrubMusicAtSeek(iframeRef.current, nextTime);
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
      iframeRef,
    ],
  );

  useEffect(
    () =>
      usePlayerStore.subscribe((state, prev) => {
        if (state.playLocked && !prev.playLocked && state.isPlaying) pause();
      }),
    [pause],
  );
  useEffect(() => {
    return usePlayerStore.subscribe((state, prev) => {
      if (state.requestedSeekTime !== null && state.requestedSeekTime !== prev.requestedSeekTime) {
        seek(state.requestedSeekTime);
        usePlayerStore.getState().clearSeekRequest();
      }
      // Play or stop from outside the loop — the FX rack auditioning a preset
      // while paused, which is silent otherwise. `returnTo` puts the playhead
      // back where the request found it: hovering is not an edit.
      const request = state.playbackRequest;
      if (request && request.nonce !== prev.playbackRequest?.nonce) {
        if (request.playing) play();
        else {
          pause();
          if (request.returnTo !== null) seek(request.returnTo, { follow: false });
        }
        usePlayerStore.getState().clearPlaybackRequest();
      }
    });
  }, [seek, play, pause]);
  useEffect(() => subscribePreviewFrame(getAdapter), [getAdapter]);
  return {
    shuttleDirectionRef,
    shuttleSpeedIndexRef,
    stopRAFLoop,
    stopReverseLoop,
    play,
    playBackward,
    pause,
    seek,
  };
}

export type TimelineTransport = ReturnType<typeof useTimelineTransport>;
