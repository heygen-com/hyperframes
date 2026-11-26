import { trackPreviewEditResult } from "../../utils/previewFeatureUsage";
/**
 * Canvas arrow-key nudge for DomEditOverlay: arrows move the selected
 * element(s) 1 composition px, Shift = 10. Each keypress previews through the
 * same GSAP/CSS channel as a drag draft, and the burst commits ONCE through
 * the same onPathOffsetCommit / onGroupPathOffsetCommit path a drag drop uses
 * — so a nudge burst is exactly a tiny drag: one source patch, one undo entry.
 */
import { useCallback, useEffect, useRef, type RefObject } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";
import { ownsPlainKeys } from "@hyperframes/core/typing-target";
import { acquireCanvasNudgeKeys } from "../../utils/canvasNudgeGate";
import {
  addStudioPendingEditFlushListener,
  beginStudioPendingEdit,
} from "../../utils/studioPendingEdits";
import type { DomEditSelection } from "./domEditing";
import {
  type GroupOverlayItem,
  type OverlayRect,
  filterNestedDomEditGroupItems,
  selectionCacheKey,
} from "./domEditOverlayGeometry";
import type {
  BlockedMoveState,
  DomEditGroupPathOffsetCommit,
  MoveCommitOptions,
  GestureState,
  GroupGestureState,
  WaitingPressState,
} from "./domEditOverlayGestures";
import {
  applyManualOffsetNudgeCommit,
  applyManualOffsetNudgeDraft,
  createManualOffsetDragMember,
  endManualOffsetDragMembers,
  restoreManualOffsetDragMembers,
  type ManualOffsetDragMember,
} from "./manualOffsetDrag";
import { manualOffsetMoveRevert } from "./gestureUndoRevert";
import { isStudioManualEditGestureCurrent, restoreStudioPathOffset } from "./manualEdits";
import {
  CANVAS_NUDGE_COMMIT_DEBOUNCE_MS,
  canCanvasNudgeTargets,
  resolveCanvasNudgeDelta,
} from "./domEditNudge";
import { selectionElementLive } from "./previewSelection";
import { previewFrameOpaque } from "../../player/lib/previewChannel";
import {
  askShownGestureStarts,
  shownFromRead,
  UNANSWERED,
  unansweredMoveReason,
  type PreviewGestureStart,
} from "./previewGestureStartRead";
import { checkReadAheadWithFrame, gestureStartReadAhead } from "./gestureStartReadAhead";

interface NudgeSession {
  members: ManualOffsetDragMember[];
  isGroup: boolean;
  /** Accumulated delta of the burst, in composition px. */
  accum: { x: number; y: number };
  timer: ReturnType<typeof setTimeout> | null;
  edit: ReturnType<typeof beginStudioPendingEdit>;
}

/** A burst on a sealed frame waits for the frame's gesture-start read; keys meanwhile add to `accum`. */
interface SealedStartRead {
  accum: { x: number; y: number };
  dropped: boolean;
}

export interface UseDomEditNudgeParams {
  selection: DomEditSelection | null;
  groupSelections: DomEditSelection[];
  allowCanvasMovement: boolean;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  overlayRef: RefObject<HTMLDivElement | null>;
  activeCompositionPathRef: RefObject<string | null>;
  selectionRef: RefObject<DomEditSelection | null>;
  overlayRectRef: RefObject<OverlayRect | null>;
  groupOverlayItemsRef: RefObject<GroupOverlayItem[]>;
  gestureRef: RefObject<GestureState | null>;
  groupGestureRef: RefObject<GroupGestureState | null>;
  blockedMoveRef: RefObject<BlockedMoveState | null>;
  waitingPressRef: RefObject<WaitingPressState | null>;
  onManualDragStartRef: RefObject<(() => void) | undefined>;
  onBlockedMoveRef: RefObject<(selection: DomEditSelection, reason?: string) => void>;
  onPathOffsetCommitRef: RefObject<
    (
      s: DomEditSelection,
      n: { x: number; y: number },
      m?: MoveCommitOptions,
    ) => Promise<unknown> | void
  >;
  onGroupPathOffsetCommitRef: RefObject<
    (updates: DomEditGroupPathOffsetCommit[]) => Promise<unknown> | void
  >;
}

