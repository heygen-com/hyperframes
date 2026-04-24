import { memo, useMemo, useRef, useState, type RefObject } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";
import { ClipboardList, Move, Palette } from "../../icons/SystemIcons";
import { Button } from "../ui";
import { type DomEditSelection, findElementForSelection } from "./domEditing";

type FocusedSection = "position" | "styles";

interface OverlayRect {
  left: number;
  top: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
}

interface DomEditOverlayProps {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  selection: DomEditSelection | null;
  copiedAgentPrompt: boolean;
  onCanvasMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
  onCanvasDoubleClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  onSelectedDoubleClick: () => void;
  onFocusSection: (section: FocusedSection) => void;
  onAskAgent: () => void;
  onMoveCommit: (
    selection: DomEditSelection,
    next: { left: number; top: number },
  ) => Promise<void> | void;
  onResizeCommit: (
    selection: DomEditSelection,
    next: { width: number; height: number },
  ) => Promise<void> | void;
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
  const scaleX = iframeRect.width / rootWidth;
  const scaleY = iframeRect.height / rootHeight;

  return {
    left: iframeRect.left - overlayRect.left + elementRect.left * scaleX,
    top: iframeRect.top - overlayRect.top + elementRect.top * scaleY,
    width: elementRect.width * scaleX,
    height: elementRect.height * scaleY,
    scaleX,
    scaleY,
  };
}

type GestureKind = "drag" | "resize";

interface GestureState {
  kind: GestureKind;
  startX: number;
  startY: number;
  originLeft: number;
  originTop: number;
  originWidth: number;
  originHeight: number;
  actualLeft: number;
  actualTop: number;
  actualWidth: number;
  actualHeight: number;
  scaleX: number;
  scaleY: number;
}

