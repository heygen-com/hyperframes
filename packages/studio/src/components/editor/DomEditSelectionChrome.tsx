import type { RefObject } from "react";
import { type DomEditSelection } from "./domEditing";
import { type GroupOverlayItem, type OverlayRect } from "./domEditOverlayGeometry";
import { resizeHandleLayout, type CropInset } from "./resizeHandleLayout";
import type { ResizeHandle } from "./domEditOverlayGestures";
import type { createDomEditOverlayGestureHandlers } from "./useDomEditOverlayGestures";
import { DomEditCropHandles } from "./DomEditCropHandles";
import { DomEditRotateHandle } from "./DomEditRotateHandle";
import { resolveRotatedResizeCursor } from "./domEditResizeLocal";
import { usePreviewReadOnly } from "./previewReadOnlyContext";

// Corner resize handles, Canva-style: one per corner, diagonal cursors.
// Corners scale about the element center; the translate keeps the center
// planted, so they need the manual-offset capability in addition to manual-size.
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

type GestureHandlers = ReturnType<typeof createDomEditOverlayGestureHandlers>;

interface DomEditGroupChromeProps {
  groupOverlayItems: GroupOverlayItem[];
  groupBounds: OverlayRect;
  allowCanvasMovement: boolean;
  allowBodyDrag: boolean;
  groupCanMove: boolean;
  gestures: GestureHandlers;
  onBoxClick: (event: React.MouseEvent<HTMLDivElement>) => void;
}

