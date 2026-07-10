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
  applyRotationDraftViaGsap,
  endManualOffsetDragMembers,
  restoreManualOffsetDragMembers,
  resumeGsapTimelines,
} from "./manualOffsetDrag";
import {
  applyStudioBoxSize,
  applyStudioBoxSizeDraft,
  applyStudioRotation,
  applyStudioRotationDraft,
  endStudioManualEditGesture,
  isStudioManualEditGestureCurrent,
  readStudioBoxSize,
  restoreStudioBoxSize,
  restoreStudioPathOffset,
  restoreStudioRotation,
} from "./manualEdits";
import {
  type GroupOverlayItem,
  type OverlayRect,
  elementCornerOverlayPoints,
  orientedOverlayRect,
  resolveDomEditGroupOverlayRect,
} from "./domEditOverlayGeometry";
import {
  BLOCKED_MOVE_THRESHOLD_PX,
  type GestureKind,
  type GestureState,
  type GroupGestureState,
  type ResizeHandle,
  type UseDomEditOverlayGesturesOptions,
  ROTATED_SNAP_BYPASS_DEGREES,
  anchorCornerForHandle,
  hasDomEditRotationChanged,
  resolveDomEditRotationGesture,
  resolveResizeAnchorOffset,
} from "./domEditOverlayGestures";
import { resolveLocalResizeSize } from "./domEditResizeLocal";
import {
  startGesture as _startGesture,
  startGroupDrag as _startGroupDrag,
} from "./domEditOverlayStartGesture";
import { hugRectForElement } from "./domEditOverlayCrop";
import {
  resolveSnapAdjustment,
  resolveResizeSnapAdjustment,
  resolveEquidistanceGuides,
  SNAP_THRESHOLD_PX,
} from "./snapEngine";
export function createDomEditOverlayGestureHandlers(opts: UseDomEditOverlayGesturesOptions) {
  const setDraftOverlayRect = (next: OverlayRect) => {
    opts.setOverlayRect(next);
  };
  const restoreGestureOverlayRect = (g: GestureState) => {
    setDraftOverlayRect({
      left: g.originLeft,
      top: g.originTop,
      width: g.originWidth,
      height: g.originHeight,
      editScaleX: g.editScaleX,
      editScaleY: g.editScaleY,
    });
  };
  const setDraftGroupOverlayItems = (next: GroupOverlayItem[]) => {
    opts.setGroupOverlayItems(next);
  };

  const restoreGroupPathOffsets = (g: GroupGestureState) => {
    restoreManualOffsetDragMembers(g.members);
    setDraftGroupOverlayItems(g.originItems);
  };

  const startGroupDrag = (e: React.PointerEvent<HTMLElement>) => _startGroupDrag(e, opts);
  const startGesture = (
    kind: GestureKind,
    e: React.PointerEvent<HTMLElement>,
    options?: {
      selection?: DomEditSelection;
      rect?: OverlayRect | null;
      resizeHandle?: ResizeHandle;
    },
  ) => _startGesture(kind, e, opts, options);

  // fallow-ignore-next-line complexity
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = opts.gestureRef.current;
    const groupG = opts.groupGestureRef.current;
    const sel = g?.selection ?? opts.selectionRef.current;
    const box = opts.boxRef.current;
    const blockedMove = opts.blockedMoveRef.current;
    if (!blockedMove && !g && !groupG) {
      opts.onCanvasPointerMoveRef.current(e, { preferClipAncestor: false });
    }

    if (blockedMove && sel) {
      const dx = e.clientX - blockedMove.startX;
      const dy = e.clientY - blockedMove.startY;
      if (!blockedMove.notified && Math.hypot(dx, dy) >= BLOCKED_MOVE_THRESHOLD_PX) {
        blockedMove.notified = true;
        opts.suppressNextBoxClickRef.current = true;
        opts.onBlockedMoveRef.current(sel);
      }
      return;
    }

    if (groupG) {
      let dx = e.clientX - groupG.startX;
      let dy = e.clientY - groupG.startY;

      const sc = groupG.snapContext;
      if (sc?.snapEnabled && sc.targets.length > 0) {
        const groupBounds = resolveDomEditGroupOverlayRect(
          groupG.originItems.map((item) => item.rect),
        );
        if (groupBounds) {
          const allTargets = sc.compositionTarget
            ? [...sc.targets, sc.compositionTarget]
            : sc.targets;
          const snap = resolveSnapAdjustment({
            movingRect: groupBounds,
            proposedDx: dx,
            proposedDy: dy,
            targets: allTargets,
            gridEdges: sc.gridEdges ?? undefined,
            threshold: SNAP_THRESHOLD_PX,
            disabled: e.altKey,
          });
          dx = snap.dx;
          dy = snap.dy;
          const movedRect = {
            left: groupBounds.left + dx,
            top: groupBounds.top + dy,
            width: groupBounds.width,
            height: groupBounds.height,
          };
          const spacingGuides = e.altKey
            ? []
            : resolveEquidistanceGuides({
                movingRect: movedRect,
                targets: allTargets,
                threshold: SNAP_THRESHOLD_PX,
              });
          opts.snapGuidesRef.current = { guides: snap.guides, spacingGuides };
        }
      }
      groupG.lastSnappedDx = dx;
      groupG.lastSnappedDy = dy;

      setDraftGroupOverlayItems(
        groupG.originItems.map((item) => ({
          ...item,
          rect: { ...item.rect, left: item.rect.left + dx, top: item.rect.top + dy },
        })),
      );
      for (const member of groupG.members) applyManualOffsetDragDraft(member, dx, dy);
      return;
    }

    if (!g || !sel) return;
    let dx = e.clientX - g.startX;
    let dy = e.clientY - g.startY;

    if (g.kind === "rotate") {
      // Single source of truth: preview the rotation through the GSAP channel (the
      // same channel the commit lands in), not the `--hf-studio-rotation` CSS var.
      const rotated = resolveDomEditRotationGesture({
        centerX: g.centerX,
        centerY: g.centerY,
        startX: g.startX,
        startY: g.startY,
        currentX: e.clientX,
        currentY: e.clientY,
        actualAngle: g.actualRotation,
        snap: e.shiftKey,
      });
      if (!applyRotationDraftViaGsap(sel.element, rotated.angle)) {
        applyStudioRotationDraft(sel.element, rotated);
      }
      return;
    }

    if (g.kind === "drag") {
      const sc = g.snapContext;
      // Bypass edge-snapping for rotated elements — the snap targets and the
      // snapped rect are axis-aligned, so snapping a rotated box's AABB shifts it
      // unpredictably. Rotation ~0 keeps snapping exactly as before.
      const dragRotated = Math.abs(g.actualRotation) >= ROTATED_SNAP_BYPASS_DEGREES;
      if (!dragRotated && sc?.snapEnabled && sc.targets.length > 0) {
        // Snap the element's VISIBLE (crop-hugged) edges, not the full bounds.
        const movingRect = hugRectForElement(
          {
            left: g.originLeft,
            top: g.originTop,
            width: g.originWidth,
            height: g.originHeight,
            editScaleX: g.editScaleX,
            editScaleY: g.editScaleY,
          },
          g.selection.element,
        );
        const allTargets = sc.compositionTarget
          ? [...sc.targets, sc.compositionTarget]
          : sc.targets;
        const snap = resolveSnapAdjustment({
          movingRect,
          proposedDx: dx,
          proposedDy: dy,
          targets: allTargets,
          gridEdges: sc.gridEdges ?? undefined,
          threshold: SNAP_THRESHOLD_PX,
          disabled: e.altKey,
        });
        dx = snap.dx;
        dy = snap.dy;
        const movedRect = {
          left: movingRect.left + dx,
          top: movingRect.top + dy,
          width: movingRect.width,
          height: movingRect.height,
        };
        const spacingGuides = e.altKey
          ? []
          : resolveEquidistanceGuides({
              movingRect: movedRect,
              targets: allTargets,
              threshold: SNAP_THRESHOLD_PX,
            });
        opts.snapGuidesRef.current = { guides: snap.guides, spacingGuides };
      }
      g.lastSnappedDx = dx;
      g.lastSnappedDy = dy;

      const nextBoxLeft = g.originLeft + dx;
      const nextBoxTop = g.originTop + dy;
      setDraftOverlayRect({
        left: nextBoxLeft,
        top: nextBoxTop,
        width: g.originWidth,
        height: g.originHeight,
        editScaleX: g.editScaleX,
        editScaleY: g.editScaleY,
      });
      if (box) {
        box.style.left = `${nextBoxLeft}px`;
        box.style.top = `${nextBoxTop}px`;
      }
      if (g.pathOffsetMember) applyManualOffsetDragDraft(g.pathOffsetMember, dx, dy);
    } else {
      if (!box) return;

      const handle = g.resizeHandle ?? "se";
      // Rotation-correct resize: snapping is bypassed for rotated elements (the
      // snap targets are axis-aligned; snapping a rotated box's AABB to them is
      // unpredictable). Rotation ~0 keeps snapping exactly as before.
      const rotated = Math.abs(g.actualRotation) >= ROTATED_SNAP_BYPASS_DEGREES;
      const sc = g.snapContext;
      if (!rotated && sc?.snapEnabled && sc.targets.length > 0) {
        const movingRect = {
          left: g.originLeft,
          top: g.originTop,
          width: g.originWidth,
          height: g.originHeight,
        };
        const allTargets = sc.compositionTarget
          ? [...sc.targets, sc.compositionTarget]
          : sc.targets;
        const snap = resolveResizeSnapAdjustment({
          movingRect,
          proposedDx: dx,
          proposedDy: dy,
          targets: allTargets,
          gridEdges: sc.gridEdges ?? undefined,
          threshold: SNAP_THRESHOLD_PX,
          disabled: e.altKey,
          edges: {
            x: handle === "nw" || handle === "sw" ? "left" : "right",
            y: handle === "nw" || handle === "ne" ? "top" : "bottom",
          },
        });
        dx = snap.dx;
        dy = snap.dy;
        opts.snapGuidesRef.current = { guides: snap.guides, spacingGuides: [] };
      }

      // LOCAL-SPACE size (industry OBB model): inverse-rotate the screen pointer
      // delta into the element's local frame so a rotated element grows along its
      // OWN axes, not the screen axes. Base size is the element-local px size at
      // gesture start (actualWidth/Height, GSAP-scale-aware). Corner drag is
      // ALWAYS proportional (CapCut/Canva model: corners only scale, never
      // stretch — user product choice); there is no free-form stretch gesture.
      const nextSize = resolveLocalResizeSize({
        baseWidth: g.actualWidth,
        baseHeight: g.actualHeight,
        rotation: (g.actualRotation * Math.PI) / 180,
        displayScaleX: g.editScaleX,
        displayScaleY: g.editScaleY,
        handle,
        dxScreen: dx,
        dyScreen: dy,
        uniform: true,
      });
      applyStudioBoxSizeDraft(sel.element, nextSize);

      // Re-measure the element's oriented box AFTER the size write. The size draft
      // rounds/clamps and (with a centered transform-origin + GSAP scale) the real
      // rendered size diverges from the CSS size, so measure rather than trust math.
      const overlayEl = opts.overlayRef.current;
      const iframe = opts.iframeRef.current;
      const sizedRect =
        overlayEl && iframe ? orientedOverlayRect(overlayEl, iframe, sel.element) : null;

      // West/north handles keep the OPPOSITE corner visually fixed by translating
      // the element through the manual-offset channel (member created at gesture
      // start). Pin the corner by measuring its real transformed position after
      // the size write and translating it back to its gesture-start position —
      // rotation-safe by construction for any transform-origin. SE is anchorless
      // (memberless) exactly as before: no translate, the box follows the element.
      let draftRect: OverlayRect;
      if (g.pathOffsetMember) {
        const cornersAfterSize =
          overlayEl && iframe ? elementCornerOverlayPoints(overlayEl, iframe, sel.element) : null;
        const fixedStart = g.resizeFixedCornerStart;
        let anchor: { dx: number; dy: number };
        if (cornersAfterSize && fixedStart) {
          const fixedNow = cornersAfterSize[anchorCornerForHandle(handle)];
          anchor = { dx: fixedStart.x - fixedNow.x, dy: fixedStart.y - fixedNow.y };
        } else {
          // Geometry unmeasurable (no live DOM) — fall back to the AABB delta.
          anchor = resolveResizeAnchorOffset({
            originWidth: g.originWidth,
            originHeight: g.originHeight,
            overlayWidth: sizedRect ? sizedRect.width : g.originWidth,
            overlayHeight: sizedRect ? sizedRect.height : g.originHeight,
            handle,
          });
        }
        g.lastResizeAnchor = anchor;
        applyManualOffsetDragDraft(g.pathOffsetMember, anchor.dx, anchor.dy);
        // Re-measure the oriented box AFTER the anchor translate so it hugs the
        // element's true rendered bounds every frame.
        const anchoredRect =
          overlayEl && iframe ? orientedOverlayRect(overlayEl, iframe, sel.element) : null;
        draftRect = anchoredRect ?? {
          left: g.originLeft + anchor.dx,
          top: g.originTop + anchor.dy,
          width: sizedRect ? sizedRect.width : g.originWidth,
          height: sizedRect ? sizedRect.height : g.originHeight,
          editScaleX: g.editScaleX,
          editScaleY: g.editScaleY,
          angle: g.actualRotation,
        };
      } else {
        draftRect = sizedRect ?? {
          left: g.originLeft,
          top: g.originTop,
          width: g.originWidth,
          height: g.originHeight,
          editScaleX: g.editScaleX,
          editScaleY: g.editScaleY,
          angle: g.actualRotation,
        };
      }
      box.style.left = `${draftRect.left}px`;
      box.style.top = `${draftRect.top}px`;
      box.style.width = `${draftRect.width}px`;
      box.style.height = `${draftRect.height}px`;
      setDraftOverlayRect(draftRect);
    }
  };

  // fallow-ignore-next-line complexity
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    opts.snapGuidesRef.current = null;
    const g = opts.gestureRef.current;
    const groupG = opts.groupGestureRef.current;
    const sel = g?.selection ?? opts.selectionRef.current;
    const box = opts.boxRef.current;
    opts.blockedMoveRef.current = null;

    if (groupG) {
      opts.groupGestureRef.current = null;
      opts.rafPausedRef.current = false;
      const rawDx = e.clientX - groupG.startX;
      const rawDy = e.clientY - groupG.startY;
      if (Math.hypot(rawDx, rawDy) < BLOCKED_MOVE_THRESHOLD_PX) {
        restoreGroupPathOffsets(groupG);
        opts.suppressNextBoxClickRef.current = true;
        return;
      }
      const dx = groupG.lastSnappedDx ?? rawDx;
      const dy = groupG.lastSnappedDy ?? rawDy;
      setDraftGroupOverlayItems(
        groupG.originItems.map((item) => ({
          ...item,
          rect: { ...item.rect, left: item.rect.left + dx, top: item.rect.top + dy },
        })),
      );
      const updates = groupG.members.map((member) => ({
        selection: member.selection,
        next: applyManualOffsetDragCommit(member, dx, dy),
      }));
      void Promise.resolve(opts.onGroupPathOffsetCommitRef.current(updates))
        .catch(() => {
          for (const member of groupG.members) {
            if (
              member.gestureToken &&
              isStudioManualEditGestureCurrent(member.element, member.gestureToken)
            )
              restoreStudioPathOffset(member.element, member.initialPathOffset);
          }
        })
        .finally(() => endManualOffsetDragMembers(groupG.members));
      return;
    }

    if (!g || !sel) {
      opts.gestureRef.current = null;
      opts.rafPausedRef.current = false;
      return;
    }
    opts.gestureRef.current = null;
    opts.rafPausedRef.current = false;
    const movedDistance = Math.hypot(e.clientX - g.startX, e.clientY - g.startY);

    if (g.kind === "drag" && movedDistance < BLOCKED_MOVE_THRESHOLD_PX) {
      restoreStudioPathOffset(sel.element, g.initialPathOffset);
      endStudioManualEditGesture(sel.element, g.manualEditDragToken);
      resumeGsapTimelines(sel.element);
      if (box) {
        box.style.left = `${g.originLeft}px`;
        box.style.top = `${g.originTop}px`;
      }
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
      if (box) {
        box.style.width = `${g.originWidth}px`;
        box.style.height = `${g.originHeight}px`;
      }
      restoreGestureOverlayRect(g);
      opts.suppressNextBoxClickRef.current = true;
      return;
    }

    if (g.kind === "rotate") {
      const finalRotation = resolveDomEditRotationGesture({
        centerX: g.centerX,
        centerY: g.centerY,
        startX: g.startX,
        startY: g.startY,
        currentX: e.clientX,
        currentY: e.clientY,
        actualAngle: g.actualRotation,
        snap: e.shiftKey,
      });
      const restoreRotation = () => {
        // Single source of truth: snap the GSAP rotation back to the gesture's base
        // angle; fall back to the legacy CSS-var restore when gsap is unavailable.
        if (!applyRotationDraftViaGsap(sel.element, g.actualRotation)) {
          restoreStudioRotation(sel.element, g.initialRotation);
        }
      };
      if (!hasDomEditRotationChanged(g.actualRotation, finalRotation.angle)) {
        restoreRotation();
        endStudioManualEditGesture(sel.element, g.manualEditDragToken);
        return;
      }
      // Keep the preview at the final angle through the GSAP channel (NOT the CSS var)
      // while the commit lands a `tl.set`/keyframe rotation on the timeline.
      if (!applyRotationDraftViaGsap(sel.element, finalRotation.angle)) {
        applyStudioRotation(sel.element, finalRotation);
      }
      void Promise.resolve(opts.onRotationCommitRef.current(sel, finalRotation))
        .catch(() => {
          if (
            g.manualEditDragToken &&
            isStudioManualEditGestureCurrent(sel.element, g.manualEditDragToken)
          )
            restoreRotation();
        })
        .finally(() => endStudioManualEditGesture(sel.element, g.manualEditDragToken));
    } else if (g.kind === "drag") {
      const dx = g.lastSnappedDx ?? e.clientX - g.startX;
      const dy = g.lastSnappedDy ?? e.clientY - g.startY;
      if (!g.pathOffsetMember) {
        return;
      }
      const finalOffset = applyManualOffsetDragCommit(g.pathOffsetMember, dx, dy);
      const nextBoxLeft = g.originLeft + dx;
      const nextBoxTop = g.originTop + dy;
      setDraftOverlayRect({
        left: nextBoxLeft,
        top: nextBoxTop,
        width: g.originWidth,
        height: g.originHeight,
        editScaleX: g.editScaleX,
        editScaleY: g.editScaleY,
      });
      if (box) {
        box.style.left = `${nextBoxLeft}px`;
        box.style.top = `${nextBoxTop}px`;
      }
      void Promise.resolve(
        opts.onPathOffsetCommitRef.current(sel, finalOffset, { altKey: e.altKey }),
      )
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
    } else {
      opts.suppressNextBoxClickRef.current = true;
      const finalSize = readStudioBoxSize(sel.element);
      applyStudioBoxSize(sel.element, finalSize);
      // Anchored corner resize (NW/NE/SW) also moved the element to keep the
      // opposite corner fixed. Land the size AND the anchor offset in a SINGLE
      // box-size commit (one persist, one undo entry). The prior two-commit
      // sequence re-stamped the element from source after the size-only persist
      // but before the offset persist landed — that one frame (new size, old
      // offset) was the release "jump". SE has no anchor member → size only.
      const member = g.pathOffsetMember;
      const anchor = g.lastResizeAnchor;
      const finalOffset =
        member && anchor && (anchor.dx !== 0 || anchor.dy !== 0)
          ? applyManualOffsetDragCommit(member, anchor.dx, anchor.dy)
          : null;
      void Promise.resolve(
        opts.onBoxSizeCommitRef.current(sel, finalSize, finalOffset ?? undefined),
      )
        .catch(() => {
          if (
            g.manualEditDragToken &&
            isStudioManualEditGestureCurrent(sel.element, g.manualEditDragToken)
          ) {
            restoreStudioBoxSize(sel.element, g.initialBoxSize);
            if (finalOffset) restoreStudioPathOffset(sel.element, g.initialPathOffset);
          }
        })
        .finally(() => {
          if (member) endManualOffsetDragMembers([member]);
          else endStudioManualEditGesture(sel.element, g.manualEditDragToken);
        });
    }
  };

  // fallow-ignore-next-line complexity
  const clearPointerState = (selectionRef: RefObject<DomEditSelection | null>) => {
    opts.snapGuidesRef.current = null;
    const groupG = opts.groupGestureRef.current;
    if (groupG) restoreGroupPathOffsets(groupG);
    const g = opts.gestureRef.current;
    const sel = g?.selection ?? selectionRef.current;
    if (g?.mode === "path-offset" && sel) {
      restoreStudioPathOffset(sel.element, g.initialPathOffset);
      endStudioManualEditGesture(sel.element, g.manualEditDragToken);
      resumeGsapTimelines(sel.element);
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
      restoreStudioRotation(sel.element, g.initialRotation);
      endStudioManualEditGesture(sel.element, g.manualEditDragToken);
    }
    opts.blockedMoveRef.current = null;
    opts.groupGestureRef.current = null;
    opts.gestureRef.current = null;
    opts.rafPausedRef.current = false;
  };

  return { startGesture, startGroupDrag, onPointerMove, onPointerUp, clearPointerState };
}