export const DomEditOverlay = memo(function DomEditOverlay({
  iframeRef,
  selection,
  copiedAgentPrompt,
  onCanvasMouseDown,
  onCanvasDoubleClick,
  onSelectedDoubleClick,
  onFocusSection,
  onAskAgent,
  onMoveCommit,
  onResizeCommit,
}: DomEditOverlayProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [overlayRect, setOverlayRect] = useState<OverlayRect | null>(null);
  const gestureRef = useRef<GestureState | null>(null);
  const rafPausedRef = useRef(false);

  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const overlayRectRef = useRef(overlayRect);
  overlayRectRef.current = overlayRect;
  const onMoveCommitRef = useRef(onMoveCommit);
  onMoveCommitRef.current = onMoveCommit;
  const onResizeCommitRef = useRef(onResizeCommit);
  onResizeCommitRef.current = onResizeCommit;

  useMountEffect(() => {
    let frame = 0;
    const update = () => {
      frame = requestAnimationFrame(update);
      if (rafPausedRef.current) return;

      const sel = selectionRef.current;
      const iframe = iframeRef.current;
      const overlayEl = overlayRef.current;
      if (!sel || !iframe || !overlayEl) {
        setOverlayRect(null);
        return;
      }

      const doc = iframe.contentDocument;
      if (!doc) return;

      const el = findElementForSelection(doc, sel, sel.sourceFile);
      if (!el) {
        setOverlayRect(null);
        return;
      }

      const next = toOverlayRect(overlayEl, iframe, el);
      if (next) setOverlayRect(next);
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

  const positionToolbar = (boxLeft: number, boxTop: number) => {
    const tb = toolbarRef.current;
    if (!tb) return;
    tb.style.left = `${boxLeft}px`;
    tb.style.top = `${Math.max(12, boxTop - 46)}px`;
  };

  const startGesture = (kind: GestureKind, e: React.PointerEvent) => {
    const sel = selectionRef.current;
    const rect = overlayRectRef.current;
    const box = boxRef.current;
    if (!sel || !rect || !box) return;

    const left = Number.parseFloat(sel.computedStyles.left ?? "");
    const top = Number.parseFloat(sel.computedStyles.top ?? "");
    const width = Number.parseFloat(sel.computedStyles.width ?? "");
    const height = Number.parseFloat(sel.computedStyles.height ?? "");
    if (!Number.isFinite(left) || !Number.isFinite(top)) return;
    if (kind === "resize" && !Number.isFinite(width) && !Number.isFinite(height)) return;

    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    rafPausedRef.current = true;

    gestureRef.current = {
      kind,
      startX: e.clientX,
      startY: e.clientY,
      originLeft: rect.left,
      originTop: rect.top,
      originWidth: rect.width,
      originHeight: rect.height,
      actualLeft: left,
      actualTop: top,
      actualWidth: Number.isFinite(width) ? width : 0,
      actualHeight: Number.isFinite(height) ? height : 0,
      scaleX: rect.scaleX,
      scaleY: rect.scaleY,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gestureRef.current;
    const sel = selectionRef.current;
    const box = boxRef.current;
    if (!g || !sel || !box) return;

    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;

    if (g.kind === "drag") {
      const nextBoxLeft = g.originLeft + dx;
      const nextBoxTop = g.originTop + dy;
      box.style.left = `${nextBoxLeft}px`;
      box.style.top = `${nextBoxTop}px`;
      positionToolbar(nextBoxLeft, nextBoxTop);
      sel.element.style.left = `${Math.round(g.actualLeft + dx / g.scaleX)}px`;
      sel.element.style.top = `${Math.round(g.actualTop + dy / g.scaleY)}px`;
    } else {
      const newW = Math.max(20, g.originWidth + dx);
      const newH = Math.max(20, g.originHeight + dy);
      box.style.width = `${newW}px`;
      box.style.height = `${newH}px`;
      sel.element.style.width = `${Math.round(g.actualWidth + dx / g.scaleX)}px`;
      sel.element.style.height = `${Math.round(g.actualHeight + dy / g.scaleY)}px`;
    }
  };

  const onPointerUp = () => {
    const g = gestureRef.current;
    const sel = selectionRef.current;
    if (!g || !sel) {
      gestureRef.current = null;
      rafPausedRef.current = false;
      return;
    }

    gestureRef.current = null;
    rafPausedRef.current = false;

    if (g.kind === "drag") {
      const finalLeft = Number.parseFloat(sel.element.style.left) || g.actualLeft;
      const finalTop = Number.parseFloat(sel.element.style.top) || g.actualTop;
      void Promise.resolve(onMoveCommitRef.current(sel, { left: finalLeft, top: finalTop })).catch(
        () => {
          sel.element.style.left = `${Math.round(g.actualLeft)}px`;
          sel.element.style.top = `${Math.round(g.actualTop)}px`;
        },
      );
    } else {
      const finalW = Number.parseFloat(sel.element.style.width) || g.actualWidth;
      const finalH = Number.parseFloat(sel.element.style.height) || g.actualHeight;
      void Promise.resolve(onResizeCommitRef.current(sel, { width: finalW, height: finalH })).catch(
        () => {
          if (g.actualWidth > 0) sel.element.style.width = `${Math.round(g.actualWidth)}px`;
          else sel.element.style.removeProperty("width");
          if (g.actualHeight > 0) sel.element.style.height = `${Math.round(g.actualHeight)}px`;
          else sel.element.style.removeProperty("height");
        },
      );
    }
  };

  const toolbarStyle = useMemo(() => {
    if (!overlayRect) return undefined;
    return {
      left: overlayRect.left,
      top: Math.max(12, overlayRect.top - 46),
    };
  }, [overlayRect]);

  // Click on overlay background → select whatever is under the pointer in the iframe.
  // This handles clicking children inside an already-selected parent: the selection
  // box stops propagation for drag gestures, but clicks on the transparent overlay
  // area outside the box pass through to the iframe pick logic.
  const handleOverlayMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-dom-edit-toolbar="true"]')) return;
    if (target?.closest('[data-dom-edit-selection-box="true"]')) return;
    onCanvasMouseDown(event);
  };

  const handleOverlayDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-dom-edit-toolbar="true"]')) return;
    onCanvasDoubleClick(event);
  };

  // Click on the selection box itself → re-pick the element under the pointer.
  // This lets you click a child element even when a parent is selected, because
  // the click coordinates are forwarded to the iframe's element picker.
  const handleBoxClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (gestureRef.current) return;
    onCanvasMouseDown(event);
  };

  return (
    <div
      key={selectionKey}
      ref={overlayRef}
      className="absolute inset-0 z-10 pointer-events-auto"
      onMouseDown={handleOverlayMouseDown}
      onDoubleClick={handleOverlayDoubleClick}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {selection && overlayRect && (
        <>
          {/* Selection box — draggable area */}
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
              cursor: selection.capabilities.canMove ? "move" : "default",
            }}
            onPointerDown={(e) => {
              if (selection.capabilities.canMove) startGesture("drag", e);
              else e.stopPropagation();
            }}
            onClick={handleBoxClick}
            onDoubleClick={onSelectedDoubleClick}
          >
            {/* Resize handle — bottom-right corner */}
            {selection.capabilities.canResize && (
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

          {/* Toolbar — follows the box during drag via imperative style updates */}
          <div
            ref={toolbarRef}
            data-dom-edit-toolbar="true"
            className="pointer-events-auto absolute flex items-center gap-1 rounded-xl border border-neutral-800 bg-neutral-950/96 px-2 py-2 shadow-lg backdrop-blur"
            style={toolbarStyle}
          >
            <Button
              variant="ghost"
              size="sm"
              icon={<Move size={12} />}
              disabled={!selection.capabilities.canMove}
              onClick={() => onFocusSection("position")}
            >
              Move
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<Palette size={12} />}
              disabled={!selection.capabilities.canEditStyles}
              onClick={() => onFocusSection("styles")}
            >
              Styles
            </Button>
            <Button
              variant={copiedAgentPrompt ? "primary" : "secondary"}
              size="sm"
              icon={<ClipboardList size={12} />}
              onClick={onAskAgent}
            >
              {copiedAgentPrompt ? "Copied" : "Ask agent"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
});
