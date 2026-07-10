/**
 * Gesture-begin functions: startGroupDrag and startGesture.
 * These are pure "start a new gesture" operations — no draft rect updates.
 */
import { type DomEditSelection } from "./domEditing";
import {
  createManualOffsetDragMember,
  readGsapRotation,
  restoreManualOffsetDragMembers,
  type ManualOffsetDragMember,
} from "./manualOffsetDrag";
import {
  beginStudioManualEditGesture,
  captureStudioBoxSize,
  captureStudioPathOffset,
  captureStudioRotation,
  readStudioBoxSize,
  readStudioRotation,
} from "./manualEdits";
import {
  type OverlayRect,
  elementCornerOverlayPoints,
  filterNestedDomEditGroupItems,
  selectionCacheKey,
} from "./domEditOverlayGeometry";
import {
  type GestureKind,
  type GestureState,
  type ResizeHandle,
  type UseDomEditOverlayGesturesOptions,
  anchorCornerForHandle,
} from "./domEditOverlayGestures";
import { collectSnapContext, buildExcludeElements } from "./snapTargetCollection";

export function startGroupDrag(
  e: React.PointerEvent<HTMLElement>,
  opts: UseDomEditOverlayGesturesOptions,
): boolean {
  const items = opts.groupOverlayItemsRef.current;
  if (items.length <= 1) return false;

  const blockedSelection = items.find(
    (item) => !item.selection.capabilities.canApplyManualOffset,
  )?.selection;
  if (blockedSelection) {
    e.preventDefault();
    e.stopPropagation();
    opts.onBlockedMoveRef.current(blockedSelection);
    return false;
  }

  opts.onManualDragStartRef.current?.();
  const dragItems = filterNestedDomEditGroupItems(items);
  const members: ManualOffsetDragMember[] = [];
  for (const item of dragItems) {
    const result = createManualOffsetDragMember({
      key: item.key,
      selection: item.selection,
      element: item.element,
      rect: item.rect,
    });
    if (!result.ok) {
      restoreManualOffsetDragMembers(members);
      e.preventDefault();
      e.stopPropagation();
      opts.onBlockedMoveRef.current(result.selection);
      return false;
    }
    members.push(result.member);
  }

  const overlayEl = opts.overlayRef.current;
  const iframe = opts.iframeRef.current;
  const snapContext =
    overlayEl && iframe
      ? collectSnapContext({
          overlayEl,
          iframe,
          excludeElements: buildExcludeElements({
            iframe,
            groupSelections: items.map((i) => i.selection),
          }),
        })
      : undefined;

  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.setPointerCapture(e.pointerId);
  opts.rafPausedRef.current = true;
  opts.groupGestureRef.current = {
    startX: e.clientX,
    startY: e.clientY,
    originItems: items,
    members,
    snapContext,
  };
  return true;
}

