import { useRef, useCallback } from "react";
import { usePlayerStore, liveTime, type TimelineElement } from "../store/playerStore";
import { useMountEffect } from "../../hooks/useMountEffect";
import { stepFrameTime, STUDIO_PREVIEW_FPS } from "../lib/time";
import { useCaptionStore } from "../../captions/store";

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

function resolveMediaElement(el: Element): HTMLMediaElement | HTMLImageElement | null {
  if (el instanceof HTMLMediaElement || el instanceof HTMLImageElement) return el;
  const candidate = el.querySelector("video, audio, img");
  return candidate instanceof HTMLMediaElement || candidate instanceof HTMLImageElement
    ? candidate
    : null;
}

function applyMediaMetadataFromElement(entry: TimelineElement, el: Element): void {
  const mediaStartAttr = el.getAttribute("data-playback-start")
    ? "playback-start"
    : el.getAttribute("data-media-start")
      ? "media-start"
      : undefined;
  const mediaStartValue =
    el.getAttribute("data-playback-start") ?? el.getAttribute("data-media-start");
  if (mediaStartValue != null) {
    const playbackStart = parseFloat(mediaStartValue);
    if (Number.isFinite(playbackStart)) entry.playbackStart = playbackStart;
  }
  if (mediaStartAttr) entry.playbackStartAttr = mediaStartAttr;

  const mediaEl = resolveMediaElement(el);
  if (!mediaEl) return;

  entry.tag = mediaEl.tagName.toLowerCase();
  const src = mediaEl.getAttribute("src");
  if (src) entry.src = src;

  if (!(mediaEl instanceof HTMLMediaElement)) return;

  const sourceDurationAttr =
    el.getAttribute("data-source-duration") ?? mediaEl.getAttribute("data-source-duration");
  const sourceDuration = sourceDurationAttr ? parseFloat(sourceDurationAttr) : mediaEl.duration;
  if (Number.isFinite(sourceDuration) && sourceDuration > 0) {
    entry.sourceDuration = sourceDuration;
  }

  const playbackRate = mediaEl.defaultPlaybackRate;
  if (Number.isFinite(playbackRate) && playbackRate > 0) {
    entry.playbackRate = playbackRate;
  }
}

const SHUTTLE_SPEEDS = [1, 2, 4] as const;
const PLAYBACK_FRAME_STEP_CODES = new Set(["ArrowLeft", "ArrowRight"]);
const PLAYBACK_SHORTCUT_IGNORED_SELECTOR = [
  "input",
  "textarea",
  "select",
  "button",
  "a[href]",
  "[contenteditable='true']",
  "[role='button']",
  "[role='checkbox']",
  "[role='combobox']",
  "[role='menuitem']",
  "[role='radio']",
  "[role='slider']",
  "[role='spinbutton']",
  "[role='switch']",
  "[role='textbox']",
].join(",");

export function shouldIgnorePlaybackShortcutTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const candidate = target as { closest?: unknown };
  if (typeof candidate.closest !== "function") return false;
  return (
    (candidate.closest as (selector: string) => Element | null).call(
      target,
      PLAYBACK_SHORTCUT_IGNORED_SELECTOR,
    ) !== null
  );
}

interface PlaybackShortcutCaptionState {
  isCaptionEditMode: boolean;
  selectedCaptionSegmentCount: number;
}

type PlaybackShortcutEvent = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "metaKey" | "code" | "target"
>;

