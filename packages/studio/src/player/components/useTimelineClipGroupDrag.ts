import { useCallback, useRef, type RefObject } from "react";
import type {
  TimelineGroupMoveChange,
  TimelineGroupResizeChange,
} from "../../hooks/useTimelineGroupEditing";
import type { TimelineElement } from "../store/playerStore";
import {
  getTimelineEditCapabilities,
  resolveTimelineGroupMove,
  resolveTimelineGroupResize,
  type TimelineGroupResizeEdge,
  type TimelineGroupTimingMember,
} from "./timelineEditing";

type TimelineResizeUpdates = Pick<TimelineElement, "start" | "duration" | "playbackStart">;

type UpdateTimelineElement = (
  elementId: string,
  updates: Partial<Pick<TimelineElement, "start" | "duration" | "playbackStart">>,
) => void;

interface GroupTimingMember extends TimelineGroupTimingMember {
  element: TimelineElement;
  key: string;
}

interface MoveSession {
  grabbedKey: string;
  members: GroupTimingMember[];
  changes: TimelineGroupMoveChange[];
  hasChanged: boolean;
}

interface ResizeSession {
  grabbedKey: string;
  edge: TimelineGroupResizeEdge;
  members: GroupTimingMember[];
  changes: TimelineGroupResizeChange[];
  hasChanged: boolean;
}

interface UseTimelineClipGroupDragInput {
  timelineElementsRef: RefObject<TimelineElement[]>;
  updateElement: UpdateTimelineElement;
  onMoveElementsRef: RefObject<
    ((changes: TimelineGroupMoveChange[]) => Promise<void> | void) | undefined
  >;
  onResizeElementsRef: RefObject<
    ((changes: TimelineGroupResizeChange[]) => Promise<void> | void) | undefined
  >;
  onPreviewMoveElementsRef: RefObject<((changes: TimelineGroupMoveChange[]) => void) | undefined>;
  onPreviewResizeElementsRef: RefObject<
    ((changes: TimelineGroupResizeChange[]) => void) | undefined
  >;
}

interface PreviewGroupMoveResult {
  active: boolean;
  previewStart: number;
}

interface PreviewGroupResizeResult {
  active: boolean;
  updates: TimelineResizeUpdates;
}

function elementKey(element: TimelineElement): string {
  return element.key ?? element.id;
}

function isMediaElement(element: TimelineElement): boolean {
  const normalizedTag = element.tag.toLowerCase();
  return normalizedTag === "audio" || normalizedTag === "video";
}

function selectedElementSet(selectedElementIdsInput: Set<string>): Set<string> {
  return selectedElementIdsInput instanceof Set ? selectedElementIdsInput : new Set<string>();
}

function selectedMembers(
  grabbedElement: TimelineElement,
  selectedElementIdsInput: Set<string>,
  timelineElements: readonly TimelineElement[],
  mapMember: (element: TimelineElement) => GroupTimingMember,
  canEdit: (element: TimelineElement) => boolean,
): GroupTimingMember[] | null {
  const selectedElementIds = selectedElementSet(selectedElementIdsInput);
  const grabbedKey = elementKey(grabbedElement);
  if (selectedElementIds.size <= 1 || !selectedElementIds.has(grabbedKey)) return null;

  const elements = timelineElements.filter((element) =>
    selectedElementIds.has(elementKey(element)),
  );
  // A group edit must not touch a member that individually forbids this operation
  // (e.g. a locked or implicitly-timed clip). If any member can't take it, don't form
  // a group; the gesture degrades to a normal single-clip edit of the grabbed clip.
  if (!elements.every(canEdit)) return null;
  const members = elements.map(mapMember);
  return members.length > 1 ? members : null;
}

function moveMember(element: TimelineElement): GroupTimingMember {
  return {
    element,
    key: elementKey(element),
    start: element.start,
    duration: element.duration,
  };
}

function resizeMember(edge: TimelineGroupResizeEdge, element: TimelineElement): GroupTimingMember {
  const shouldSeedPlaybackStart = edge === "start" && isMediaElement(element);
  return {
    element,
    key: elementKey(element),
    start: element.start,
    duration: element.duration,
    playbackStart: shouldSeedPlaybackStart ? (element.playbackStart ?? 0) : element.playbackStart,
    playbackRate: element.playbackRate,
  };
}

function sameGesture(sessionKey: string, element: TimelineElement): boolean {
  return sessionKey === elementKey(element);
}

