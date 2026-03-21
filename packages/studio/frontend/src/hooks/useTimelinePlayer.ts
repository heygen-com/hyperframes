import { useRef, useCallback, useEffect } from "react";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";

/**
 * Sandbox player API (window.__player from sandbox interceptor)
 */
interface PlayerAPI {
  play: () => void;
  pause: () => void;
  seek: (time: number) => void;
  renderSeek?: (time: number) => void;
  getTime: () => number;
  getDuration: () => number;
  isPlaying: () => boolean;
}

/**
 * Legacy raw GSAP timeline (window.__timeline or window.__timelines[key])
 */
interface TimelineLike {
  play: () => void;
  pause: () => void;
  seek: (time: number) => void;
  time: () => number;
  duration: () => number;
  isActive: () => boolean;
}

type IframeWindow = Window & {
  __player?: PlayerAPI;
  __timeline?: TimelineLike;
  __timelines?: Record<string, TimelineLike>;
};

/**
 * Unified adapter that wraps either __player or raw GSAP timeline
 * into a common interface.
 */
interface PlaybackAdapter {
  play: () => void;
  pause: () => void;
  seek: (time: number) => void;
  renderSeek?: (time: number) => void;
  getTime: () => number;
  getDuration: () => number;
  isPlaying: () => boolean;
}

const PREVIEW_CANONICAL_FPS = 30;

function quantizeTimeToFrame(time: number, fps: number = PREVIEW_CANONICAL_FPS): number {
  const safe = Number.isFinite(time) ? Math.max(0, time) : 0;
  const frame = Math.floor(safe * fps + 1e-9);
  return frame / fps;
}

function wrapPlayer(p: PlayerAPI): PlaybackAdapter {
  return {
    play: () => p.play(),
    pause: () => p.pause(),
    seek: (t) => p.seek(t),
    renderSeek: typeof p.renderSeek === "function" ? (t) => p.renderSeek?.(t) : undefined,
    getTime: () => p.getTime(),
    getDuration: () => p.getDuration(),
    isPlaying: () => p.isPlaying(),
  };
}

function wrapTimeline(tl: TimelineLike): PlaybackAdapter {
  return {
    play: () => tl.play(),
    pause: () => tl.pause(),
    seek: (t) => {
      tl.pause();
      tl.seek(t);
    },
    getTime: () => tl.time(),
    getDuration: () => tl.duration(),
    isPlaying: () => tl.isActive(),
  };
}

