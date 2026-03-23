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

interface ClipManifestClip {
  id: string | null;
  label: string;
  start: number;
  duration: number;
  track: number;
  kind: "video" | "audio" | "image" | "element" | "composition";
  tagName: string | null;
  compositionId: string | null;
  parentCompositionId: string | null;
  compositionSrc: string | null;
  assetUrl: string | null;
}

interface ClipManifest {
  clips: ClipManifestClip[];
  scenes: Array<{ id: string; label: string; start: number; duration: number }>;
  durationInFrames: number;
}

type IframeWindow = Window & {
  __player?: PlayerAPI;
  __timeline?: TimelineLike;
  __timelines?: Record<string, TimelineLike>;
  __clipManifest?: ClipManifest;
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
    // Fallback for CDN runtime that still uses the old source name
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

  // ZERO store subscriptions — this hook never causes re-renders.
  // All reads use getState() (point-in-time), all writes use the stable setters.
  const { setIsPlaying, setCurrentTime, setDuration, setTimelineReady, setElements, reset } =
    usePlayerStore.getState();

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

  const applyPlaybackRate = useCallback((rate: number) => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    // Send to runtime via bridge (works with both new and CDN runtime)
    iframe.contentWindow?.postMessage({ source: "hf-parent", type: "control", action: "set-playback-rate", playbackRate: rate }, "*");
    iframe.contentWindow?.postMessage({ source: "hf-parent", type: "control", action: "set-playback-rate", playbackRate: rate }, "*");
    // Also set directly on GSAP timeline if accessible
    try {
      const win = iframe.contentWindow as IframeWindow | null;
      if (win?.__timelines) {
        for (const tl of Object.values(win.__timelines)) {
          if (tl && typeof (tl as unknown as { timeScale?: (v: number) => void }).timeScale === "function") {
            (tl as unknown as { timeScale: (v: number) => void }).timeScale(rate);
          }
        }
      }
    } catch { /* cross-origin */ }
  }, []);

  const play = useCallback(() => {
    const adapter = getAdapter();
    if (!adapter) return;
    if (adapter.getTime() >= adapter.getDuration()) {
      adapter.seek(0);
    }
    unmutePreviewMedia(iframeRef.current);
    applyPlaybackRate(usePlayerStore.getState().playbackRate);
    adapter.play();
    setIsPlaying(true);
    startRAFLoop();
  }, [getAdapter, setIsPlaying, startRAFLoop, applyPlaybackRate]);

  const pause = useCallback(() => {
    const adapter = getAdapter();
    if (!adapter) return;
    adapter.pause();
    setIsPlaying(false);
    stopRAFLoop();
  }, [getAdapter, setIsPlaying, stopRAFLoop]);

  const togglePlay = useCallback(() => {
    if (usePlayerStore.getState().isPlaying) {
      pause();
    } else {
      play();
    }
  }, [play, pause]);

  const seek = useCallback(
    (time: number) => {
      const adapter = getAdapter();
      if (!adapter) return;
      adapter.seek(time);
      liveTime.notify(time); // Direct DOM updates (playhead, timecode, progress) — no re-render
      stopRAFLoop();
      // Only update store if state actually changes (avoids unnecessary re-renders)
      if (usePlayerStore.getState().isPlaying) setIsPlaying(false);
    },
    [getAdapter, setIsPlaying, stopRAFLoop],
  );

  // Convert a runtime timeline message (from iframe postMessage) into TimelineElements
  const processTimelineMessage = useCallback(
    (data: { clips: ClipManifestClip[]; durationInFrames: number }) => {
      if (!data.clips || data.clips.length === 0) return;

      // Show only root-level clips: those with no parentCompositionId (direct children of root).
      // Sub-composition children (parentCompositionId !== null) belong to the drill-down view.
      const els: TimelineElement[] = data.clips
        .filter((clip) => !clip.parentCompositionId)
        .map((clip) => {
          const entry: TimelineElement = {
            id: clip.id || clip.label || clip.tagName || "element",
            tag: clip.tagName || clip.kind,
            start: clip.start,
            duration: clip.duration,
            track: clip.track,
          };
          if (clip.assetUrl) entry.src = clip.assetUrl;
          if (clip.kind === "composition" && clip.compositionId) {
            entry.compositionSrc = clip.compositionSrc || `compositions/${clip.compositionId}.html`;
          }
          return entry;
        });
      setElements(els);
    },
    [setElements],
  );

  const onIframeLoad = useCallback(() => {
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
          const iframeWin = iframeRef.current?.contentWindow as IframeWindow | null;
          if (doc && iframeWin) {
            normalizePreviewViewport(doc, iframeWin);
            autoHealMissingCompositionIds(doc);
          }

          // Try reading __clipManifest if already available (fast path)
          const manifest = iframeWin?.__clipManifest;
          if (manifest && manifest.clips.length > 0) {
            processTimelineMessage(manifest);
          } else if (doc) {
            // Fallback: parse data-start elements directly from DOM (raw HTML without runtime)
            const rootComp = doc.querySelector("[data-composition-id]");
            const nodes = doc.querySelectorAll("[data-start]");
            const els: TimelineElement[] = [];
            let trackCounter = 0;
            const rootDuration = adapter.getDuration();
            nodes.forEach((node) => {
              if (node === rootComp) return;
              const el = node as HTMLElement;
              const startStr = el.getAttribute("data-start");
              if (startStr == null) return;
              const start = parseFloat(startStr);
              if (isNaN(start)) return;

              const tagLower = el.tagName.toLowerCase();
              let dur = 0;
              const durStr = el.getAttribute("data-duration");
              if (durStr != null) dur = parseFloat(durStr);
              if (isNaN(dur) || dur <= 0) dur = Math.max(0, rootDuration - start);

              const trackStr = el.getAttribute("data-track-index");
              const track = trackStr != null ? parseInt(trackStr, 10) : trackCounter++;
              const entry: TimelineElement = {
                id: el.id || el.className?.split(" ")[0] || tagLower,
                tag: tagLower,
                start,
                duration: dur,
                track: isNaN(track) ? 0 : track,
              };
              if (tagLower === "video" || tagLower === "audio" || tagLower === "img") {
                const src = el.getAttribute("src");
                if (src) entry.src = src;
              }
              // Detect sub-compositions
              const compSrc = el.getAttribute("data-composition-src");
              const compId = el.getAttribute("data-composition-id");
              if (compSrc || (compId && compId !== rootComp?.getAttribute("data-composition-id"))) {
                entry.compositionSrc = compSrc || `compositions/${compId}.html`;
              }
              els.push(entry);
            });
            if (els.length > 0) setElements(els);
          }
          // The runtime will also postMessage the full timeline after all compositions load.
          // That message is handled by the window listener below, which will update elements
          // with the complete data (including async-loaded compositions).
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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- setElements is a stable zustand setter
  }, [getAdapter, setDuration, setCurrentTime, setTimelineReady, setIsPlaying, processTimelineMessage]);

  /** Save the current playback time so the next onIframeLoad restores it. */
  const saveSeekPosition = useCallback(() => {
    const adapter = getAdapter();
    pendingSeekRef.current = adapter ? adapter.getTime() : (usePlayerStore.getState().currentTime ?? 0);
    isRefreshingRef.current = true;
    stopRAFLoop();
    setIsPlaying(false);
  }, [getAdapter, stopRAFLoop, setIsPlaying]);

  const refreshPlayer = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    saveSeekPosition();

    const src = iframe.src;
    const url = new URL(src, window.location.origin);
    url.searchParams.set("_t", String(Date.now()));
    iframe.src = url.toString();
  }, [saveSeekPosition]);

  const togglePlayRef = useRef(togglePlay);
  togglePlayRef.current = togglePlay;
  const processTimelineMessageRef = useRef(processTimelineMessage);
  processTimelineMessageRef.current = processTimelineMessage;

  useMountEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && e.target === document.body) {
        e.preventDefault();
        togglePlayRef.current();
      }
    };

    // Listen for timeline messages from the iframe runtime.
    // The runtime sends this AFTER all external compositions load,
    // so we get the complete clip list (not just the first few).
    const handleMessage = (e: MessageEvent) => {
      const data = e.data;
      if ((data?.source === "hf-preview" || data?.source === "hf-preview") && data?.type === "timeline" && Array.isArray(data.clips)) {
        processTimelineMessageRef.current(data);
        // Update duration only if the new value is longer (don't downgrade during generation)
        if (data.durationInFrames > 0) {
          const fps = 30;
          const dur = data.durationInFrames / fps;
          const currentDur = usePlayerStore.getState().duration;
          if (dur > currentDur) usePlayerStore.getState().setDuration(dur);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("message", handleMessage);
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
    saveSeekPosition,
  };
}
