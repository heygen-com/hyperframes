import { useRef, useCallback } from "react";
import { usePlayerStore, liveTime, type TimelineElement } from "../store/playerStore";
import { useMountEffect } from "../../hooks/useMountEffect";

interface PlaybackAdapter {
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
  __player?: PlaybackAdapter;
  __timeline?: TimelineLike;
  __timelines?: Record<string, TimelineLike>;
  __clipManifest?: ClipManifest;
};

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

/**
 * Parse [data-start] elements from a Document into TimelineElement[].
 * Shared helper — used by onIframeLoad fallback, handleMessage, and enrichMissingCompositions.
 */
function parseTimelineFromDOM(doc: Document, rootDuration: number): TimelineElement[] {
  const rootComp = doc.querySelector("[data-composition-id]");
  const nodes = doc.querySelectorAll("[data-start]");
  const els: TimelineElement[] = [];
  let trackCounter = 0;

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

    // Media elements
    if (tagLower === "video" || tagLower === "audio" || tagLower === "img") {
      const src = el.getAttribute("src");
      if (src) entry.src = src;
      const ms = el.getAttribute("data-media-start");
      if (ms) entry.playbackStart = parseFloat(ms);
      const vol = el.getAttribute("data-volume");
      if (vol) entry.volume = parseFloat(vol);
    }

    // Sub-compositions
    const compSrc =
      el.getAttribute("data-composition-src") || el.getAttribute("data-composition-file");
    const compId = el.getAttribute("data-composition-id");
    if (compSrc) {
      entry.compositionSrc = compSrc;
    } else if (compId && compId !== rootComp?.getAttribute("data-composition-id")) {
      // Inline composition — expose inner video for thumbnails
      const innerVideo = el.querySelector("video[src]");
      if (innerVideo) {
        entry.src = innerVideo.getAttribute("src") || undefined;
        entry.tag = "video";
      }
    }

    els.push(entry);
  });

  return els;
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
      doc.getElementById(`${compId}-layer`) ||
      doc.getElementById(`${compId}-comp`) ||
      doc.getElementById(compId);
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
  } catch (err) {
    console.warn("[useTimelinePlayer] Failed to unmute preview media", err);
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
  const { setIsPlaying, setCurrentTime, setDuration, setTimelineReady, setElements } =
    usePlayerStore.getState();

  const getAdapter = useCallback((): PlaybackAdapter | null => {
    try {
      const win = iframeRef.current?.contentWindow as IframeWindow | null;
      if (!win) return null;

      if (win.__player && typeof win.__player.play === "function") {
        return win.__player;
      }

      if (win.__timeline) return wrapTimeline(win.__timeline);

      if (win.__timelines) {
        const keys = Object.keys(win.__timelines);
        if (keys.length > 0) return wrapTimeline(win.__timelines[keys[keys.length - 1]]);
      }

      return null;
    } catch (err) {
      console.warn("[useTimelinePlayer] Could not get playback adapter (cross-origin)", err);
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
    iframe.contentWindow?.postMessage(
      { source: "hf-parent", type: "control", action: "set-playback-rate", playbackRate: rate },
      "*",
    );
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
    setCurrentTime(adapter.getTime()); // sync store so Split/Delete have accurate time
    setIsPlaying(false);
    stopRAFLoop();
  }, [getAdapter, setCurrentTime, setIsPlaying, stopRAFLoop]);

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
      setCurrentTime(time); // sync store so Split/Delete have accurate time
      stopRAFLoop();
      // Only update store if state actually changes (avoids unnecessary re-renders)
      if (usePlayerStore.getState().isPlaying) setIsPlaying(false);
    },
    [getAdapter, setCurrentTime, setIsPlaying, stopRAFLoop],
  );

  // Convert a runtime timeline message (from iframe postMessage) into TimelineElements
  const processTimelineMessage = useCallback(
    (data: { clips: ClipManifestClip[]; durationInFrames: number }) => {
      if (!data.clips || data.clips.length === 0) {
        return;
      }

      // Show root-level clips: no parentCompositionId, OR parent is a "phantom wrapper"
      const clipCompositionIds = new Set(data.clips.map((c) => c.compositionId).filter(Boolean));
      const filtered = data.clips.filter(
        (clip) => !clip.parentCompositionId || !clipCompositionIds.has(clip.parentCompositionId),
      );
      const els: TimelineElement[] = filtered.map((clip) => {
        const entry: TimelineElement = {
          id: clip.id || clip.label || clip.tagName || "element",
          tag: clip.tagName || clip.kind,
          start: clip.start,
          duration: clip.duration,
          track: clip.track,
        };
        if (clip.assetUrl) entry.src = clip.assetUrl;
        if (clip.kind === "composition" && clip.compositionId) {
          // The bundler renames data-composition-src to data-composition-file
          // after inlining, so the clip manifest may not have compositionSrc.
          // Fall back to reading data-composition-file from the DOM.
          let resolvedSrc = clip.compositionSrc;
          let hostEl: Element | null = null;
          if (!resolvedSrc) {
            try {
              const iframeDoc = iframeRef.current?.contentDocument;
              hostEl =
                iframeDoc?.querySelector(`[data-composition-id="${clip.compositionId}"]`) ?? null;
              resolvedSrc =
                hostEl?.getAttribute("data-composition-src") ??
                hostEl?.getAttribute("data-composition-file") ??
                null;
            } catch {
              /* cross-origin */
            }
          }
          if (resolvedSrc) {
            entry.compositionSrc = resolvedSrc;
          } else if (hostEl) {
            // Inline composition (no external file) — expose inner video for thumbnails
            const innerVideo = hostEl.querySelector("video[src]");
            if (innerVideo) {
              entry.src = innerVideo.getAttribute("src") || undefined;
              entry.tag = "video";
            }
          }
        }
        return entry;
      });
      // Don't downgrade: if we already have more elements with a longer duration,
      // skip updates that would show fewer clips (transient runtime state).
      const currentElements = usePlayerStore.getState().elements;
      const currentDuration = usePlayerStore.getState().duration;
      const rawDuration = data.durationInFrames / 30;
      // Clamp non-finite or absurdly large durations — the runtime can emit
      // Infinity when it detects a loop-inflated GSAP timeline without an
      // explicit data-duration on the root composition.
      const newDuration = Number.isFinite(rawDuration) && rawDuration < 7200 ? rawDuration : 0;
      if (currentElements.length > els.length && newDuration <= currentDuration) {
        return; // skip transient downgrade
      }
      setElements(els);
      // Ensure duration covers the furthest clip end so fit-zoom shows everything
      if (els.length > 0) {
        const maxEnd = Math.max(...els.map((e) => e.start + e.duration));
        const effectiveDur = Math.max(newDuration, maxEnd);
        if (Number.isFinite(effectiveDur) && effectiveDur > currentDuration)
          setDuration(effectiveDur);
      }
      if (els.length > 0) setTimelineReady(true);
    },
    [setElements, setTimelineReady, setDuration],
  );

  /**
   * Scan the iframe DOM for composition hosts missing from the current
   * timeline elements and add them.  The CDN runtime often fails to resolve
   * element-reference starts (`data-start="intro"`) so composition hosts
   * are silently dropped from `__clipManifest`.  This pass reads the DOM +
   * GSAP timeline registry directly to fill the gaps.
   */
  const enrichMissingCompositions = useCallback(() => {
    try {
      const iframe = iframeRef.current;
      const doc = iframe?.contentDocument;
      const iframeWin = iframe?.contentWindow as IframeWindow | null;
      if (!doc || !iframeWin) return;

      const currentEls = usePlayerStore.getState().elements;
      const existingIds = new Set(currentEls.map((e) => e.id));
      const rootComp = doc.querySelector("[data-composition-id]");
      const rootCompId = rootComp?.getAttribute("data-composition-id");
      // Use [data-composition-id][data-start] — the composition loader strips
      // data-composition-src after loading, so we can't rely on it.
      const hosts = doc.querySelectorAll("[data-composition-id][data-start]");
      const missing: TimelineElement[] = [];

      hosts.forEach((host) => {
        const el = host as HTMLElement;
        const compId = el.getAttribute("data-composition-id");
        if (!compId || compId === rootCompId) return;
        if (existingIds.has(el.id) || existingIds.has(compId)) return;

        // Resolve start: numeric or element-reference
        const startAttr = el.getAttribute("data-start") ?? "0";
        let start = parseFloat(startAttr);
        if (isNaN(start)) {
          const ref =
            doc.getElementById(startAttr) ||
            doc.querySelector(`[data-composition-id="${startAttr}"]`);
          if (ref) {
            const refStartAttr = ref.getAttribute("data-start") ?? "0";
            let refStart = parseFloat(refStartAttr);
            // Recursively resolve one level of reference for the ref's own start
            if (isNaN(refStart)) {
              const refRef =
                doc.getElementById(refStartAttr) ||
                doc.querySelector(`[data-composition-id="${refStartAttr}"]`);
              const rrStart = parseFloat(refRef?.getAttribute("data-start") ?? "0") || 0;
              const rrCompId = refRef?.getAttribute("data-composition-id");
              const rrDur =
                parseFloat(refRef?.getAttribute("data-duration") ?? "") ||
                (rrCompId
                  ? ((
                      iframeWin.__timelines?.[rrCompId] as TimelineLike | undefined
                    )?.duration?.() ?? 0)
                  : 0);
              refStart = rrStart + rrDur;
            }
            const refCompId = ref.getAttribute("data-composition-id");
            const refDur =
              parseFloat(ref.getAttribute("data-duration") ?? "") ||
              (refCompId
                ? ((iframeWin.__timelines?.[refCompId] as TimelineLike | undefined)?.duration?.() ??
                  0)
                : 0);
            start = refStart + refDur;
          } else {
            start = 0;
          }
        }

        // Resolve duration from data-duration or GSAP timeline
        let dur = parseFloat(el.getAttribute("data-duration") ?? "");
        if (isNaN(dur) || dur <= 0) {
          dur = (iframeWin.__timelines?.[compId] as TimelineLike | undefined)?.duration?.() ?? 0;
        }
        if (!Number.isFinite(dur) || dur <= 0) return;
        if (!Number.isFinite(start)) start = 0;

        const trackStr = el.getAttribute("data-track-index");
        const track = trackStr != null ? parseInt(trackStr, 10) : 0;
        const compSrc =
          el.getAttribute("data-composition-src") || el.getAttribute("data-composition-file");
        const entry: TimelineElement = {
          id: el.id || compId,
          tag: el.tagName.toLowerCase(),
          start,
          duration: dur,
          track: isNaN(track) ? 0 : track,
        };
        if (compSrc) {
          entry.compositionSrc = compSrc;
        } else {
          // Inline composition — expose inner video for thumbnails
          const innerVideo = el.querySelector("video[src]");
          if (innerVideo) {
            entry.src = innerVideo.getAttribute("src") || undefined;
            entry.tag = "video";
          }
        }
        missing.push(entry);
      });

      // Patch existing elements that are missing compositionSrc
      let patched = false;
      const updatedEls = currentEls.map((existing) => {
        if (existing.compositionSrc) return existing;
        // Find the matching DOM host by element id or composition id
        const host =
          doc.getElementById(existing.id) ??
          doc.querySelector(`[data-composition-id="${existing.id}"]`);
        if (!host) return existing;
        const compSrc =
          host.getAttribute("data-composition-src") || host.getAttribute("data-composition-file");
        if (compSrc) {
          patched = true;
          return { ...existing, compositionSrc: compSrc };
        }
        return existing;
      });

      if (missing.length > 0 || patched) {
        // Dedup: ensure no missing element duplicates an existing one
        const finalIds = new Set(updatedEls.map((e) => e.id));
        const dedupedMissing = missing.filter((m) => !finalIds.has(m.id));
        setElements([...updatedEls, ...dedupedMissing]);
        setTimelineReady(true);
      }
    } catch (err) {
      console.warn("[useTimelinePlayer] enrichMissingCompositions failed", err);
    }
  }, [setElements, setTimelineReady]);

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
        const adapterDur = adapter.getDuration();
        // Cap at 7200s (2h) to guard against loop-inflated GSAP timelines
        if (Number.isFinite(adapterDur) && adapterDur > 0 && adapterDur < 7200)
          setDuration(adapterDur);
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
          }
          // Enrich: fill in composition hosts the manifest missed
          enrichMissingCompositions();

          // Run DOM fallback if still no elements were populated
          // (manifest may exist but all clips filtered out by parentCompositionId logic)
          if (usePlayerStore.getState().elements.length === 0 && doc) {
            // Fallback: parse data-start elements directly from DOM (raw HTML without runtime)
            const els = parseTimelineFromDOM(doc, adapter.getDuration());
            if (els.length > 0) {
              setElements(els);
              setTimelineReady(true);
            }
          }

          // Final fallback for standalone composition previews: if still no
          // elements, build timeline entries from the DOM inside the root
          // composition. This ensures the timeline always shows content when
          // viewing a single composition (where elements lack data-start).
          if (usePlayerStore.getState().elements.length === 0 && doc) {
            const rootComp = doc.querySelector("[data-composition-id]");
            const rootDuration = adapter.getDuration();
            if (rootComp && rootDuration > 0) {
              const rootId = rootComp.getAttribute("data-composition-id") || "composition";
              // Derive compositionSrc from the iframe URL for thumbnail rendering.
              // URL pattern: /api/projects/{id}/preview/comp/{path}
              const iframeSrc = iframeRef.current?.src || "";
              const compPathMatch = iframeSrc.match(/\/preview\/comp\/(.+?)(?:\?|$)/);
              const compositionSrc = compPathMatch
                ? decodeURIComponent(compPathMatch[1])
                : undefined;
              // Always show the root composition as a single clip — guarantees
              // the timeline is never empty when a valid composition is loaded.
              setElements([
                {
                  id: rootId,
                  tag: (rootComp as HTMLElement).tagName?.toLowerCase() || "div",
                  start: 0,
                  duration: rootDuration,
                  track: 0,
                  compositionSrc,
                },
              ]);
              setTimelineReady(true);
            }
          }
          // The runtime will also postMessage the full timeline after all compositions load.
          // That message is handled by the window listener below, which will update elements
          // with the complete data (including async-loaded compositions).
        } catch (err) {
          console.warn("[useTimelinePlayer] Could not read timeline elements from iframe", err);
        }

        return;
      }
      if (attempts >= maxAttempts) {
        clearInterval(probeIntervalRef.current);
        console.warn("Could not find __player, __timeline, or __timelines on iframe after 5s");
      }
    }, 200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    getAdapter,
    setDuration,
    setCurrentTime,
    setTimelineReady,
    setIsPlaying,
    processTimelineMessage,
    enrichMissingCompositions,
  ]);

  /** Save the current playback time so the next onIframeLoad restores it. */
  const saveSeekPosition = useCallback(() => {
    const adapter = getAdapter();
    pendingSeekRef.current = adapter
      ? adapter.getTime()
      : (usePlayerStore.getState().currentTime ?? 0);
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
  const getAdapterRef = useRef(getAdapter);
  getAdapterRef.current = getAdapter;
  const processTimelineMessageRef = useRef(processTimelineMessage);
  processTimelineMessageRef.current = processTimelineMessage;
  const enrichMissingCompositionsRef = useRef(enrichMissingCompositions);
  enrichMissingCompositionsRef.current = enrichMissingCompositions;

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
      // Only process messages from the main preview iframe — ignore MediaPanel/ClipThumbnail iframes
      if (e.source && iframeRef.current && e.source !== iframeRef.current.contentWindow) {
        return;
      }
      // Also handle the runtime's state message which includes timeline data
      if (data?.source === "hf-preview" && data?.type === "state") {
        // State message means the runtime is alive — check for elements
        try {
          if (usePlayerStore.getState().elements.length === 0) {
            const iframe = iframeRef.current;
            const iframeWin = iframe?.contentWindow as IframeWindow | null;
            const manifest = iframeWin?.__clipManifest;
            if (manifest && manifest.clips.length > 0) {
              processTimelineMessageRef.current(manifest);
            }
          }
          // Always try to enrich — timelines may have registered since the last check
          enrichMissingCompositionsRef.current();
        } catch (err) {
          console.warn("[useTimelinePlayer] Could not read clip manifest from iframe", err);
        }
      }
      if (data?.source === "hf-preview" && data?.type === "timeline" && Array.isArray(data.clips)) {
        processTimelineMessageRef.current(data);
        // Fill in composition hosts the manifest missed (element-reference starts)
        enrichMissingCompositionsRef.current();
        // Update duration only if the new value is longer (don't downgrade during generation)
        if (data.durationInFrames > 0 && Number.isFinite(data.durationInFrames)) {
          const fps = 30;
          const dur = data.durationInFrames / fps;
          const currentDur = usePlayerStore.getState().duration;
          if (dur > currentDur) usePlayerStore.getState().setDuration(dur);
        }
        // If manifest produced 0 elements after filtering, try DOM fallback
        if (usePlayerStore.getState().elements.length === 0) {
          try {
            const iframe = iframeRef.current;
            const doc = iframe?.contentDocument;
            const adapter = getAdapter();
            if (doc && adapter) {
              const els = parseTimelineFromDOM(doc, adapter.getDuration());
              if (els.length > 0) {
                setElements(els);
                setTimelineReady(true);
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

    // Pause video when tab loses focus (user switches away)
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

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("message", handleMessage);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("message", handleMessage);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      stopRAFLoop();
      if (probeIntervalRef.current) clearInterval(probeIntervalRef.current);
      // Don't reset() on cleanup — preserve timeline elements across iframe refreshes
      // to prevent blink. New data will replace old when the iframe reloads.
    };
  });

  /** Reset the player store (elements, duration, etc.) — call when switching sessions. */
  const resetPlayer = useCallback(() => {
    stopRAFLoop();
    if (probeIntervalRef.current) clearInterval(probeIntervalRef.current);
    usePlayerStore.getState().reset();
  }, [stopRAFLoop]);

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
