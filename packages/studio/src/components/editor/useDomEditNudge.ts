/**
 * Canvas arrow-key nudge for DomEditOverlay: arrows move the selected
 * element(s) 1 composition px, Shift = 10. Each keypress previews through the
 * same GSAP/CSS channel as a drag draft, and the burst commits ONCE through
 * the same onPathOffsetCommit / onGroupPathOffsetCommit path a drag drop uses
 * — so a nudge burst is exactly a tiny drag: one source patch, one undo entry.
 */
import { useCallback, useEffect, useRef, type RefObject } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";
import { isEditableTarget } from "../../utils/timelineDiscovery";
import { acquireCanvasNudgeKeys } from "../../utils/canvasNudgeGate";
import type { DomEditSelection } from "./domEditing";
import {
  type GroupOverlayItem,
  type OverlayRect,
  filterNestedDomEditGroupItems,
} from "./domEditOverlayGeometry";
import type {
  BlockedMoveState,
  DomEditGroupPathOffsetCommit,
  GestureState,
  GroupGestureState,
} from "./domEditOverlayGestures";
import {
  applyManualOffsetNudgeCommit,
  applyManualOffsetNudgeDraft,
  createManualOffsetDragMember,
  endManualOffsetDragMembers,
  restoreManualOffsetDragMembers,
  type ManualOffsetDragMember,
} from "./manualOffsetDrag";
import { isStudioManualEditGestureCurrent, restoreStudioPathOffset } from "./manualEdits";
import {
  CANVAS_NUDGE_COMMIT_DEBOUNCE_MS,
  canCanvasNudgeTargets,
  resolveCanvasNudgeDelta,
} from "./domEditNudge";

interface NudgeSession {
  members: ManualOffsetDragMember[];
  isGroup: boolean;
  /** Accumulated delta of the burst, in composition px. */
  accum: { x: number; y: number };
  timer: ReturnType<typeof setTimeout> | null;
}

export interface UseDomEditNudgeParams {
  selection: DomEditSelection | null;
  groupSelections: DomEditSelection[];
  allowCanvasMovement: boolean;
  selectionRef: RefObject<DomEditSelection | null>;
  overlayRectRef: RefObject<OverlayRect | null>;
  groupOverlayItemsRef: RefObject<GroupOverlayItem[]>;
  gestureRef: RefObject<GestureState | null>;
  groupGestureRef: RefObject<GroupGestureState | null>;
  blockedMoveRef: RefObject<BlockedMoveState | null>;
  onManualDragStartRef: RefObject<(() => void) | undefined>;
  onPathOffsetCommitRef: RefObject<
    (
      s: DomEditSelection,
      n: { x: number; y: number },
      m?: { altKey?: boolean },
    ) => Promise<void> | void
  >;
  onGroupPathOffsetCommitRef: RefObject<
    (updates: DomEditGroupPathOffsetCommit[]) => Promise<void> | void
  >;
}

type NudgeTarget = {
  key: string;
  selection: DomEditSelection;
  element: HTMLElement;
  rect: OverlayRect;
};

/** Drag members for a multi-selection nudge (same snapshot a group drag uses). */
function resolveGroupNudgeTargets(groupItems: GroupOverlayItem[]): NudgeTarget[] | null {
  if (!canCanvasNudgeTargets(groupItems.map((item) => item.selection))) return null;
  return filterNestedDomEditGroupItems(groupItems);
}

/** Drag member for a single-selection nudge, or null when it can't be moved. */
function resolveSingleNudgeTarget(
  sel: DomEditSelection | null,
  rect: OverlayRect | null,
): NudgeTarget[] | null {
  if (!sel || !rect || !sel.capabilities.canApplyManualOffset || !sel.element.isConnected) {
    return null;
  }
  return [{ key: sel.id ?? sel.selector ?? sel.label, selection: sel, element: sel.element, rect }];
}

/**
 * True when a keydown must not start/extend a nudge: canvas movement disabled,
 * a pointer gesture already owns the element, or the user is typing in a field.
 */
function shouldIgnoreNudgeKey(p: UseDomEditNudgeParams, event: KeyboardEvent): boolean {
  if (!p.allowCanvasMovement || event.defaultPrevented) return true;
  if (p.gestureRef.current || p.groupGestureRef.current || p.blockedMoveRef.current) return true;
  return isEditableTarget(event.target);
}

