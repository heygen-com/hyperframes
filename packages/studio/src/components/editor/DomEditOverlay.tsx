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
  focusDomEditOverlayElement,
} from "./domEditOverlayGestures";
import { useDomEditOverlayRects } from "./useDomEditOverlayRects";
import { OffCanvasIndicators, type OffCanvasRect } from "./OffCanvasIndicators";
import { createDomEditOverlayGestureHandlers } from "./useDomEditOverlayGestures";
import { useDomEditNudge } from "./useDomEditNudge";
import { SnapGuideOverlay, type SnapGuidesState } from "./SnapGuideOverlay";
import { GridOverlay } from "./GridOverlay";
import type { GestureRecordingState } from "./GestureRecordControl";
import { DomEditGroupChrome, DomEditSelectionChrome } from "./DomEditSelectionChrome";
import { hugRectForElement } from "./domEditOverlayCrop";
import { useCropOverlay } from "../../hooks/useCropOverlay";
import { readDomEditSelectionShapeStyles, resolveBoxChromeClass } from "./domEditOverlayShape";
import { useDomEditCompositionRect } from "./useDomEditCompositionRect";
import { useMountEffect } from "../../hooks/useMountEffect";
import { startOffCanvasIndicatorRefresh } from "./offCanvasIndicatorRefresh";
import { CanvasContextMenu } from "./CanvasContextMenu";
import type { ZOrderPatch } from "./canvasContextMenuZOrder";
import { getPreviewTargetFromPointer } from "../../utils/studioPreviewHelpers";

// Re-exports for external consumers — preserving existing import paths.
export {
  filterNestedDomEditGroupItems,
  resolveDomEditCoordinateScale,
  resolveDomEditGroupOverlayRect,
} from "./domEditOverlayGeometry";
export {
  focusDomEditOverlayElement,
  hasDomEditRotationChanged,
  resolveDomEditRotationGesture,
} from "./domEditOverlayGestures";
export type { DomEditGroupPathOffsetCommit } from "./domEditOverlayGestures";

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
    offset?: { x: number; y: number },
    restore?: () => void,
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
   * Called with the resolved z-order patch list after an optimistic DOM update.
   * The patch list is tie-aware and may include sibling elements (see
   * canvasContextMenuZOrder). Wire to handleDomZIndexReorderCommit from
   * useDomEditActionsContext. See CanvasContextMenu.tsx module comment.
   */
  onApplyZIndex?: (selection: DomEditSelection, patches: ZOrderPatch[]) => void;
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
  // contextMenuSelection is the element the menu targets — captured at right-click
  // time so the menu can open even before the React selection state settles.
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    sel: DomEditSelection;
  } | null>(null);

  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  // Close the context menu whenever the selection moves off the element the menu
  // targets (a click that reselects elsewhere, a deselect, or a preview reload
  // that rebuilds the selection). Without this the menu can linger — orphaned —
  // over a stale target after the underlying element is gone. A right-click that
  // OPENS the menu also selects its target, so the common open path keeps the
  // menu (same element) rather than immediately dismissing it.
  useEffect(() => {
    if (!contextMenu) return;
    if (!selection || selection.element !== contextMenu.sel.element) {
      setContextMenu(null);
    }
  }, [selection, contextMenu]);

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

    // Start marquee if clicking on empty canvas (no element under pointer).
    // The hover selection is an ASYNC cache: on a fast click (or when the
    // pointer was already resting over an element) it can still be empty while
    // an element IS under the pointer — starting a marquee here would swallow
    // the selection mousedown and the click would silently select nothing.
    // Confirm emptiness with a fresh SYNCHRONOUS hit-test before committing.
    if (!hoverSelectionRef.current && onMarqueeSelectRef.current && compRect.width > 0) {
      const iframe = iframeRef.current;
      const freshTarget = iframe
        ? getPreviewTargetFromPointer(
            iframe,
            event.clientX,
            event.clientY,
            activeCompositionPathRef.current,
          )
        : null;
      if (freshTarget) return;
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
      let activeSel: DomEditSelection | null = currentSel;
      if (!currentSel) {
        const pointerEvent = event as unknown as React.PointerEvent<HTMLDivElement>;
        const resolved = await onCanvasPointerMoveRef.current(pointerEvent);
        if (!resolved) return; // Nothing under the cursor — skip menu.
        onSelectionChangeRef.current(resolved, { revealPanel: true });
        // Use `resolved` directly: React state (and therefore selectionRef) won't
        // update synchronously after onSelectionChange — we'd be reading stale null.
        activeSel = resolved;
      } else {
        // Check if the user right-clicked on an unselected element (hover target).
        const hover = hoverSelectionRef.current;
        if (hover && hover.element !== currentSel.element) {
          onSelectionChangeRef.current(hover, { revealPanel: true });
          activeSel = hover;
        }
      }

      if (!activeSel) return;
      setContextMenu({ x: event.clientX, y: event.clientY, sel: activeSel });
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
          style={{
            ...hugRectForElement(hoverRect, hoverSelection.element),
            transform: hoverRect.angle ? `rotate(${hoverRect.angle}deg)` : undefined,
          }}
        />
      )}
      {hasGroupSelection && groupOverlayItems.length > 1 && groupBounds && compRect.width > 0 && (
        <DomEditGroupChrome
          groupOverlayItems={groupOverlayItems}
          groupBounds={groupBounds}
          allowCanvasMovement={allowCanvasMovement}
          groupCanMove={groupCanMove}
          gestures={gestures}
          onBoxMouseDown={suppressBoxMouseDown}
          onBoxClick={handleBoxClick}
        />
      )}
      {!hasGroupSelection && selection && overlayRect && compRect.width > 0 && (
        <DomEditSelectionChrome
          selection={selection}
          overlayRect={overlayRect}
          allowCanvasMovement={allowCanvasMovement}
          cropOutlineInsetPx={cropOutlineInsetPx ?? undefined}
          boxRef={boxRef}
          boxChromeClass={boxChromeClass}
          boxClipPath={boxClipPath}
          selectionKey={selectionKey}
          groupSelectionCount={groupSelections.length}
          blockedMoveRef={blockedMoveRef}
          gestures={gestures}
          onStyleCommit={onStyleCommitRef.current}
          onBoxMouseDown={suppressBoxMouseDown}
          onBoxClick={handleBoxClick}
        />
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
      {contextMenu && (
        <CanvasContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          selection={contextMenu.sel}
          onClose={() => setContextMenu(null)}
          onDelete={
            onDeleteSelection
              ? (sel) => {
                  setContextMenu(null);
                  onDeleteSelection(sel);
                }
              : undefined
          }
          onApplyZIndex={
            onApplyZIndex
              ? (patches) => {
                  onApplyZIndex(contextMenu.sel, patches);
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
