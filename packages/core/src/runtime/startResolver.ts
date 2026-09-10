import type { RuntimeTimelineLike } from "./types";
import { swallow } from "./diagnostics";
import { resolveAuthoredTimingWindow } from "./authoredTiming";
// Straight from playbackRate, not through media.ts's re-export: media.ts
// imports mediaVolumeEnvelope, which needs this resolver, and the round trip
// would be an import cycle.
import {
  parseStrictFiniteTimingNumber,
  readElementPlaybackRate,
  readMediaStart,
} from "./playbackRate";
import { isMediaElement } from "./domRealm";
import { parseStartExpression } from "./startExpression";
import { MEDIA_START_BASIS_ATTR, resolveAbsoluteMediaStartSeconds } from "../mediaTiming";

export function createRuntimeStartTimeResolver(params: {
  timelineRegistry?: Record<string, RuntimeTimelineLike | undefined>;
  includeAuthoredTimingAttrs?: boolean;
  /**
   * The document that reference lookups (`data-start="intro + 2"`) resolve
   * against. Defaults to the global `document` — the runtime bundle's own
   * realm. Hosts driving a composition in an IFRAME must pass that iframe's
   * document, or every reference silently resolves against the host page.
   */
  documentRef?: Document;
}): {
  resolveStartForElement: (element: Element, fallback?: number) => number;
  resolveDurationForElement: (element: Element) => number | null;
  resolveMediaStartForElement: (element: Element) => number;
} {
  const timelineRegistry = params.timelineRegistry ?? {};
  const includeAuthoredTimingAttrs = params.includeAuthoredTimingAttrs ?? false;
  const doc = params.documentRef ?? document;
  const startCache = new WeakMap<Element, number | null>();
  const durationCache = new WeakMap<Element, number | null>();
  const visiting = new Set<Element>();

  const findReferenceTarget = (refId: string): Element | null => {
    const byId = doc.getElementById(refId);
    if (byId) return byId;
    return (
      (doc.querySelector(`[data-composition-id="${CSS.escape(refId)}"]`) as Element | null) ?? null
    );
  };

  const resolveDurationForElement = (element: Element): number | null => {
    const cached = durationCache.get(element);
    if (cached !== undefined) return cached;
    let resolved: number | null = null;
    const durationTiming = resolveAuthoredTimingWindow({
      start: 0,
      duration: element.getAttribute("data-duration"),
      authoredDuration: includeAuthoredTimingAttrs
        ? element.getAttribute("data-hf-authored-duration")
        : null,
    });
    if (durationTiming?.duration != null && durationTiming.duration > 0) {
      resolved = durationTiming.duration;
    }
    if (resolved == null || resolved <= 0) {
      const start = resolveStartForElementInternal(element, 0);
      const endTiming = resolveAuthoredTimingWindow({
        start,
        end: element.getAttribute("data-end"),
        authoredEnd: includeAuthoredTimingAttrs
          ? element.getAttribute("data-hf-authored-end")
          : null,
      });
      if (endTiming?.duration != null && endTiming.duration > 0) {
        resolved = endTiming.duration;
      }
    }
    if ((resolved == null || resolved <= 0) && isMediaElement(element)) {
      const playbackStart = readMediaStart(element);
      if (Number.isFinite(element.duration) && element.duration > playbackStart) {
        resolved = (element.duration - playbackStart) / readElementPlaybackRate(element);
      }
    }
    if (resolved == null || resolved <= 0) {
      const compositionId = element.getAttribute("data-composition-id");
      if (compositionId) {
        const timeline = timelineRegistry[compositionId] ?? null;
        if (timeline && typeof timeline.duration === "function") {
          try {
            const timelineDuration = Number(timeline.duration());
            if (Number.isFinite(timelineDuration) && timelineDuration > 0) {
              resolved = timelineDuration;
            }
          } catch (err) {
            // ignore broken timeline impls
            swallow("runtime.startResolver.site1", err);
          }
        }
      }
    }
    if (resolved != null && Number.isFinite(resolved) && resolved > 0) {
      durationCache.set(element, resolved);
      return resolved;
    }
    durationCache.set(element, null);
    return null;
  };

  const resolveHostOffsetForElement = (element: Element, fallback: number): number => {
    if (element.hasAttribute("data-composition-id")) {
      const parentComposition = element.parentElement?.closest("[data-composition-id]");
      if (!parentComposition) return 0;
      return resolveStartForElementInternal(parentComposition, fallback);
    }
    const compositionRoot = element.closest("[data-composition-id]");
    if (!compositionRoot) return 0;
    return resolveStartForElementInternal(compositionRoot, fallback);
  };

  const resolveStartForElementInternal = (element: Element, fallback: number): number => {
    const cached = startCache.get(element);
    if (cached !== undefined) {
      return cached == null ? fallback : cached;
    }
    if (visiting.has(element)) {
      return fallback;
    }
    visiting.add(element);
    try {
      const expression = parseStartExpression(element.getAttribute("data-start"));
      if (!expression) {
        // If this element is a loaded composition inner root (has data-composition-id
        // but no data-start), walk up to the host parent which carries the actual
        // timing. This happens when the host uses a different data-composition-id
        // than the loaded file — e.g. host="montage" but file has "scene-10", or
        // when the host itself has no data-composition-id at all (an "anonymous"
        // host) and the composition's own id was restored onto the inlined wrapper.
        // Check data-composition-src (runtime, not yet inlined), data-composition-id
        // (bundled/compiled host with its own id), and data-composition-file (the
        // marker every inlined host gets, compiled or bundled, once
        // data-composition-src is stripped — covers the anonymous-host case).
        if (element.hasAttribute("data-composition-id")) {
          const parent = element.parentElement;
          if (
            parent &&
            (parent.hasAttribute("data-composition-src") ||
              parent.hasAttribute("data-composition-id") ||
              parent.hasAttribute("data-composition-file"))
          ) {
            const parentStart = resolveStartForElementInternal(parent, fallback);
            startCache.set(element, parentStart);
            return parentStart;
          }
        }
        startCache.set(element, fallback);
        return fallback;
      }
      if (expression.kind === "absolute") {
        const absolute = Math.max(0, expression.value);
        const resolved = Math.max(0, resolveHostOffsetForElement(element, fallback) + absolute);
        startCache.set(element, resolved);
        return resolved;
      }
      const target = findReferenceTarget(expression.refId);
      if (!target) {
        startCache.set(element, fallback);
        return fallback;
      }
      const targetStart = resolveStartForElementInternal(target, 0);
      const targetDuration = resolveDurationForElement(target);
      if (targetDuration == null || targetDuration <= 0) {
        const unresolved = Math.max(0, targetStart + expression.offset);
        startCache.set(element, unresolved);
        return unresolved;
      }
      const resolved = Math.max(0, targetStart + targetDuration + expression.offset);
      startCache.set(element, resolved);
      return resolved;
    } finally {
      visiting.delete(element);
    }
  };

  /**
   * The ONE owner of "when does this media element start on the root timeline".
   *
   * A media element is not a plain timed clip: `data-hf-media-start-basis`
   * decides whether its `data-start` is composition-local (the default, so the
   * host offset is added) or a legacy root-global timestamp (already absolute,
   * so adding the host offset double-counts it). Anything that derives a media
   * start from attributes — the clip manifest, the visibility pass, the media
   * cache, WebAudio scheduling — must come through here, or the timeline the
   * editor draws stops matching the timeline that plays.
   */
  const resolveMediaStartForElement = (element: Element): number => {
    const compositionRoot = element.closest("[data-composition-id]");
    const hostStart = compositionRoot ? resolveStartForElementInternal(compositionRoot, 0) : 0;
    const authoredStart = parseStrictFiniteTimingNumber(element.getAttribute("data-start"));
    // No literal start (absent, or a `data-start="intro + 2"` reference), an
    // auto-injected start, or a host at t=0 — nothing for the basis to
    // disambiguate, so the ordinary start resolution is already correct.
    if (element.hasAttribute("data-hf-auto-start") || authoredStart == null || hostStart <= 0) {
      return resolveStartForElementInternal(element, hostStart);
    }
    return resolveAbsoluteMediaStartSeconds({
      authoredStart,
      hostStart,
      basis: element.getAttribute(MEDIA_START_BASIS_ATTR),
    });
  };

  return {
    resolveStartForElement: (element: Element, fallback = 0) =>
      resolveStartForElementInternal(element, Math.max(0, fallback)),
    resolveDurationForElement: (element: Element) => resolveDurationForElement(element),
    resolveMediaStartForElement,
  };
}

export type { RuntimeTimelineLike } from "./types";
