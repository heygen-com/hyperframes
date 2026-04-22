import type {
  RuntimeTimelineClip,
  RuntimeTimelineMessage,
  RuntimeTimelineScene,
  RuntimeTimelineLike,
} from "./types";
import { createRuntimeStartTimeResolver } from "./startResolver";

function parseNum(value: string | null | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * When multiple content kinds share the same track number, split them
 * onto separate tracks so the timeline UI shows distinct rows.
 *
 * Preferred kind order (top → bottom): composition, video, image, element, audio.
 * Tracks that contain only one kind are left untouched.
 */
const KIND_ORDER: Record<string, number> = {
  composition: 0,
  video: 1,
  image: 2,
  element: 3,
  audio: 4,
};

function normalizeTrackAssignments(clips: RuntimeTimelineClip[]): void {
  if (clips.length === 0) return;

  // Group clips by their raw track number and detect which tracks have mixed kinds
  const trackKinds = new Map<number, Set<string>>();
  for (const clip of clips) {
    const kinds = trackKinds.get(clip.track) ?? new Set();
    kinds.add(clip.kind);
    trackKinds.set(clip.track, kinds);
  }

  const hasMixedTracks = Array.from(trackKinds.values()).some((kinds) => kinds.size > 1);
  if (!hasMixedTracks) return;

  // Build new contiguous track numbers, splitting mixed tracks by kind
  let nextTrack = 0;
  const newTrackMap = new Map<string, number>(); // "origTrack:kind" → newTrack

  const sortedTracks = [...trackKinds.keys()].sort((a, b) => a - b);
  for (const track of sortedTracks) {
    const kinds = trackKinds.get(track)!;
    if (kinds.size === 1) {
      newTrackMap.set(`${track}:${[...kinds][0]}`, nextTrack++);
    } else {
      // Split by kind in preferred order
      const sorted = [...kinds].sort((a, b) => (KIND_ORDER[a] ?? 99) - (KIND_ORDER[b] ?? 99));
      for (const kind of sorted) {
        newTrackMap.set(`${track}:${kind}`, nextTrack++);
      }
    }
  }

  for (const clip of clips) {
    const key = `${clip.track}:${clip.kind}`;
    const newTrack = newTrackMap.get(key);
    if (newTrack != null) clip.track = newTrack;
  }
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
  const resolveMediaElementDurationSeconds = (
    mediaEl: HTMLVideoElement | HTMLAudioElement,
  ): number | null => {
    const declaredDuration = parseNum(mediaEl.getAttribute("data-duration"));
    if (declaredDuration != null && declaredDuration > 0) {
      return declaredDuration;
    }
    const playbackStart =
      parseNum(mediaEl.getAttribute("data-playback-start")) ??
      parseNum(mediaEl.getAttribute("data-media-start")) ??
      0;
    if (Number.isFinite(mediaEl.duration) && mediaEl.duration > playbackStart) {
      return Math.max(0, mediaEl.duration - playbackStart);
    }
    return null;
  };
  const resolveMediaWindowEndSeconds = (): number | null => {
    const mediaNodes = Array.from(
      document.querySelectorAll("video[data-start], audio[data-start]"),
    ) as Array<HTMLVideoElement | HTMLAudioElement>;
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
          inheritedDuration =
            parseNum(cursor.getAttribute("data-duration")) ??
            resolveTimelineDurationSeconds(compositionId) ??
            null;
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
    typeof rootDurationFromAttr === "number" &&
    Number.isFinite(rootDurationFromAttr) &&
    rootDurationFromAttr > 0
      ? rootDurationFromAttr
      : null;
  const mediaWindowDurationCandidate =
    typeof mediaWindowDuration === "number" &&
    Number.isFinite(mediaWindowDuration) &&
    mediaWindowDuration > 0
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
    preferredRootDuration != null
      ? Math.min(preferredRootDuration, params.maxTimelineDurationSeconds)
      : null;
  const rootCompositionEnd =
    rootCompositionDuration != null ? rootCompositionStart + rootCompositionDuration : null;
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
  // Only collect elements that are explicitly part of the timeline:
  // - Elements with data-start or data-track-index (timed clips)
  // - Elements with data-composition-id (sub-compositions)
  // - Media elements (video, audio, img)
  // Elements without data-start (e.g. GSAP-animated scenes) are not included
  // as clips — they have no declared timing so the timeline can't show their
  // actual visibility window. They can still appear as scenes via the separate
  // scene collection below.
  const nodes = Array.from(
    document.querySelectorAll(
      "[data-start], [data-track-index], [data-composition-id], video, audio, img",
    ),
  );
  let maxEnd = 0;
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (node === root) continue;
    if (["SCRIPT", "STYLE", "LINK", "META", "TEMPLATE", "NOSCRIPT"].includes(node.tagName))
      continue;
    const compositionContext = resolveNearestCompositionContext(node, root);
    const start = startResolver.resolveStartForElement(
      node,
      compositionContext.inheritedStart ?? 0,
    );
    const nodeCompositionId = node.getAttribute("data-composition-id");
    let duration = parseNum(node.getAttribute("data-duration"));
    if (
      (duration == null || duration <= 0) &&
      nodeCompositionId &&
      nodeCompositionId !== rootCompositionId
    ) {
      duration = resolveTimelineDurationSeconds(nodeCompositionId);
    }
    if ((duration == null || duration <= 0) && node instanceof HTMLMediaElement) {
      const mediaStart =
        parseNum(node.getAttribute("data-playback-start")) ??
        parseNum(node.getAttribute("data-media-start")) ??
        0;
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
      id: (node as HTMLElement).id || nodeCompositionId || `__node__index_${i}`,
      label:
        node.getAttribute("data-timeline-label") ??
        node.getAttribute("data-label") ??
        node.getAttribute("aria-label") ??
        nodeCompositionId ??
        (node as HTMLElement).id ??
        (node as HTMLElement).className?.split(" ")[0] ??
        kind,
      start,
      duration,
      track:
        Number.parseInt(
          node.getAttribute("data-track-index") ?? node.getAttribute("data-track") ?? String(i),
          10,
        ) || 0,
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
  // ── GSAP introspection ──────────────────────────────────────────────────
  // Discover elements animated by GSAP that weren't picked up by the DOM query
  // (e.g. scene divs controlled purely via opacity/display tweens).
  // Introspect the master timeline's tweens to find their targets and time ranges.
  // ── GSAP introspection ──────────────────────────────────────────────────
  // Discover scene-level elements animated by GSAP that weren't picked up by
  // the DOM query. Introspect the master timeline's tweens, resolve absolute
  // time ranges, and bubble child tween ranges up to their nearest scene-level
  // ancestor (direct child of root with an id).
  const gsapClipIds = new Set(clips.map((c) => c.id));
  const rootCompositionIdForGsap = root?.getAttribute("data-composition-id") ?? null;
  const masterTimeline = rootCompositionIdForGsap
    ? (timelineRegistry[rootCompositionIdForGsap] ?? null)
    : null;
  if (masterTimeline && root) {
    type GsapTween = {
      targets?: () => Element[];
      startTime?: () => number;
      duration?: () => number;
      parent?: { startTime?: () => number };
    };
    const tlWithChildren = masterTimeline as typeof masterTimeline & {
      getChildren?: (nested: boolean, tweens: boolean, timelines: boolean) => GsapTween[];
    };
    if (typeof tlWithChildren.getChildren === "function") {
      try {
        const tweens = tlWithChildren.getChildren(true, true, false) ?? [];
        // Build a set of direct children of root that have an id — these are
        // scene-level containers. Tween ranges on their descendants get bubbled
        // up to expand the scene's time range.
        const sceneElements = new Map<Element, { id: string; start: number; end: number }>();
        for (const child of root.children) {
          const childEl = child as HTMLElement;
          if (!childEl.id) continue;
          const tag = childEl.tagName.toLowerCase();
          if (tag === "script" || tag === "style" || tag === "link") continue;
          sceneElements.set(childEl, { id: childEl.id, start: Infinity, end: -Infinity });
        }
        // Find the scene-level ancestor for a given element
        const findSceneAncestor = (el: Element): Element | null => {
          let cursor: Element | null = el;
          while (cursor) {
            if (sceneElements.has(cursor)) return cursor;
            if (cursor === root) return null;
            cursor = cursor.parentElement;
          }
          return null;
        };
        // Walk all tweens and accumulate time ranges per scene element
        for (const tween of tweens) {
          if (typeof tween.targets !== "function") continue;
          if (typeof tween.startTime !== "function" || typeof tween.duration !== "function")
            continue;
          let tweenStart = tween.startTime();
          let parent = tween.parent;
          while (parent && typeof parent.startTime === "function") {
            tweenStart += parent.startTime();
            parent = (parent as GsapTween).parent;
          }
          const tweenEnd = tweenStart + tween.duration();
          if (!Number.isFinite(tweenStart) || !Number.isFinite(tweenEnd)) continue;
          for (const target of tween.targets()) {
            if (!(target instanceof Element)) continue;
            // Bubble up to the scene-level ancestor
            const scene = findSceneAncestor(target);
            if (!scene) continue;
            const range = sceneElements.get(scene);
            if (!range) continue;
            range.start = Math.min(range.start, tweenStart);
            range.end = Math.max(range.end, tweenEnd);
          }
        }
        // Create clips for scene elements that have tween ranges
        const gsapTrack = clips.length > 0 ? Math.max(...clips.map((c) => c.track)) + 1 : 0;
        for (const [element, range] of sceneElements) {
          if (range.start === Infinity || range.end === -Infinity) continue;
          const el = element as HTMLElement;
          if (gsapClipIds.has(el.id)) continue;
          const duration = Math.max(0, range.end - range.start);
          if (duration <= 0) continue;
          const clampedDuration = clampDurationToRootWindow(range.start, duration);
          if (clampedDuration <= 0) continue;
          maxEnd = Math.max(maxEnd, range.start + clampedDuration);
          clips.push({
            id: el.id,
            label:
              el.getAttribute("data-timeline-label") ??
              el.getAttribute("data-label") ??
              el.getAttribute("aria-label") ??
              el.id,
            start: range.start,
            duration: clampedDuration,
            track:
              Number.parseInt(
                el.getAttribute("data-track-index") ?? el.getAttribute("data-track") ?? "",
                10,
              ) || gsapTrack,
            kind: "element",
            tagName: el.tagName.toLowerCase(),
            compositionId: el.getAttribute("data-composition-id"),
            compositionAncestors: rootCompositionIdForGsap ? [rootCompositionIdForGsap] : [],
            parentCompositionId: rootCompositionIdForGsap,
            nodePath: null,
            compositionSrc: null,
            assetUrl: null,
            timelineRole: el.getAttribute("data-timeline-role"),
            timelineLabel: el.getAttribute("data-timeline-label"),
            timelineGroup: el.getAttribute("data-timeline-group"),
            timelinePriority: parseNum(el.getAttribute("data-timeline-priority")),
          });
          gsapClipIds.add(el.id);
        }
      } catch {
        // GSAP introspection is best-effort — don't break timeline if it fails
      }
    }
  }

  // ── Persistent overlays ─────────────────────────────────────────────────
  // Direct children of root that are pure structural overlays should only
  // surface in the timeline when authors explicitly opt them in. Otherwise
  // background layers like "backdrop" make the whole composition read as a
  // long clip, which is misleading in Studio.
  if (root && rootCompositionDuration != null && rootCompositionDuration > 0) {
    const overlayTrack = clips.length > 0 ? Math.max(...clips.map((c) => c.track)) + 1 : 0;
    for (const child of root.children) {
      const el = child as HTMLElement;
      if (!el.id) continue;
      if (gsapClipIds.has(el.id)) continue;
      const timelineRole = el.getAttribute("data-timeline-role");
      if (timelineRole !== "overlay" && timelineRole !== "persistent-overlay") continue;
      const tag = el.tagName.toLowerCase();
      if (tag === "script" || tag === "style" || tag === "link" || tag === "meta") continue;
      // Skip elements that are invisible (display:none in their CSS class)
      const computed = window.getComputedStyle(el);
      if (computed.display === "none") continue;
      const clampedDuration = clampDurationToRootWindow(0, rootCompositionDuration);
      if (clampedDuration <= 0) continue;
      maxEnd = Math.max(maxEnd, clampedDuration);
      clips.push({
        id: el.id,
        label:
          el.getAttribute("data-timeline-label") ??
          el.getAttribute("data-label") ??
          el.getAttribute("aria-label") ??
          el.id,
        start: 0,
        duration: clampedDuration,
        track:
          Number.parseInt(
            el.getAttribute("data-track-index") ?? el.getAttribute("data-track") ?? "",
            10,
          ) || overlayTrack,
        kind: "element",
        tagName: tag,
        compositionId: el.getAttribute("data-composition-id"),
        compositionAncestors: rootCompositionIdForGsap ? [rootCompositionIdForGsap] : [],
        parentCompositionId: rootCompositionIdForGsap,
        nodePath: null,
        compositionSrc: null,
        assetUrl: null,
        timelineRole,
        timelineLabel: el.getAttribute("data-timeline-label"),
        timelineGroup: el.getAttribute("data-timeline-group"),
        timelinePriority: parseNum(el.getAttribute("data-timeline-priority")),
      });
      gsapClipIds.add(el.id);
    }
  }

  // ── Track normalization ────────────────────────────────────────────────
  // When multiple content kinds (composition, audio, video, …) share the same
  // data-track-index value, split them onto separate tracks so the timeline UI
  // shows distinct rows for each kind.
  normalizeTrackAssignments(clips);

  for (const compositionNode of compositionNodes) {
    if (compositionNode === root) continue;
    const compositionId = compositionNode.getAttribute("data-composition-id");
    if (!compositionId || !isSceneLikeCompositionId(compositionId)) continue;
    const start = startResolver.resolveStartForElement(compositionNode, 0);
    const durationFromAttr = parseNum(compositionNode.getAttribute("data-duration"));
    const durationFromTimeline = resolveTimelineDurationSeconds(compositionId);
    const duration =
      durationFromAttr && durationFromAttr > 0 ? durationFromAttr : durationFromTimeline;
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
  // Timeline payload duration should reflect the playable composition window,
  // not just the furthest currently-surfaced clip. Studio can intentionally
  // hide structural/background tracks from the timeline UI; if we collapse the
  // payload duration down to the last visible clip end, the controls jump even
  // though playback still runs for the full authored root duration.
  const safeDuration = Math.max(
    1,
    Math.min(
      Math.max(maxEnd || 1, rootCompositionDuration ?? 0),
      params.maxTimelineDurationSeconds,
    ),
  );
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
