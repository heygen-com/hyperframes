import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { type DomEditSelection } from "./domEditing";
import type { PreviewMouseDownOptions } from "../../hooks/usePreviewInteraction";
import { useMarqueeGestures } from "./marqueeCommit";
import { MarqueeOverlay } from "./MarqueeOverlay";
import { resolveDomEditGroupOverlayRect } from "./domEditOverlayGeometry";
import {
  type BlockedMoveState,
  type DomEditGroupPathOffsetCommit,
  type FocusableDomEditOverlay,
  type GestureState,
  type GroupGestureState,
  type ResizeHandle,
  focusDomEditOverlayElement,
} from "./domEditOverlayGestures";
import { useDomEditOverlayRects } from "./useDomEditOverlayRects";
import { OffCanvasIndicators, type OffCanvasRect } from "./OffCanvasIndicators";
import { createDomEditOverlayGestureHandlers } from "./useDomEditOverlayGestures";
import { useDomEditNudge } from "./useDomEditNudge";
import { SnapGuideOverlay, type SnapGuidesState } from "./SnapGuideOverlay";
import { GridOverlay } from "./GridOverlay";
import type { GestureRecordingState } from "./GestureRecordControl";
import { DomEditCropHandles } from "./DomEditCropHandles";
import { DomEditRotateHandle } from "./DomEditRotateHandle";
import { hugRectForElement } from "./domEditOverlayCrop";
import { useCropOverlay } from "../../hooks/useCropOverlay";
import { readDomEditSelectionShapeStyles, resolveBoxChromeClass } from "./domEditOverlayShape";
import { useDomEditCompositionRect } from "./useDomEditCompositionRect";
import { useMountEffect } from "../../hooks/useMountEffect";
import { startOffCanvasIndicatorRefresh } from "./offCanvasIndicatorRefresh";
import { CanvasContextMenu } from "./CanvasContextMenu";

// Re-exports for external consumers — preserving existing import paths.
export {
  filterNestedDomEditGroupItems,
  resolveDomEditCoordinateScale,
  resolveDomEditGroupOverlayRect,
} from "./domEditOverlayGeometry";
export {
  focusDomEditOverlayElement,
  hasDomEditRotationChanged,
  resolveDomEditResizeGesture,
  resolveDomEditRotationGesture,
} from "./domEditOverlayGestures";
export type { DomEditGroupPathOffsetCommit } from "./domEditOverlayGestures";

// Corner resize handles, Canva-style: one per corner, diagonal cursors.
// Non-SE corners anchor the opposite corner by translating the element, so
// they need the manual-offset capability in addition to manual-size.
const RESIZE_HANDLE_DEFS: Array<{
  handle: ResizeHandle;
  cursor: string;
  x: "left" | "right";
  y: "top" | "bottom";
}> = [
  { handle: "nw", cursor: "nwse-resize", x: "left", y: "top" },
  { handle: "ne", cursor: "nesw-resize", x: "right", y: "top" },
  { handle: "sw", cursor: "nesw-resize", x: "left", y: "bottom" },
  { handle: "se", cursor: "nwse-resize", x: "right", y: "bottom" },
];

// Visible dot is 9px; the pointer target is a 16px invisible square centered
// on the corner so click targets don't shrink with the smaller dot.
const RESIZE_HANDLE_HIT_PX = 16;

function resizeHandleStyle(
  def: (typeof RESIZE_HANDLE_DEFS)[number],
  overlayRect: { left: number; top: number; width: number; height: number },
  cropInset?: { top: number; right: number; bottom: number; left: number },
): React.CSSProperties {
  const half = RESIZE_HANDLE_HIT_PX / 2;
  const style: React.CSSProperties = { cursor: def.cursor, touchAction: "none" };
  // Position relative to the overlay container (not the selection box).
  // This ensures the dots render as siblings of the box border div — strictly
  // above it — rather than as children where the parent border can visually
  // overlap the dot circle at the corner.
  if (def.x === "left") {
    style.left = overlayRect.left + (cropInset?.left ?? 0) - half;
  } else {
    style.left = overlayRect.left + overlayRect.width - (cropInset?.right ?? 0) - half;
  }
  if (def.y === "top") {
    style.top = overlayRect.top + (cropInset?.top ?? 0) - half;
  } else {
    style.top = overlayRect.top + overlayRect.height - (cropInset?.bottom ?? 0) - half;
  }
  return style;
}

