import { useMemo } from "react";
import { usePlayerStore, type TimelineElement, type DomClipChild } from "../store/playerStore";
import type { ClipManifestClip } from "../lib/playbackTypes";
import { createTimelineElementFromManifestClip } from "../lib/timelineDOM";
import { buildTimelineElementKey } from "../lib/timelineElementHelpers";

function findTopLevelAncestor(id: string, parentMap: Map<string, string>): string | null {
  let current = parentMap.get(id);
  if (!current) return null;
  const visited = new Set<string>();
  visited.add(id);
  while (parentMap.has(current)) {
    if (visited.has(current)) return current;
    visited.add(current);
    const parent = parentMap.get(current);
    if (!parent) return current;
    current = parent;
  }
  return current;
}

function extractDomId(key: string): string {
  const hashIdx = key.lastIndexOf("#");
  return hashIdx >= 0 ? key.slice(hashIdx + 1) : key;
}

function resolveRawId(
  selectedId: string | null,
  manifest: ClipManifestClip[],
  parentMap: Map<string, string>,
): string | null {
  if (!selectedId) return null;
  const rawId = extractDomId(selectedId);
  if (parentMap.has(rawId)) return rawId;
  if (parentMap.has(selectedId)) return selectedId;
  const clip = manifest.find((c) => c.label === selectedId || c.label === rawId);
  if (clip?.id && parentMap.has(clip.id)) return clip.id;
  return null;
}

interface TimelineExpansionRawIdInput {
  selectedElementId: string | null;
  isPlaying: boolean;
  currentTime: number;
  manifest: ClipManifestClip[];
  parentMap: Map<string, string>;
}

function clipContainsTime(clip: ClipManifestClip, time: number): boolean {
  return Number.isFinite(time) && time >= clip.start && time < clip.start + clip.duration;
}

function getActiveParentDepth(id: string, parentMap: Map<string, string>, activeIds: Set<string>) {
  let depth = 0;
  let parent = parentMap.get(id);
  const visited = new Set<string>();
  visited.add(id);
  while (parent) {
    if (visited.has(parent)) return depth;
    visited.add(parent);
    if (activeIds.has(parent)) depth += 1;
    parent = parentMap.get(parent);
  }
  return depth;
}

function findActiveExpandableCompositionId(
  currentTime: number,
  manifest: ClipManifestClip[],
  parentMap: Map<string, string>,
): string | null {
  const parentIds = new Set(parentMap.values());
  const activeIds = new Set<string>();
  for (const clip of manifest) {
    if (!clip.id || !parentIds.has(clip.id) || !clipContainsTime(clip, currentTime)) continue;
    activeIds.add(clip.id);
  }
  let bestId: string | null = null;
  let bestDepth = -1;
  for (const id of activeIds) {
    const depth = getActiveParentDepth(id, parentMap, activeIds);
    if (depth <= bestDepth) continue;
    bestId = id;
    bestDepth = depth;
  }
  return bestId;
}

export function resolveTimelineExpansionRawId({
  selectedElementId,
  isPlaying,
  currentTime,
  manifest,
  parentMap,
}: TimelineExpansionRawIdInput): string | null {
  const selectedRawId = resolveRawId(selectedElementId, manifest, parentMap);
  if (selectedRawId) return selectedRawId;
  if (isPlaying) return null;
  return findActiveExpandableCompositionId(currentTime, manifest, parentMap);
}

function filterToTopLevel(
  elements: TimelineElement[],
  parentMap: Map<string, string>,
): TimelineElement[] {
  if (parentMap.size === 0) return elements;
  return elements.filter((el) => !parentMap.has(el.domId ?? el.id));
}

function clampChildToParent(
  child: ClipManifestClip,
  parentStart: number,
  parentEnd: number,
): { start: number; duration: number } | null {
  const childEnd = child.start + child.duration;
  if (child.start >= parentEnd || childEnd <= parentStart) return null;
  const clampedStart = Math.max(child.start, parentStart);
  const clampedDuration = Math.min(childEnd, parentEnd) - clampedStart;
  return clampedDuration > 0 ? { start: clampedStart, duration: clampedDuration } : null;
}

interface DisplayBounds {
  start: number;
  end: number;
  track: number;
}

// `display` bounds come from the top-level scene clip (where the expanded row is
// drawn). `editBasis` comes from the child's immediate sub-comp host: its absolute
// start anchors local-time edits and its compositionSrc is the file edits write to.
// They differ only for sub-comp-inside-sub-comp nesting.
function buildChildElements(
  siblings: ClipManifestClip[],
  display: DisplayBounds,
  editBasis: { start: number; sourceFile: string | undefined },
): TimelineElement[] {
  const result: TimelineElement[] = [];
  for (const child of siblings) {
    const clamped = clampChildToParent(child, display.start, display.end);
    if (!clamped) continue;
    const base = createTimelineElementFromManifestClip({
      clip: child,
      fallbackIndex: result.length,
    });
    const domId = child.id ?? undefined;
    const selector = child.id ? `#${child.id}` : undefined;
    // `base.key` was built without a hostEl, so it fell back to the colon form
    // (`index.html:<id>:<idx>`) even though we set domId below. Recompute it from
    // the same inputs the store uses (`<sourceFile>#<domId>`) so an expanded
    // child shares one identity with its flat store element — otherwise selecting
    // it sets `selectedElementId` to the store's hash key while the rendered row
    // is keyed by the colon form, and `isSelected` never matches (no highlight).
    const key = buildTimelineElementKey({
      id: base.id,
      fallbackIndex: result.length,
      domId,
      selector,
      selectorIndex: base.selectorIndex,
      sourceFile: editBasis.sourceFile,
    });
    result.push({
      ...base,
      key,
      start: clamped.start,
      duration: clamped.duration,
      track: display.track + result.length,
      expandedParentStart: editBasis.start,
      domId,
      selector,
      sourceFile: editBasis.sourceFile,
      timingSource: "authored",
    });
  }
  return result;
}

