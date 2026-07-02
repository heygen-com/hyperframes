import { memo, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";
import { type DomEditSelection } from "./domEditing";
import { useMarqueeGestures } from "./marqueeCommit";
import { MarqueeOverlay } from "./MarqueeOverlay";
import { groupAwareOverlayRect, resolveDomEditGroupOverlayRect } from "./domEditOverlayGeometry";
import { collectDomEditLayerItems } from "./domEditingLayers";
import { isElementComputedVisible } from "./domEditingElement";
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
import { SnapGuideOverlay, type SnapGuidesState } from "./SnapGuideOverlay";
import { GridOverlay } from "./GridOverlay";
import type { GestureRecordingState } from "./GestureRecordControl";

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
  gridVisible?: boolean;
  gridSpacing?: number;
  recordingState?: GestureRecordingState;
  onToggleRecording?: () => void;
  onMarqueeSelect?: (selections: DomEditSelection[], additive: boolean) => void;
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
  onMarqueeSelect,
}: DomEditOverlayProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const onMarqueeSelectRef = useRef(onMarqueeSelect);
  onMarqueeSelectRef.current = onMarqueeSelect;

  // fallow-ignore-next-line complexity
  const selectionShapeStyles = (() => {
    const fallback = {
      borderRadius: 8 as string | number,
      clipPath: undefined as string | undefined,
    };
    if (!selection?.element) return fallback;
    try {
      const tag = selection.element.tagName.toLowerCase();
      if (tag === "svg" || tag === "img" || tag === "video" || tag === "canvas") return fallback;
      const win = selection.element.ownerDocument.defaultView;
      if (!win) return fallback;
      const cs = win.getComputedStyle(selection.element);
      const br = cs.borderRadius;
      const cp = cs.clipPath;
      return {
        borderRadius: br && br !== "0px" ? br : 4,
        clipPath: cp && cp !== "none" ? cp : undefined,
      };
    } catch {
      return fallback;
    }
  })();
  const gestureRef = useRef<GestureState | null>(null);
  const groupGestureRef = useRef<GroupGestureState | null>(null);
  const blockedMoveRef = useRef<BlockedMoveState | null>(null);
  const suppressNextBoxClickRef = useRef(false);
  const suppressNextBoxMouseDownRef = useRef(false);
  const suppressNextOverlayMouseDownRef = useRef(false);
  const snapGuidesRef = useRef<SnapGuidesState | null>(null);
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

  const [compRect, setCompRect] = useState({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    scaleX: 1,
    scaleY: 1,
  });
  useMountEffect(() => {
    let frame = 0;
    // fallow-ignore-next-line complexity
    const update = () => {
      frame = requestAnimationFrame(update);
      const iframe = iframeRef.current;
      const overlayEl = overlayRef.current;
      if (!iframe || !overlayEl) return;
      const iRect = iframe.getBoundingClientRect();
      const oRect = overlayEl.getBoundingClientRect();
      const left = iRect.left - oRect.left;
      const top = iRect.top - oRect.top;
      if (iRect.width <= 0 || iRect.height <= 0) return;
      const doc = iframe.contentDocument;
      const root = doc?.querySelector<HTMLElement>("[data-composition-id]") ?? doc?.documentElement;
      const dw = Number.parseFloat(root?.getAttribute("data-width") ?? "");
      const dh = Number.parseFloat(root?.getAttribute("data-height") ?? "");
      const scaleX = dw > 0 ? iRect.width / dw : 1;
      const scaleY = dh > 0 ? iRect.height / dh : 1;
      setCompRect((prev) => {
        if (
          Math.abs(prev.left - left) < 0.5 &&
          Math.abs(prev.top - top) < 0.5 &&
          Math.abs(prev.width - iRect.width) < 0.5 &&
          Math.abs(prev.height - iRect.height) < 0.5 &&
          Math.abs(prev.scaleX - scaleX) < 0.001 &&
          Math.abs(prev.scaleY - scaleY) < 0.001
        )
          return prev;
        return { left, top, width: iRect.width, height: iRect.height, scaleX, scaleY };
      });
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  });

  // Off-canvas element indicators — dashed outlines for elements positioned
  // outside the composition bounds so users can find them.
  const offCanvasElementsRef = useRef<Map<string, HTMLElement>>(new Map());
  const [offCanvasRects, setOffCanvasRects] = useState<OffCanvasRect[]>([]);
  // fallow-ignore-next-line complexity
  useEffect(() => {
    const iframe = iframeRef.current;
    const overlay = overlayRef.current;
    if (!iframe || !overlay || compRect.width <= 0) {
      setOffCanvasRects([]);
      return;
    }
    const doc = iframe.contentDocument;
    if (!doc) return;
    const root = doc.querySelector<HTMLElement>("[data-composition-id]") ?? doc.body;
    const acp = activeCompositionPath ?? "index.html";
    const items = collectDomEditLayerItems(root, {
      activeCompositionPath: acp,
      isMasterView: !acp || acp === "index.html",
    });
    const rects: typeof offCanvasRects = [];
    const elMap = new Map<string, HTMLElement>();
    for (const item of items) {
      if (!isElementComputedVisible(item.element)) continue;
      // Groups use their members' union (where they actually render), so a group
      // whose members sit inside the canvas isn't flagged off-canvas by a stale
      // wrapper box.
      const r = groupAwareOverlayRect(overlay, iframe, item.element);
      if (!r) continue;
      // Any edge crossing the composition border → gray-zone indicator (the
      // in-canvas portion is clipped away below, so only the sliver shows).
      const extendsOutsideComp =
        r.left < compRect.left ||
        r.left + r.width > compRect.left + compRect.width ||
        r.top < compRect.top ||
        r.top + r.height > compRect.top + compRect.height;
      if (extendsOutsideComp) {
        rects.push({ key: item.key, left: r.left, top: r.top, width: r.width, height: r.height });
        elMap.set(item.key, item.element);
      }
    }
    offCanvasElementsRef.current = elMap;
    setOffCanvasRects(rects);
    // Positions depend on layout, not selection — the selected-element
    // suppression is a render-time filter, so selection/groupSelections stay
    // out of the deps to avoid re-walking geometry on each selection change.
  }, [iframeRef, compRect, activeCompositionPath]);

  const gestures = createDomEditOverlayGestureHandlers({
    overlayRef,
    iframeRef,
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
    snapGuidesRef,
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
    onCanvasMouseDown(event, { preferClipAncestor: false });
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
      // Cursor follows marquee rect *state* (re-renders), not the mutable ref.
      style={marquee.marqueeRect ? { cursor: "crosshair" } : undefined}
      onPointerDownCapture={(event) =>
        focusDomEditOverlayElement(event.currentTarget as FocusableDomEditOverlay)
      }
      onPointerDown={handleOverlayPointerDown}
      onMouseDown={handleOverlayMouseDown}
      onPointerMove={marquee.onPointerMove}
      onPointerLeave={() => onCanvasPointerLeaveRef.current()}
      onPointerUp={marquee.onPointerUp}
      onPointerCancel={marquee.onPointerCancel}
    >
      {hoverSelection && hoverRect && compRect.width > 0 && (
        <div
          aria-hidden="true"
          data-dom-edit-hover-box="true"
          className="pointer-events-none absolute rounded-md border border-studio-accent/80 bg-studio-accent/5 shadow-[0_0_0_1px_rgba(60,230,172,0.25)]"
          style={{
            left: hoverRect.left,
            top: hoverRect.top,
            width: hoverRect.width,
            height: hoverRect.height,
          }}
        />
      )}
      {hasGroupSelection && groupOverlayItems.length > 1 && groupBounds && compRect.width > 0 && (
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
            className={`pointer-events-auto absolute rounded-md ${selectionShapeStyles.clipPath ? "shadow-[inset_0_0_0_2px_rgba(60,230,172,0.6)]" : "border border-studio-accent/80 shadow-[0_0_0_1px_rgba(60,230,172,0.25)]"} bg-studio-accent/5`}
            style={{
              left: overlayRect.left,
              top: overlayRect.top,
              width: overlayRect.width,
              height: overlayRect.height,
              clipPath: selectionShapeStyles.clipPath,
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
        overlayWidth={compRect.width}
        overlayHeight={compRect.height}
      />
    </div>
  );
});