interface DomEditOverlayProps {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  activeCompositionPath: string | null;
  selection: DomEditSelection | null;
  groupSelections?: DomEditSelection[];
  hoverSelection: DomEditSelection | null;
  allowCanvasMovement?: boolean;
  onCanvasMouseDown: (
    event: React.MouseEvent<HTMLDivElement>,
    options?: PreviewMouseDownOptions,
  ) => void;
  onCanvasPointerMove: (
    event: React.PointerEvent<HTMLDivElement>,
    options?: { preferClipAncestor?: boolean },
  ) => Promise<DomEditSelection | null>;
  onCanvasPointerLeave: () => void;
  onSelectionChange: (
    selection: DomEditSelection,
    options?: { revealPanel?: boolean; additive?: boolean },
  ) => void;
  onBlockedMove: (selection: DomEditSelection) => void;
  onManualDragStart?: () => void;
  onPathOffsetCommit: (
    selection: DomEditSelection,
    next: { x: number; y: number },
    modifiers?: { altKey?: boolean },
  ) => Promise<void> | void;
  onGroupPathOffsetCommit: (updates: DomEditGroupPathOffsetCommit[]) => Promise<void> | void;
  onBoxSizeCommit: (
    selection: DomEditSelection,
    next: { width: number; height: number },
  ) => Promise<void> | void;
  onRotationCommit: (selection: DomEditSelection, next: { angle: number }) => Promise<void> | void;
  onStyleCommit?: (property: string, value: string) => Promise<void> | void;
  gridVisible?: boolean;
  gridSpacing?: number;
  recordingState?: GestureRecordingState;
  onToggleRecording?: () => void;
  onMarqueeSelect?: (selections: DomEditSelection[], additive: boolean) => void;
  /**
   * Delete the selected canvas element.
   * Wire to handleDomEditElementDelete from useDomEditActionsContext —
   * same handler the Delete/Backspace hotkey uses.
   */
  onDeleteSelection?: (selection: DomEditSelection) => void;
  /**
   * Called with the resolved new z-index after an optimistic DOM update.
   * Wire to handleDomZIndexReorderCommit from useDomEditActionsContext.
   * See CanvasContextMenu.tsx module comment for the wiring snippet.
   */
  onApplyZIndex?: (selection: DomEditSelection, zIndex: number) => void;
}