export function useTimelinePlayer() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const rafRef = useRef<number>(0);
  const probeIntervalRef = useRef<ReturnType<typeof setInterval>>();
  const pendingSeekRef = useRef<number | null>(null);
  const isRefreshingRef = useRef(false);

  const {
    isPlaying,
    currentTime,
    setIsPlaying,
    setCurrentTime,
    setDuration,
    setTimelineReady,
    setElements,
    reset,
  } = usePlayerStore();

  const getAdapter = useCallback((): PlaybackAdapter | null => {
    try {
      const win = iframeRef.current?.contentWindow as IframeWindow | null;
      if (!win) return null;

      // Prefer __player (sandbox interceptor runtime)
      if (win.__player && typeof win.__player.play === "function") {
        return wrapPlayer(win.__player);
      }

      // Legacy: single __timeline
      if (win.__timeline) return wrapTimeline(win.__timeline);

      // Legacy: __timelines map — last registered = master
      if (win.__timelines) {
        const keys = Object.keys(win.__timelines);
        if (keys.length > 0)
        {
          const lastKey = keys[keys.length - 1];
          const lastTimeline = lastKey ? win.__timelines[lastKey] : undefined;
          if (lastTimeline) return wrapTimeline(lastTimeline);
        }
      }

      return null;
    } catch {
      return null;
    }
  }, []);

  const startRAFLoop = useCallback(() => {
    const tick = () => {
      const adapter = getAdapter();
      if (adapter) {
        const time = adapter.getTime();
        const dur = adapter.getDuration();
        setCurrentTime(time);
        // Check if playback reached the end
        if (time >= dur && !adapter.isPlaying()) {
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

  const play = useCallback(() => {
    const adapter = getAdapter();
    if (!adapter) return;
    // If at the end, restart from beginning
    if (adapter.getTime() >= adapter.getDuration()) {
      adapter.seek(0);
    }
    adapter.play();
    setIsPlaying(true);
    startRAFLoop();
  }, [getAdapter, setIsPlaying, startRAFLoop]);

  const pause = useCallback(() => {
    const adapter = getAdapter();
    if (!adapter) return;
    adapter.pause();
    setIsPlaying(false);
    stopRAFLoop();
  }, [getAdapter, setIsPlaying, stopRAFLoop]);

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  }, [isPlaying, play, pause]);

  const seek = useCallback(
    (time: number) => {
      const adapter = getAdapter();
      if (!adapter) return;
      const quantized = quantizeTimeToFrame(time);
      if (typeof adapter.renderSeek === "function") {
        adapter.renderSeek(quantized);
      } else {
        adapter.seek(quantized);
      }
      try {
        const win = iframeRef.current?.contentWindow as
          | (Window & { gsap?: { ticker?: { tick: () => void } } })
          | undefined;
        win?.gsap?.ticker?.tick?.();
      } catch {
        // noop
      }
      setCurrentTime(quantized);
      setIsPlaying(false);
      stopRAFLoop();
    },
    [getAdapter, setCurrentTime, setIsPlaying, stopRAFLoop]
  );

  const onIframeLoad = useCallback(() => {
    let attempts = 0;
    const maxAttempts = 25; // 5 seconds total

    if (probeIntervalRef.current) clearInterval(probeIntervalRef.current);

    probeIntervalRef.current = setInterval(() => {
      attempts++;
      const win = iframeRef.current?.contentWindow as
        | (Window & { __playerReady?: boolean; __renderReady?: boolean })
        | null;
      const adapter = getAdapter();
      const readyForParity = Boolean(win?.__playerReady && win?.__renderReady);
      if (adapter && adapter.getDuration() > 0 && readyForParity) {
        clearInterval(probeIntervalRef.current);
        adapter.pause();

        const seekTo = pendingSeekRef.current;
        pendingSeekRef.current = null;
        const startTime =
          seekTo != null ? Math.min(seekTo, adapter.getDuration()) : 0;

        const quantizedStart = quantizeTimeToFrame(startTime);
        if (typeof adapter.renderSeek === "function") {
          adapter.renderSeek(quantizedStart);
        } else {
          adapter.seek(quantizedStart);
        }
        setDuration(adapter.getDuration());
        setCurrentTime(quantizedStart);
        if (!isRefreshingRef.current) {
          setTimelineReady(true);
        }
        isRefreshingRef.current = false;
        setIsPlaying(false);

        // Extract timeline elements from iframe DOM
        try {
          const doc = iframeRef.current?.contentDocument;
          if (doc) {
            // Identify root composition so we can skip it on the timeline
            const rootComposition = doc.querySelector("[data-composition-id]");

            const nodes = doc.querySelectorAll("[data-start]");
            const els: TimelineElement[] = [];
            let trackCounter = 0;
            nodes.forEach((node) => {
              // Skip root composition — only show its children
              if (node === rootComposition) return;
              const el = node as HTMLElement;
              const startStr = el.getAttribute("data-start");
              if (startStr == null) return;
              const start = parseFloat(startStr);
              if (isNaN(start)) return;

              const tagLower = el.tagName.toLowerCase();

              let dur = 0;
              const durStr = el.getAttribute("data-duration");
              const endStr = el.getAttribute("data-end");
              if (durStr != null) {
                dur = parseFloat(durStr);
              } else if (endStr != null) {
                dur = parseFloat(endStr) - start;
              }

              // Infer duration from media's actual duration for video/audio
              if (
                (isNaN(dur) || dur <= 0) &&
                (tagLower === "video" || tagLower === "audio")
              ) {
                const mediaEl = el as unknown as HTMLMediaElement;
                if (
                  mediaEl.duration &&
                  isFinite(mediaEl.duration) &&
                  mediaEl.duration > 0
                ) {
                  const mediaStart =
                    parseFloat(el.getAttribute("data-media-start") || "0") ||
                    0;
                  dur = mediaEl.duration - mediaStart;
                }
              }

              // Infer duration from GSAP timeline for compositions
              const compositionId = el.getAttribute("data-composition-id");
              if ((isNaN(dur) || dur <= 0) && compositionId) {
                const win = iframeRef.current
                  ?.contentWindow as IframeWindow | null;
                const compTl = win?.__timelines?.[compositionId];
                if (compTl) {
                  const compDur = compTl.duration();
                  if (compDur > 0) dur = compDur;
                }
              }

              if (isNaN(dur) || dur <= 0) dur = adapter.getDuration() - start;
              // TODO: Remove data-track after migration
              const trackStr = el.getAttribute("data-track-index") ?? el.getAttribute("data-track");
              const track =
                trackStr != null ? parseInt(trackStr, 10) : trackCounter++;
              const entry: TimelineElement = {
                id: el.id || tagLower,
                tag: tagLower,
                start,
                duration: dur,
                track: isNaN(track) ? 0 : track,
              };

              // Extract media attributes
              if (
                tagLower === "video" ||
                tagLower === "audio" ||
                tagLower === "img"
              ) {
                const src = el.getAttribute("src");
                if (src) entry.src = src;
              }
              const mediaStartAttr = el.getAttribute("data-media-start");
              if (mediaStartAttr != null) {
                const parsed = parseFloat(mediaStartAttr);
                if (!isNaN(parsed)) entry.mediaStart = parsed;
              }
              const vol = el.getAttribute("data-volume");
              if (vol != null) {
                const parsed = parseFloat(vol);
                if (!isNaN(parsed)) entry.volume = parsed;
              }

              els.push(entry);
            });
            setElements(els);
          }
        } catch {
          // Cross-origin or DOM access error — ignore
        }

        return;
      }
      if (attempts >= maxAttempts) {
        clearInterval(probeIntervalRef.current);
        console.warn(
          "Could not find parity-ready runtime (__playerReady + __renderReady) after 5s"
        );
      }
    }, 200);
  }, [
    getAdapter,
    setDuration,
    setCurrentTime,
    setTimelineReady,
    setIsPlaying,
    setElements,
  ]);

  const refreshPlayer = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const adapter = getAdapter();
    pendingSeekRef.current = adapter ? adapter.getTime() : currentTime;
    isRefreshingRef.current = true;

    stopRAFLoop();
    setIsPlaying(false);

    const src = iframe.src;
    const url = new URL(src, window.location.origin);
    url.searchParams.set("_t", String(Date.now()));
    iframe.src = url.toString();
  }, [getAdapter, currentTime, stopRAFLoop, setIsPlaying]);

  // Spacebar shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && e.target === document.body) {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [togglePlay]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopRAFLoop();
      if (probeIntervalRef.current) clearInterval(probeIntervalRef.current);
      reset();
    };
  }, [stopRAFLoop, reset]);

  return {
    iframeRef,
    play,
    pause,
    togglePlay,
    seek,
    onIframeLoad,
    refreshPlayer,
  };
}
