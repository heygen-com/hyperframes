/**
 * Higher-level timeline DOM operations: element factories, DOM-to-element
 * parsing, timeline merging, and standalone composition helpers.
 *
 * Preview iframe utilities (normaliseViewport, autoHeal, audio controls, resolveIframe,
 * buildMissingCompositionElements) live in timelineIframeHelpers.ts.
 *
 * Pure functions (no React, no store reads) — testable in isolation.
 */

import type { TimelineElement } from "../store/playerStore";
import type { ClipManifestClip } from "./playbackTypes";
import { resolveCssStackingContextId } from "@hyperframes/core/runtime/stacking-context";
import {
  resolveMediaElement,
  applyMediaMetadataFromElement,
  getTimelineElementDisplayLabel,
  getImplicitTimelineLayerLabel,
  isImplicitTimelineLayerCandidate,
  getTimelineElementSelector,
  getTimelineElementSourceFile,
  getTimelineElementSelectorIndex,
  buildTimelineElementKey,
  buildTimelineElementIdentity,
  getTimelineElementIdentity,
  isTimelineIgnoredElement,
  readTimelineElementZIndex,
} from "./timelineElementHelpers";

// Re-export helpers that were previously public from this module so that
// existing import sites (hook + tests) don't need to change.
// fallow-ignore-next-line unused-exports
export {
  readTimelineDurationFromDocument,
  // fallow-ignore-next-line unused-exports
  resolveMediaElement,
  // fallow-ignore-next-line unused-exports
  applyMediaMetadataFromElement,
  getTimelineElementSelector,
  // fallow-ignore-next-line unused-exports
  getTimelineElementSourceFile,
  // fallow-ignore-next-line unused-exports
  getTimelineElementSelectorIndex,
  // fallow-ignore-next-line unused-exports
  buildTimelineElementIdentity,
  // fallow-ignore-next-line unused-exports
  getTimelineElementIdentity,
  findTimelineDomNodeForClip,
} from "./timelineElementHelpers";

// Re-export iframe helpers so the hook can keep a single import source.
export {
  normalizePreviewViewport,
  autoHealMissingCompositionIds,
  setPreviewMediaMuted,
  setPreviewPlaybackRate,
  shouldMutePreviewAudio,
  resolveIframe,
  buildMissingCompositionElements,
} from "./timelineIframeHelpers";

// ---------------------------------------------------------------------------
// TimelineElement factories
// ---------------------------------------------------------------------------

function resolveClipTag(clip: ClipManifestClip): string {
  return clip.tagName || clip.kind || "div";
}