// fallow-ignore-next-line complexity
export const DomEditOverlay = memo(function DomEditOverlay({
  iframeRef,
  activeCompositionPath,
  selection,
  groupSelections = [],
  hoverSelection,
  allowCanvasMovement = true,
  onCanvasMouseDown,
  onCanvasPointerMove,
  onCanvasPointerLeave,
  onSelectionChange,
  onBlockedMove,
  gridVisible = false,
  gridSpacing = 50,
  onManualDragStart,
  onPathOffsetCommit,
  onGroupPathOffsetCommit,
  onBoxSizeCommit,
  onRotationCommit,
  onStyleCommit,
  onMarqueeSelect,
  onDeleteSelection,
  onApplyZIndex,
}: DomEditOverlayProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const onMarqueeSelectRef = useRef(onMarqueeSelect);
  onMarqueeSelectRef.current = onMarqueeSelect;

  const selectionShapeStyles = readDomEditSelectionShapeStyles(selection);
  const gestureRef = useRef<GestureState | null>(null);
  const groupGestureRef = useRef<GroupGestureState | null>(null);
  const blockedMoveRef = useRef<BlockedMoveState | null>(null);
  const suppressNextBoxClickRef = useRef(false);
  const suppressNextBoxMouseDownRef = useRef(false);
  const suppressNextOverlayMouseDownRef = useRef(false);
  const snapGuidesRef = useRef<SnapGuidesState | null>(null);
  const rafPausedRef = useRef(false);

  // Context menu state: position of the right-click that opened it.
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const activeCompositionPathRef = useRef(activeCompositionPath);
  activeCompositionPathRef.current = activeCompositionPath;
  const groupSelectionsRef = useRef(groupSelections);
  groupSelectionsRef.current = groupSelections;
  const hoverSelectionRef = useRef(hoverSelection);
  hoverSelectionRef.current = hoverSelection;
  const onPathOffsetCommitRef = useRef(onPathOffsetCommit);
  onPathOffsetCommitRef.current = onPathOffsetCommit;
  const onGroupPathOffsetCommitRef = useRef(onGroupPathOffsetCommit);
  onGroupPathOffsetCommitRef.current = onGroupPathOffsetCommit;
  const onBoxSizeCommitRef = useRef(onBoxSizeCommit);
  onBoxSizeCommitRef.current = onBoxSizeCommit;
  const onRotationCommitRef = useRef(onRotationCommit);
  onRotationCommitRef.current = onRotationCommit;
  const onStyleCommitRef = useRef(onStyleCommit);
  onStyleCommitRef.current = onStyleCommit;
  const onBlockedMoveRef = useRef(onBlockedMove);
  onBlockedMoveRef.current = onBlockedMove;
  const onManualDragStartRef = useRef(onManualDragStart);
  onManualDragStartRef.current = onManualDragStart;
  const onCanvasPointerMoveRef = useRef(onCanvasPointerMove);
  onCanvasPointerMoveRef.current = onCanvasPointerMove;
  const onCanvasPointerLeaveRef = useRef(onCanvasPointerLeave);
  onCanvasPointerLeaveRef.current = onCanvasPointerLeave;
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;

  const {
    overlayRect,
    overlayRectRef,
    setOverlayRect,
    hoverRect,
    groupOverlayItems,
    groupOverlayItemsRef,
    setGroupOverlayItems,
    childRects,
  } = useDomEditOverlayRects({
    iframeRef,
    overlayRef,
    selectionRef,
    activeCompositionPathRef,
    groupSelectionsRef,
    hoverSelectionRef,
    rafPausedRef,
  });

  const compRect = useDomEditCompositionRect({ iframeRef, overlayRef });
  const compRectRef = useRef(compRect);
  compRectRef.current = compRect;

  const { hasCropInsets, cropOutlineInsetPx } = useCropOverlay({
    selection,
    overlayRect,
  });
  // Inset crops draw their own outline child; other clip shapes keep the raw mirror.
  const boxClipPath = hasCropInsets ? undefined : selectionShapeStyles.clipPath;
  const boxChromeClass = resolveBoxChromeClass(Boolean(cropOutlineInsetPx), boxClipPath);

  // Off-canvas element indicators — dashed outlines for elements positioned
  // outside the composition bounds so users can find them.
  const offCanvasElementsRef = useRef<Map<string, HTMLElement>>(new Map());
  const [offCanvasRects, setOffCanvasRects] = useState<OffCanvasRect[]>([]);
  const offCanvasDirtyRef = useRef(true);
  const offCanvasSigRef = useRef("");
  const offCanvasObserverRef = useRef<MutationObserver | null>(null);
  const offCanvasObservedDocRef = useRef<Document | null>(null);

  // Positions depend on live iframe layout, not selection — the selected-element
  // suppression is a render-time filter, so selection/groupSelections stay out
  // of the geometry walk.
  useMountEffect(() =>
    startOffCanvasIndicatorRefresh({
      iframeRef,
      overlayRef,
      compRectRef,
      activeCompositionPathRef,
      dirtyRef: offCanvasDirtyRef,
      sigRef: offCanvasSigRef,
      observerRef: offCanvasObserverRef,
      observedDocRef: offCanvasObservedDocRef,
      elementsRef: offCanvasElementsRef,
      setRects: setOffCanvasRects,
    }),
  );

  // Switching compositions may not swap the iframe document (so the observer's
  // doc-swap detection wouldn't fire) yet changes which elements are off-canvas.
  // Force a recompute explicitly on comp change.
  useEffect(() => {
    offCanvasDirtyRef.current = true;
  }, [activeCompositionPath]);

  const gestures = createDomEditOverlayGestureHandlers({
    overlayRef,
    iframeRef,
    boxRef,
    selectionRef,
    hoverSelectionRef,
    overlayRectRef,
    groupOverlayItemsRef,
    gestureRef,
    groupGestureRef,
    blockedMoveRef,
    rafPausedRef,
    suppressNextBoxClickRef,
    setOverlayRect,
    setGroupOverlayItems,
    onBlockedMoveRef,
    onManualDragStartRef,
    onPathOffsetCommitRef,
    onGroupPathOffsetCommitRef,
    onBoxSizeCommitRef,
    onRotationCommitRef,
    onCanvasPointerMoveRef,
    onCanvasMouseDown,
    snapGuidesRef,
  });

  // Arrow-key nudge (1px, Shift = 10px) — commits through the same
  // path-offset callbacks as a drag, one undo entry per key burst.
  const { flushNudge } = useDomEditNudge({
    selection,
    groupSelections,
    allowCanvasMovement,
    selectionRef,
    overlayRectRef,
    groupOverlayItemsRef,
    gestureRef,
    groupGestureRef,
    blockedMoveRef,
    onManualDragStartRef,
    onPathOffsetCommitRef,
    onGroupPathOffsetCommitRef,
  });

  const marquee = useMarqueeGestures({
    iframeRef,
    overlayRef,
    activeCompositionPathRef,
    onMarqueeSelectRef,
    selectionRef,
    gestures,
  });

  const selectionKey = useMemo(() => {
    if (!selection) return "none";
    return `${selection.sourceFile}:${selection.id ?? selection.selector ?? selection.label}:${selection.selectorIndex ?? 0}`;
  }, [selection]);

  const groupBounds = useMemo(
    () => resolveDomEditGroupOverlayRect(groupOverlayItems.map((item) => item.rect)),
    [groupOverlayItems],
  );
  const hasGroupSelection = groupSelections.length > 1;
  const groupCanMove =
    hasGroupSelection &&
    groupOverlayItems.length > 1 &&
    groupOverlayItems.every((item) => item.selection.capabilities.canApplyManualOffset);

  const handleOverlayMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!allowCanvasMovement) return;
    if (suppressNextOverlayMouseDownRef.current) {
      suppressNextOverlayMouseDownRef.current = false;
      suppressNextBoxMouseDownRef.current = false;
      suppressNextBoxClickRef.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-dom-edit-selection-box="true"]')) return;
    // Allow clicks anywhere on the overlay — GSAP-translated elements can
    // extend beyond the composition rect into the gray zone, and users need
    // to select/deselect them by clicking there.
    onCanvasMouseDown(event, { hoverSelection: hoverSelectionRef.current });
    if (event.shiftKey) {
      suppressNextBoxMouseDownRef.current = true;
      suppressNextBoxClickRef.current = true;
    }
  };

  // fallow-ignore-next-line complexity
  const handleOverlayPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!allowCanvasMovement || event.button !== 0) return;
    if (event.shiftKey) {
      // Use the already-updated hover selection rather than re-resolving async
      const candidate = hoverSelectionRef.current;
      if (!candidate) return;
      event.preventDefault();
      event.stopPropagation();
      suppressNextOverlayMouseDownRef.current = true;
      suppressNextBoxMouseDownRef.current = true;
      suppressNextBoxClickRef.current = true;
      onSelectionChangeRef.current(candidate, { additive: true });
      return;
    }

    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-dom-edit-selection-box="true"]')) return;

    // Start marquee if clicking on empty canvas (no element under pointer)
    if (!hoverSelectionRef.current && onMarqueeSelectRef.current && compRect.width > 0) {
      const overlayEl = overlayRef.current;
      if (overlayEl) {
        const oRect = overlayEl.getBoundingClientRect();
        const cx = event.clientX - oRect.left;
        const cy = event.clientY - oRect.top;
        const inComp =
          cx >= compRect.left &&
          cx <= compRect.left + compRect.width &&
          cy >= compRect.top &&
          cy <= compRect.top + compRect.height;
        if (inComp) {
          event.preventDefault();
          event.stopPropagation();
          suppressNextOverlayMouseDownRef.current = true;
          (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
          marquee.marqueeRef.current = {
            startX: cx,
            startY: cy,
            currentX: cx,
            currentY: cy,
            pointerId: event.pointerId,
            pastThreshold: false,
          };
          return;
        }
      }
    }
  };

  const handleBoxClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!allowCanvasMovement) return;
    if (gestureRef.current || groupGestureRef.current) return;
    if (suppressNextBoxClickRef.current) {
      suppressNextBoxClickRef.current = false;
      event.stopPropagation();
      return;
    }
    onCanvasMouseDown(event, { hoverSelection: hoverSelectionRef.current });
  };

  const suppressBoxMouseDown = (e: React.MouseEvent) => {
    if (!suppressNextBoxMouseDownRef.current) return;
    suppressNextBoxMouseDownRef.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  // Right-click: select element first (if not already selected), then open menu.
  const handleContextMenu = useCallback(
    async (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();

      // If no element is selected yet, resolve it from the pointer position first.
      const currentSel = selectionRef.current;
      if (!currentSel) {
        const pointerEvent = event as unknown as React.PointerEvent<HTMLDivElement>;
        const resolved = await onCanvasPointerMoveRef.current(pointerEvent);
        if (resolved) {
          onSelectionChangeRef.current(resolved, { revealPanel: true });
        }
        // If still nothing resolved, skip menu.
        if (!selectionRef.current) return;
      } else {
        // Check if the user right-clicked on an unselected element (hover target).
        const hover = hoverSelectionRef.current;
        if (hover && hover.element !== currentSel.element) {
          onSelectionChangeRef.current(hover, { revealPanel: true });
        }
      }

      setContextMenu({ x: event.clientX, y: event.clientY });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 z-10 pointer-events-auto outline-none"
      tabIndex={-1}
      aria-label="Composition canvas"
      // Cursor follows marquee rect *state* (re-renders), not the mutable ref.
      style={marquee.marqueeRect ? { cursor: "crosshair" } : undefined}
      onPointerDownCapture={(event) => {
        // A pointer gesture supersedes a pending nudge burst — commit it first
        // so the gesture's member snapshot starts from the nudged position.
        flushNudge();
        focusDomEditOverlayElement(event.currentTarget as FocusableDomEditOverlay);
      }}
      onPointerDown={handleOverlayPointerDown}
      onMouseDown={handleOverlayMouseDown}
      onPointerMove={marquee.onPointerMove}
      onPointerLeave={() => onCanvasPointerLeaveRef.current()}
      onPointerUp={marquee.onPointerUp}
      onPointerCancel={marquee.onPointerCancel}
      onContextMenu={handleContextMenu}
    >
      {hoverSelection && hoverRect && compRect.width > 0 && (
        <div
          aria-hidden="true"
          data-dom-edit-hover-box="true"
          className="pointer-events-none absolute rounded-md border border-studio-accent/80 shadow-[0_0_0_1px_rgba(60,230,172,0.25)]"
          style={hugRectForElement(hoverRect, hoverSelection.element)}
        />
      )}
      {hasGroupSelection && groupOverlayItems.length > 1 && groupBounds && compRect.width > 0 && (
        <>
          {groupOverlayItems.map((item) => (
            <div
              key={item.key}
              aria-hidden="true"
              className="pointer-events-none absolute rounded-xl border border-studio-accent/70"
              style={{
                left: item.rect.left,
                top: item.rect.top,
                width: item.rect.width,
                height: item.rect.height,
              }}
            />
          ))}
          <div
            data-dom-edit-selection-box="true"
            className="pointer-events-auto absolute rounded-xl border border-studio-accent shadow-[0_0_0_1px_rgba(60,230,172,0.3)]"
            style={{
              left: groupBounds.left,
              top: groupBounds.top,
              width: groupBounds.width,
              height: groupBounds.height,
              cursor: allowCanvasMovement && groupCanMove ? "move" : "default",
            }}
            onPointerDown={(e) => {
              if (!allowCanvasMovement || !groupCanMove || e.shiftKey) return;
              gestures.startGroupDrag(e);
            }}
            onMouseDown={suppressBoxMouseDown}
            onClick={handleBoxClick}
          />
        </>
      )}
      {!hasGroupSelection && selection && overlayRect && compRect.width > 0 && (
        <>
          {allowCanvasMovement && selection.capabilities.canApplyManualRotation && (
            <DomEditRotateHandle
              overlayRect={overlayRect}
              cropOutlineInsetPx={cropOutlineInsetPx}
              onStartRotate={(e) => {
                e.stopPropagation();
                gestures.startGesture("rotate", e);
              }}
            />
          )}
          <div
            key={selectionKey}
            ref={boxRef}
            data-dom-edit-selection-box="true"
            className={`pointer-events-auto absolute rounded-md ${boxChromeClass}`}
            style={{
              left: overlayRect.left,
              top: overlayRect.top,
              width: overlayRect.width,
              height: overlayRect.height,
              clipPath: boxClipPath,
              cursor:
                allowCanvasMovement && selection.capabilities.canApplyManualOffset
                  ? "move"
                  : "default",
            }}
            onPointerDown={(e) => {
              if (!allowCanvasMovement || e.shiftKey) return;
              if (selection.capabilities.canApplyManualOffset) {
                gestures.startGesture("drag", e);
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
            onMouseDown={suppressBoxMouseDown}
            onClick={handleBoxClick}
          >
            {cropOutlineInsetPx && (
              <div
                className="pointer-events-none absolute rounded-md border border-studio-accent/80 shadow-[0_0_0_1px_rgba(60,230,172,0.25)]"
                style={{
                  left: cropOutlineInsetPx.left,
                  top: cropOutlineInsetPx.top,
                  right: cropOutlineInsetPx.right,
                  bottom: cropOutlineInsetPx.bottom,
                }}
              />
            )}
          </div>
          {/* Resize-handle dots rendered as siblings of the selection box, not
              children, so they paint strictly above the box border. Each handle
              is positioned relative to the overlay container using the
              overlayRect origin, matching the old child-relative offsets. */}
          {allowCanvasMovement &&
            selection.capabilities.canApplyManualSize &&
            RESIZE_HANDLE_DEFS.map((def) =>
              def.handle !== "se" && !selection.capabilities.canApplyManualOffset ? null : (
                <div
                  key={def.handle}
                  className="absolute flex h-4 w-4 items-center justify-center"
                  style={resizeHandleStyle(def, overlayRect, cropOutlineInsetPx ?? undefined)}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    gestures.startGesture("resize", e, { resizeHandle: def.handle });
                  }}
                >
                  <div className="pointer-events-none h-[9px] w-[9px] rounded-full border-[1.5px] border-studio-accent bg-white shadow-[0_0_3px_rgba(0,0,0,0.45)]" />
                </div>
              ),
            )}
          {selection.capabilities.canCrop && groupSelections.length <= 1 && (
            <DomEditCropHandles
              selection={selection}
              overlayRect={overlayRect}
              onStyleCommit={onStyleCommitRef.current}
            />
          )}
        </>
      )}
      {childRects.length > 0 &&
        compRect.width > 0 &&
        childRects.map((cr, i) => (
          <div
            key={i}
            className="pointer-events-none absolute border border-dashed border-white/20 rounded-sm"
            style={{
              left: cr.left,
              top: cr.top,
              width: cr.width,
              height: cr.height,
            }}
          />
        ))}
      <OffCanvasIndicators
        rects={offCanvasRects}
        elements={offCanvasElementsRef}
        compRect={compRect}
        selection={selection}
        groupSelections={groupSelections}
        activeCompositionPathRef={activeCompositionPathRef}
        onSelectionChangeRef={onSelectionChangeRef}
      />
      <MarqueeOverlay candidateRects={marquee.candidateRects} marqueeRect={marquee.marqueeRect} />
      {contextMenu && selection && (
        <CanvasContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          selection={selection}
          onClose={() => setContextMenu(null)}
          onDelete={(sel) => {
            setContextMenu(null);
            onDeleteSelection?.(sel);
          }}
          onApplyZIndex={
            onApplyZIndex
              ? (zIndex) => {
                  onApplyZIndex(selection, zIndex);
                }
              : undefined
          }
        />
      )}
      <GridOverlay
        visible={gridVisible}
        spacing={gridSpacing}
        scaleX={compRect.scaleX}
        scaleY={compRect.scaleY}
        compositionLeft={compRect.left}
        compositionTop={compRect.top}
        compositionWidth={compRect.width}
        compositionHeight={compRect.height}
      />
      <SnapGuideOverlay
        snapGuidesRef={snapGuidesRef}
        compositionLeft={compRect.left}
        compositionTop={compRect.top}
        compositionWidth={compRect.width}
        compositionHeight={compRect.height}
      />
    </div>
  );
});