type NudgeTarget = {
  key: string;
  selection: DomEditSelection;
  element: HTMLElement;
  rect: OverlayRect;
  start?: PreviewGestureStart;
};

/**
 * A selection's stable identity, not its object reference. A parent that
 * doesn't memoize the selection it passes down hands us a new object every
 * render for the SAME element — keying an effect on the object itself would
 * then re-fire on every render instead of on an actual selection change.
 *
 * All discriminators are folded in (id / hfId / selector / selectorIndex /
 * label), not just the first present one: two id-less siblings can share a
 * selector, so `id ?? selector ?? label` collapsed them to the same key —
 * selecting sibling B mid-burst then didn't flush A's pending nudge, so the
 * next arrow kept moving A. selectorIndex is the discriminator that separates
 * them. The parts are only ever compared for equality (never parsed back),
 * so they're joined on a NUL delimiter — a byte no discriminator can contain,
 * so distinct selections stay distinct even when a value (e.g. a label) holds
 * a space. It's written as the escape "\u0000", not a literal 0x00 byte, so
 * this source file stays text (a raw NUL makes git treat it as binary).
 */
function selectionIdentityKey(selection: DomEditSelection | null): string {
  if (!selection) return "";
  return [
    selection.id ?? "",
    selection.hfId ?? "",
    selection.selector ?? "",
    selection.selectorIndex ?? "",
    selection.label,
  ].join("\u0000");
}

function groupSelectionsIdentityKey(selections: DomEditSelection[]): string {
  return selections.map(selectionIdentityKey).join(" ");
}

const FALLBACK_NUDGE_RECT: OverlayRect = {
  left: 0,
  top: 0,
  width: 0,
  height: 0,
  editScaleX: 1,
  editScaleY: 1,
};

function groupTargetsFromSelections(selections: DomEditSelection[]): NudgeTarget[] {
  const seen = new Set<string>();
  return selections.flatMap((selection) => {
    const key = selectionCacheKey(selection);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ key, selection, element: selection.element, rect: FALLBACK_NUDGE_RECT }];
  });
}

/** Drag members for a multi-selection nudge (same snapshot a group drag uses). */
function resolveGroupNudgeTargets(
  groupItems: GroupOverlayItem[],
  groupSelections: DomEditSelection[],
): NudgeTarget[] | null {
  const items: NudgeTarget[] =
    groupItems.length > 1 ? groupItems : groupTargetsFromSelections(groupSelections);
  if (items.length < 2 || !canCanvasNudgeTargets(items.map((item) => item.selection))) return null;
  return filterNestedDomEditGroupItems(items);
}

/** Drag member for a single-selection nudge, or null when it can't be moved. */
function resolveSingleNudgeTarget(
  sel: DomEditSelection | null,
  rect: OverlayRect | null,
): NudgeTarget[] | null {
  if (!sel || !sel.capabilities.canApplyManualOffset || !selectionElementLive(sel)) {
    return null;
  }
  return [
    {
      key: sel.id ?? sel.selector ?? sel.label,
      selection: sel,
      element: sel.element,
      rect: rect ?? FALLBACK_NUDGE_RECT,
    },
  ];
}

/**
 * True when a keydown must not start/extend a nudge: canvas movement disabled,
 * a pointer gesture owns or is about to own the element, or focus is in a field or a player.
 */
function shouldIgnoreNudgeKey(p: UseDomEditNudgeParams, event: KeyboardEvent): boolean {
  if (!p.allowCanvasMovement || event.defaultPrevented) return true;
  if (p.gestureRef.current || p.groupGestureRef.current || p.blockedMoveRef.current) return true;
  if (p.waitingPressRef.current) return true;
  return ownsPlainKeys(event.target);
}