// Multi-selection chrome: per-member outlines plus a single draggable bounding
// box spanning the union of the members.
export function DomEditGroupChrome({
  groupOverlayItems,
  groupBounds,
  allowCanvasMovement,
  allowBodyDrag,
  groupCanMove,
  gestures,
  onBoxClick,
}: DomEditGroupChromeProps) {
  const canManipulate = allowCanvasMovement && !usePreviewReadOnly();
  return (
    <>
      {groupOverlayItems.map((item) => (
        <div
          key={item.key}
          data-dom-edit-group-member={item.key}
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
        data-dom-edit-group-box="true"
        className="pointer-events-auto absolute rounded-xl border border-studio-accent shadow-[0_0_0_1px_rgba(60,230,172,0.3)]"
        style={{
          left: groupBounds.left,
          top: groupBounds.top,
          width: groupBounds.width,
          height: groupBounds.height,
          cursor: !allowBodyDrag ? undefined : canManipulate && groupCanMove ? "move" : "default",
        }}
        onPointerDown={(e) => {
          if (!canManipulate || !allowBodyDrag || (e.shiftKey && !groupCanMove)) return;
          gestures.startGroupDrag(e);
        }}
        onClick={onBoxClick}
      />
    </>
  );
}

/** The corners a box can be resized from: all four when it can also move, else only the one that keeps it put. */
function resizeCorners(selection: DomEditSelection, canManipulate: boolean, editing: boolean) {
  if (!canManipulate || editing || !selection.capabilities.canApplyManualSize) return [];
  return RESIZE_HANDLE_DEFS.filter(
    (def) => def.handle === "se" || selection.capabilities.canApplyManualOffset,
  );
}

/** Resize-handle dots sit beside the selection box, not in it, so they paint above its border and its clip path
 *  cannot cut them. Their wrapper is placed like the box. */
function DomEditResizeHandles({
  handlesRef,
  overlayRect,
  cropInset,
  corners,
  showRotate,
  gestures,
}: {
  handlesRef: RefObject<HTMLDivElement | null>;
  overlayRect: OverlayRect;
  cropInset?: CropInset;
  corners: (typeof RESIZE_HANDLE_DEFS)[number][];
  showRotate: boolean;
  gestures: GestureHandlers;
}) {
  return (
    <div
      ref={handlesRef}
      data-dom-edit-selection-handles="true"
      className="pointer-events-none absolute"
      style={{
        left: overlayRect.left,
        top: overlayRect.top,
        width: overlayRect.width,
        height: overlayRect.height,
      }}
    >
      {showRotate && (
        <DomEditRotateHandle
          cropOutlineInsetPx={cropInset}
          onStartRotate={(e) => {
            e.stopPropagation();
            gestures.startGesture("rotate", e);
          }}
        />
      )}
      {corners.map((def) => {
        const layout = resizeHandleLayout(def, overlayRect, cropInset);
        return (
          <div
            key={def.handle}
            className="pointer-events-auto absolute flex h-4 w-4 items-center justify-center"
            style={{
              ...layout.style,
              // Cursor rotates with the object: bucket the corner's base
              // diagonal + element rotation into the 8 CSS resize cursors.
              cursor: resolveRotatedResizeCursor(def.handle, overlayRect.angle ?? 0),
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              const corner = e.currentTarget
                .querySelector("[data-resize-corner]")
                ?.getBoundingClientRect();
              gestures.startGesture("resize", e, {
                resizeHandle: def.handle,
                resizeCorner: corner && { x: corner.left, y: corner.top },
              });
            }}
          >
            <span
              data-resize-corner
              className="pointer-events-none absolute"
              style={layout.anchor}
            />
            <div className="pointer-events-none h-[12px] w-[12px] rounded-full border-[1.5px] border-studio-accent bg-white shadow-[0_0_3px_rgba(0,0,0,0.45)]" />
          </div>
        );
      })}
    </div>
  );
}

interface DomEditSelectionChromeProps {
  selection: DomEditSelection;
  overlayRect: OverlayRect;
  allowCanvasMovement: boolean;
  allowBodyDrag: boolean;
  cropOutlineInsetPx?: { top: number; right: number; bottom: number; left: number };
  boxRef: RefObject<HTMLDivElement | null>;
  handlesRef: RefObject<HTMLDivElement | null>;
  boxChromeClass: string;
  boxClipPath: string | undefined;
  selectionKey: string;
  groupSelectionCount: number;
  gestures: GestureHandlers;
  onStyleCommit?: (property: string, value: string) => Promise<unknown> | void;
  onBoxClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  /** The canvas' text-editing session: what opens one, and whether one is open. */
  inlineText?: {
    editing: boolean;
    /** Every press on the box. Returns true when it opened a text edit. */
    startFromPress: (event: React.PointerEvent) => boolean;
  };
}

// Oriented selection chrome: a rotation wrapper spanning the overlay, rotated by
// the element's live angle about the selection box CENTER. Its children (border
// box, corner dots, and rotate handle) keep their existing
// overlay-absolute positions — rotating the whole plane about the box center
// lands them on the element's real transformed corners for free. At angle 0 the
// transform is a no-op, so the chrome is pixel-identical.
export function DomEditSelectionChrome({
  selection,
  overlayRect,
  allowCanvasMovement,
  allowBodyDrag,
  cropOutlineInsetPx,
  boxRef,
  handlesRef,
  boxChromeClass,
  boxClipPath,
  selectionKey,
  groupSelectionCount,
  gestures,
  onStyleCommit,
  onBoxClick,
  inlineText,
}: DomEditSelectionChromeProps) {
  // While the text is being edited the chrome is a mark, not a control. The
  // overlay above the preview already stands aside for the caret, but
  // `pointer-events: none` on a parent does not disable a child that asks for
  // them back, and the box is positioned to cover exactly the text being typed
  // into: left interactive, it swallows every press, so the caret can never be
  // moved and characters can never be selected by dragging.
  const editing = inlineText?.editing ?? false;
  const readOnly = usePreviewReadOnly();
  const canManipulate = allowCanvasMovement && !readOnly;

  return (
    <>
      <div
        data-dom-edit-chrome="true"
        className="pointer-events-none absolute inset-0"
        style={{
          transformOrigin: `${overlayRect.left + overlayRect.width / 2}px ${overlayRect.top + overlayRect.height / 2}px`,
          transform: overlayRect.angle ? `rotate(${overlayRect.angle}deg)` : undefined,
        }}
      >
        <div
          key={selectionKey}
          ref={boxRef}
          data-dom-edit-selection-box="true"
          className={`${editing ? "pointer-events-none" : "pointer-events-auto"} absolute rounded-md ${boxChromeClass}`}
          style={{
            left: overlayRect.left,
            top: overlayRect.top,
            width: overlayRect.width,
            height: overlayRect.height,
            clipPath: boxClipPath,
            cursor: !allowBodyDrag
              ? undefined
              : canManipulate && selection.capabilities.canApplyManualOffset
                ? "move"
                : "default",
          }}
          onPointerDown={(e) => {
            // A second press opens the element's text for editing, and must be
            // caught here rather than on the canvas: this handler prevents the
            // default on the first press, which suppresses the compatibility
            // mousedown the canvas would otherwise see, and the pointer capture
            // it takes stops the browser pairing the presses into a dblclick.
            if (inlineText?.startFromPress(e)) {
              e.preventDefault();
              e.stopPropagation();
              return;
            }
            if (!allowBodyDrag || !canManipulate) return;
            if (selection.capabilities.canApplyManualOffset) {
              gestures.startGesture("drag", e);
              return;
            }
            if (!e.shiftKey) gestures.startBlockedMove(e, selection);
          }}
          onClick={onBoxClick}
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
        <DomEditResizeHandles
          handlesRef={handlesRef}
          overlayRect={overlayRect}
          cropInset={cropOutlineInsetPx}
          corners={resizeCorners(selection, canManipulate, editing)}
          showRotate={canManipulate && !editing && selection.capabilities.canApplyManualRotation}
          gestures={gestures}
        />
      </div>
      {/* Crop owns its element-local oriented frame. Keep it outside the chrome's
          rotated plane or a rotated selection applies the angle twice. */}
      {selection.capabilities.canCrop && !editing && !readOnly && groupSelectionCount <= 1 && (
        <DomEditCropHandles
          selection={selection}
          overlayRect={overlayRect}
          onStyleCommit={onStyleCommit}
        />
      )}
    </>
  );
}