export function shouldIgnorePlaybackShortcutEvent(
  event: PlaybackShortcutEvent,
  captionState: PlaybackShortcutCaptionState = {
    isCaptionEditMode: false,
    selectedCaptionSegmentCount: 0,
  },
): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return true;
  if (shouldIgnorePlaybackShortcutTarget(event.target)) return true;
  return (
    PLAYBACK_FRAME_STEP_CODES.has(event.code) &&
    captionState.isCaptionEditMode &&
    captionState.selectedCaptionSegmentCount > 0
  );
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
    if (Number.isFinite(rootDuration) && rootDuration > 0 && start >= rootDuration) return;

    const tagLower = el.tagName.toLowerCase();
    let dur = 0;
    const durStr = el.getAttribute("data-duration");
    if (durStr != null) dur = parseFloat(durStr);
    if (isNaN(dur) || dur <= 0) dur = Math.max(0, rootDuration - start);
    if (Number.isFinite(rootDuration) && rootDuration > 0) {
      dur = Math.min(dur, Math.max(0, rootDuration - start));
    }
    if (!Number.isFinite(dur) || dur <= 0) return;

    const trackStr = el.getAttribute("data-track-index");
    const track = trackStr != null ? parseInt(trackStr, 10) : trackCounter++;
    const compId = el.getAttribute("data-composition-id");
    const selector = getTimelineElementSelector(el);
    const sourceFile = getTimelineElementSourceFile(el);
    const selectorIndex = getTimelineElementSelectorIndex(doc, el, selector);
    const id = el.id || compId || el.className?.split(" ")[0] || tagLower;
    const entry: TimelineElement = {
      id,
      key: buildTimelineElementKey({
        id,
        fallbackIndex: els.length,
        domId: el.id || undefined,
        selector,
        selectorIndex,
        sourceFile,
      }),
      tag: tagLower,
      start,
      duration: dur,
      track: isNaN(track) ? 0 : track,
      domId: el.id || undefined,
      selector,
      selectorIndex,
      sourceFile,
    };

    const mediaEl = resolveMediaElement(el);
    if (mediaEl) {
      if (mediaEl.tagName === "IMG") {
        entry.tag = "img";
      }
      const src = mediaEl.getAttribute("src");
      if (src) entry.src = src;
      const vol = el.getAttribute("data-volume") ?? mediaEl.getAttribute("data-volume");
      if (vol) entry.volume = parseFloat(vol);
      applyMediaMetadataFromElement(entry, el);
    }

    // Sub-compositions
    const compSrc =
      el.getAttribute("data-composition-src") || el.getAttribute("data-composition-file");
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

function getTimelineElementSelector(el: Element): string | undefined {
  if (el instanceof HTMLElement && el.id) return `#${el.id}`;
  const compId = el.getAttribute("data-composition-id");
  if (compId) return `[data-composition-id="${compId}"]`;
  if (el instanceof HTMLElement) {
    const firstClass = el.className.split(/\s+/).find(Boolean);
    if (firstClass) return `.${firstClass}`;
  }
  return undefined;
}

function getTimelineElementSourceFile(el: Element): string | undefined {
  const ownerRoot = el.parentElement?.closest("[data-composition-id]");
  return (
    ownerRoot?.getAttribute("data-composition-file") ??
    ownerRoot?.getAttribute("data-composition-src") ??
    undefined
  );
}

function getTimelineElementSelectorIndex(
  doc: Document,
  el: Element,
  selector: string | undefined,
): number | undefined {
  if (!selector || selector.startsWith("#") || selector.startsWith("[data-composition-id=")) {
    return undefined;
  }

  try {
    const matches = Array.from(doc.querySelectorAll(selector));
    const matchIndex = matches.indexOf(el);
    return matchIndex >= 0 ? matchIndex : undefined;
  } catch {
    return undefined;
  }
}

function buildTimelineElementKey(params: {
  id: string;
  fallbackIndex: number;
  domId?: string;
  selector?: string;
  selectorIndex?: number;
  sourceFile?: string;
}): string {
  const scope = params.sourceFile ?? "index.html";
  if (params.domId) return `${scope}#${params.domId}`;
  if (params.selector) return `${scope}:${params.selector}:${params.selectorIndex ?? 0}`;
  return `${scope}:${params.id}:${params.fallbackIndex}`;
}

function findTimelineDomNode(doc: Document, id: string): Element | null {
  return (
    doc.getElementById(id) ??
    doc.querySelector(`[data-composition-id="${id}"]`) ??
    doc.querySelector(`.${id}`) ??
    null
  );
}

