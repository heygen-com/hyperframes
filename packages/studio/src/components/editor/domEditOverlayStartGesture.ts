/**
 * Gesture-begin functions: startGroupDrag and startGesture.
 * These are pure "start a new gesture" operations — no draft rect updates.
 */
import { readElementGsapNumber } from "../../utils/elementGsap";
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
  filterNestedDomEditGroupItems,
  selectionCacheKey,
} from "./domEditOverlayGeometry";
import {
  type GestureKind,
  type GestureState,
  type UseDomEditOverlayGesturesOptions,
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
  options?: { selection?: DomEditSelection; rect?: OverlayRect | null },
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
  // The draft writes CSS width/height, so the resize base must be the CSS
  // layout size. offsetWidth/Height are transform-free; the overlay-rect
  // fallback (rect / editScale) includes the element's own GSAP scale and
  // would make a rescaled element's draft grow from the RENDERED size.
  const layoutWidth = sel.element.offsetWidth;
  const layoutHeight = sel.element.offsetHeight;
  const actualWidth =
    size.width > 0 ? size.width : layoutWidth > 0 ? layoutWidth : rect.width / rect.editScaleX;
  const actualHeight =
    size.height > 0 ? size.height : layoutHeight > 0 ? layoutHeight : rect.height / rect.editScaleY;
  // overlay rect = cssSize x contentScale x editScale, so the element's own
  // render factor (its GSAP scale) falls out of the measured rect. 1 when
  // unscaled or unmeasurable.
  const rawContentScaleX = rect.width / (rect.editScaleX * actualWidth);
  const rawContentScaleY = rect.height / (rect.editScaleY * actualHeight);
  const contentScaleX =
    Number.isFinite(rawContentScaleX) && rawContentScaleX > 0 ? rawContentScaleX : 1;
  const contentScaleY =
    Number.isFinite(rawContentScaleY) && rawContentScaleY > 0 ? rawContentScaleY : 1;
  let resizeAnchor: GestureState["resizeAnchor"];
  if (kind === "resize") {
    const startBcr = sel.element.getBoundingClientRect();
    resizeAnchor = {
      anchorX: startBcr.x,
      anchorY: startBcr.y,
      baseGsapX: readElementGsapNumber(sel.element, "x") ?? 0,
      baseGsapY: readElementGsapNumber(sel.element, "y") ?? 0,
      pinX: 0,
      pinY: 0,
    };
  }
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
    manualEditDragToken = beginStudioManualEditGesture(sel.element);
  }

  const overlayBounds = overlayEl?.getBoundingClientRect();
  const centerX = (overlayBounds?.left ?? 0) + rect.left + rect.width / 2;
  const centerY = (overlayBounds?.top ?? 0) + rect.top + rect.height / 2;

  const iframe = opts.iframeRef.current;
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
    contentScaleX,
    contentScaleY,
    resizeAnchor,
    manualEditDragToken,
    snapContext,
  };
  return true;
}
