import * as readout from "./domEditGestureReadoutState";
import { createPreviewGestureStarts } from "./previewGestureStarts";
import { trackPreviewEditResult } from "../../utils/previewFeatureUsage";
// fallow-ignore-file code-duplication
/**
 * Gesture handling for DomEditOverlay.
 * Owns: onPointerMove, onPointerUp, clearPointerState.
 * startGesture and startGroupDrag live in domEditOverlayStartGesture.ts.
 */
import type { RefObject } from "react";
import { type DomEditSelection } from "./domEditing";
import {
  applyManualOffsetDragCommit,
  applyManualOffsetDragDraft,
  endManualOffsetDragMembers,
  restoreManualOffsetDragMembers,
} from "./manualOffsetDrag";
import { manualOffsetMoveRevert, elementLookRevert } from "./gestureUndoRevert";
import {
  applyRotationDraft,
  endRotationGestureIfCurrent,
  restoreRotationDraft,
} from "./rotationDraft";
import {
  applyStudioBoxSize,
  applyStudioBoxSizeDraft,
  endStudioManualEditGesture,
  isStudioManualEditGestureCurrent,
  readStudioBoxSize,
  restoreStudioBoxSize,
  restoreStudioPathOffset,
} from "./manualEdits";
import {
  type GroupOverlayItem,
  type OverlayRect,
  orientedOverlayRect,
  shiftedOverlayRect,
} from "./domEditOverlayGeometry";
import {
  BLOCKED_MOVE_THRESHOLD_PX,
  drawGroupOutline,
  drawSelectionOutline,
  type GestureState,
  type GroupGestureState,
  type UseDomEditOverlayGesturesOptions,
  hasDomEditRotationChanged,
  movesGesture,
  isDomEditGestureTap,
} from "./domEditOverlayGestures";
import { endResizeWithoutMember, resolveResizeDraftRect } from "./resizeDraft";
import { notifyBlockedPress } from "./domEditOverlayStartGesture";
import { logResize, logResizeMove, logResizeSettle } from "../../utils/resizeDebug";
import { logDrag, logDragSettle, readDragPositions } from "../../utils/dragDebug";
import { createGroupDragMover } from "./groupDragMove";
import { DomEditSaveQueueOpenError } from "../../utils/domEditSaveQueue";
import { beginStudioPendingEdit } from "../../utils/studioPendingEdits";
import { releaseEndedGestureHolds } from "../../player/lib/previewChannel";
import { snappedDragDelta } from "./snappedDragDelta";
import { resizeSizeAt, rotationAt } from "./gestureSteps";

function logGestureCommitFailure(message: string, error: unknown): void {
  if (error instanceof DomEditSaveQueueOpenError) return;
  console.error(message, error);
}