export function resolveStandaloneRootCompositionSrc(iframeSrc: string): string | undefined {
  const compPathMatch = iframeSrc.match(/\/preview\/comp\/(.+?)(?:\?|$)/);
  return compPathMatch ? decodeURIComponent(compPathMatch[1]) : undefined;
}

export function buildStandaloneRootTimelineElement(params: {
  compositionId: string;
  tagName: string;
  rootDuration: number;
  iframeSrc: string;
  selector?: string;
  selectorIndex?: number;
}): TimelineElement | null {
  if (!Number.isFinite(params.rootDuration) || params.rootDuration <= 0) return null;

  const compositionSrc = resolveStandaloneRootCompositionSrc(params.iframeSrc);

  return {
    id: params.compositionId,
    key: buildTimelineElementKey({
      id: params.compositionId,
      fallbackIndex: 0,
      selector: params.selector,
      selectorIndex: params.selectorIndex,
      sourceFile: compositionSrc,
    }),
    tag: params.tagName.toLowerCase() || "div",
    start: 0,
    duration: params.rootDuration,
    track: 0,
    compositionSrc,
    selector: params.selector,
    selectorIndex: params.selectorIndex,
    sourceFile: compositionSrc,
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

/**
 * Resolve the underlying iframe from any host element. Supports:
 * - Direct `<iframe>` element (most common — studio's own `Player.tsx`)
 * - Custom elements (e.g. `<hyperframes-player>`) whose shadow DOM contains an iframe
 * - Wrapper elements whose light DOM contains a descendant iframe
 *
 * Exported so web-component consumers can pre-resolve the iframe before
 * assigning it to `iframeRef` returned by `useTimelinePlayer`. Returns `null`
 * when the element has no associated iframe yet.
 *
 * @example
 * ```tsx
 * const { iframeRef } = useTimelinePlayer();
 * const playerElRef = useRef<HyperframesPlayer>(null);
 *
 * useEffect(() => {
 *   iframeRef.current = resolveIframe(playerElRef.current);
 * }, [iframeRef]);
 * ```
 */
export function resolveIframe(el: Element | null): HTMLIFrameElement | null {
  if (!el) return null;
  if (el instanceof HTMLIFrameElement) return el;
  return el.shadowRoot?.querySelector("iframe") ?? el.querySelector("iframe") ?? null;
}

export function mergeTimelineElementsPreservingDowngrades(
  currentElements: TimelineElement[],
  nextElements: TimelineElement[],
  currentDuration: number,
  nextDuration: number,
): TimelineElement[] {
  const safeCurrentDuration = Number.isFinite(currentDuration) ? currentDuration : 0;
  const safeNextDuration = Number.isFinite(nextDuration) ? nextDuration : 0;

  if (
    currentElements.length === 0 ||
    nextElements.length >= currentElements.length ||
    safeNextDuration > safeCurrentDuration
  ) {
    return nextElements;
  }

  const nextIds = new Set(nextElements.map((element) => element.id));
  const preserved = currentElements.filter((element) => !nextIds.has(element.id));
  if (preserved.length === 0) return nextElements;
  return [...nextElements, ...preserved];
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
  const pressedCodesRef = useRef(new Set<string>());
  const iframeShortcutCleanupRef = useRef<(() => void) | null>(null);
  const playbackKeyDownRef = useRef<(e: KeyboardEvent) => void>(() => {});
  const playbackKeyUpRef = useRef<(e: KeyboardEvent) => void>(() => {});

  // ZERO store subscriptions — this hook never causes re-renders.
  // All reads use getState() (point-in-time), all writes use the stable setters.
  const { setIsPlaying, setCurrentTime, setDuration, setTimelineReady, setElements } =
    usePlayerStore.getState();

  const syncTimelineElements = useCallback(
    (elements: TimelineElement[], nextDuration?: number) => {
      const state = usePlayerStore.getState();
      const mergedElements = mergeTimelineElementsPreservingDowngrades(
        state.elements,
        elements,
        state.duration,
        nextDuration ?? state.duration,
      );
      setElements(mergedElements);
      if (Number.isFinite(nextDuration) && (nextDuration ?? 0) > 0) {
        setDuration(nextDuration ?? 0);
      }
      setTimelineReady(true);
    },
    [setElements, setTimelineReady, setDuration],
  );

  const getAdapter = useCallback((): PlaybackAdapter | null => {
    try {
      const iframe = iframeRef.current;
      const win = iframe?.contentWindow as IframeWindow | null;
      if (!win) return null;

      if (win.__player && typeof win.__player.play === "function") {
        return win.__player;
      }

      if (win.__timeline) return wrapTimeline(win.__timeline);

      if (win.__timelines) {
        const keys = Object.keys(win.__timelines);
        if (keys.length > 0) {
          // Resolve the root composition id from the DOM — the outermost
          // `[data-composition-id]` element is the master. Without this,
          // Object.keys() order would let a sub-composition's timeline
          // hijack play/pause/seek and the duration readout.
          const rootId = iframe?.contentDocument
            ?.querySelector("[data-composition-id]")
            ?.getAttribute("data-composition-id");
          const key = rootId && rootId in win.__timelines ? rootId : keys[keys.length - 1];
          return wrapTimeline(win.__timelines[key]);
        }
      }

      return null;
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
        const time = adapter.getTime();
        const dur = adapter.getDuration();
        liveTime.notify(time); // direct DOM updates, no React re-render
        if (time >= dur && !adapter.isPlaying()) {
          if (usePlayerStore.getState().loopEnabled && dur > 0) {
            adapter.seek(0);
            liveTime.notify(0);
            adapter.play();
            setIsPlaying(true);
            rafRef.current = requestAnimationFrame(tick);
            return;
          }
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
    stopRAFLoop();
    stopReverseLoop();
    const adapter = getAdapter();
    if (!adapter) return;
    if (adapter.getTime() >= adapter.getDuration()) {
      adapter.seek(0);
    }
    unmutePreviewMedia(iframeRef.current);
    applyPlaybackRate(usePlayerStore.getState().playbackRate);
    adapter.play();
    shuttleDirectionRef.current = "forward";
    setIsPlaying(true);
    startRAFLoop();
  }, [getAdapter, setIsPlaying, startRAFLoop, applyPlaybackRate, stopRAFLoop, stopReverseLoop]);

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
      unmutePreviewMedia(iframeRef.current);
      const speed = Math.max(0.1, Math.min(4, rate));
      let startTime = initialTime;
      let startedAt = performance.now();

      const tick = (now: number) => {
        const elapsed = ((now - startedAt) / 1000) * speed;
        let nextTime = startTime - elapsed;
        if (nextTime <= 0) {
          if (usePlayerStore.getState().loopEnabled && duration > 0) {
            startTime = duration;
            startedAt = now;
            nextTime = duration;
          } else {
            adapter.seek(0);
            liveTime.notify(0);
            setCurrentTime(0);
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
    [getAdapter, setCurrentTime, setIsPlaying, stopRAFLoop, stopReverseLoop],
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

  const togglePlay = useCallback(() => {
    if (usePlayerStore.getState().isPlaying) {
      pause();
    } else {
      play();
    }
  }, [play, pause]);

  const seek = useCallback(
    (time: number) => {
      stopReverseLoop();
      const adapter = getAdapter();
      if (!adapter) return;
      const duration = Math.max(0, adapter.getDuration());
      const nextTime = Math.max(0, duration > 0 ? Math.min(duration, time) : time);
      adapter.seek(nextTime);
      liveTime.notify(nextTime); // Direct DOM updates (playhead, timecode, progress) — no re-render
      setCurrentTime(nextTime); // sync store so Split/Delete have accurate time
      stopRAFLoop();
      // Only update store if state actually changes (avoids unnecessary re-renders)
      if (usePlayerStore.getState().isPlaying) setIsPlaying(false);
      shuttleDirectionRef.current = null;
      shuttleSpeedIndexRef.current = 0;
    },
    [getAdapter, setCurrentTime, setIsPlaying, stopRAFLoop, stopReverseLoop],
  );

  const stepFrames = useCallback(
    (deltaFrames: number) => {
      const adapter = getAdapter();
      const currentTime = adapter?.getTime() ?? usePlayerStore.getState().currentTime;
      seek(stepFrameTime(currentTime, deltaFrames, STUDIO_PREVIEW_FPS));
    },
    [getAdapter, seek],
  );

  const shuttle = useCallback(
    (direction: "forward" | "backward") => {
      if (shuttleDirectionRef.current === direction) {
        shuttleSpeedIndexRef.current = Math.min(
          shuttleSpeedIndexRef.current + 1,
          SHUTTLE_SPEEDS.length - 1,
        );
      } else {
        shuttleSpeedIndexRef.current = 0;
      }
      const speed = SHUTTLE_SPEEDS[shuttleSpeedIndexRef.current];
      usePlayerStore.getState().setPlaybackRate(speed);
      if (direction === "forward") {
        play();
      } else {
        playBackward(speed);
      }
    },
    [play, playBackward],
  );

  const handlePlaybackKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const captionState = useCaptionStore.getState();
      if (
        shouldIgnorePlaybackShortcutEvent(e, {
          isCaptionEditMode: captionState.isEditMode,
          selectedCaptionSegmentCount: captionState.selectedSegmentIds.size,
        })
      ) {
        return;
      }
      pressedCodesRef.current.add(e.code);
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
        return;
      }
      if (e.code === "ArrowLeft") {
        e.preventDefault();
        stepFrames(e.shiftKey ? -10 : -1);
        return;
      }
      if (e.code === "ArrowRight") {
        e.preventDefault();
        stepFrames(e.shiftKey ? 10 : 1);
        return;
      }
      if (e.repeat) return;
      if (e.code === "KeyK") {
        e.preventDefault();
        pause();
        return;
      }
      if (e.code === "KeyJ") {
        e.preventDefault();
        if (pressedCodesRef.current.has("KeyK")) {
          stepFrames(-1);
          return;
        }
        shuttle("backward");
        return;
      }
      if (e.code === "KeyL") {
        e.preventDefault();
        if (pressedCodesRef.current.has("KeyK")) {
          stepFrames(1);
          return;
        }
        shuttle("forward");
      }
    },
    [pause, shuttle, stepFrames, togglePlay],
  );

  const handlePlaybackKeyUp = useCallback((e: KeyboardEvent) => {
    pressedCodesRef.current.delete(e.code);
  }, []);
  playbackKeyDownRef.current = handlePlaybackKeyDown;
  playbackKeyUpRef.current = handlePlaybackKeyUp;

  const attachIframeShortcutListeners = useCallback(() => {
    iframeShortcutCleanupRef.current?.();
    iframeShortcutCleanupRef.current = null;

    const iframeWin = iframeRef.current?.contentWindow;
    const iframeDoc = iframeRef.current?.contentDocument;
    if (!iframeWin && !iframeDoc) return;

    const handleIframeKeyDown = (e: KeyboardEvent) => playbackKeyDownRef.current(e);
    const handleIframeKeyUp = (e: KeyboardEvent) => playbackKeyUpRef.current(e);
    iframeWin?.addEventListener("keydown", handleIframeKeyDown, true);
    iframeWin?.addEventListener("keyup", handleIframeKeyUp, true);
    iframeDoc?.addEventListener("keydown", handleIframeKeyDown, true);
    iframeDoc?.addEventListener("keyup", handleIframeKeyUp, true);
    iframeShortcutCleanupRef.current = () => {
      iframeWin?.removeEventListener("keydown", handleIframeKeyDown, true);
      iframeWin?.removeEventListener("keyup", handleIframeKeyUp, true);
      iframeDoc?.removeEventListener("keydown", handleIframeKeyDown, true);
      iframeDoc?.removeEventListener("keyup", handleIframeKeyUp, true);
    };
  }, []);

  // Convert a runtime timeline message (from iframe postMessage) into TimelineElements
  const processTimelineMessage = useCallback(
    (data: {
      clips: ClipManifestClip[];
      durationInFrames: number;
      scenes?: Array<{ id: string; label: string; start: number; duration: number }>;
    }) => {
      if (!data.clips || data.clips.length === 0) {
        return;
      }

      // Show root-level clips: no parentCompositionId, OR parent is a "phantom wrapper"
      const clipCompositionIds = new Set(data.clips.map((c) => c.compositionId).filter(Boolean));
      const filtered = data.clips.filter(
        (clip) => !clip.parentCompositionId || !clipCompositionIds.has(clip.parentCompositionId),
      );
      const els: TimelineElement[] = filtered.map((clip, index) => {
        let hostEl: Element | null = null;
        const id = clip.id || clip.label || clip.tagName || "element";
        const entry: TimelineElement = {
          id,
          tag: clip.tagName || clip.kind,
          start: clip.start,
          duration: clip.duration,
          track: clip.track,
        };
        try {
          const iframeDoc = iframeRef.current?.contentDocument;
          if (iframeDoc && entry.id) {
            hostEl = findTimelineDomNode(iframeDoc, entry.id);
          }
        } catch {
          /* cross-origin */
        }
        if (hostEl) {
          const iframeDoc = iframeRef.current?.contentDocument;
          entry.domId = hostEl.id || undefined;
          entry.selector = getTimelineElementSelector(hostEl);
          entry.selectorIndex =
            iframeDoc && entry.selector
              ? getTimelineElementSelectorIndex(iframeDoc, hostEl, entry.selector)
              : undefined;
          entry.sourceFile = getTimelineElementSourceFile(hostEl);
          applyMediaMetadataFromElement(entry, hostEl);
        }
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
                iframeDoc?.querySelector(`[data-composition-id="${clip.compositionId}"]`) ?? hostEl;
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
          if (hostEl) {
            const iframeDoc = iframeRef.current?.contentDocument;
            entry.domId = hostEl.id || undefined;
            entry.selector = getTimelineElementSelector(hostEl);
            entry.selectorIndex =
              iframeDoc && entry.selector
                ? getTimelineElementSelectorIndex(iframeDoc, hostEl, entry.selector)
                : undefined;
            entry.sourceFile = getTimelineElementSourceFile(hostEl);
          }
        }
        entry.key = buildTimelineElementKey({
          id,
          fallbackIndex: index,
          domId: entry.domId,
          selector: entry.selector,
          selectorIndex: entry.selectorIndex,
          sourceFile: entry.sourceFile,
        });
        return entry;
      });
      const rawDuration = data.durationInFrames / 30;
      // Clamp non-finite or absurdly large durations — the runtime can emit
      // Infinity when it detects a loop-inflated GSAP timeline without an
      // explicit data-duration on the root composition.
      const newDuration = Number.isFinite(rawDuration) && rawDuration < 7200 ? rawDuration : 0;
      const effectiveDuration = newDuration > 0 ? newDuration : usePlayerStore.getState().duration;
      const clampedEls =
        effectiveDuration > 0
          ? els
              .filter((element) => element.start < effectiveDuration)
              .map((element) => ({
                ...element,
                duration: Math.min(element.duration, effectiveDuration - element.start),
              }))
              .filter((element) => element.duration > 0)
          : els;
      if (clampedEls.length > 0) {
        syncTimelineElements(clampedEls, newDuration > 0 ? newDuration : undefined);
      }
    },
    [syncTimelineElements],
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
        const rootDuration = usePlayerStore.getState().duration;
        if (Number.isFinite(rootDuration) && rootDuration > 0) {
          if (start >= rootDuration) return;
          dur = Math.min(dur, Math.max(0, rootDuration - start));
          if (dur <= 0) return;
        }

        const trackStr = el.getAttribute("data-track-index");
        const track = trackStr != null ? parseInt(trackStr, 10) : 0;
        const compSrc =
          el.getAttribute("data-composition-src") || el.getAttribute("data-composition-file");
        const selector = getTimelineElementSelector(el);
        const sourceFile = getTimelineElementSourceFile(el);
        const selectorIndex = getTimelineElementSelectorIndex(doc, el, selector);
        const id = el.id || compId;
        const entry: TimelineElement = {
          id,
          key: buildTimelineElementKey({
            id,
            fallbackIndex: missing.length,
            domId: el.id || undefined,
            selector,
            selectorIndex,
            sourceFile,
          }),
          tag: el.tagName.toLowerCase(),
          start,
          duration: dur,
          track: isNaN(track) ? 0 : track,
          domId: el.id || undefined,
          selector,
          selectorIndex,
          sourceFile,
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
        syncTimelineElements([...updatedEls, ...dedupedMissing]);
      }
    } catch (err) {
      console.warn("[useTimelinePlayer] enrichMissingCompositions failed", err);
    }
  }, [syncTimelineElements]);

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
          const iframe = iframeRef.current;
          const doc = iframe?.contentDocument;
          const iframeWin = iframe?.contentWindow as IframeWindow | null;
          if (doc && iframeWin) {
            normalizePreviewViewport(doc, iframeWin);
            autoHealMissingCompositionIds(doc);
            attachIframeShortcutListeners();
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
              syncTimelineElements(els);
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
              const fallbackElement = buildStandaloneRootTimelineElement({
                compositionId: rootComp.getAttribute("data-composition-id") || "composition",
                tagName: (rootComp as HTMLElement).tagName || "div",
                rootDuration,
                iframeSrc: iframe?.src || "",
                selector: getTimelineElementSelector(rootComp),
              });
              if (fallbackElement) {
                // Always show the root composition as a single clip — guarantees
                // the timeline is never empty when a valid composition is loaded.
                syncTimelineElements([fallbackElement]);
              }
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
    syncTimelineElements,
    attachIframeShortcutListeners,
  ]);

  /** Save the current playback time so the next onIframeLoad restores it. */
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
  const processTimelineMessageRef = useRef(processTimelineMessage);
  processTimelineMessageRef.current = processTimelineMessage;
  const enrichMissingCompositionsRef = useRef(enrichMissingCompositions);
  enrichMissingCompositionsRef.current = enrichMissingCompositions;

  useMountEffect(() => {
    const handleWindowKeyDown = (e: KeyboardEvent) => playbackKeyDownRef.current(e);
    const handleWindowKeyUp = (e: KeyboardEvent) => playbackKeyUpRef.current(e);

    // Listen for timeline messages from the iframe runtime.
    // The runtime sends this AFTER all external compositions load,
    // so we get the complete clip list (not just the first few).
    const handleMessage = (e: MessageEvent) => {
      const data = e.data;
      // Only process messages from the main preview iframe — ignore MediaPanel/ClipThumbnail iframes
      const ourIframe = iframeRef.current;
      if (e.source && ourIframe && e.source !== ourIframe.contentWindow) {
        return;
      }
      // Also handle the runtime's state message which includes timeline data
      if (data?.source === "hf-preview" && data?.type === "state") {
        // State message means the runtime is alive — check for elements
        try {
          if (usePlayerStore.getState().elements.length === 0) {
            const iframeWin = ourIframe?.contentWindow as IframeWindow | null;
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
        if (data.durationInFrames > 0 && Number.isFinite(data.durationInFrames)) {
          const fps = 30;
          const dur = data.durationInFrames / fps;
          if (dur > 0 && dur < 7200) {
            usePlayerStore.getState().setDuration(dur);
          }
        }
        // If manifest produced 0 elements after filtering, try DOM fallback
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
      if (probeIntervalRef.current) clearInterval(probeIntervalRef.current);
      // Don't reset() on cleanup — preserve timeline elements across iframe refreshes
      // to prevent blink. New data will replace old when the iframe reloads.
    };
  });

  /** Reset the player store (elements, duration, etc.) — call when switching sessions. */
  const resetPlayer = useCallback(() => {
    stopRAFLoop();
    stopReverseLoop();
    if (probeIntervalRef.current) clearInterval(probeIntervalRef.current);
    usePlayerStore.getState().reset();
  }, [stopRAFLoop, stopReverseLoop]);

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
