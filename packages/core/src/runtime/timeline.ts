import type { RuntimeTimelineClip, RuntimeTimelineMessage, RuntimeTimelineScene, RuntimeTimelineLike } from "./types";
import { createRuntimeStartTimeResolver } from "./startResolver";

function parseNum(value: string | null | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toAbsoluteAssetUrl(rawValue: string | null | undefined): string | null {
  const raw = String(rawValue ?? "").trim();
  if (!raw) return null;
  const lowered = raw.toLowerCase();
  if (lowered.startsWith("data:") || lowered.startsWith("javascript:")) return null;
  try {
    return new URL(raw, document.baseURI).toString();
  } catch {
    return raw;
  }
}

function resolveNodeAssetUrl(node: Element): string | null {
  const src = node.getAttribute("src") ?? node.getAttribute("data-src");
  if (src) return toAbsoluteAssetUrl(src);
  const compositionSrc = node.getAttribute("data-composition-src");
  if (compositionSrc) return toAbsoluteAssetUrl(compositionSrc);
  const mediaDescendant = node.querySelector("img[src], video[src], audio[src], source[src]");
  if (!mediaDescendant) return null;
  return toAbsoluteAssetUrl(mediaDescendant.getAttribute("src"));
}

export function collectRuntimeTimelinePayload(params: {
  canonicalFps: number;
  maxTimelineDurationSeconds: number;
}): RuntimeTimelineMessage {
  const runtimeWindow = window as Window & {
    __timelines?: Record<string, RuntimeTimelineLike | undefined>;
  };
  const timelineRegistry = runtimeWindow.__timelines ?? {};
  const startResolver = createRuntimeStartTimeResolver({
    timelineRegistry,
  });
  const resolveTimelineDurationSeconds = (compositionId: string | null): number | null => {
    if (!compositionId) return null;
    const timeline = timelineRegistry[compositionId] ?? null;
    if (!timeline || typeof timeline.duration !== "function") return null;
    try {
      const duration = Number(timeline.duration());
      return Number.isFinite(duration) && duration > 0 ? duration : null;
    } catch {
      return null;
    }
  };
  const resolveMediaElementDurationSeconds = (mediaEl: HTMLVideoElement | HTMLAudioElement): number | null => {
    const declaredDuration = parseNum(mediaEl.getAttribute("data-duration"));
    if (declaredDuration != null && declaredDuration > 0) {
      return declaredDuration;
    }
    const playbackStart =
      parseNum(mediaEl.getAttribute("data-playback-start")) ?? parseNum(mediaEl.getAttribute("data-media-start")) ?? 0;
    if (Number.isFinite(mediaEl.duration) && mediaEl.duration > playbackStart) {
      return Math.max(0, mediaEl.duration - playbackStart);
    }
    return null;
  };
  const resolveMediaWindowEndSeconds = (): number | null => {
    const mediaNodes = Array.from(document.querySelectorAll("video[data-start], audio[data-start]")) as Array<
      HTMLVideoElement | HTMLAudioElement
    >;
    if (mediaNodes.length === 0) return null;
    let maxWindowEndSeconds = 0;
    for (const mediaNode of mediaNodes) {
      const start = startResolver.resolveStartForElement(mediaNode, 0);
      if (!Number.isFinite(start)) continue;
      const duration = resolveMediaElementDurationSeconds(mediaNode);
      if (duration == null || duration <= 0) continue;
      maxWindowEndSeconds = Math.max(maxWindowEndSeconds, Math.max(0, start) + duration);
    }
    return maxWindowEndSeconds > 0 ? maxWindowEndSeconds : null;
  };
  const isSceneLikeCompositionId = (compositionId: string): boolean => {
    const normalized = compositionId.trim().toLowerCase();
    if (!normalized || normalized === "main") return false;
    if (normalized.includes("caption")) return false;
    if (normalized.includes("ambient")) return false;
    return true;
  };
  const resolveNearestCompositionContext = (
    node: Element,
    root: Element | null,
  ): {
    parentCompositionId: string | null;
    compositionAncestors: string[];
    inheritedStart: number | null;
    inheritedDuration: number | null;
  } => {
    const ancestors: string[] = [];
    let inheritedStart: number | null = null;
    let inheritedDuration: number | null = null;
    let parentCompositionId: string | null = null;
    let cursor = node.parentElement;
    while (cursor) {
      const compositionId = cursor.getAttribute("data-composition-id");
      if (compositionId) {
        ancestors.push(compositionId);
        if (!parentCompositionId && cursor !== root) {
          parentCompositionId = compositionId;
        }
        if (inheritedStart == null) {
          inheritedStart = startResolver.resolveStartForElement(cursor, 0);
        }
        if (inheritedDuration == null) {
          inheritedDuration = parseNum(cursor.getAttribute("data-duration")) ?? null;
        }
      }
      cursor = cursor.parentElement;
    }
    return {
      parentCompositionId,
      compositionAncestors: ancestors.reverse(),
      inheritedStart,
      inheritedDuration,
    };
  };

  const root = document.querySelector("[data-composition-id]") as Element | null;
  const rootCompositionId = root?.getAttribute("data-composition-id") ?? null;
  const rootCompositionStart = root ? startResolver.resolveStartForElement(root, 0) : 0;
  const mediaWindowEnd = resolveMediaWindowEndSeconds();
  const mediaWindowDuration =
    mediaWindowEnd != null ? Math.max(0, mediaWindowEnd - Math.max(0, rootCompositionStart)) : null;
  const rootDurationFromTimeline = resolveTimelineDurationSeconds(rootCompositionId);
  const rootDurationFromAttr = parseNum(root?.getAttribute("data-duration"));
  const timelineDurationCandidate =
    typeof rootDurationFromTimeline === "number" &&
    Number.isFinite(rootDurationFromTimeline) &&
    rootDurationFromTimeline > 0
      ? rootDurationFromTimeline
      : null;
  const attrDurationCandidate =
    typeof rootDurationFromAttr === "number" && Number.isFinite(rootDurationFromAttr) && rootDurationFromAttr > 0
      ? rootDurationFromAttr
      : null;
  const mediaWindowDurationCandidate =
    typeof mediaWindowDuration === "number" && Number.isFinite(mediaWindowDuration) && mediaWindowDuration > 0
      ? mediaWindowDuration
      : null;
  const timelineLooksLoopInflated =
    timelineDurationCandidate != null &&
    mediaWindowDurationCandidate != null &&
    timelineDurationCandidate > mediaWindowDurationCandidate + 1;
  // Prefer explicit authored root duration first.
  // If absent, guard against loop-inflated GSAP durations by trusting finite media window.
  const preferredRootDuration =
    attrDurationCandidate ??
    (timelineLooksLoopInflated
      ? mediaWindowDurationCandidate
      : (timelineDurationCandidate ?? mediaWindowDurationCandidate));
  const rootCompositionDuration =
    preferredRootDuration != null ? Math.min(preferredRootDuration, params.maxTimelineDurationSeconds) : null;
  const rootCompositionEnd = rootCompositionDuration != null ? rootCompositionStart + rootCompositionDuration : null;
  const timelineWindowEnd =
    rootCompositionEnd ??
    (typeof mediaWindowEnd === "number" && Number.isFinite(mediaWindowEnd) && mediaWindowEnd > 0
      ? mediaWindowEnd
      : null);
  const clampDurationToRootWindow = (start: number, duration: number): number => {
    if (!Number.isFinite(duration) || duration <= 0) return 0;
    if (timelineWindowEnd == null || !Number.isFinite(timelineWindowEnd)) return duration;
    if (!Number.isFinite(start) || start >= timelineWindowEnd) return 0;
    return Math.max(0, Math.min(duration, timelineWindowEnd - start));
  };
  const compositionNodes = Array.from(document.querySelectorAll("[data-composition-id]"));
  const clips: RuntimeTimelineClip[] = [];
  const scenes: RuntimeTimelineScene[] = [];
  const nodes = Array.from(document.querySelectorAll("*"));
  let maxEnd = 0;
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (node === root) continue;
    if (["SCRIPT", "STYLE", "LINK", "META", "TEMPLATE", "NOSCRIPT"].includes(node.tagName)) continue;
    const compositionContext = resolveNearestCompositionContext(node, root);
    const start = startResolver.resolveStartForElement(node, compositionContext.inheritedStart ?? 0);
    const nodeCompositionId = node.getAttribute("data-composition-id");
    let duration = parseNum(node.getAttribute("data-duration"));
    if ((duration == null || duration <= 0) && nodeCompositionId && nodeCompositionId !== rootCompositionId) {
      duration = resolveTimelineDurationSeconds(nodeCompositionId);
    }
    if ((duration == null || duration <= 0) && node instanceof HTMLMediaElement) {
      const mediaStart =
        parseNum(node.getAttribute("data-playback-start")) ?? parseNum(node.getAttribute("data-media-start")) ?? 0;
      if (Number.isFinite(node.duration) && node.duration > 0) {
        duration = Math.max(0, node.duration - mediaStart);
      }
    }
    if (duration == null || duration <= 0) {
      const inheritedDuration = compositionContext.inheritedDuration;
      if (inheritedDuration != null && inheritedDuration > 0) {
        const inheritedStart = compositionContext.inheritedStart ?? 0;
        const inheritedEnd = inheritedStart + inheritedDuration;
        duration = Math.max(0, inheritedEnd - start);
      }
    }
    if (duration == null || duration <= 0) continue;
    duration = clampDurationToRootWindow(start, duration);
    if (duration <= 0) continue;
    const end = start + duration;
    maxEnd = Math.max(maxEnd, end);
    const tag = node.tagName.toLowerCase();
    const kind: RuntimeTimelineClip["kind"] =
      nodeCompositionId && nodeCompositionId !== rootCompositionId
        ? "composition"
        : tag === "video"
          ? "video"
          : tag === "audio"
            ? "audio"
            : tag === "img"
              ? "image"
              : "element";
    clips.push({
      id: (node as HTMLElement).id || `__node__index_${i}`,
      label:
        node.getAttribute("data-timeline-label") ??
        node.getAttribute("data-label") ??
        node.getAttribute("aria-label") ??
        (node as HTMLElement).id ??
        (node as HTMLElement).className?.split(" ")[0] ??
        kind,
      start,
      duration,
      track:
        Number.parseInt(node.getAttribute("data-track-index") ?? node.getAttribute("data-track") ?? String(i), 10) || 0,
      kind,
      tagName: tag,
      compositionId: node.getAttribute("data-composition-id"),
      compositionAncestors: compositionContext.compositionAncestors,
      parentCompositionId: compositionContext.parentCompositionId,
      nodePath: null,
      compositionSrc: toAbsoluteAssetUrl(node.getAttribute("data-composition-src")),
      assetUrl: resolveNodeAssetUrl(node),
      timelineRole: node.getAttribute("data-timeline-role"),
      timelineLabel: node.getAttribute("data-timeline-label"),
      timelineGroup: node.getAttribute("data-timeline-group"),
      timelinePriority: parseNum(node.getAttribute("data-timeline-priority")),
    });
  }
  for (const compositionNode of compositionNodes) {
    if (compositionNode === root) continue;
    const compositionId = compositionNode.getAttribute("data-composition-id");
    if (!compositionId || !isSceneLikeCompositionId(compositionId)) continue;
    const start = startResolver.resolveStartForElement(compositionNode, 0);
    const durationFromAttr = parseNum(compositionNode.getAttribute("data-duration"));
    const durationFromTimeline = resolveTimelineDurationSeconds(compositionId);
    const duration = durationFromAttr && durationFromAttr > 0 ? durationFromAttr : durationFromTimeline;
    if (duration == null || duration <= 0) continue;
    const clampedDuration = clampDurationToRootWindow(start, duration);
    if (clampedDuration <= 0) continue;
    scenes.push({
      id: compositionId,
      label: compositionNode.getAttribute("data-label") ?? compositionId,
      start,
      duration: clampedDuration,
      thumbnailUrl: toAbsoluteAssetUrl(compositionNode.getAttribute("data-thumbnail-url")),
      avatarName: null,
    });
  }
  const safeDuration = Math.max(1, Math.min(maxEnd || 1, params.maxTimelineDurationSeconds));
  const shouldEmitNonDeterministicInf = timelineLooksLoopInflated && attrDurationCandidate == null;
  const durationInFrames = shouldEmitNonDeterministicInf
    ? Number.POSITIVE_INFINITY
    : Math.max(1, Math.round(safeDuration * Math.max(1, params.canonicalFps)));
  return {
    source: "hf-preview",
    type: "timeline",
    durationInFrames,
    clips,
    scenes,
    compositionWidth: parseNum(root?.getAttribute("data-width")) ?? 1920,
    compositionHeight: parseNum(root?.getAttribute("data-height")) ?? 1080,
  };
}