// fallow-ignore-next-line complexity
export function createTimelineElementFromManifestClip(params: {
  clip: ClipManifestClip;
  fallbackIndex: number;
  doc?: Document | null;
  hostEl?: Element | null;
}): TimelineElement {
  const { clip, fallbackIndex, doc } = params;
  let hostEl = params.hostEl ?? null;
  const label = getTimelineElementDisplayLabel({
    id: clip.id,
    label: clip.label,
    tag: resolveClipTag(clip),
  });

  let domId: string | undefined;
  let selector: string | undefined;
  let selectorIndex: number | undefined;
  let sourceFile: string | undefined;

  let hfId: string | undefined;
  if (hostEl) {
    domId = hostEl.id || undefined;
    hfId = hostEl.getAttribute("data-hf-id") || undefined;
    selector = getTimelineElementSelector(hostEl);
    selectorIndex =
      doc && selector ? getTimelineElementSelectorIndex(doc, hostEl, selector) : undefined;
    sourceFile = getTimelineElementSourceFile(hostEl);
  }

  const identity = buildTimelineElementIdentity({
    preferredId: clip.id,
    label,
    fallbackIndex,
    domId,
    selector,
    selectorIndex,
    sourceFile,
  });
  const entry: TimelineElement = {
    id: identity.id,
    label,
    key: identity.key,
    tag: resolveClipTag(clip),
    start: clip.start,
    duration: clip.duration,
    track: clip.track,
    // clip.track IS the authored data-track-index verbatim (the runtime honors
    // it; see parseAuthoredTrack in core/runtime/timeline.ts). Record it at this
    // translation boundary so later display-lane remaps (normalizeToZones,
    // expanded-child rows) can persist in AUTHORED space instead of
    // reconstructing it from lane occupants.
    authoredTrack: clip.track,
    // Runtime-computed stacking context — authoritative; helpers read it, never
    // re-derive it.
    stackingContextId: clip.stackingContextId ?? null,
    domId,
    hfId,
    selector,
    selectorIndex,
    sourceFile,
  };

  if (hostEl) {
    applyMediaMetadataFromElement(entry, hostEl);
    if (hostEl.hasAttribute("data-hidden")) entry.hidden = true;
    const timelineRole = hostEl.getAttribute("data-timeline-role");
    if (timelineRole) entry.timelineRole = timelineRole;
    entry.zIndex = readTimelineElementZIndex(hostEl);
  }
  if (clip.assetUrl) entry.src = clip.assetUrl;
  if (clip.kind === "composition" && clip.compositionId) {
    let resolvedSrc = clip.compositionSrc;
    if (!resolvedSrc) {
      hostEl =
        doc?.querySelector(`[data-composition-id="${CSS.escape(clip.compositionId)}"]`) ?? hostEl;
      resolvedSrc =
        hostEl?.getAttribute("data-composition-src") ??
        hostEl?.getAttribute("data-composition-file") ??
        null;
    }
    if (resolvedSrc) {
      entry.compositionSrc = resolvedSrc;
    } else if (hostEl) {
      const innerVideo = hostEl.querySelector("video[src]");
      if (innerVideo) {
        entry.src = innerVideo.getAttribute("src") || undefined;
        entry.tag = "video";
      }
    }
    if (hostEl) {
      entry.domId = hostEl.id || undefined;
      entry.hfId = hostEl.getAttribute("data-hf-id") || undefined;
      entry.selector = getTimelineElementSelector(hostEl);
      entry.selectorIndex =
        doc && entry.selector
          ? getTimelineElementSelectorIndex(doc, hostEl, entry.selector)
          : undefined;
      entry.sourceFile = getTimelineElementSourceFile(hostEl);
      const nextIdentity = buildTimelineElementIdentity({
        preferredId: clip.id,
        label,
        fallbackIndex,
        domId: entry.domId,
        selector: entry.selector,
        selectorIndex: entry.selectorIndex,
        sourceFile: entry.sourceFile,
      });
      entry.id = nextIdentity.id;
      entry.key = nextIdentity.key;
    }
  }

  return entry;
}

export function createImplicitTimelineLayersFromDOM(
  doc: Document,
  rootDuration: number,
  existingElements: readonly TimelineElement[] = [],
): TimelineElement[] {
  if (!Number.isFinite(rootDuration) || rootDuration <= 0) return [];
  const rootComp = doc.querySelector("[data-composition-id]");
  if (!rootComp) return [];

  const existingKeys = new Set(existingElements.map(getTimelineElementIdentity));
  const maxTrack = existingElements.reduce(
    (max, element) => Math.max(max, Number.isFinite(element.track) ? element.track : 0),
    -1,
  );
  const layers: TimelineElement[] = [];

  for (const child of Array.from(rootComp.children)) {
    if (!isImplicitTimelineLayerCandidate(rootComp, child)) continue;

    const selector = getTimelineElementSelector(child);
    if (!selector) continue;
    const selectorIndex = getTimelineElementSelectorIndex(doc, child, selector);
    const sourceFile = getTimelineElementSourceFile(child);
    const label = getImplicitTimelineLayerLabel(child);
    const identity = buildTimelineElementIdentity({
      preferredId: child.id || null,
      label,
      fallbackIndex: existingElements.length + layers.length,
      domId: child.id || undefined,
      selector,
      selectorIndex,
      sourceFile,
    });
    if (existingKeys.has(identity.key) || existingKeys.has(identity.id)) continue;

    layers.push({
      domId: child.id || undefined,
      hfId: child.getAttribute("data-hf-id") || undefined,
      zIndex: readTimelineElementZIndex(child),
      duration: rootDuration,
      id: identity.id,
      key: identity.key,
      label,
      selector,
      selectorIndex,
      sourceFile,
      stackingContextId: resolveCssStackingContextId(child),
      start: 0,
      tag: child.tagName.toLowerCase(),
      timingSource: "implicit",
      track: maxTrack + 1 + layers.length,
    });
  }

  return layers;
}

