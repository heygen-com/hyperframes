import { memo, useMemo, useRef, useState, type RefObject } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";
import { type DomEditSelection, findElementForSelection } from "./domEditing";
import {
  applyStudioBoxSize,
  applyStudioBoxSizeDraft,
  applyStudioPathOffset,
  applyStudioPathOffsetDraft,
  applyStudioRotation,
  applyStudioRotationDraft,
  beginStudioManualEditGesture,
  captureStudioBoxSize,
  captureStudioPathOffset,
  captureStudioRotation,
  endStudioManualEditGesture,
  isStudioManualEditGestureCurrent,
  readStudioBoxSize,
  readStudioPathOffset,
  readStudioRotation,
  restoreStudioBoxSize,
  restoreStudioPathOffset,
  restoreStudioRotation,
  type StudioBoxSizeSnapshot,
  type StudioPathOffsetSnapshot,
  type StudioRotationSnapshot,
} from "./manualEdits";

interface OverlayRect {
  left: number;
  top: number;
  width: number;
  height: number;
  editScaleX: number;
  editScaleY: number;
}

interface DomEditOverlayProps {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  selection: DomEditSelection | null;
  allowCanvasMovement?: boolean;
  onCanvasMouseDown: (
    event: React.MouseEvent<HTMLDivElement>,
    options?: { preferClipAncestor?: boolean },
  ) => void;
  onBlockedMove: (selection: DomEditSelection) => void;
  onPathOffsetCommit: (
    selection: DomEditSelection,
    next: { x: number; y: number },
  ) => Promise<void> | void;
  onBoxSizeCommit: (
    selection: DomEditSelection,
    next: { width: number; height: number },
  ) => Promise<void> | void;
  onRotationCommit: (selection: DomEditSelection, next: { angle: number }) => Promise<void> | void;
}

function toOverlayRect(
  overlayEl: HTMLDivElement,
  iframe: HTMLIFrameElement,
  element: HTMLElement,
): OverlayRect | null {
  const iframeRect = iframe.getBoundingClientRect();
  const overlayRect = overlayEl.getBoundingClientRect();
  const doc = iframe.contentDocument;
  const root =
    doc?.querySelector<HTMLElement>("[data-composition-id]") ?? doc?.documentElement ?? null;
  const rootRect = root?.getBoundingClientRect();
  const rootWidth = rootRect?.width;
  const rootHeight = rootRect?.height;
  if (!rootWidth || !rootHeight) return null;

  const elementRect = element.getBoundingClientRect();
  const rootScaleX = iframeRect.width / rootWidth;
  const rootScaleY = iframeRect.height / rootHeight;
  const sourceBoundary = findSourceBoundary(element);
  const sourceBoundaryRect = sourceBoundary?.getBoundingClientRect();
  const editScale = resolveDomEditCoordinateScale({
    rootScaleX,
    rootScaleY,
    sourceRectWidth: sourceBoundaryRect?.width,
    sourceRectHeight: sourceBoundaryRect?.height,
    sourceWidth: readPositiveDimension(sourceBoundary?.getAttribute("data-width") ?? null),
    sourceHeight: readPositiveDimension(sourceBoundary?.getAttribute("data-height") ?? null),
  });

  return {
    left: iframeRect.left - overlayRect.left + (elementRect.left - rootRect.left) * rootScaleX,
    top: iframeRect.top - overlayRect.top + (elementRect.top - rootRect.top) * rootScaleY,
    width: elementRect.width * rootScaleX,
    height: elementRect.height * rootScaleY,
    editScaleX: editScale.scaleX,
    editScaleY: editScale.scaleY,
  };
}