function createMoveSession(
  element: TimelineElement,
  selectedElementIds: Set<string>,
  timelineElements: readonly TimelineElement[],
): MoveSession | null {
  const members = selectedMembers(
    element,
    selectedElementIds,
    timelineElements,
    moveMember,
    (candidate) => getTimelineEditCapabilities(candidate).canMove,
  );
  if (!members) return null;
  return {
    grabbedKey: elementKey(element),
    members,
    changes: [],
    hasChanged: false,
  };
}

function createResizeSession(
  element: TimelineElement,
  selectedElementIds: Set<string>,
  timelineElements: readonly TimelineElement[],
  edge: TimelineGroupResizeEdge,
): ResizeSession | null {
  const members = selectedMembers(
    element,
    selectedElementIds,
    timelineElements,
    (member) => resizeMember(edge, member),
    (candidate) => {
      const caps = getTimelineEditCapabilities(candidate);
      return edge === "start" ? caps.canTrimStart : caps.canTrimEnd;
    },
  );
  if (!members) return null;
  return {
    grabbedKey: elementKey(element),
    edge,
    members,
    changes: [],
    hasChanged: false,
  };
}

function resolveMoveChanges(
  session: MoveSession,
  previewStart: number,
): TimelineGroupMoveChange[] | null {
  const grabbed = session.members.find((member) => member.key === session.grabbedKey);
  if (!grabbed) return null;
  const result = resolveTimelineGroupMove(session.members, previewStart - grabbed.start);
  return result.members.map((member, index) => ({
    element: session.members[index]!.element,
    start: member.start,
  }));
}

function resizeRawDelta(session: ResizeSession, updates: TimelineResizeUpdates): number | null {
  const grabbed = session.members.find((member) => member.key === session.grabbedKey);
  if (!grabbed) return null;
  return session.edge === "start"
    ? updates.start - grabbed.start
    : updates.duration - grabbed.duration;
}

function resolveResizeChanges(
  session: ResizeSession,
  updates: TimelineResizeUpdates,
): TimelineGroupResizeChange[] | null {
  const rawDelta = resizeRawDelta(session, updates);
  if (rawDelta == null) return null;
  const result = resolveTimelineGroupResize(session.members, session.edge, rawDelta);
  return result.members.map((member, index) => ({
    element: session.members[index]!.element,
    start: member.start,
    duration: member.duration,
    playbackStart: member.playbackStart,
  }));
}

function moveSessionHasChanged(
  session: MoveSession,
  changes: readonly TimelineGroupMoveChange[],
): boolean {
  return changes.some((change, index) => change.start !== session.members[index]!.start);
}

function resizeSessionHasChanged(
  session: ResizeSession,
  changes: readonly TimelineGroupResizeChange[],
): boolean {
  return changes.some((change, index) => {
    const member = session.members[index]!;
    return (
      change.start !== member.start ||
      change.duration !== member.duration ||
      change.playbackStart !== member.playbackStart
    );
  });
}

function previewStartForGrabbed(
  session: MoveSession,
  changes: readonly TimelineGroupMoveChange[],
  fallback: number,
): number {
  const change = changes.find((candidate) => elementKey(candidate.element) === session.grabbedKey);
  return change?.start ?? fallback;
}

function resizeUpdatesForGrabbed(
  session: ResizeSession,
  changes: readonly TimelineGroupResizeChange[],
  fallback: TimelineResizeUpdates,
): TimelineResizeUpdates {
  const change = changes.find((candidate) => elementKey(candidate.element) === session.grabbedKey);
  if (!change) return fallback;
  return {
    start: change.start,
    duration: change.duration,
    playbackStart: change.playbackStart,
  };
}

