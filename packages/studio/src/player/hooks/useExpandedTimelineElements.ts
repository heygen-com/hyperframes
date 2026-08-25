import { useMemo } from "react";
import { usePlayerStore, type TimelineElement, type DomClipChild } from "../store/playerStore";
import type { ClipManifestClip } from "../lib/playbackTypes";
import { createTimelineElementFromManifestClip } from "../lib/timelineDOM";
import { buildTimelineElementKey, splitTimelineElementKey } from "../lib/timelineElementHelpers";

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

function resolveRawId(
  selectedId: string | null,
  manifest: ClipManifestClip[],
  parentMap: Map<string, string>,
): string | null {
  if (!selectedId) return null;
  const rawId = splitTimelineElementKey(selectedId).domId;
  if (parentMap.has(rawId)) return rawId;
  if (parentMap.has(selectedId)) return selectedId;
  const clip = manifest.find((c) => c.label === selectedId || c.label === rawId);
  if (clip?.id && parentMap.has(clip.id)) return clip.id;
  return null;
}

interface TimelineExpansionRawIdInput {
  selectedElementId: string | null;
  currentTime: number;
  manifest: ClipManifestClip[];
  parentMap: Map<string, string>;
}

function clipContainsTime(clip: ClipManifestClip, time: number): boolean {
  return Number.isFinite(time) && time >= clip.start && time < clip.start + clip.duration;
}