// Sub-comp DOM children (groups/pills) aren't manifest clips and have no timing
// of their own — they're "always on" within their sub-comp host, so synthesize
// clips spanning the host's full bounds. The host element supplies start/duration
// and the composition file edits write to.
function domSiblingClips(
  domClipChildren: DomClipChild[],
  siblingParentId: string,
  host: TimelineElement,
): ClipManifestClip[] {
  return domClipChildren
    .filter((c) => c.parentId === siblingParentId)
    .map(
      (c): ClipManifestClip => ({
        id: c.id,
        label: c.label,
        start: host.start,
        duration: host.duration,
        track: host.track,
        kind: "element",
        tagName: null,
        compositionId: null,
        parentCompositionId: host.id ?? null,
        compositionSrc: host.compositionSrc ?? null,
        assetUrl: null,
      }),
    );
}

// Exported for tests.
export function buildExpandedElements(
  elements: TimelineElement[],
  manifest: ClipManifestClip[],
  parentMap: Map<string, string>,
  topLevelId: string,
  siblingParentId: string,
  domClipChildren: DomClipChild[] = [],
): TimelineElement[] {
  const topLevelElement = elements.find((el) => el.id === topLevelId || el.domId === topLevelId);
  if (!topLevelElement) return filterToTopLevel(elements, parentMap);

  // Prefer real manifest children; fall back to DOM-only sub-comp children
  // (groups/pills) that have no data-start and thus never enter the manifest.
  const siblings = (() => {
    const fromManifest = manifest.filter(
      (c) => c.id != null && parentMap.get(c.id) === siblingParentId,
    );
    if (fromManifest.length > 0) return fromManifest;
    return domSiblingClips(domClipChildren, siblingParentId, topLevelElement);
  })();
  if (siblings.length === 0) return filterToTopLevel(elements, parentMap);

  // The sub-comp host the children actually live in: top-level host for 1-level
  // nesting, a nested host for deeper nesting. Its start/file anchor edits.
  const parentHost = manifest.find((c) => c.id === siblingParentId);
  const editBasis = {
    start: parentHost?.start ?? topLevelElement.start,
    sourceFile: parentHost?.compositionSrc ?? topLevelElement.compositionSrc ?? undefined,
  };

  const parentKey = topLevelElement.key ?? topLevelElement.id;
  const expanded = buildChildElements(
    siblings,
    {
      start: topLevelElement.start,
      end: topLevelElement.start + topLevelElement.duration,
      track: topLevelElement.track,
    },
    editBasis,
  );
  if (expanded.length === 0) return filterToTopLevel(elements, parentMap);

  return elements
    .filter((el) => (el.key ?? el.id) === parentKey || !parentMap.has(el.domId ?? el.id))
    .flatMap((el) => ((el.key ?? el.id) === parentKey ? expanded : [el]));
}

export function useExpandedTimelineElements(): TimelineElement[] {
  const elements = usePlayerStore((s) => s.elements);
  const clipManifest = usePlayerStore((s) => s.clipManifest);
  const clipParentMap = usePlayerStore((s) => s.clipParentMap);
  const domClipChildren = usePlayerStore((s) => s.domClipChildren);
  const selectedElementId = usePlayerStore((s) => s.selectedElementId);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const currentTime = usePlayerStore((s) => s.currentTime);

  // Resolve which raw clip drives expansion. This reads currentTime (for paused
  // auto-expand) so it re-runs each scrub tick, but it's a cheap manifest scan and
  // its RESULT only changes when the playhead crosses a composition boundary. Keying
  // the expensive build below on these ids (not raw currentTime) avoids re-allocating
  // expandedElements — and cascading TimelineClip re-renders — on every tick.
  const { rawId, selectedRawId } = useMemo(() => {
    if (!clipManifest || clipManifest.length === 0 || clipParentMap.size === 0) {
      return { rawId: null as string | null, selectedRawId: null as string | null };
    }
    return {
      rawId: resolveTimelineExpansionRawId({
        selectedElementId,
        isPlaying,
        currentTime,
        manifest: clipManifest,
        parentMap: clipParentMap,
      }),
      selectedRawId: resolveRawId(selectedElementId, clipManifest, clipParentMap),
    };
  }, [clipManifest, clipParentMap, selectedElementId, isPlaying, currentTime]);

  return useMemo(() => {
    if (!clipManifest || clipManifest.length === 0 || clipParentMap.size === 0) {
      return elements;
    }
    if (!rawId) return filterToTopLevel(elements, clipParentMap);

    const immediateParent = selectedRawId ? clipParentMap.get(rawId) : rawId;
    if (!immediateParent) return filterToTopLevel(elements, clipParentMap);
    const topLevel = findTopLevelAncestor(rawId, clipParentMap) ?? immediateParent;
    return buildExpandedElements(
      elements,
      clipManifest,
      clipParentMap,
      topLevel,
      immediateParent,
      domClipChildren,
    );
  }, [elements, clipManifest, clipParentMap, domClipChildren, rawId, selectedRawId]);
}