/**
 * Parse [data-start] elements from a Document into TimelineElement[].
 * Shared helper — used by onIframeLoad fallback, handleMessage, and enrichMissingCompositions.
 */
export function parseTimelineFromDOM(doc: Document, rootDuration: number): TimelineElement[] {
  const rootComp = doc.querySelector("[data-composition-id]");
  const nodes = doc.querySelectorAll("[data-start]");
  const els: TimelineElement[] = [];
  let trackCounter = 0;

  // fallow-ignore-next-line complexity
  nodes.forEach((node) => {
    if (node === rootComp) return;
    if (isTimelineIgnoredElement(node)) return;
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
    // fallow-ignore-next-line code-duplication
    const compId = el.getAttribute("data-composition-id");
    const selector = getTimelineElementSelector(el);
    const sourceFile = getTimelineElementSourceFile(el);
    const selectorIndex = getTimelineElementSelectorIndex(doc, el, selector);
    const label = getTimelineElementDisplayLabel({
      id: el.id || compId || null,
      label: el.getAttribute("data-timeline-label") ?? el.getAttribute("data-label"),
      tag: tagLower,
    });
    const identity = buildTimelineElementIdentity({
      preferredId: el.id || compId || null,
      label,
      fallbackIndex: els.length,
      domId: el.id || undefined,
      selector,
      selectorIndex,
      sourceFile,
    });
    const entry: TimelineElement = {
      id: identity.id,
      label,
      key: identity.key,
      tag: tagLower,
      start,
      duration: dur,
      track: isNaN(track) ? 0 : track,
      domId: el.id || undefined,
      hfId: el.getAttribute("data-hf-id") || undefined,
      selector,
      selectorIndex,
      sourceFile,
      stackingContextId: resolveCssStackingContextId(el),
      timingSource: "authored",
      zIndex: readTimelineElementZIndex(el),
    };

    const mediaEl = resolveMediaElement(el);
    if (mediaEl) {
      if (mediaEl.tagName === "IMG") {
        entry.tag = "img";
      }
      const vol = el.getAttribute("data-volume") ?? mediaEl.getAttribute("data-volume");
      if (vol) entry.volume = parseFloat(vol);
      applyMediaMetadataFromElement(entry, el);
      // Override AFTER the helper (which sets the raw relative attribute) so the
      // resolved absolute URL wins — the Studio can then fetch the asset
      // regardless of whether the attribute value was relative or absolute.
      const resolvedSrc = (mediaEl as HTMLMediaElement | HTMLImageElement).src || undefined;
      if (resolvedSrc) entry.src = resolvedSrc;
    }

    if (el.hasAttribute("data-timeline-locked")) {
      entry.timelineLocked = true;
    }
    if (el.hasAttribute("data-hidden")) {
      entry.hidden = true;
    }

    const timelineRole = el.getAttribute("data-timeline-role");
    if (timelineRole) entry.timelineRole = timelineRole;

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

  return [...els, ...createImplicitTimelineLayersFromDOM(doc, rootDuration, els)];
}

// ---------------------------------------------------------------------------
// Merge helpers
// ---------------------------------------------------------------------------

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

  const nextIdentities = new Set(nextElements.map(getTimelineElementIdentity));
  const preserved = currentElements.filter(
    (element) =>
      !nextIdentities.has(getTimelineElementIdentity(element)) &&
      // Only preserve enriched sub-composition children (compositionSrc set),
      // which a bare DOM re-scan legitimately drops and enrichMissingCompositions
      // re-adds. A TOP-LEVEL element missing from the fresh scan was genuinely
      // removed (undo of a split, a delete), so let it go — otherwise undoing a
      // split leaves a ghost clip in the timeline even though the file is reverted.
      element.compositionSrc != null,
  );
  if (preserved.length === 0) return nextElements;
  return [...nextElements, ...preserved];
}

// ---------------------------------------------------------------------------
// Standalone composition helpers
// ---------------------------------------------------------------------------

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
    label: getTimelineElementDisplayLabel({
      id: params.compositionId,
      tag: params.tagName,
    }),
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