/** Half-open containment plus the closing boundary — see the fallback below. */
function clipTouchesTime(clip: ClipManifestClip, time: number): boolean {
  return Number.isFinite(time) && time >= clip.start && time <= clip.start + clip.duration;
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
  const collect = (matches: (clip: ClipManifestClip, time: number) => boolean) => {
    const ids = new Set<string>();
    for (const clip of manifest) {
      if (clip.id && parentIds.has(clip.id) && matches(clip, currentTime)) ids.add(clip.id);
    }
    return ids;
  };
  // Clip windows are half-open, so a playhead parked exactly on a clip's end is
  // inside nothing — at the end of the timeline that collapsed every expanded
  // sub-composition row and its keyframe lanes. Only when the strict pass finds
  // nothing do we accept the closing boundary, so a playhead landing on the seam
  // between two adjacent clips still expands the one that is starting.
  const strict = collect(clipContainsTime);
  const activeIds = strict.size > 0 ? strict : collect(clipTouchesTime);
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
  currentTime,
  manifest,
  parentMap,
}: TimelineExpansionRawIdInput): string | null {
  const selectedRawId = resolveRawId(selectedElementId, manifest, parentMap);
  if (selectedRawId) return selectedRawId;
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

/**
 * State that lives on the live host element, not in the clip manifest:
 * `data-hidden`, `data-timeline-locked`, `data-timeline-role`. A child row is
 * built from a manifest clip with no hostEl to read, so
 * createTimelineElementFromManifestClip cannot see any of it. The flat store
 * element for the same child WAS built with one, so it is inherited from there.
 *
 * Without this the eye on an expanded child always reported the row visible, so
 * clicking it wrote data-hidden again instead of removing it, and a hidden child
 * could never be shown again (not even after a reload, since the attribute is in
 * the source).
 */
/**
 * Audio-group membership for an expanded child, from whichever source has it.
 *
 * The flat store twin when there is one; otherwise the `DomClipChild` record,
 * which carried it off the live element during the DOM walk. That fallback is
 * the ONLY source for a sub-composition that declares both a group and its
 * members: those members never enter the flat store, so "inherit from the flat
 * twin" silently produced no membership and therefore no group row — for
 * exactly the case group support was extended to cover.
 */
function childGroupState(
  flat: TimelineElement | undefined,
  domChild: DomClipChild | undefined,
): Partial<TimelineElement> {
  const source = flat?.audioGroup ? flat : domChild?.audioGroup ? domChild : null;
  if (!source) return {};
  return {
    audioGroup: source.audioGroup,
    audioGroupLabel: source.audioGroupLabel,
    audioGroupVolume: source.audioGroupVolume,
    audioGroupHidden: source.audioGroupHidden,
    audioGroupFxChain: source.audioGroupFxChain,
    audioGroupAutomation: source.audioGroupAutomation,
  };
}

function hostElementState(flat: TimelineElement | undefined): Partial<TimelineElement> {
  if (!flat) return {};
  return {
    hidden: flat.hidden,
    timelineLocked: flat.timelineLocked,
    timelineRole: flat.timelineRole,
    // Same reason as the three above: these are read off the host element, which
    // an expanded child is built without. Missing them, an audio child inside a
    // sub-composition reserved no automation height and drew no lanes, while the
    // property panel — reading the live DOM selection rather than this row —
    // still showed the chain and its toggles.
    fxChain: flat.fxChain,
    automation: flat.automation,
  };
}

// `display` bounds come from the top-level scene clip (where the expanded row is
// drawn). `editBasis` comes from the child's immediate sub-comp host: its absolute
// start anchors local-time edits and its compositionSrc is the file edits write to.
// They differ only for sub-comp-inside-sub-comp nesting.
function buildChildElements(
  siblings: ClipManifestClip[],
  display: DisplayBounds,
  editBasis: { start: number; sourceFile: string | undefined },
  expandedHostKey: string,
  elements: readonly TimelineElement[],
  domChildrenById: ReadonlyMap<string, DomClipChild>,
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
      ...hostElementState(elements.find((element) => element.key === key)),
      ...childGroupState(
        elements.find((element) => element.key === key),
        domId ? domChildrenById.get(domId) : undefined,
      ),
      key,
      start: clamped.start,
      duration: clamped.duration,
      // `track` becomes a synthetic display row under the expanded host, but the
      // factory-set `authoredTrack` (the child's data-track-index in ITS OWN
      // file's coordinate space) and the runtime-computed `stackingContextId`
      // must survive verbatim — lane persists and z-sync read them, they are
      // never reconstructed from display lanes.
      //
      // COLLISION-FREE synthetic rows: the old `display.track + index` scheme
      // could equal a REAL clip's integer lane (host on track 0 with two
      // children puts child #2 on track 1 — where an unrelated top-level clip
      // may live). Lane grouping merges purely by track number, so that
      // collision fused clips from DIFFERENT source files into one display
      // lane, and lane-scoped actions (gap close) then batch-persisted foreign
      // clips. Fractions strictly between the host's lane and the next integer
      // can never equal a normalized (integer) lane, while still rendering the
      // children as their own ordered rows directly under the host.
      //
      // Confined to the LOWER half of that gap, because a GROUP row anchors at
      // exactly `firstMemberTrack - 0.5` (`useTimelineTrackDerivations`) — and
      // the old `k / (n + 2)` hit 0.5 dead on for a host with two children
      // (2/4), producing a duplicate row key and a duplicated group header. This
      // scheme's maximum is `0.5 * n / (n + 1)`, strictly under 0.5 for every n.
      track: display.track + (0.5 * (result.length + 1)) / (siblings.length + 1),
      authoredTrack: base.authoredTrack,
      stackingContextId: base.stackingContextId,
      expandedParentStart: editBasis.start,
      expandedHostKey,
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
  host: {
    id: string | null;
    start: number;
    duration: number;
    track: number;
    compositionSrc?: string | null;
  },
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
        stackingContextId: c.stackingContextId,
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

  // The sub-comp host the children actually live in: top-level host for 1-level
  // nesting, a nested host for deeper nesting. Its start/file anchor edits.
  const parentHost = manifest.find((c) => c.id === siblingParentId);

  // Prefer real manifest children; fall back to DOM-only sub-comp children
  // (groups/pills) that have no data-start and thus never enter the manifest.
  // Those are synthesized against the host they actually live in, not the
  // top-level element, or every child row reads the whole top-level window.
  const siblings = (() => {
    const fromManifest = manifest.filter(
      (c) => c.id != null && parentMap.get(c.id) === siblingParentId,
    );
    if (fromManifest.length > 0) return fromManifest;
    return domSiblingClips(domClipChildren, siblingParentId, parentHost ?? topLevelElement);
  })();
  if (siblings.length === 0) return filterToTopLevel(elements, parentMap);

  const editBasis = {
    start: parentHost?.start ?? topLevelElement.start,
    sourceFile: parentHost?.compositionSrc ?? topLevelElement.compositionSrc ?? undefined,
  };

  const parentKey = topLevelElement.key ?? topLevelElement.id;
  const domChildrenById = new Map(domClipChildren.map((child) => [child.id, child]));
  const expanded = buildChildElements(
    siblings,
    {
      start: topLevelElement.start,
      end: topLevelElement.start + topLevelElement.duration,
      track: topLevelElement.track,
    },
    editBasis,
    parentKey,
    elements,
    domChildrenById,
  );
  if (expanded.length === 0) return filterToTopLevel(elements, parentMap);

  // Every host between the drilled one and the top level owns a row, so the
  // drill has to spare all of them, not just the top. A middle host is still a
  // host: dropping its row drops its keyframe lane with it.
  const drillPath = new Set<string>();
  for (let cursor: string | undefined = siblingParentId; cursor; ) {
    if (drillPath.has(cursor)) break;
    drillPath.add(cursor);
    if (cursor === topLevelId) break;
    cursor = parentMap.get(cursor);
  }
  // Children hang under the DEEPEST host on that path, so anchor them there
  // when it has a row of its own and fall back to the top-level row when it
  // does not (a host that lives only in the manifest never had one).
  const anchorsChildren = (el: TimelineElement): boolean =>
    drillPath.has(siblingParentId) && elements.some((e) => (e.domId ?? e.id) === siblingParentId)
      ? (el.domId ?? el.id) === siblingParentId
      : (el.key ?? el.id) === parentKey;

  // ADDITIVE drill-in: the host row stays and its children are appended under
  // it. Expansion is also triggered by the playhead alone (active auto-expand),
  // so substituting the host row made it vanish on an ordinary seek, and with
  // it the host's keyframe lane, since diamonds render per row from
  // `keyframeCache.get(elementKey)`. The synthetic fractional lanes above sit
  // strictly between the host's lane and the next integer, so the children have
  // their own rows without the host having to give up its own.
  return elements
    .filter(
      (el) =>
        (el.key ?? el.id) === parentKey ||
        drillPath.has(el.domId ?? el.id) ||
        !parentMap.has(el.domId ?? el.id),
    )
    .flatMap((el) => (anchorsChildren(el) ? [el, ...expanded] : [el]));
}

export function useExpandedTimelineElements(): TimelineElement[] {
  const elements = usePlayerStore((s) => s.elements);
  const clipManifest = usePlayerStore((s) => s.clipManifest);
  const clipParentMap = usePlayerStore((s) => s.clipParentMap);
  const domClipChildren = usePlayerStore((s) => s.domClipChildren);
  const selectedElementId = usePlayerStore((s) => s.selectedElementId);
  const currentTime = usePlayerStore((s) => s.currentTime);

  // Resolve which raw clip drives expansion from the store's committed playhead
  // time. The RAF loop keeps live time out of React and Zustand during playback,
  // so this target deliberately stays stable until the loop commits or a seek /
  // pause updates the store. The scan re-runs on scrub ticks, but its RESULT only
  // changes when the playhead crosses a composition boundary. Keying the expensive
  // build below on these ids (not raw currentTime) avoids re-allocating
  // expandedElements — and cascading TimelineClip re-renders — on every tick.
  const { rawId, selectedRawId } = useMemo(() => {
    if (!clipManifest || clipManifest.length === 0 || clipParentMap.size === 0) {
      return { rawId: null as string | null, selectedRawId: null as string | null };
    }
    return {
      rawId: resolveTimelineExpansionRawId({
        selectedElementId,
        currentTime,
        manifest: clipManifest,
        parentMap: clipParentMap,
      }),
      selectedRawId: resolveRawId(selectedElementId, clipManifest, clipParentMap),
    };
  }, [clipManifest, clipParentMap, selectedElementId, currentTime]);

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