export function useDomEditNudge(params: UseDomEditNudgeParams): { flushNudge: () => void } {
  const sessionRef = useRef<NudgeSession | null>(null);
  const readingRef = useRef<SealedStartRead | null>(null);
  const paramsRef = useRef(params);
  paramsRef.current = params;

  // Commit the pending burst: one source write per burst = one undo entry.
  // Mirrors the drag's onPointerUp — same commit callbacks, same failure
  // restore, same member teardown.
  const commitSession = (): Promise<unknown> | undefined => {
    if (cancelSealedRead()) return undefined;
    const session = sessionRef.current;
    if (!session) return undefined;
    sessionRef.current = null;
    if (session.timer) clearTimeout(session.timer);
    const p = paramsRef.current;
    let saved: Promise<unknown> | undefined;
    try {
      const updates: DomEditGroupPathOffsetCommit[] = session.members.map((member) => ({
        selection: member.selection,
        next: applyManualOffsetNudgeCommit(member, session.accum),
        plainTranslate: member.plainTranslate,
      }));
      const commit = session.edit.adopt(() =>
        session.isGroup
          ? p.onGroupPathOffsetCommitRef.current(updates)
          : p.onPathOffsetCommitRef.current(updates[0].selection, updates[0].next, {
              plainTranslate: updates[0].plainTranslate,
            }),
      );
      if (session.edit.reverted())
        for (const member of session.members)
          restoreStudioPathOffset(member.element, member.initialPathOffset);
      saved = Promise.resolve(commit)
        .then((result) => trackPreviewEditResult("nudge", "keyboard", result))
        .catch(() => {
          for (const member of session.members) {
            if (isStudioManualEditGestureCurrent(member.element, member.gestureToken)) {
              restoreStudioPathOffset(member.element, member.initialPathOffset);
            }
          }
        })
        .finally(() => endManualOffsetDragMembers(session.members));
      return saved;
    } finally {
      session.edit.settle(saved);
    }
  };
  // Whatever flushes a burst still waiting on its frame (a drag, a selection change, another edit) owns the element
  // now: the keys are dropped, nothing was drawn yet, and the next arrow starts a fresh read on the current target.
  const cancelSealedRead = (): boolean => {
    const reading = readingRef.current;
    if (!reading) return false;
    reading.dropped = true;
    readingRef.current = null;
    return true;
  };
  const commitSessionRef = useRef(commitSession);
  commitSessionRef.current = commitSession;

  useEffect(() => {
    if (params.allowCanvasMovement) return;
    cancelSealedRead();
    if (!sessionRef.current) return;
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session.timer) clearTimeout(session.timer);
    restoreManualOffsetDragMembers(session.members);
    endManualOffsetDragMembers(session.members);
    session.edit.settle();
  }, [params.allowCanvasMovement]);

  // Build drag members for the current target set — the same member snapshot a
  // pointer drag starts from (startGesture / startGroupDrag), so the nudge
  // commit converts offsets → GSAP x/y with identical math.
  const nudgeTargets = () => {
    const p = paramsRef.current;
    const groupItems = p.groupOverlayItemsRef.current;
    const isGroup = groupItems.length > 1 || p.groupSelections.length > 1;
    const targets = isGroup
      ? resolveGroupNudgeTargets(groupItems, p.groupSelections)
      : resolveSingleNudgeTarget(p.selectionRef.current, p.overlayRectRef.current);
    return targets && { targets, isGroup };
  };

  const beginSession = (
    found: { targets: NudgeTarget[]; isGroup: boolean },
    repeat: boolean,
  ): NudgeSession | "refused" | null => {
    const p = paramsRef.current;
    const { targets, isGroup } = found;
    // Same side effect a drag start has (pauses preview playback).
    p.onManualDragStartRef.current?.();
    const members: ManualOffsetDragMember[] = [];
    for (const target of targets) {
      const result = createManualOffsetDragMember({ ...target, gesture: "nudge" });
      if (!result.ok) {
        restoreManualOffsetDragMembers(members);
        if (!repeat) p.onBlockedMoveRef.current(result.selection, result.reason);
        return "refused";
      }
      members.push(result.member);
    }
    if (members.length === 0) return null;
    const edit = beginStudioPendingEdit(manualOffsetMoveRevert(members));
    return { members, isGroup, accum: { x: 0, y: 0 }, timer: null, edit };
  };

  const startBurst = (session: NudgeSession) => {
    sessionRef.current = session;
    for (const member of session.members) applyManualOffsetNudgeDraft(member, session.accum);
    if (session.timer) clearTimeout(session.timer);
    session.timer = setTimeout(() => commitSessionRef.current(), CANVAS_NUDGE_COMMIT_DEBOUNCE_MS);
  };

  const startFromReadAhead = (
    iframe: HTMLIFrameElement,
    found: { targets: NudgeTarget[]; isGroup: boolean },
    repeat: boolean,
  ): NudgeSession | "refused" | null => {
    const p = paramsRef.current;
    const overlay = p.overlayRef.current;
    if (!overlay) return null;
    const selections = found.targets.map((target) => target.selection);
    const read = gestureStartReadAhead(p, iframe, selections, false);
    const shown = read && shownFromRead(read, iframe, overlay, selections);
    if (!read || typeof shown !== "object" || !shown) return null;
    checkReadAheadWithFrame(iframe, read);
    const targets = found.targets.map((target, i) => ({ ...target, ...shown.shown[i] }));
    return beginSession({ targets, isGroup: found.isGroup }, repeat);
  };

  // A sealed frame's stand-in has no GSAP or translate: its members start from the frame's read, as a press does.
  const readSealedStart = (
    iframe: HTMLIFrameElement,
    found: { targets: NudgeTarget[]; isGroup: boolean },
  ): SealedStartRead => {
    const p = paramsRef.current;
    const selections = found.targets.map((target) => target.selection);
    const read: SealedStartRead = { accum: { x: 0, y: 0 }, dropped: false };
    void askShownGestureStarts(
      iframe,
      p.overlayRef.current,
      p.activeCompositionPathRef.current,
      selections,
    )
      .catch(() => null)
      .then((answer) => {
        if (readingRef.current === read) readingRef.current = null;
        if (!read.dropped) startFrom(answer);
      });
    const startFrom = (answer: Awaited<ReturnType<typeof askShownGestureStarts>> | null) => {
      if (answer === UNANSWERED && selections[0])
        p.onBlockedMoveRef.current(selections[0], unansweredMoveReason(iframe));
      if (!answer || answer === UNANSWERED) return;
      const targets = found.targets.map((target, i) => ({ ...target, ...answer.shown[i] }));
      const session = beginSession({ targets, isGroup: found.isGroup }, false);
      if (!session || session === "refused") return;
      session.accum = read.accum;
      startBurst(session);
    };
    return read;
  };

  const openSession = (repeat: boolean, delta: { dx: number; dy: number }) => {
    const found = nudgeTargets();
    if (!found) return null;
    const iframe = paramsRef.current.iframeRef.current;
    if (iframe && previewFrameOpaque(iframe)) {
      const fromRead = startFromReadAhead(iframe, found, repeat);
      if (fromRead) return fromRead;
      const read = readSealedStart(iframe, found);
      read.accum = { x: delta.dx, y: delta.dy };
      readingRef.current = read;
      return "reading" as const;
    }
    return beginSession(found, repeat);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    const p = paramsRef.current;
    if (shouldIgnoreNudgeKey(p, event)) return;
    const delta = resolveCanvasNudgeDelta(event);
    if (!delta) return;
    if (readingRef.current) {
      readingRef.current.accum = {
        x: readingRef.current.accum.x + delta.dx,
        y: readingRef.current.accum.y + delta.dy,
      };
      return void event.preventDefault();
    }
    const session = sessionRef.current ?? openSession(event.repeat, delta);
    if (session === "reading" || session === "refused") return void event.preventDefault();
    if (!session) return;
    event.preventDefault();
    session.accum = { x: session.accum.x + delta.dx, y: session.accum.y + delta.dy };
    startBurst(session);
  };
  const handleKeyDownRef = useRef(handleKeyDown);
  handleKeyDownRef.current = handleKeyDown;

  useMountEffect(() => {
    const listener = (event: KeyboardEvent) => handleKeyDownRef.current(event);
    // Capture, like the other app-level key handlers, so a focused panel
    // can't swallow the nudge before it reaches us.
    window.addEventListener("keydown", listener, true);
    const stopCommitOnUndoDrain = addStudioPendingEditFlushListener(() =>
      commitSessionRef.current(),
    );
    return () => {
      window.removeEventListener("keydown", listener, true);
      stopCommitOnUndoDrain();
      commitSessionRef.current();
    };
  });

  // Selection change ends the burst: commit to the OLD target before the
  // arrows start moving the new one. Keyed on the selection's stable identity
  // (id/selector/label), NOT the object reference — a parent that re-creates
  // the selection object on every render (without memoizing it) must not
  // flush a burst that's still in progress for the same element.
  const selectionKey = selectionIdentityKey(params.selection);
  const groupSelectionsKey = groupSelectionsIdentityKey(params.groupSelections);
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => () => void commitSessionRef.current(), [selectionKey, groupSelectionsKey]);

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