function readPositiveDimension(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function findSourceBoundary(element: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = element;
  while (current) {
    if (
      current.hasAttribute("data-composition-file") ||
      current.hasAttribute("data-composition-src")
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

export function resolveDomEditCoordinateScale(input: {
  rootScaleX: number;
  rootScaleY: number;
  sourceRectWidth?: number;
  sourceRectHeight?: number;
  sourceWidth?: number | null;
  sourceHeight?: number | null;
}): { scaleX: number; scaleY: number } {
  const rootScaleX = input.rootScaleX > 0 ? input.rootScaleX : 1;
  const rootScaleY = input.rootScaleY > 0 ? input.rootScaleY : 1;
  const sourceScaleX =
    input.sourceRectWidth && input.sourceRectWidth > 0 && input.sourceWidth && input.sourceWidth > 0
      ? (input.sourceRectWidth * rootScaleX) / input.sourceWidth
      : rootScaleX;
  const sourceScaleY =
    input.sourceRectHeight &&
    input.sourceRectHeight > 0 &&
    input.sourceHeight &&
    input.sourceHeight > 0
      ? (input.sourceRectHeight * rootScaleY) / input.sourceHeight
      : rootScaleY;
  return {
    scaleX: sourceScaleX > 0 ? sourceScaleX : rootScaleX,
    scaleY: sourceScaleY > 0 ? sourceScaleY : rootScaleY,
  };
}

type GestureKind = "drag" | "resize" | "rotate";
const BLOCKED_MOVE_THRESHOLD_PX = 4;
const MIN_RESIZE_EDGE_PX = 20;
const OVERLAY_RECT_EPSILON_PX = 0.5;
const ROTATION_SNAP_DEGREES = 15;

function rectsEqual(a: OverlayRect | null, b: OverlayRect | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    Math.abs(a.left - b.left) < OVERLAY_RECT_EPSILON_PX &&
    Math.abs(a.top - b.top) < OVERLAY_RECT_EPSILON_PX &&
    Math.abs(a.width - b.width) < OVERLAY_RECT_EPSILON_PX &&
    Math.abs(a.height - b.height) < OVERLAY_RECT_EPSILON_PX &&
    Math.abs(a.editScaleX - b.editScaleX) < 0.001 &&
    Math.abs(a.editScaleY - b.editScaleY) < 0.001
  );
}

function selectionCacheKey(
  selection: Pick<DomEditSelection, "id" | "selector" | "selectorIndex" | "sourceFile">,
): string {
  return [
    selection.sourceFile ?? "",
    selection.id ?? "",
    selection.selector ?? "",
    selection.selectorIndex ?? "",
  ].join("|");
}

type FocusableDomEditOverlay = {
  focus(options?: FocusOptions): void;
};

export function focusDomEditOverlayElement(element: FocusableDomEditOverlay | null): void {
  element?.focus({ preventScroll: true });
}

export function resolveDomEditResizeGesture(input: {
  originWidth: number;
  originHeight: number;
  actualWidth: number;
  actualHeight: number;
  scaleX: number;
  scaleY: number;
  dx: number;
  dy: number;
  uniform: boolean;
}): { overlayWidth: number; overlayHeight: number; width: number; height: number } {
  const scaleX = input.scaleX > 0 ? input.scaleX : 1;
  const scaleY = input.scaleY > 0 ? input.scaleY : 1;

  if (input.uniform) {
    const deltaX = input.dx / scaleX;
    const deltaY = input.dy / scaleY;
    const delta = Math.abs(deltaX) >= Math.abs(deltaY) ? deltaX : deltaY;
    const side = Math.max(1, Math.max(input.actualWidth, input.actualHeight) + delta);
    return {
      overlayWidth: Math.max(MIN_RESIZE_EDGE_PX, side * scaleX),
      overlayHeight: Math.max(MIN_RESIZE_EDGE_PX, side * scaleY),
      width: side,
      height: side,
    };
  }

  return {
    overlayWidth: Math.max(MIN_RESIZE_EDGE_PX, input.originWidth + input.dx),
    overlayHeight: Math.max(MIN_RESIZE_EDGE_PX, input.originHeight + input.dy),
    width: Math.max(1, input.actualWidth + input.dx / scaleX),
    height: Math.max(1, input.actualHeight + input.dy / scaleY),
  };
}

export function resolveDomEditPathOffsetGesture(input: {
  actualOffsetX: number;
  actualOffsetY: number;
  scaleX: number;
  scaleY: number;
  dx: number;
  dy: number;
}): { x: number; y: number } {
  const scaleX = input.scaleX > 0 ? input.scaleX : 1;
  const scaleY = input.scaleY > 0 ? input.scaleY : 1;
  return {
    x: input.actualOffsetX + input.dx / scaleX,
    y: input.actualOffsetY + input.dy / scaleY,
  };
}

function pointerAngleDegrees(centerX: number, centerY: number, x: number, y: number): number {
  return (Math.atan2(y - centerY, x - centerX) * 180) / Math.PI;
}

function normalizeAngleDelta(delta: number): number {
  return ((((delta + 180) % 360) + 360) % 360) - 180;
}

function roundAngle(angle: number): number {
  return Math.round(angle * 10) / 10;
}

export function resolveDomEditRotationGesture(input: {
  centerX: number;
  centerY: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  actualAngle: number;
  snap: boolean;
}): { angle: number } {
  const startAngle = pointerAngleDegrees(input.centerX, input.centerY, input.startX, input.startY);
  const currentAngle = pointerAngleDegrees(
    input.centerX,
    input.centerY,
    input.currentX,
    input.currentY,
  );
  const delta = normalizeAngleDelta(currentAngle - startAngle);
  const angle = input.actualAngle + delta;
  return {
    angle: input.snap
      ? Math.round(angle / ROTATION_SNAP_DEGREES) * ROTATION_SNAP_DEGREES
      : roundAngle(angle),
  };
}

interface GestureState {
  kind: GestureKind;
  mode: "path-offset" | "box-size" | "rotation";
  startX: number;
  startY: number;
  centerX: number;
  centerY: number;
  initialPathOffset: StudioPathOffsetSnapshot;
  initialRotation: StudioRotationSnapshot;
  initialBoxSize: StudioBoxSizeSnapshot;
  originLeft: number;
  originTop: number;
  originWidth: number;
  originHeight: number;
  actualOffsetX: number;
  actualOffsetY: number;
  actualWidth: number;
  actualHeight: number;
  actualRotation: number;
  editScaleX: number;
  editScaleY: number;
  manualEditDragToken?: string;
}

interface BlockedMoveState {
  pointerId: number;
  startX: number;
  startY: number;
  notified: boolean;
}

export const DomEditOverlay = memo(function DomEditOverlay({
  iframeRef,
  selection,
  allowCanvasMovement = true,
  onCanvasMouseDown,
  onBlockedMove,
  onPathOffsetCommit,
  onBoxSizeCommit,
  onRotationCommit,
}: DomEditOverlayProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [overlayRect, setOverlayRect] = useState<OverlayRect | null>(null);
  const gestureRef = useRef<GestureState | null>(null);
  const blockedMoveRef = useRef<BlockedMoveState | null>(null);
  const suppressNextBoxClickRef = useRef(false);
  const rafPausedRef = useRef(false);
  const resolvedElementRef = useRef<{ key: string; element: HTMLElement } | null>(null);

  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const overlayRectRef = useRef(overlayRect);
  overlayRectRef.current = overlayRect;
  const onPathOffsetCommitRef = useRef(onPathOffsetCommit);
  onPathOffsetCommitRef.current = onPathOffsetCommit;
  const onBoxSizeCommitRef = useRef(onBoxSizeCommit);
  onBoxSizeCommitRef.current = onBoxSizeCommit;
  const onRotationCommitRef = useRef(onRotationCommit);
  onRotationCommitRef.current = onRotationCommit;
  const onBlockedMoveRef = useRef(onBlockedMove);
  onBlockedMoveRef.current = onBlockedMove;

  useMountEffect(() => {
    let frame = 0;
    const clearOverlayRect = () => {
      if (!overlayRectRef.current) return;
      overlayRectRef.current = null;
      setOverlayRect(null);
    };
    const setNextOverlayRect = (next: OverlayRect | null) => {
      if (rectsEqual(overlayRectRef.current, next)) return;
      overlayRectRef.current = next;
      setOverlayRect(next);
    };
    const resolveElement = (doc: Document, sel: DomEditSelection) => {
      const key = selectionCacheKey(sel);
      const cached = resolvedElementRef.current;
      if (
        cached?.key === key &&
        cached.element.isConnected &&
        cached.element.ownerDocument === doc
      ) {
        return cached.element;
      }

      const next = findElementForSelection(doc, sel, sel.sourceFile);
      resolvedElementRef.current = next ? { key, element: next } : null;
      return next;
    };

    const update = () => {
      frame = requestAnimationFrame(update);
      if (rafPausedRef.current) return;

      const sel = selectionRef.current;
      const iframe = iframeRef.current;
      const overlayEl = overlayRef.current;
      if (!iframe || !overlayEl) {
        resolvedElementRef.current = null;
        clearOverlayRect();
        return;
      }

      const doc = iframe.contentDocument;
      if (!doc) return;

      if (!sel) {
        resolvedElementRef.current = null;
        clearOverlayRect();
        return;
      }

      const el = resolveElement(doc, sel);
      if (!el) {
        clearOverlayRect();
        return;
      }

      const next = toOverlayRect(overlayEl, iframe, el);
      setNextOverlayRect(next);
    };

    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  });

  const selectionKey = useMemo(() => {
    if (!selection) return "none";
    return `${selection.sourceFile}:${selection.id ?? selection.selector ?? selection.label}:${
      selection.selectorIndex ?? 0
    }`;
  }, [selection]);

  const startGesture = (kind: GestureKind, e: React.PointerEvent) => {
    const sel = selectionRef.current;
    const rect = overlayRectRef.current;
    const box = boxRef.current;
    const overlayEl = overlayRef.current;
    if (!sel || !rect || !box) return;
    const mode: GestureState["mode"] =
      kind === "rotate" ? "rotation" : kind === "drag" ? "path-offset" : "box-size";
    if (kind === "drag" && !sel.capabilities.canApplyManualOffset) return;
    if (kind === "resize" && !sel.capabilities.canApplyManualSize) return;
    if (kind === "rotate" && !sel.capabilities.canApplyManualRotation) return;
    if (kind === "resize" && (!Number.isFinite(rect.width) || !Number.isFinite(rect.height))) {
      return;
    }
    const offset = readStudioPathOffset(sel.element);
    const size = readStudioBoxSize(sel.element);
    const rotation = readStudioRotation(sel.element);
    const actualWidth = size.width > 0 ? size.width : rect.width / rect.editScaleX;
    const actualHeight = size.height > 0 ? size.height : rect.height / rect.editScaleY;
    const manualEditDragToken = beginStudioManualEditGesture(sel.element);
    const overlayBounds = overlayEl?.getBoundingClientRect();
    const centerX = (overlayBounds?.left ?? 0) + rect.left + rect.width / 2;
    const centerY = (overlayBounds?.top ?? 0) + rect.top + rect.height / 2;

    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    rafPausedRef.current = true;

    gestureRef.current = {
      kind,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      centerX,
      centerY,
      initialPathOffset: captureStudioPathOffset(sel.element),
      initialRotation: captureStudioRotation(sel.element),
      initialBoxSize: captureStudioBoxSize(sel.element),
      originLeft: rect.left,
      originTop: rect.top,
      originWidth: rect.width,
      originHeight: rect.height,
      actualOffsetX: offset.x,
      actualOffsetY: offset.y,
      actualWidth,
      actualHeight,
      actualRotation: rotation.angle,
      editScaleX: rect.editScaleX,
      editScaleY: rect.editScaleY,
      manualEditDragToken,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gestureRef.current;
    const sel = selectionRef.current;
    const box = boxRef.current;
    const blockedMove = blockedMoveRef.current;
    if (blockedMove && sel) {
      const dx = e.clientX - blockedMove.startX;
      const dy = e.clientY - blockedMove.startY;
      if (!blockedMove.notified && Math.hypot(dx, dy) >= BLOCKED_MOVE_THRESHOLD_PX) {
        blockedMove.notified = true;
        suppressNextBoxClickRef.current = true;
        onBlockedMoveRef.current(sel);
      }
      return;
    }

    if (!g || !sel || !box) return;

    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;

    if (g.kind === "rotate") {
      const nextRotation = resolveDomEditRotationGesture({
        centerX: g.centerX,
        centerY: g.centerY,
        startX: g.startX,
        startY: g.startY,
        currentX: e.clientX,
        currentY: e.clientY,
        actualAngle: g.actualRotation,
        snap: e.shiftKey,
      });
      applyStudioRotationDraft(sel.element, nextRotation);
      return;
    }

    if (g.kind === "drag") {
      const nextBoxLeft = g.originLeft + dx;
      const nextBoxTop = g.originTop + dy;
      box.style.left = `${nextBoxLeft}px`;
      box.style.top = `${nextBoxTop}px`;
      applyStudioPathOffsetDraft(
        sel.element,
        resolveDomEditPathOffsetGesture({
          actualOffsetX: g.actualOffsetX,
          actualOffsetY: g.actualOffsetY,
          scaleX: g.editScaleX,
          scaleY: g.editScaleY,
          dx,
          dy,
        }),
      );
    } else {
      const nextSize = resolveDomEditResizeGesture({
        originWidth: g.originWidth,
        originHeight: g.originHeight,
        actualWidth: g.actualWidth,
        actualHeight: g.actualHeight,
        scaleX: g.editScaleX,
        scaleY: g.editScaleY,
        dx,
        dy,
        uniform: e.shiftKey,
      });
      box.style.width = `${nextSize.overlayWidth}px`;
      box.style.height = `${nextSize.overlayHeight}px`;
      applyStudioBoxSizeDraft(sel.element, nextSize);
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    const sel = selectionRef.current;
    const box = boxRef.current;
    blockedMoveRef.current = null;
    if (!g || !sel) {
      gestureRef.current = null;
      rafPausedRef.current = false;
      return;
    }

    gestureRef.current = null;
    rafPausedRef.current = false;

    const movedDistance = Math.hypot(e.clientX - g.startX, e.clientY - g.startY);
    if (g.kind === "drag" && movedDistance < BLOCKED_MOVE_THRESHOLD_PX) {
      restoreStudioPathOffset(sel.element, g.initialPathOffset);
      endStudioManualEditGesture(sel.element, g.manualEditDragToken);
      if (box) {
        box.style.left = `${g.originLeft}px`;
        box.style.top = `${g.originTop}px`;
      }
      suppressNextBoxClickRef.current = true;
      onCanvasMouseDown(e as unknown as React.MouseEvent<HTMLDivElement>, {
        preferClipAncestor: false,
      });
      return;
    }

    if (g.kind === "resize" && movedDistance < BLOCKED_MOVE_THRESHOLD_PX) {
      restoreStudioBoxSize(sel.element, g.initialBoxSize);
      endStudioManualEditGesture(sel.element, g.manualEditDragToken);
      if (box) {
        box.style.width = `${g.originWidth}px`;
        box.style.height = `${g.originHeight}px`;
      }
      return;
    }

    if (g.kind === "rotate" && movedDistance < BLOCKED_MOVE_THRESHOLD_PX) {
      restoreStudioRotation(sel.element, g.initialRotation);
      endStudioManualEditGesture(sel.element, g.manualEditDragToken);
      return;
    }

    if (g.kind === "rotate") {
      const finalRotation = readStudioRotation(sel.element);
      applyStudioRotation(sel.element, finalRotation);
      void Promise.resolve(onRotationCommitRef.current(sel, finalRotation))
        .catch(() => {
          if (
            g.manualEditDragToken &&
            isStudioManualEditGestureCurrent(sel.element, g.manualEditDragToken)
          ) {
            restoreStudioRotation(sel.element, g.initialRotation);
          }
        })
        .finally(() => {
          endStudioManualEditGesture(sel.element, g.manualEditDragToken);
        });
    } else if (g.kind === "drag") {
      const finalOffset = readStudioPathOffset(sel.element);
      applyStudioPathOffset(sel.element, finalOffset);
      void Promise.resolve(onPathOffsetCommitRef.current(sel, finalOffset))
        .catch(() => {
          if (
            g.manualEditDragToken &&
            isStudioManualEditGestureCurrent(sel.element, g.manualEditDragToken)
          ) {
            restoreStudioPathOffset(sel.element, g.initialPathOffset);
          }
        })
        .finally(() => {
          endStudioManualEditGesture(sel.element, g.manualEditDragToken);
        });
    } else {
      const finalSize = readStudioBoxSize(sel.element);
      applyStudioBoxSize(sel.element, finalSize);
      void Promise.resolve(onBoxSizeCommitRef.current(sel, finalSize))
        .catch(() => {
          if (
            g.manualEditDragToken &&
            isStudioManualEditGestureCurrent(sel.element, g.manualEditDragToken)
          ) {
            restoreStudioBoxSize(sel.element, g.initialBoxSize);
          }
        })
        .finally(() => {
          endStudioManualEditGesture(sel.element, g.manualEditDragToken);
        });
    }
  };

  // Click on overlay background → select whatever is under the pointer in the iframe.
  // This handles clicking children inside an already-selected parent: the selection
  // box stops propagation for drag gestures, but clicks on the transparent overlay
  // area outside the box pass through to the iframe pick logic.
  const handleOverlayMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-dom-edit-selection-box="true"]')) return;
    onCanvasMouseDown(event, { preferClipAncestor: false });
  };

  // Click on the selection box itself → re-pick the element under the pointer.
  // This lets you click a child element even when a parent is selected, because
  // the click coordinates are forwarded to the iframe's element picker.
  const handleBoxClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (gestureRef.current) return;
    if (suppressNextBoxClickRef.current) {
      suppressNextBoxClickRef.current = false;
      event.stopPropagation();
      return;
    }
    onCanvasMouseDown(event, { preferClipAncestor: false });
  };

  const clearPointerState = () => {
    const g = gestureRef.current;
    const sel = selectionRef.current;
    if (g?.mode === "path-offset" && sel) {
      restoreStudioPathOffset(sel.element, g.initialPathOffset);
      endStudioManualEditGesture(sel.element, g.manualEditDragToken);
    }
    if (g?.mode === "box-size" && sel) {
      restoreStudioBoxSize(sel.element, g.initialBoxSize);
      endStudioManualEditGesture(sel.element, g.manualEditDragToken);
    }
    if (g?.mode === "rotation" && sel) {
      restoreStudioRotation(sel.element, g.initialRotation);
      endStudioManualEditGesture(sel.element, g.manualEditDragToken);
    }
    blockedMoveRef.current = null;
    gestureRef.current = null;
    rafPausedRef.current = false;
  };

  return (
    <div
      key={selectionKey}
      ref={overlayRef}
      className="absolute inset-0 z-10 pointer-events-auto outline-none"
      tabIndex={-1}
      aria-label="Composition canvas"
      onPointerDownCapture={(event) => focusDomEditOverlayElement(event.currentTarget)}
      onMouseDown={handleOverlayMouseDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={clearPointerState}
    >
      {selection && overlayRect && (
        <>
          {allowCanvasMovement && selection.capabilities.canApplyManualRotation && (
            <div
              className="pointer-events-none absolute"
              style={{
                left: overlayRect.left + overlayRect.width / 2,
                top: overlayRect.top - 34,
                width: 28,
                height: 34,
                transform: "translateX(-50%)",
              }}
            >
              <div className="absolute left-1/2 top-3 h-5 w-px -translate-x-1/2 bg-studio-accent/60" />
              <button
                type="button"
                className="pointer-events-auto absolute left-1/2 top-0 h-4 w-4 -translate-x-1/2 rounded-full border border-studio-accent/80 bg-neutral-950 p-0 shadow-[0_0_0_2px_rgba(60,230,172,0.18)]"
                style={{ cursor: "grab", touchAction: "none" }}
                title="Rotate"
                aria-label="Rotate selection"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  startGesture("rotate", e);
                }}
              />
            </div>
          )}
          <div
            key={selectionKey}
            ref={boxRef}
            data-dom-edit-selection-box="true"
            className="pointer-events-auto absolute rounded-xl border border-studio-accent/80 bg-studio-accent/5 shadow-[0_0_0_1px_rgba(60,230,172,0.25)]"
            style={{
              left: overlayRect.left,
              top: overlayRect.top,
              width: overlayRect.width,
              height: overlayRect.height,
              cursor:
                allowCanvasMovement && selection.capabilities.canApplyManualOffset
                  ? "move"
                  : "default",
            }}
            onPointerDown={(e) => {
              if (!allowCanvasMovement) return;
              if (selection.capabilities.canApplyManualOffset) {
                startGesture("drag", e);
                return;
              }
              e.preventDefault();
              e.stopPropagation();
              e.currentTarget.setPointerCapture(e.pointerId);
              blockedMoveRef.current = {
                pointerId: e.pointerId,
                startX: e.clientX,
                startY: e.clientY,
                notified: false,
              };
            }}
            onClick={handleBoxClick}
          >
            {/* Resize handle — bottom-right corner */}
            {allowCanvasMovement && selection.capabilities.canApplyManualSize && (
              <div
                className="absolute -right-1.5 -bottom-1.5 w-3 h-3 rounded-sm bg-studio-accent border border-studio-accent/60"
                style={{ cursor: "se-resize", touchAction: "none" }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  startGesture("resize", e);
                }}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
});