export function useDomEditNudge(params: UseDomEditNudgeParams): { flushNudge: () => void } {
  const sessionRef = useRef<NudgeSession | null>(null);
  const paramsRef = useRef(params);
  paramsRef.current = params;

  // Commit the pending burst: one source write per burst = one undo entry.
  // Mirrors the drag's onPointerUp — same commit callbacks, same failure
  // restore, same member teardown.
  const commitSession = () => {
    const session = sessionRef.current;
    if (!session) return;
    sessionRef.current = null;
    if (session.timer) clearTimeout(session.timer);
    const updates: DomEditGroupPathOffsetCommit[] = session.members.map((member) => ({
      selection: member.selection,
      next: applyManualOffsetNudgeCommit(member, session.accum),
    }));
    const p = paramsRef.current;
    const commit = session.isGroup
      ? p.onGroupPathOffsetCommitRef.current(updates)
      : p.onPathOffsetCommitRef.current(updates[0].selection, updates[0].next);
    void Promise.resolve(commit)
      .catch(() => {
        for (const member of session.members) {
          if (isStudioManualEditGestureCurrent(member.element, member.gestureToken)) {
            restoreStudioPathOffset(member.element, member.initialPathOffset);
          }
        }
      })
      .finally(() => endManualOffsetDragMembers(session.members));
  };
  const commitSessionRef = useRef(commitSession);
  commitSessionRef.current = commitSession;

  // Build drag members for the current target set — the same member snapshot a
  // pointer drag starts from (startGesture / startGroupDrag), so the nudge
  // commit converts offsets → GSAP x/y with identical math.
  const beginSession = (): NudgeSession | null => {
    const p = paramsRef.current;
    const groupItems = p.groupOverlayItemsRef.current;
    const isGroup = groupItems.length > 1;
    const targets = isGroup
      ? resolveGroupNudgeTargets(groupItems)
      : resolveSingleNudgeTarget(p.selectionRef.current, p.overlayRectRef.current);
    if (!targets) return null;
    const members: ManualOffsetDragMember[] = [];
    for (const target of targets) {
      const result = createManualOffsetDragMember(target);
      if (!result.ok) {
        restoreManualOffsetDragMembers(members);
        return null;
      }
      members.push(result.member);
    }
    if (members.length === 0) return null;
    // Same side effect a drag start has (pauses preview playback).
    p.onManualDragStartRef.current?.();
    return { members, isGroup, accum: { x: 0, y: 0 }, timer: null };
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    const p = paramsRef.current;
    if (shouldIgnoreNudgeKey(p, event)) return;
    const delta = resolveCanvasNudgeDelta(event);
    if (!delta) return;
    const session = sessionRef.current ?? beginSession();
    if (!session) return;
    sessionRef.current = session;
    event.preventDefault();
    session.accum = { x: session.accum.x + delta.dx, y: session.accum.y + delta.dy };
    for (const member of session.members) applyManualOffsetNudgeDraft(member, session.accum);
    if (session.timer) clearTimeout(session.timer);
    session.timer = setTimeout(() => commitSessionRef.current(), CANVAS_NUDGE_COMMIT_DEBOUNCE_MS);
  };
  const handleKeyDownRef = useRef(handleKeyDown);
  handleKeyDownRef.current = handleKeyDown;

  useMountEffect(() => {
    const listener = (event: KeyboardEvent) => handleKeyDownRef.current(event);
    // Capture, like the other app-level key handlers, so a focused panel
    // can't swallow the nudge before it reaches us.
    window.addEventListener("keydown", listener, true);
    return () => {
      window.removeEventListener("keydown", listener, true);
      commitSessionRef.current();
    };
  });

  // Selection change ends the burst: commit to the OLD target before the
  // arrows start moving the new one.
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => () => commitSessionRef.current(), [params.selection, params.groupSelections]);

  // Claim the arrow keys from the playback frame-step while the selection is
  // nudgeable (see canvasNudgeGate — listener order is mount-dependent, so
  // preventDefault alone can't arbitrate).
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    const targets =
      params.groupSelections.length > 1
        ? params.groupSelections
        : params.selection
          ? [params.selection]
          : [];
    if (!params.allowCanvasMovement || !canCanvasNudgeTargets(targets)) return;
    return acquireCanvasNudgeKeys();
  }, [params.selection, params.groupSelections, params.allowCanvasMovement]);

  // A pointer gesture supersedes a pending burst — DomEditOverlay flushes on
  // pointerdown-capture so the drag's member snapshot starts from the nudged,
  // committed position.
  const flushNudge = useCallback(() => commitSessionRef.current(), []);
  return { flushNudge };
}