export function createDomEditOverlayGestureHandlers(opts: UseDomEditOverlayGesturesOptions) {
  const setDraftOverlayRect = (next: OverlayRect, syncCropFrame = false) => {
    if (opts.waitingPressRef.current) return;
    opts.setOverlayRect(next);
    drawSelectionOutline(opts.boxRef.current, opts.handlesRef.current, next, { syncCropFrame });
  };
  const restoreGestureOverlayRect = (g: GestureState) => {
    setDraftOverlayRect(
      {
        left: g.originLeft,
        top: g.originTop,
        width: g.originWidth,
        height: g.originHeight,
        editScaleX: g.editScaleX,
        editScaleY: g.editScaleY,
        // Rotation keeps the chrome aligned with the element during its draft.
        angle: g.actualRotation,
      },
      g.kind === "drag",
    );
  };
  const setDraftGroupOverlayItems = (next: GroupOverlayItem[]) => {
    if (opts.waitingPressRef.current) return;
    opts.setGroupOverlayItems(next);
    drawGroupOutline(opts.overlayRef.current, next);
  };

  const restoreGroupPathOffsets = (g: GroupGestureState) => {
    restoreManualOffsetDragMembers(g.members);
    setDraftGroupOverlayItems(g.originItems);
  };

  const { startGesture, startGroupDrag, endWaitingPress, endHeldPress, releaseWaitingPress } =
    createPreviewGestureStarts(
      opts,
      (event) => moveActiveGesture(event),
      (event) => releaseActiveGesture(event),
    );

  // A press on a box that cannot move says why at once.
  const startBlockedMove = (e: React.PointerEvent<HTMLElement>, selection: DomEditSelection) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    opts.blockedMoveRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY };
    notifyBlockedPress(e, opts, selection);
  };

  const moveGroupDrag = createGroupDragMover(opts, setDraftGroupOverlayItems);

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const waiting = opts.waitingPressRef.current;
    if (waiting && waiting.pointerId === e.pointerId) {
      if (waiting.released || !movesGesture(waiting, e)) return;
      waiting.moved = e;
      waiting.draw?.(e.clientX - waiting.startX, e.clientY - waiting.startY);
      return;
    }
    moveActiveGesture(e);
  };

  // fallow-ignore-next-line complexity
  const moveActiveGesture = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = opts.gestureRef.current;
    const groupG = opts.groupGestureRef.current;
    const sel = g?.selection ?? opts.selectionRef.current;
    const blockedMove = opts.blockedMoveRef.current;
    if (!blockedMove && !g && !groupG) {
      opts.onCanvasPointerMoveRef.current(e, { preferClipAncestor: false });
    }
    const held = g ?? groupG;
    if (held && !movesGesture(held, e)) return;

    if (blockedMove) {
      const dx = e.clientX - blockedMove.startX;
      const dy = e.clientY - blockedMove.startY;
      if (Math.hypot(dx, dy) >= BLOCKED_MOVE_THRESHOLD_PX) {
        opts.suppressNextBoxClickRef.current = true;
      }
      return;
    }

    if (groupG) {
      if (!isDomEditGestureTap(groupG, e)) groupG.travelled = true;
      moveGroupDrag(groupG, e);
      return;
    }

    if (!g || !sel) return;
    if (!isDomEditGestureTap(g, e)) g.travelled = true;
    let dx = e.clientX - g.startX;
    let dy = e.clientY - g.startY;

    if (g.kind === "rotate") {
      // Single source of truth: preview the rotation through the GSAP channel (the
      // same channel the commit lands in), not the `--hf-studio-rotation` CSS var.
      const angle = rotationAt(g, e);
      readout.updateGestureReadoutAngle(g.readout, angle, g.actualRotation);
      applyRotationDraft(sel.element, angle, g.plainRotation);
      return;
    }

    if (g.kind === "drag") {
      ({ dx, dy } = snappedDragDelta(g, e, opts.snapGuidesRef));

      const nextBoxLeft = g.originLeft + dx;
      const nextBoxTop = g.originTop + dy;
      const draftRect = {
        left: nextBoxLeft,
        top: nextBoxTop,
        width: g.originWidth,
        height: g.originHeight,
        editScaleX: g.editScaleX,
        editScaleY: g.editScaleY,
        angle: g.actualRotation,
      };
      readout.updateGestureReadout(g.readout, draftRect);
      setDraftOverlayRect(draftRect, true);
      if (g.pathOffsetMember) applyManualOffsetDragDraft(g.pathOffsetMember, dx, dy);
    } else {
      const nextSize = resizeSizeAt(g, e);
      const writtenSize = applyStudioBoxSizeDraft(sel.element, nextSize);

      const overlayEl = opts.overlayRef.current;
      const iframe = opts.iframeRef.current;
      const measureOrientedRect = () =>
        overlayEl && iframe ? orientedOverlayRect(overlayEl, iframe, sel.element) : null;

      const draftRect = resolveResizeDraftRect(
        g,
        sel.element,
        overlayEl,
        iframe,
        measureOrientedRect,
        { wanted: nextSize, written: writtenSize },
      );
      logResizeMove({
        pointer: { x: e.clientX, y: e.clientY },
        nextSize,
        anchor: g.lastResizeAnchor ?? null,
        draftRect,
        liveInlineStyle: sel.element.getAttribute("style"),
      });
      readout.updateGestureReadoutSize(g.readout, draftRect, writtenSize);
      setDraftOverlayRect(draftRect);
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const waiting = opts.waitingPressRef.current;
    if (waiting && waiting.pointerId === e.pointerId) {
      releaseWaitingPress(waiting, e);
      opts.suppressNextBoxClickRef.current = true;
      return;
    }
    releaseActiveGesture(e);
  };

  // fallow-ignore-next-line complexity
  const releaseActiveGesture = (e: React.PointerEvent<HTMLDivElement>) => {
    opts.snapGuidesRef.current = null;
    const g = opts.gestureRef.current;
    const groupG = opts.groupGestureRef.current;
    const sel = g?.selection ?? opts.selectionRef.current;
    opts.blockedMoveRef.current = null;
    opts.rafPausedRef.current = opts.waitingPressRef.current !== null;

    if (groupG) {
      opts.groupGestureRef.current = null;
      releaseEndedGestureHolds();
      const rawDx = e.clientX - groupG.startX;
      const rawDy = e.clientY - groupG.startY;
      // Consume the release click so it cannot deselect the moved group.
      opts.suppressNextBoxClickRef.current = true;
      if (isDomEditGestureTap(groupG, e)) {
        restoreGroupPathOffsets(groupG);
        if (e.shiftKey) {
          opts.onCanvasMouseDown(e as unknown as React.MouseEvent<HTMLDivElement>, {
            preferClipAncestor: false,
            hoverSelection: opts.hoverSelectionRef.current,
          });
        }
        return;
      }
      const dx = groupG.lastSnappedDx ?? rawDx;
      const dy = groupG.lastSnappedDy ?? rawDy;
      setDraftGroupOverlayItems(
        groupG.originItems.map((item) => ({
          ...item,
          rect: shiftedOverlayRect(item.rect, dx, dy),
        })),
      );
      const updates = groupG.members.map((member) => ({
        selection: member.selection,
        next: applyManualOffsetDragCommit(member, dx, dy),
        plainTranslate: member.plainTranslate,
      }));
      logDrag("drop", {
        pointer: `${Math.round(rawDx)},${Math.round(rawDy)}`,
        applied: `${Math.round(dx)},${Math.round(dy)}`,
        committed: Object.fromEntries(
          updates.map((update, index) => [
            groupG.members[index]?.key ?? String(index),
            `${Math.round(update.next.x)},${Math.round(update.next.y)}`,
          ]),
        ),
        at: readDragPositions(groupG.members),
      });
      const groupEdit = beginStudioPendingEdit(manualOffsetMoveRevert(groupG.members));
      const groupSaved = Promise.resolve(
        groupEdit.adopt(() => opts.onGroupPathOffsetCommitRef.current(updates)),
      )
        .then((result) => trackPreviewEditResult("move", "drag", result))
        .catch(() => {
          for (const member of groupG.members) {
            if (
              member.gestureToken &&
              isStudioManualEditGestureCurrent(member.element, member.gestureToken)
            )
              restoreStudioPathOffset(member.element, member.initialPathOffset);
          }
        })
        .finally(() => {
          logDrag("committed", { at: readDragPositions(groupG.members) });
          endManualOffsetDragMembers(groupG.members);
          // Teardown re-seeks the player, exposing any stale preview position.
          logDragSettle("settle", groupG.members);
        });
      groupEdit.settle(groupSaved);
      return;
    }

    opts.gestureRef.current = null;
    releaseEndedGestureHolds();
    if (!g || !sel) return;
    const movedDistance = Math.hypot(e.clientX - g.startX, e.clientY - g.startY);

    if (g.kind === "drag" && isDomEditGestureTap(g, e)) {
      if (g.pathOffsetMember) restoreManualOffsetDragMembers([g.pathOffsetMember]);
      restoreGestureOverlayRect(g);
      opts.suppressNextBoxClickRef.current = true;
      opts.onCanvasMouseDown(e as unknown as React.MouseEvent<HTMLDivElement>, {
        preferClipAncestor: false,
        hoverSelection: opts.hoverSelectionRef.current,
      });
      return;
    }

    if (g.kind === "resize" && movedDistance < BLOCKED_MOVE_THRESHOLD_PX) {
      restoreStudioBoxSize(sel.element, g.initialBoxSize);
      if (g.pathOffsetMember) {
        restoreManualOffsetDragMembers([g.pathOffsetMember]);
      } else {
        endStudioManualEditGesture(sel.element, g.manualEditDragToken);
      }
      restoreGestureOverlayRect(g);
      opts.suppressNextBoxClickRef.current = true;
      return;
    }

    if (g.kind === "rotate") {
      const finalAngle = rotationAt(g, e);
      const restoreRotation = () =>
        restoreRotationDraft(
          sel.element,
          g.actualRotation,
          g.initialRotation,
          g.plainRotation !== null,
        );
      if (!hasDomEditRotationChanged(g.actualRotation, finalAngle)) {
        restoreRotation();
        endStudioManualEditGesture(sel.element, g.manualEditDragToken);
        return;
      }
      applyRotationDraft(sel.element, finalAngle, g.plainRotation);
      const commit = { angle: finalAngle, plain: g.plainRotation };
      const edit = beginStudioPendingEdit(elementLookRevert(sel.element, g.initialLook));
      const saved = Promise.resolve(edit.adopt(() => opts.onRotationCommitRef.current(sel, commit)))
        .then((result) => trackPreviewEditResult("rotate", "drag", result))
        .catch((error) => {
          logGestureCommitFailure("rotate commit failed", error);
          if (
            g.manualEditDragToken &&
            isStudioManualEditGestureCurrent(sel.element, g.manualEditDragToken)
          )
            restoreRotation();
        })
        .finally(() => endRotationGestureIfCurrent(sel.element, g.manualEditDragToken));
      edit.settle(saved);
    } else if (g.kind === "drag") {
      // A release over another layer must keep this dragged layer selected.
      opts.suppressNextBoxClickRef.current = true;
      const dx = g.lastSnappedDx ?? e.clientX - g.startX;
      const dy = g.lastSnappedDy ?? e.clientY - g.startY;
      if (!g.pathOffsetMember) {
        return;
      }
      const finalOffset = applyManualOffsetDragCommit(g.pathOffsetMember, dx, dy);
      const nextBoxLeft = g.originLeft + dx;
      const nextBoxTop = g.originTop + dy;
      setDraftOverlayRect(
        {
          left: nextBoxLeft,
          top: nextBoxTop,
          width: g.originWidth,
          height: g.originHeight,
          editScaleX: g.editScaleX,
          editScaleY: g.editScaleY,
          angle: g.actualRotation,
        },
        true,
      );
      const member = g.pathOffsetMember;
      const edit = beginStudioPendingEdit(manualOffsetMoveRevert([member]));
      const saved = Promise.resolve(
        edit.adopt(() =>
          opts.onPathOffsetCommitRef.current(sel, finalOffset, {
            altKey: e.altKey,
            plainTranslate: member.plainTranslate,
          }),
        ),
      )
        .then((result) => trackPreviewEditResult("move", "drag", result))
        .catch(() => {
          if (
            g.pathOffsetMember?.gestureToken &&
            isStudioManualEditGestureCurrent(sel.element, g.pathOffsetMember.gestureToken)
          )
            restoreStudioPathOffset(sel.element, g.initialPathOffset);
        })
        .finally(() => {
          if (g.pathOffsetMember) endManualOffsetDragMembers([g.pathOffsetMember]);
        });
      edit.settle(saved);
    } else {
      opts.suppressNextBoxClickRef.current = true;
      const finalSize = readStudioBoxSize(sel.element);
      applyStudioBoxSize(sel.element, finalSize);
      // Save size and center-preserving offset together under one undo entry.
      const member = g.pathOffsetMember;
      const anchor = g.lastResizeAnchor;
      const finalOffset =
        member && anchor && (anchor.dx !== 0 || anchor.dy !== 0)
          ? applyManualOffsetDragCommit(member, anchor.dx, anchor.dy)
          : null;
      logResize("release", {
        finalSize,
        anchor: anchor ?? null,
        finalOffset: finalOffset ?? null,
        hasMember: !!member,
        inlineStyle: sel.element.getAttribute("style"),
      });
      const restore = () => {
        if (
          !g.manualEditDragToken ||
          !isStudioManualEditGestureCurrent(sel.element, g.manualEditDragToken)
        )
          return;
        restoreStudioBoxSize(sel.element, g.initialBoxSize);
        if (finalOffset) restoreStudioPathOffset(sel.element, g.initialPathOffset);
      };
      const commitSize = () =>
        opts.onBoxSizeCommitRef.current(sel, finalSize, finalOffset ?? undefined, restore, member);
      const edit = beginStudioPendingEdit(elementLookRevert(sel.element, g.initialLook));
      const saved = Promise.resolve(edit.adopt(commitSize))
        .then((result) => trackPreviewEditResult("resize", "drag", result))
        .catch((error) => {
          logGestureCommitFailure("resize commit failed", error);
        })
        .finally(() => {
          if (member) endManualOffsetDragMembers([member]);
          else endResizeWithoutMember(sel.element, g.manualEditDragToken);
        });
      edit.settle(saved);
      logResizeSettle(sel.element, "post-release");
    }
  };

  /** `dropQueued`: released presses still waiting go too, as when the overlay leaves or turns read-only. */
  // fallow-ignore-next-line complexity
  const clearPointerState = (
    selectionRef: RefObject<DomEditSelection | null>,
    dropQueued = false,
  ) => {
    if (dropQueued) endWaitingPress();
    else endHeldPress();
    opts.snapGuidesRef.current = null;
    const groupG = opts.groupGestureRef.current;
    if (groupG) restoreGroupPathOffsets(groupG);
    const g = opts.gestureRef.current;
    const sel = g?.selection ?? selectionRef.current;
    if (g?.mode === "path-offset" && sel) {
      if (g.pathOffsetMember) restoreManualOffsetDragMembers([g.pathOffsetMember]);
      restoreGestureOverlayRect(g);
    }
    if (g?.mode === "box-size" && sel) {
      restoreStudioBoxSize(sel.element, g.initialBoxSize);
      if (g.pathOffsetMember) {
        restoreManualOffsetDragMembers([g.pathOffsetMember]);
      } else {
        endStudioManualEditGesture(sel.element, g.manualEditDragToken);
      }
      restoreGestureOverlayRect(g);
    }
    if (g?.mode === "rotation" && sel) {
      restoreRotationDraft(
        sel.element,
        g.actualRotation,
        g.initialRotation,
        g.plainRotation !== null,
      );
      endStudioManualEditGesture(sel.element, g.manualEditDragToken);
    }
    opts.blockedMoveRef.current = null;
    opts.groupGestureRef.current = null;
    opts.gestureRef.current = null;
    releaseEndedGestureHolds();
    opts.rafPausedRef.current = opts.waitingPressRef.current !== null;
  };

  const onLostPointerCapture = (e: React.PointerEvent<HTMLDivElement>) => {
    const waiting = opts.waitingPressRef.current;
    // Pointerup releases capture normally; the queued edit still has to land.
    if (waiting?.pointerId === e.pointerId && waiting.released) return;
    clearPointerState(opts.selectionRef);
  };

  return {
    startGesture,
    startGroupDrag,
    startBlockedMove,
    onPointerMove,
    onPointerUp,
    onLostPointerCapture,
    clearPointerState,
  };
}