// fallow-ignore-next-line complexity
export function startGesture(
  kind: GestureKind,
  e: React.PointerEvent<HTMLElement>,
  opts: UseDomEditOverlayGesturesOptions,
  options?: {
    selection?: DomEditSelection;
    rect?: OverlayRect | null;
    resizeHandle?: ResizeHandle;
  },
): boolean {
  const sel = options?.selection ?? opts.selectionRef.current;
  const rect = options?.rect ?? opts.overlayRectRef.current;
  const box = opts.boxRef.current;
  const overlayEl = opts.overlayRef.current;
  if (!sel || !rect) return false;
  if (kind !== "drag" && !box) return false;
  const mode: GestureState["mode"] =
    kind === "rotate" ? "rotation" : kind === "drag" ? "path-offset" : "box-size";
  if (kind === "drag" && !sel.capabilities.canApplyManualOffset) return false;
  if (kind === "resize" && !sel.capabilities.canApplyManualSize) return false;
  if (kind === "rotate" && !sel.capabilities.canApplyManualRotation) return false;
  if (kind === "resize" && (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)))
    return false;

  const size = readStudioBoxSize(sel.element);
  // Single-source rotation base = the live GSAP transform rotation plus any legacy
  // `--hf-studio-rotation` CSS var (old projects), so a rotate gesture starts from the
  // element's actual visual angle and commits an absolute angle to the timeline.
  const rotation = { angle: readGsapRotation(sel.element) + readStudioRotation(sel.element).angle };
  const actualWidth = size.width > 0 ? size.width : rect.width / rect.editScaleX;
  const actualHeight = size.height > 0 ? size.height : rect.height / rect.editScaleY;
  let initialPathOffset = captureStudioPathOffset(sel.element);
  let manualEditDragToken: string | undefined;
  let pathOffsetMember: ManualOffsetDragMember | undefined;

  if (kind === "drag") {
    opts.onManualDragStartRef.current?.();
    opts.rafPausedRef.current = true;
    const result = createManualOffsetDragMember({
      key: selectionCacheKey(sel),
      selection: sel,
      element: sel.element,
      rect,
    });
    if (!result.ok) {
      opts.onBlockedMoveRef.current(result.selection);
      return false;
    }
    pathOffsetMember = result.member;
    initialPathOffset = result.member.initialPathOffset;
    manualEditDragToken = result.member.gestureToken;
  } else {
    // Corner resize from a west/north handle anchors the opposite corner by
    // translating the element while it resizes — that translation goes through
    // the same manual-offset channel as a drag, so create a member for it.
    const resizeHandle = kind === "resize" ? (options?.resizeHandle ?? "se") : undefined;
    const needsAnchorOffset =
      resizeHandle !== undefined && resizeHandle !== "se" && sel.capabilities.canApplyManualOffset;
    if (needsAnchorOffset) {
      const result = createManualOffsetDragMember({
        key: selectionCacheKey(sel),
        selection: sel,
        element: sel.element,
        rect,
      });
      if (result.ok) {
        pathOffsetMember = result.member;
        initialPathOffset = result.member.initialPathOffset;
        manualEditDragToken = result.member.gestureToken;
      } else {
        manualEditDragToken = beginStudioManualEditGesture(sel.element);
      }
    } else {
      manualEditDragToken = beginStudioManualEditGesture(sel.element);
    }
  }

  const overlayBounds = overlayEl?.getBoundingClientRect();
  const centerX = (overlayBounds?.left ?? 0) + rect.left + rect.width / 2;
  const centerY = (overlayBounds?.top ?? 0) + rect.top + rect.height / 2;

  const iframe = opts.iframeRef.current;

  // For an anchored corner resize, capture the FIXED corner's real (rotation-aware)
  // overlay position now, so per-frame anchoring can pin that exact point instead of
  // an axis-aligned width/height delta (which slides the fixed corner on a rotated
  // element — the resize jump/gap bug).
  const resizeHandleForAnchor = kind === "resize" ? (options?.resizeHandle ?? "se") : undefined;
  let resizeFixedCornerStart: { x: number; y: number } | undefined;
  if (
    resizeHandleForAnchor !== undefined &&
    resizeHandleForAnchor !== "se" &&
    pathOffsetMember &&
    overlayEl &&
    iframe
  ) {
    const corners = elementCornerOverlayPoints(overlayEl, iframe, sel.element);
    if (corners) resizeFixedCornerStart = corners[anchorCornerForHandle(resizeHandleForAnchor)];
  }
  const snapContext =
    (kind === "drag" || kind === "resize") && overlayEl && iframe
      ? collectSnapContext({
          overlayEl,
          iframe,
          excludeElements: buildExcludeElements({ iframe, selection: sel }),
        })
      : undefined;
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.setPointerCapture(e.pointerId);
  opts.rafPausedRef.current = true;
  opts.gestureRef.current = {
    kind,
    mode,
    selection: sel,
    startX: e.clientX,
    startY: e.clientY,
    centerX,
    centerY,
    initialPathOffset,
    initialRotation: captureStudioRotation(sel.element),
    initialBoxSize: captureStudioBoxSize(sel.element),
    pathOffsetMember,
    originLeft: rect.left,
    originTop: rect.top,
    originWidth: rect.width,
    originHeight: rect.height,
    actualWidth,
    actualHeight,
    actualRotation: rotation.angle,
    editScaleX: rect.editScaleX,
    editScaleY: rect.editScaleY,
    manualEditDragToken,
    snapContext,
    resizeHandle: kind === "resize" ? (options?.resizeHandle ?? "se") : undefined,
    resizeFixedCornerStart,
  };
  return true;
}
