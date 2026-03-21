import { useRef, useCallback } from "react";
import { usePlayerStore, liveTime, type TimelineElement } from "../store/playerStore";
import { useMountEffect } from "../lib/useMountEffect";

interface PlayerAPI {
  play: () => void;
  pause: () => void;
  seek: (time: number) => void;
  getTime: () => number;
  getDuration: () => number;
  isPlaying: () => boolean;
}

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

interface PlaybackAdapter {
  play: () => void;
  pause: () => void;
  seek: (time: number) => void;
  getTime: () => number;
  getDuration: () => number;
  isPlaying: () => boolean;
}

function wrapPlayer(p: PlayerAPI): PlaybackAdapter {
  return {
    play: () => p.play(),
    pause: () => p.pause(),
    seek: (t) => p.seek(t),
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

function normalizePreviewViewport(doc: Document, win: Window): void {
  if (doc.documentElement) {
    doc.documentElement.style.overflow = "hidden";
    doc.documentElement.style.margin = "0";
  }
  if (doc.body) {
    doc.body.style.overflow = "hidden";
    doc.body.style.margin = "0";
  }
  win.scrollTo({ top: 0, left: 0, behavior: "auto" });
}

function autoHealMissingCompositionIds(doc: Document): void {
  const compositionIdRe = /data-composition-id=["']([^"']+)["']/gi;
  const referencedIds = new Set<string>();
  const scopedNodes = Array.from(doc.querySelectorAll("style, script"));
  for (const node of scopedNodes) {
    const text = node.textContent || "";
    if (!text) continue;
    let match: RegExpExecArray | null;
    while ((match = compositionIdRe.exec(text)) !== null) {
      const id = (match[1] || "").trim();
      if (id) referencedIds.add(id);
    }
  }

  if (referencedIds.size === 0) return;

  const existingIds = new Set<string>();
  const existingNodes = Array.from(doc.querySelectorAll<HTMLElement>("[data-composition-id]"));
  for (const node of existingNodes) {
    const id = node.getAttribute("data-composition-id");
    if (id) existingIds.add(id);
  }

  for (const compId of referencedIds) {
    if (compId === "root" || existingIds.has(compId)) continue;
    const host =
      doc.getElementById(`${compId}-layer`) || doc.getElementById(`${compId}-comp`) || doc.getElementById(compId);
    if (!host) continue;
    if (!host.getAttribute("data-composition-id")) {
      host.setAttribute("data-composition-id", compId);
    }
  }
}

function unmutePreviewMedia(iframe: HTMLIFrameElement | null): void {
  if (!iframe) return;
  try {
    iframe.contentWindow?.postMessage(
      { source: "hf-parent", type: "control", action: "set-muted", muted: false },
      "*",
    );
  } catch {
    /* ignore */
  }
}

export function useTimelinePlayer() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const rafRef = useRef<number>(0);
  const probeIntervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const pendingSeekRef = useRef<number | null>(null);
  const isRefreshingRef = useRef(false);

  const { isPlaying, setIsPlaying, setCurrentTime, setDuration, setTimelineReady, setElements, reset } =
    usePlayerStore();

  const getAdapter = useCallback((): PlaybackAdapter | null => {
    try {
      const win = iframeRef.current?.contentWindow as IframeWindow | null;
      if (!win) return null;

      if (win.__player && typeof win.__player.play === "function") {
        return wrapPlayer(win.__player);
      }

      if (win.__timeline) return wrapTimeline(win.__timeline);

      if (win.__timelines) {
        const keys = Object.keys(win.__timelines);
        if (keys.length > 0) return wrapTimeline(win.__timelines[keys[keys.length - 1]]);
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
        liveTime.notify(time); // direct DOM updates, no React re-render
        if (time >= dur && !adapter.isPlaying()) {
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

  const play = useCallback(() => {
    const adapter = getAdapter();
    if (!adapter) return;
    if (adapter.getTime() >= adapter.getDuration()) {
      adapter.seek(0);
    }
    unmutePreviewMedia(iframeRef.current);
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
      adapter.seek(time);
      setCurrentTime(time);
      setIsPlaying(false);
      stopRAFLoop();
    },
    [getAdapter, setCurrentTime, setIsPlaying, stopRAFLoop],
  );

  const onIframeLoad = useCallback(() => {
    // Unmute immediately on load so audio is ready when user hits play
    unmutePreviewMedia(iframeRef.current);

    let attempts = 0;
    const maxAttempts = 25;

    if (probeIntervalRef.current) clearInterval(probeIntervalRef.current);

    probeIntervalRef.current = setInterval(() => {
      attempts++;
      const adapter = getAdapter();
      if (adapter && adapter.getDuration() > 0) {
        clearInterval(probeIntervalRef.current);
        adapter.pause();

        const seekTo = pendingSeekRef.current;
        pendingSeekRef.current = null;
        const startTime = seekTo != null ? Math.min(seekTo, adapter.getDuration()) : 0;

        adapter.seek(startTime);
        setDuration(adapter.getDuration());
        setCurrentTime(startTime);
        if (!isRefreshingRef.current) {
          setTimelineReady(true);
        }
        isRefreshingRef.current = false;
        setIsPlaying(false);

        try {
          const doc = iframeRef.current?.contentDocument;
          if (doc) {
            const win = iframeRef.current?.contentWindow;
            if (win) {
              normalizePreviewViewport(doc, win);
              autoHealMissingCompositionIds(doc);
            }
            const rootComposition = doc.querySelector("[data-composition-id]");
            const nodes = doc.querySelectorAll("[data-start]");
            const els: TimelineElement[] = [];
            let trackCounter = 0;
            const rootDuration = adapter.getDuration();
            nodes.forEach((node) => {
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

              if ((isNaN(dur) || dur <= 0) && (tagLower === "video" || tagLower === "audio")) {
                const mediaEl = el as unknown as HTMLMediaElement;
                if (mediaEl.duration && isFinite(mediaEl.duration) && mediaEl.duration > 0) {
                  const pbStart = parseFloat(el.getAttribute("data-playback-start") || "0") || 0;
                  dur = mediaEl.duration - pbStart;
                }
              }

              const compositionId = el.getAttribute("data-composition-id");
              if ((isNaN(dur) || dur <= 0) && compositionId) {
                const win = iframeRef.current?.contentWindow as IframeWindow | null;
                const compTl = win?.__timelines?.[compositionId];
                if (compTl) {
                  const compDur = compTl.duration();
                  if (compDur > 0) dur = compDur;
                }
              }

              const maxVisibleDuration = Math.max(0, rootDuration - start);
              if (isNaN(dur) || dur <= 0) {
                dur = maxVisibleDuration;
              } else if (maxVisibleDuration > 0) {
                dur = Math.min(dur, maxVisibleDuration);
              }

              const trackStr = el.getAttribute("data-track-index");
              const track = trackStr != null ? parseInt(trackStr, 10) : trackCounter++;
              const entry: TimelineElement = {
                id: el.id || tagLower,
                tag: tagLower,
                start,
                duration: dur,
                track: isNaN(track) ? 0 : track,
              };

              if (tagLower === "video" || tagLower === "audio" || tagLower === "img") {
                const src = el.getAttribute("src");
                if (src) entry.src = src;
              }
              const pbStart = el.getAttribute("data-playback-start");
              if (pbStart != null) {
                const parsed = parseFloat(pbStart);
                if (!isNaN(parsed)) entry.playbackStart = parsed;
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
          // Cross-origin or DOM access error
        }

        return;
      }
      if (attempts >= maxAttempts) {
        clearInterval(probeIntervalRef.current);
        console.warn("Could not find __player, __timeline, or __timelines on iframe after 5s");
      }
    }, 200);
  }, [getAdapter, setDuration, setCurrentTime, setTimelineReady, setIsPlaying, setElements]);

  const refreshPlayer = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    pendingSeekRef.current = 0;
    isRefreshingRef.current = true;

    stopRAFLoop();
    setIsPlaying(false);

    const src = iframe.src;
    const url = new URL(src, window.location.origin);
    url.searchParams.set("_t", String(Date.now()));
    iframe.src = url.toString();
  }, [stopRAFLoop, setIsPlaying]);

  const togglePlayRef = useRef(togglePlay);
  togglePlayRef.current = togglePlay;
  useMountEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && e.target === document.body) {
        e.preventDefault();
        togglePlayRef.current();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      stopRAFLoop();
      if (probeIntervalRef.current) clearInterval(probeIntervalRef.current);
      reset();
    };
  });

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