export function useTimelineClipGroupDrag({
  timelineElementsRef,
  updateElement,
  onMoveElementsRef,
  onResizeElementsRef,
  onPreviewMoveElementsRef,
  onPreviewResizeElementsRef,
}: UseTimelineClipGroupDragInput) {
  const moveSessionRef = useRef<MoveSession | null>(null);
  const resizeSessionRef = useRef<ResizeSession | null>(null);

  const rollbackMove = useCallback(
    (session: MoveSession) => {
      const changes = session.members.map((member) => ({
        element: member.element,
        start: member.start,
      }));
      for (const change of changes) {
        updateElement(elementKey(change.element), { start: change.start });
      }
      onPreviewMoveElementsRef.current?.(changes);
    },
    [onPreviewMoveElementsRef, updateElement],
  );

  const rollbackResize = useCallback(
    (session: ResizeSession) => {
      const changes = session.members.map((member) => ({
        element: member.element,
        start: member.start,
        duration: member.duration,
        playbackStart: member.playbackStart,
      }));
      for (const change of changes) {
        updateElement(elementKey(change.element), {
          start: change.start,
          duration: change.duration,
          playbackStart: change.playbackStart,
        });
      }
      onPreviewResizeElementsRef.current?.(changes);
    },
    [onPreviewResizeElementsRef, updateElement],
  );

  const previewGroupMove = useCallback(
    (
      element: TimelineElement,
      selectedElementIds: Set<string>,
      previewStart: number,
    ): PreviewGroupMoveResult => {
      let session = moveSessionRef.current;
      if (!session || !sameGesture(session.grabbedKey, element)) {
        if (!onMoveElementsRef.current) return { active: false, previewStart };
        session = createMoveSession(element, selectedElementIds, timelineElementsRef.current);
        if (!session) return { active: false, previewStart };
        moveSessionRef.current = session;
      }

      const changes = resolveMoveChanges(session, previewStart);
      if (!changes) return { active: false, previewStart };
      session.changes = changes;
      session.hasChanged = moveSessionHasChanged(session, changes);

      for (const change of changes) {
        updateElement(elementKey(change.element), { start: change.start });
      }
      onPreviewMoveElementsRef.current?.(changes);

      return {
        active: true,
        previewStart: previewStartForGrabbed(session, changes, previewStart),
      };
    },
    [onMoveElementsRef, onPreviewMoveElementsRef, timelineElementsRef, updateElement],
  );

  const previewGroupResize = useCallback(
    (
      element: TimelineElement,
      selectedElementIds: Set<string>,
      edge: TimelineGroupResizeEdge,
      updates: TimelineResizeUpdates,
    ): PreviewGroupResizeResult => {
      let session = resizeSessionRef.current;
      if (!session || !sameGesture(session.grabbedKey, element) || session.edge !== edge) {
        if (!onResizeElementsRef.current) return { active: false, updates };
        session = createResizeSession(
          element,
          selectedElementIds,
          timelineElementsRef.current,
          edge,
        );
        if (!session) return { active: false, updates };
        resizeSessionRef.current = session;
      }

      const changes = resolveResizeChanges(session, updates);
      if (!changes) return { active: false, updates };
      session.changes = changes;
      session.hasChanged = resizeSessionHasChanged(session, changes);

      for (const change of changes) {
        updateElement(elementKey(change.element), {
          start: change.start,
          duration: change.duration,
          playbackStart: change.playbackStart,
        });
      }
      onPreviewResizeElementsRef.current?.(changes);

      return {
        active: true,
        updates: resizeUpdatesForGrabbed(session, changes, updates),
      };
    },
    [onPreviewResizeElementsRef, onResizeElementsRef, timelineElementsRef, updateElement],
  );

  const commitGroupMove = useCallback(
    (element: TimelineElement): boolean => {
      const session = moveSessionRef.current;
      if (!session || !sameGesture(session.grabbedKey, element)) return false;
      moveSessionRef.current = null;
      if (!session.hasChanged) return true;

      Promise.resolve(onMoveElementsRef.current?.(session.changes)).catch((error) => {
        rollbackMove(session);
        console.error("[Timeline] Failed to persist group clip move", error);
      });
      return true;
    },
    [onMoveElementsRef, rollbackMove],
  );

  const commitGroupResize = useCallback(
    (element: TimelineElement): boolean => {
      const session = resizeSessionRef.current;
      if (!session || !sameGesture(session.grabbedKey, element)) return false;
      resizeSessionRef.current = null;
      if (!session.hasChanged) return true;

      Promise.resolve(onResizeElementsRef.current?.(session.changes)).catch((error) => {
        rollbackResize(session);
        console.error("[Timeline] Failed to persist group clip resize", error);
      });
      return true;
    },
    [onResizeElementsRef, rollbackResize],
  );

  const clearGroupDragSessions = useCallback(() => {
    moveSessionRef.current = null;
    resizeSessionRef.current = null;
  }, []);

  return {
    previewGroupMove,
    previewGroupResize,
    commitGroupMove,
    commitGroupResize,
    clearGroupDragSessions,
  };
}
