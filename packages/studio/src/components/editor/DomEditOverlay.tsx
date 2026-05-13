import { memo, useMemo, useRef, type RefObject } from "react";
import { type DomEditSelection } from "./domEditing";
import { resolveDomEditGroupOverlayRect, toOverlayRect } from "./domEditOverlayGeometry";
import {
  type BlockedMoveState,
  type FocusableDomEditOverlay,
  type GestureState,
  type GroupGestureState,
  focusDomEditOverlayElement,
} from "./domEditOverlayGestures";
import { useDomEditOverlayRects } from "./useDomEditOverlayRects";
import { createDomEditOverlayGestureHandlers } from "./useDomEditOverlayGestures";

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

export interface DomEditGroupPathOffsetCommit {
  selection: DomEditSelection;
  next: { x: number; y: number };
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
    options?: { preferClipAncestor?: boolean },
  ) => void;
  onCanvasPointerMove: (
    event: React.PointerEvent<HTMLDivElement>,
    options?: { preferClipAncestor?: boolean },
  ) => DomEditSelection | null;
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
  ) => Promise<void> | void;
  onGroupPathOffsetCommit: (updates: DomEditGroupPathOffsetCommit[]) => Promise<void> | void;
  onBoxSizeCommit: (
    selection: DomEditSelection,
    next: { width: number; height: number },
  ) => Promise<void> | void;
  onRotationCommit: (selection: DomEditSelection, next: { angle: number }) => Promise<void> | void;
}

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
  onManualDragStart,
  onPathOffsetCommit,
  onGroupPathOffsetCommit,
  onBoxSizeCommit,
  onRotationCommit,
}: DomEditOverlayProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const gestureRef = useRef<GestureState | null>(null);
  const groupGestureRef = useRef<GroupGestureState | null>(null);
  const blockedMoveRef = useRef<BlockedMoveState | null>(null);
  const suppressNextBoxClickRef = useRef(false);
  const suppressNextBoxMouseDownRef = useRef(false);
  const suppressNextOverlayMouseDownRef = useRef(false);
  const rafPausedRef = useRef(false);

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
  } = useDomEditOverlayRects({
    iframeRef,
    overlayRef,
    selectionRef,
    activeCompositionPathRef,
    groupSelectionsRef,
    hoverSelectionRef,
    rafPausedRef,
  });

  const gestures = createDomEditOverlayGestureHandlers({
    overlayRef,
    boxRef,
    selectionRef,
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
    onCanvasMouseDown(event, { preferClipAncestor: false });
    if (event.shiftKey) {
      suppressNextBoxMouseDownRef.current = true;
      suppressNextBoxClickRef.current = true;
    }
  };

  const handleOverlayPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!allowCanvasMovement || event.button !== 0) return;
    if (event.shiftKey) {
      const candidate =
        onCanvasPointerMoveRef.current(event, { preferClipAncestor: false }) ??
        hoverSelectionRef.current;
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

    const candidate =
      onCanvasPointerMoveRef.current(event, { preferClipAncestor: false }) ??
      hoverSelectionRef.current;
    if (!candidate?.capabilities.canApplyManualOffset) return;

    const overlayEl = overlayRef.current;
    const iframe = iframeRef.current;
    const candidateRect =
      overlayEl && iframe ? toOverlayRect(overlayEl, iframe, candidate.element) : null;
    if (!candidateRect) return;

    suppressNextOverlayMouseDownRef.current = true;
    selectionRef.current = candidate;
    setOverlayRect(candidateRect);
    const didStartGesture = gestures.startGesture("drag", event, {
      selection: candidate,
      rect: candidateRect,
    });
    if (!didStartGesture) {
      suppressNextOverlayMouseDownRef.current = false;
      return;
    }
    onSelectionChangeRef.current(candidate);
  };

  const handleBoxClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (gestureRef.current || groupGestureRef.current) return;
    if (suppressNextBoxClickRef.current) {
      suppressNextBoxClickRef.current = false;
      event.stopPropagation();
      return;
    }
    onCanvasMouseDown(event, { preferClipAncestor: false });
  };

  const suppressBoxMouseDown = (e: React.MouseEvent) => {
    if (!suppressNextBoxMouseDownRef.current) return;
    suppressNextBoxMouseDownRef.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 z-10 pointer-events-auto outline-none"
      tabIndex={-1}
      aria-label="Composition canvas"
      onPointerDownCapture={(event) =>
        focusDomEditOverlayElement(event.currentTarget as FocusableDomEditOverlay)
      }
      onPointerDown={handleOverlayPointerDown}
      onMouseDown={handleOverlayMouseDown}
      onPointerMove={gestures.onPointerMove}
      onPointerLeave={() => onCanvasPointerLeaveRef.current()}
      onPointerUp={gestures.onPointerUp}
      onPointerCancel={() => gestures.clearPointerState(selectionRef)}
    >
      {hoverSelection && hoverRect && (
        <div
          aria-hidden="true"
          data-dom-edit-hover-box="true"
          className="pointer-events-none absolute rounded-xl border border-studio-accent/80 bg-studio-accent/5 shadow-[0_0_0_1px_rgba(60,230,172,0.25)]"
          style={{
            left: hoverRect.left,
            top: hoverRect.top,
            width: hoverRect.width,
            height: hoverRect.height,
          }}
        />
      )}
      {hasGroupSelection && groupOverlayItems.length > 1 && groupBounds && (
        <>
          {groupOverlayItems.map((item) => (
            <div
              key={item.key}
              aria-hidden="true"
              className="pointer-events-none absolute rounded-xl border border-studio-accent/70 bg-studio-accent/[0.03]"
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
            className="pointer-events-auto absolute rounded-xl border border-studio-accent bg-studio-accent/5 shadow-[0_0_0_1px_rgba(60,230,172,0.3)]"
            style={{
              left: groupBounds.left,
              top: groupBounds.top,
              width: groupBounds.width,
              height: groupBounds.height,
              cursor: allowCanvasMovement && groupCanMove ? "move" : "default",
            }}
            onPointerDown={(e) => {
              if (!allowCanvasMovement || e.shiftKey) return;
              gestures.startGroupDrag(e);
            }}
            onMouseDown={suppressBoxMouseDown}
            onClick={handleBoxClick}
          />
        </>
      )}
      {!hasGroupSelection && selection && overlayRect && (
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
              <div className="absolute left-1/2 top-3 bottom-0 w-px -translate-x-1/2 bg-studio-accent/60" />
              <button
                type="button"
                className="pointer-events-auto absolute left-1/2 top-0 h-3 w-3 -translate-x-1/2 rounded-full border border-studio-accent bg-studio-accent p-0 shadow-[0_0_0_2px_rgba(60,230,172,0.18)]"
                style={{ cursor: "grab", touchAction: "none" }}
                title="Rotate"
                aria-label="Rotate selection"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  gestures.startGesture("rotate", e);
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
            {allowCanvasMovement && selection.capabilities.canApplyManualSize && (
              <div
                className="absolute -right-1.5 -bottom-1.5 w-3 h-3 rounded-sm bg-studio-accent border border-studio-accent/60"
                style={{ cursor: "se-resize", touchAction: "none" }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  gestures.startGesture("resize", e);
                }}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
});
