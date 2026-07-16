/**
 * Runtime iframe integration utilities.
 *
 * Handles the boundary between the studio host page and the preview iframe:
 * - Viewport normalisation on load
 * - Auto-healing missing data-composition-id attributes
 * - Unmuting media via postMessage
 * - Resolving the underlying <iframe> from any wrapper element
 * - Scanning the DOM for composition hosts the manifest missed
 *   (element-reference starts that the CDN runtime fails to resolve)
 */

import type { TimelineElement } from "../store/playerStore";
import type { IframeWindow } from "./playbackTypes";
import { readClipTiming } from "@hyperframes/core/composition-contract";
import {
  getTimelineElementSelector,
  getTimelineElementSourceFile,
  getTimelineElementSelectorIndex,
  getTimelineElementDisplayLabel,
  buildTimelineElementIdentity,
  readTimelineElementZIndex,
} from "./timelineElementHelpers";
import { postRuntimeControlMessage } from "./runtimeProtocol";

// ---------------------------------------------------------------------------
// Viewport / DOM normalisation
// ---------------------------------------------------------------------------

export function normalizePreviewViewport(doc: Document, win: Window): void {
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

// Legacy recovery retained until versioned composition manifests complete
// their compatibility soak across published CDN runtimes.
// fallow-ignore-next-line complexity
export function autoHealMissingCompositionIds(doc: Document): void {
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

// ---------------------------------------------------------------------------
// Audio / iframe resolution
// ---------------------------------------------------------------------------

type PreviewPlayerHost = HTMLElement & {
  muted?: boolean;
  playbackRate?: number;
};

function isPreviewPlayerHost(value: unknown): value is PreviewPlayerHost {
  return value instanceof HTMLElement;
}

function resolvePreviewPlayerHost(iframe: HTMLIFrameElement): PreviewPlayerHost | null {
  const root = iframe.getRootNode();
  if (
    typeof ShadowRoot !== "undefined" &&
    root instanceof ShadowRoot &&
    isPreviewPlayerHost(root.host)
  ) {
    return root.host;
  }
  return null;
}

function postPreviewControl(
  iframe: HTMLIFrameElement,
  action: string,
  payload: Record<string, unknown>,
): void {
  postRuntimeControlMessage(iframe.contentWindow, action, payload);
}

export function shouldMutePreviewAudio(audioMuted: boolean, playbackRate: number): boolean {
  return audioMuted || playbackRate > 1;
}

export function setPreviewMediaMuted(iframe: HTMLIFrameElement | null, muted: boolean): void {
  if (!iframe) return;
  try {
    const host = resolvePreviewPlayerHost(iframe);
    if (host && typeof host.muted === "boolean") {
      host.muted = muted;
      return;
    }
    postPreviewControl(iframe, "set-muted", { muted });
  } catch {}
}

export function setPreviewPlaybackRate(
  iframe: HTMLIFrameElement | null,
  playbackRate: number,
): void {
  if (!iframe) return;
  const rate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
  try {
    const host = resolvePreviewPlayerHost(iframe);
    if (host && typeof host.playbackRate === "number") {
      host.playbackRate = rate;
      return;
    }
    postPreviewControl(iframe, "set-playback-rate", { playbackRate: rate });
  } catch {}
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

// ---------------------------------------------------------------------------
// Audio scrubbing
// ---------------------------------------------------------------------------
// Plays a brief slice of the music track while the user drags the playhead,
// like an NLE scrub. Repeated calls keep playback alive; it auto-pauses shortly
// after scrubbing stops and restores the element's prior muted state.

const SCRUB_VOLUME = 0.25;

let scrubAudioEl: HTMLAudioElement | null = null;
let scrubStopTimer: ReturnType<typeof setTimeout> | null = null;
let scrubPrevMuted: boolean | null = null;
let scrubPrevVolume: number | null = null;

// Resolve the SAME element the store identified as music: prefer its id, then
// the role attribute, and only fall back to the first <audio> (which could be a
// voiceover, so the id hint matters).
function resolveScrubAudioEl(doc: Document, musicId?: string | null): HTMLAudioElement | null {
  if (musicId) {
    const byId = doc.getElementById(musicId);
    if (byId instanceof HTMLAudioElement) return byId;
  }
  return (
    doc.querySelector<HTMLAudioElement>("audio[data-timeline-role='music']") ??
    doc.querySelector<HTMLAudioElement>("audio")
  );
}

function applyScrub(el: HTMLAudioElement, audioFileTime: number): void {
  if (scrubAudioEl && scrubAudioEl !== el) stopScrubPreviewAudio();
  if (scrubPrevMuted === null) scrubPrevMuted = el.muted;
  if (scrubPrevVolume === null) scrubPrevVolume = el.volume;
  scrubAudioEl = el;
  try {
    el.muted = false;
    el.volume = SCRUB_VOLUME;
    if (Math.abs(el.currentTime - audioFileTime) > 0.04) el.currentTime = audioFileTime;
    if (el.paused) void el.play().catch(() => {});
  } catch {
    /* element not ready */
  }
  if (scrubStopTimer) clearTimeout(scrubStopTimer);
  scrubStopTimer = setTimeout(stopScrubPreviewAudio, 140);
}

/**
 * Scrub the preview music audio to `audioFileTime` (seconds into the source
 * file). Pass `null` to stop. Safe to call rapidly during a playhead drag.
 */
export function scrubPreviewAudio(
  iframe: HTMLIFrameElement | null,
  audioFileTime: number | null,
  musicId?: string | null,
): void {
  if (!iframe) return;
  if (audioFileTime === null) {
    stopScrubPreviewAudio();
    return;
  }
  let doc: Document | null = null;
  try {
    doc = iframe.contentDocument;
  } catch {
    return;
  }
  if (!doc) return;
  const el = resolveScrubAudioEl(doc, musicId);
  if (el) applyScrub(el, audioFileTime);
}

export function stopScrubPreviewAudio(): void {
  if (scrubStopTimer) {
    clearTimeout(scrubStopTimer);
    scrubStopTimer = null;
  }
  const el = scrubAudioEl;
  scrubAudioEl = null;
  if (!el) return;
  try {
    el.pause();
    if (scrubPrevMuted !== null) el.muted = scrubPrevMuted;
    if (scrubPrevVolume !== null) el.volume = scrubPrevVolume;
  } catch {
    /* ignore */
  }
  scrubPrevMuted = null;
  scrubPrevVolume = null;
}

// ---------------------------------------------------------------------------
// Enrich missing compositions from DOM
// ---------------------------------------------------------------------------

function timelineDuration(iframeWin: IframeWindow, compositionId: string): number {
  return (
    (
      iframeWin.__timelines?.[compositionId] as { duration?: () => number } | undefined
    )?.duration?.() ?? 0
  );
}

function createTimedElementLookup(doc: Document): Map<string, Element> {
  const timedById = new Map<string, Element>();
  for (const timed of doc.querySelectorAll("[data-start]")) {
    for (const id of [
      timed.id,
      timed.getAttribute("data-hf-id"),
      timed.getAttribute("data-composition-id"),
    ]) {
      if (id) timedById.set(id, timed);
    }
  }
  return timedById;
}

function createReferenceEndResolver(
  timedById: ReadonlyMap<string, Element>,
  iframeWin: IframeWindow,
): (refId: string, visiting: ReadonlySet<string>) => number | null {
  const resolveEnd = (refId: string, visiting: ReadonlySet<string>): number | null => {
    if (visiting.has(refId)) return null;
    const referenced = timedById.get(refId);
    if (!referenced) return null;
    const next = new Set(visiting).add(refId);
    const timing = readClipTiming(referenced, {
      resolveReferenceEnd: (nestedId) => resolveEnd(nestedId, next),
    });
    if (timing.end != null) return timing.end;
    const compositionId = referenced.getAttribute("data-composition-id");
    const duration = compositionId ? timelineDuration(iframeWin, compositionId) : 0;
    return timing.start == null || duration <= 0 ? null : timing.start + duration;
  };
  return resolveEnd;
}

function clampCompositionWindow(
  start: number,
  duration: number,
  rootDuration: number,
): { start: number; duration: number } | null {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const safeStart = Number.isFinite(start) ? start : 0;
  if (!Number.isFinite(rootDuration) || rootDuration <= 0) {
    return { start: safeStart, duration };
  }
  if (safeStart >= rootDuration) return null;
  const clamped = Math.min(duration, Math.max(0, rootDuration - safeStart));
  return clamped > 0 ? { start: safeStart, duration: clamped } : null;
}

function nonEmpty(value: string, fallback: string): string {
  return value || fallback;
}

function optionalNonEmpty(value: string | null): string | undefined {
  return value || undefined;
}

function attachCompositionSource(
  entry: TimelineElement,
  element: HTMLElement,
  compositionSrc: string | null,
): TimelineElement {
  if (compositionSrc) return { ...entry, compositionSrc };
  const innerVideo = element.querySelector("video[src]");
  if (!innerVideo) return entry;
  return { ...entry, src: optionalNonEmpty(innerVideo.getAttribute("src")), tag: "video" };
}

function buildMissingCompositionEntry(params: {
  doc: Document;
  iframeWin: IframeWindow;
  element: HTMLElement;
  compositionId: string;
  rootDuration: number;
  fallbackIndex: number;
  resolveEnd: (refId: string, visiting: ReadonlySet<string>) => number | null;
}): TimelineElement | null {
  const { doc, iframeWin, element, compositionId, rootDuration, fallbackIndex, resolveEnd } =
    params;
  const timing = readClipTiming(element, {
    resolveReferenceEnd: (refId) => resolveEnd(refId, new Set([compositionId])),
  });
  const window = clampCompositionWindow(
    timing.start ?? 0,
    timing.duration ?? timelineDuration(iframeWin, compositionId),
    rootDuration,
  );
  if (!window) return null;

  const preferredId = nonEmpty(element.id, compositionId);
  const compositionSrc =
    element.getAttribute("data-composition-src") ?? element.getAttribute("data-composition-file");
  const selector = getTimelineElementSelector(element);
  const sourceFile = getTimelineElementSourceFile(element);
  const selectorIndex = getTimelineElementSelectorIndex(doc, element, selector);
  const label = getTimelineElementDisplayLabel({
    id: preferredId,
    label: element.getAttribute("data-timeline-label") ?? element.getAttribute("data-label"),
    tag: element.tagName,
  });
  const identity = buildTimelineElementIdentity({
    preferredId,
    label,
    fallbackIndex,
    domId: optionalNonEmpty(element.id),
    selector,
    selectorIndex,
    sourceFile,
  });
  const entry: TimelineElement = {
    id: identity.id,
    label,
    key: identity.key,
    tag: element.tagName.toLowerCase(),
    start: window.start,
    duration: window.duration,
    track: timing.trackIndex,
    domId: optionalNonEmpty(element.id),
    hfId: optionalNonEmpty(element.getAttribute("data-hf-id")),
    selector,
    selectorIndex,
    sourceFile,
    zIndex: readTimelineElementZIndex(element),
  };
  return attachCompositionSource(entry, element, compositionSrc);
}

/**
 * Scan the iframe DOM for composition hosts missing from the current
 * timeline elements and add them.  The CDN runtime often fails to resolve
 * element-reference starts (`data-start="intro"`) so composition hosts
 * are silently dropped from `__clipManifest`.  This pass reads the DOM +
 * GSAP timeline registry directly to fill the gaps.
 */
export function buildMissingCompositionElements(
  doc: Document,
  iframeWin: IframeWindow,
  currentEls: readonly TimelineElement[],
  rootDuration: number,
): { missing: TimelineElement[]; updatedEls: TimelineElement[]; patched: boolean } {
  const existingIds = new Set(currentEls.map((e) => e.id));
  const rootComp = doc.querySelector("[data-composition-id]");
  const rootCompId = rootComp?.getAttribute("data-composition-id");
  // Use [data-composition-id][data-start] — the composition loader strips
  // data-composition-src after loading, so we can't rely on it.
  const hosts = doc.querySelectorAll("[data-composition-id][data-start]");
  const missing: TimelineElement[] = [];

  const resolveEnd = createReferenceEndResolver(createTimedElementLookup(doc), iframeWin);

  for (const host of hosts) {
    const el = host as HTMLElement;
    const compId = el.getAttribute("data-composition-id");
    if (!compId || compId === rootCompId) continue;
    if (existingIds.has(el.id) || existingIds.has(compId)) continue;
    const entry = buildMissingCompositionEntry({
      doc,
      iframeWin,
      element: el,
      compositionId: compId,
      rootDuration,
      fallbackIndex: missing.length,
      resolveEnd,
    });
    if (entry) missing.push(entry);
  }

  // Patch existing elements that are missing compositionSrc
  let patched = false;
  const updatedEls = (currentEls as TimelineElement[]).map((existing) => {
    if (existing.compositionSrc) return existing;
    // Find the matching DOM host by element id or composition id
    const host =
      doc.getElementById(existing.id) ??
      doc.querySelector(`[data-composition-id="${CSS.escape(existing.id)}"]`);
    if (!host) return existing;
    const compSrc =
      host.getAttribute("data-composition-src") || host.getAttribute("data-composition-file");
    if (compSrc) {
      patched = true;
      return { ...existing, compositionSrc: compSrc };
    }
    return existing;
  });

  return { missing, updatedEls, patched };
}
