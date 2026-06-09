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
import {
  getTimelineElementSelector,
  getTimelineElementSourceFile,
  getTimelineElementSelectorIndex,
  getTimelineElementDisplayLabel,
  buildTimelineElementIdentity,
} from "./timelineElementHelpers";

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
  iframe.contentWindow?.postMessage(
    { source: "hf-parent", type: "control", action, ...payload },
    "*",
  );
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
  } catch (err) {
    console.warn("[useTimelinePlayer] Failed to set preview media mute state", err);
  }
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
  } catch (err) {
    console.warn("[useTimelinePlayer] Failed to set preview playback rate", err);
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

// ---------------------------------------------------------------------------
// Enrich missing compositions from DOM
// ---------------------------------------------------------------------------

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
        doc.getElementById(startAttr) || doc.querySelector(`[data-composition-id="${startAttr}"]`);
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
                  iframeWin.__timelines?.[rrCompId] as { duration?: () => number } | undefined
                )?.duration?.() ?? 0)
              : 0);
          refStart = rrStart + rrDur;
        }
        const refCompId = ref.getAttribute("data-composition-id");
        const refDur =
          parseFloat(ref.getAttribute("data-duration") ?? "") ||
          (refCompId
            ? ((
                iframeWin.__timelines?.[refCompId] as { duration?: () => number } | undefined
              )?.duration?.() ?? 0)
            : 0);
        start = refStart + refDur;
      } else {
        start = 0;
      }
    }

    // Resolve duration from data-duration or GSAP timeline
    let dur = parseFloat(el.getAttribute("data-duration") ?? "");
    if (isNaN(dur) || dur <= 0) {
      dur =
        (
          iframeWin.__timelines?.[compId] as { duration?: () => number } | undefined
        )?.duration?.() ?? 0;
    }
    if (!Number.isFinite(dur) || dur <= 0) return;
    if (!Number.isFinite(start)) start = 0;
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
    const label = getTimelineElementDisplayLabel({
      id: el.id || compId || null,
      label: el.getAttribute("data-timeline-label") ?? el.getAttribute("data-label"),
      tag: el.tagName,
    });
    const identity = buildTimelineElementIdentity({
      preferredId: el.id || compId || null,
      label,
      fallbackIndex: missing.length,
      domId: el.id || undefined,
      selector,
      selectorIndex,
      sourceFile,
    });
    const entry: TimelineElement = {
      id: identity.id,
      label,
      key: identity.key,
      tag: el.tagName.toLowerCase(),
      start,
      duration: dur,
      track: isNaN(track) ? 0 : track,
      domId: el.id || undefined,
      hfId: el.getAttribute("data-hf-id") || undefined,
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
  const updatedEls = (currentEls as TimelineElement[]).map((existing) => {
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

  return { missing, updatedEls, patched };
}
