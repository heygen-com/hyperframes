import type { RuntimeTimelineLike } from "./types";
import { swallow } from "./diagnostics";
import { resolveAuthoredTimingWindow } from "./authoredTiming";
// Straight from playbackRate, not through media.ts's re-export: media.ts
// imports mediaVolumeEnvelope, which needs this resolver, and the round trip
// would be an import cycle.
import {
  parseStrictFiniteTimingNumber,
  resolveNaturalMediaTimelineDuration,
  resolveTimedImageDurationSeconds,
} from "./playbackRate";
import { isMediaElement } from "./domRealm";
import { parseStartExpression } from "./startExpression";
import {
  compositionOriginSeconds,
  isRootGlobalMediaStart,
  MEDIA_START_BASIS_ATTR,
  resolveMediaStartSeconds,
  type MediaStartInput,
} from "../mediaTiming";

export function createRuntimeStartTimeResolver(params: {
  timelineRegistry?: Record<string, Pick<RuntimeTimelineLike, "duration"> | undefined>;
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
  resolveHostStartForElement: (element: Element) => number;
  isRootGlobalMediaStartForElement: (element: Element) => boolean;
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
      resolved = resolveNaturalMediaTimelineDuration(element, element.duration);
    }
    if (resolved == null || resolved <= 0) resolved = resolveTimedImageDurationSeconds(element);
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

  // A mounted composition root without its own `data-start` takes its timing from the host it was
  // loaded into: the host may use a different id than the file, or none (an anonymous host).
  const inheritedTimingHost = (element: Element): Element | null => {
    const parent = element.parentElement;
    if (!parent || !element.hasAttribute("data-composition-id")) return null;
    if (parseStartExpression(element.getAttribute("data-start"))) return null;
    return parent.hasAttribute("data-composition-src") ||
      parent.hasAttribute("data-composition-id") ||
      parent.hasAttribute("data-composition-file")
      ? parent
      : null;
  };

  const resolveCompositionOrigin = (compositionRoot: Element, fallback: number): number =>
    compositionOriginSeconds(
      resolveStartForElementInternal(compositionRoot, fallback),
      inheritedTimingHost(compositionRoot) ?? compositionRoot,
    );

  const resolveHostOffsetForElement = (element: Element, fallback: number): number => {
    const compositionRoot = element.hasAttribute("data-composition-id")
      ? element.parentElement?.closest("[data-composition-id]")
      : element.closest("[data-composition-id]");
    return compositionRoot ? resolveCompositionOrigin(compositionRoot, fallback) : 0;
  };

  const computeStart = (element: Element, fallback: number): number => {
    const expression = parseStartExpression(element.getAttribute("data-start"));
    if (!expression) {
      const host = inheritedTimingHost(element);
      return host ? resolveStartForElementInternal(host, fallback) : fallback;
    }
    if (expression.kind === "absolute") {
      // Negative when a host's in-point is past its start; the host's slot cuts that part.
      return resolveHostOffsetForElement(element, fallback) + Math.max(0, expression.value);
    }
    const target = findReferenceTarget(expression.refId);
    if (!target) return fallback;
    const targetStart = resolveStartForElementInternal(target, 0);
    const targetDuration = resolveDurationForElement(target) ?? 0;
    return Math.max(0, targetStart + targetDuration + expression.offset);
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
      const resolved = computeStart(element, fallback);
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
  const mediaStartInput = (element: Element): MediaStartInput => {
    const compositionRoot = element.closest("[data-composition-id]");
    return {
      authoredStart: parseStrictFiniteTimingNumber(element.getAttribute("data-start")),
      hostStart: compositionRoot ? resolveCompositionOrigin(compositionRoot, 0) : 0,
      hasAutoStart: element.hasAttribute("data-hf-auto-start"),
      basis: element.getAttribute(MEDIA_START_BASIS_ATTR),
    };
  };

  const resolveMediaStartForElement = (element: Element): number => {
    const input = mediaStartInput(element);
    return resolveMediaStartSeconds({
      ...input,
      ordinaryStart: () => resolveStartForElementInternal(element, input.hostStart),
    });
  };

  const isRootGlobalMediaStartForElement = (element: Element): boolean =>
    isMediaElement(element) && isRootGlobalMediaStart(mediaStartInput(element));

  return {
    resolveStartForElement: (element: Element, fallback = 0) =>
      resolveStartForElementInternal(element, Math.max(0, fallback)),
    resolveDurationForElement: (element: Element) => resolveDurationForElement(element),
    resolveMediaStartForElement,
    resolveHostStartForElement: (element: Element) => resolveHostOffsetForElement(element, 0),
    isRootGlobalMediaStartForElement,
  };
}

export type { RuntimeTimelineLike } from "./types";
