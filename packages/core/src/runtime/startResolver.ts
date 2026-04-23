import type { RuntimeTimelineLike } from "./types";

const AUTHORED_DURATION_ATTR = "data-hf-authored-duration";
const AUTHORED_END_ATTR = "data-hf-authored-end";

type ReferenceExpression =
  | {
      kind: "absolute";
      value: number;
    }
  | {
      kind: "reference";
      refId: string;
      offset: number;
    };

function parseNumeric(value: string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDurationAttr(element: Element): number | null {
  return parseNumeric(element.getAttribute("data-duration"));
}

function parseEndAttr(element: Element): number | null {
  return parseNumeric(element.getAttribute("data-end"));
}

function parseAuthoredDurationAttr(element: Element): number | null {
  return parseNumeric(element.getAttribute(AUTHORED_DURATION_ATTR));
}

function parseAuthoredEndAttr(element: Element): number | null {
  return parseNumeric(element.getAttribute(AUTHORED_END_ATTR));
}

function parseStartExpression(raw: string | null | undefined): ReferenceExpression | null {
  const normalized = (raw ?? "").trim();
  if (!normalized) return null;
  const absolute = parseNumeric(normalized);
  if (absolute != null) {
    return { kind: "absolute", value: absolute };
  }
  const referenceMatch = normalized.match(/^([A-Za-z0-9_.:-]+)(?:\s*([+-])\s*([0-9]*\.?[0-9]+))?$/);
  if (!referenceMatch) return null;
  const refId = (referenceMatch[1] ?? "").trim();
  if (!refId) return null;
  const sign = referenceMatch[2] ?? "+";
  const offsetRaw = referenceMatch[3] ?? "0";
  const parsedOffset = Number.parseFloat(offsetRaw);
  const offsetMagnitude = Number.isFinite(parsedOffset) ? Math.max(0, parsedOffset) : 0;
  const offset = sign === "-" ? -offsetMagnitude : offsetMagnitude;
  return { kind: "reference", refId, offset };
}

export function createRuntimeStartTimeResolver(params: {
  timelineRegistry?: Record<string, RuntimeTimelineLike | undefined>;
  includeAuthoredTimingAttrs?: boolean;
}): {
  resolveStartForElement: (element: Element, fallback?: number) => number;
  resolveDurationForElement: (element: Element) => number | null;
} {
  const timelineRegistry = params.timelineRegistry ?? {};
  const includeAuthoredTimingAttrs = params.includeAuthoredTimingAttrs ?? false;
  const startCache = new WeakMap<Element, number | null>();
  const durationCache = new WeakMap<Element, number | null>();
  const visiting = new Set<Element>();

  const findReferenceTarget = (refId: string): Element | null => {
    const byId = document.getElementById(refId);
    if (byId) return byId;
    return (
      (document.querySelector(`[data-composition-id="${CSS.escape(refId)}"]`) as Element | null) ??
      null
    );
  };

  const resolveDurationForElement = (element: Element): number | null => {
    const cached = durationCache.get(element);
    if (cached !== undefined) return cached;
    let resolved: number | null = null;
    const durationAttr =
      parseDurationAttr(element) ??
      (includeAuthoredTimingAttrs ? parseAuthoredDurationAttr(element) : null);
    if (durationAttr != null && durationAttr > 0) {
      resolved = durationAttr;
    }
    if (resolved == null || resolved <= 0) {
      const endAttr =
        parseEndAttr(element) ??
        (includeAuthoredTimingAttrs ? parseAuthoredEndAttr(element) : null);
      if (endAttr != null) {
        const start = resolveStartForElementInternal(element, 0);
        const delta = endAttr - start;
        if (Number.isFinite(delta) && delta > 0) {
          resolved = delta;
        }
      }
    }
    if ((resolved == null || resolved <= 0) && element instanceof HTMLMediaElement) {
      const playbackStart =
        parseNumeric(element.getAttribute("data-playback-start")) ??
        parseNumeric(element.getAttribute("data-media-start")) ??
        0;
      if (Number.isFinite(element.duration) && element.duration > playbackStart) {
        resolved = element.duration - playbackStart;
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
          } catch {
            // ignore broken timeline impls
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
        // than the loaded file — e.g. host="montage" but file has "scene-10".
        // Check both data-composition-src (runtime) and data-composition-id (bundled,
        // where data-composition-src is stripped after inlining).
        if (element.hasAttribute("data-composition-id")) {
          const parent = element.parentElement;
          if (
            parent &&
            (parent.hasAttribute("data-composition-src") ||
              parent.hasAttribute("data-composition-id"))
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

  return {
    resolveStartForElement: (element: Element, fallback = 0) =>
      resolveStartForElementInternal(element, Math.max(0, fallback)),
    resolveDurationForElement: (element: Element) => resolveDurationForElement(element),
  };
}
