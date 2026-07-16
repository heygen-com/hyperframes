import type { RefObject } from "react";
import { type DomEditSelection } from "./domEditing";
import type { GroupOverlayItem, OverlayRect } from "./domEditOverlayGeometry";
import type { BlockedMoveState, ResizeHandle } from "./domEditOverlayGestures";
import type { createDomEditOverlayGestureHandlers } from "./useDomEditOverlayGestures";
import { DomEditCropHandles } from "./DomEditCropHandles";
import { DomEditRotateHandle } from "./DomEditRotateHandle";
import { resolveRotatedResizeCursor } from "./domEditResizeLocal";

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

// Visible dot is 9px; the pointer target is a 16px invisible square centered
// on the corner so click targets don't shrink with the smaller dot.
const RESIZE_HANDLE_HIT_PX = 16;

type CropInset = { top: number; right: number; bottom: number; left: number };
const NO_CROP_INSET: CropInset = { top: 0, right: 0, bottom: 0, left: 0 };

function resizeHandleStyle(
  def: (typeof RESIZE_HANDLE_DEFS)[number],
  overlayRect: { left: number; top: number; width: number; height: number },
  cropInset?: CropInset,
): React.CSSProperties {
  const half = RESIZE_HANDLE_HIT_PX / 2;
  const inset = cropInset ?? NO_CROP_INSET;
  const style: React.CSSProperties = { cursor: def.cursor, touchAction: "none" };
  // Position relative to the overlay container (not the selection box).
  // This ensures the dots render as siblings of the box border div — strictly
  // above it — rather than as children where the parent border can visually
  // overlap the dot circle at the corner.
  style.left =
    def.x === "left"
      ? overlayRect.left + inset.left - half
      : overlayRect.left + overlayRect.width - inset.right - half;
  style.top =
    def.y === "top"
      ? overlayRect.top + inset.top - half
      : overlayRect.top + overlayRect.height - inset.bottom - half;
  return style;
}

type GestureHandlers = ReturnType<typeof createDomEditOverlayGestureHandlers>;

interface DomEditGroupChromeProps {
  groupOverlayItems: GroupOverlayItem[];
  groupBounds: OverlayRect;
  allowCanvasMovement: boolean;
  groupCanMove: boolean;
  gestures: GestureHandlers;
  onBoxMouseDown: (e: React.MouseEvent) => void;
  onBoxClick: (event: React.MouseEvent<HTMLDivElement>) => void;
}

// Multi-selection chrome: per-member outlines plus a single draggable bounding
// box spanning the union of the members.
export function DomEditGroupChrome({
  groupOverlayItems,
  groupBounds,
  allowCanvasMovement,
  groupCanMove,
  gestures,
  onBoxMouseDown,
  onBoxClick,
}: DomEditGroupChromeProps) {
  return (
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
        onMouseDown={onBoxMouseDown}
        onClick={onBoxClick}
      />
    </>
  );
}

interface DomEditSelectionChromeProps {
  selection: DomEditSelection;
  overlayRect: OverlayRect;
  allowCanvasMovement: boolean;
  cropOutlineInsetPx?: { top: number; right: number; bottom: number; left: number };
  boxRef: RefObject<HTMLDivElement | null>;
  boxChromeClass: string;
  boxClipPath: string | undefined;
  selectionKey: string;
  groupSelectionCount: number;
  blockedMoveRef: RefObject<BlockedMoveState | null>;
  gestures: GestureHandlers;
  onStyleCommit?: (property: string, value: string) => Promise<void> | void;
  onBoxMouseDown: (e: React.MouseEvent) => void;
  onBoxClick: (event: React.MouseEvent<HTMLDivElement>) => void;
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
  cropOutlineInsetPx,
  boxRef,
  boxChromeClass,
  boxClipPath,
  selectionKey,
  groupSelectionCount,
  blockedMoveRef,
  gestures,
  onStyleCommit,
  onBoxMouseDown,
  onBoxClick,
}: DomEditSelectionChromeProps) {
  return (
    <>
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          transformOrigin: `${overlayRect.left + overlayRect.width / 2}px ${overlayRect.top + overlayRect.height / 2}px`,
          transform: overlayRect.angle ? `rotate(${overlayRect.angle}deg)` : undefined,
        }}
      >
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
          onMouseDown={onBoxMouseDown}
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
                className="pointer-events-auto absolute flex h-4 w-4 items-center justify-center"
                style={{
                  ...resizeHandleStyle(def, overlayRect, cropOutlineInsetPx ?? undefined),
                  // Cursor rotates with the object: bucket the corner's base
                  // diagonal + element rotation into the 8 CSS resize cursors.
                  cursor: resolveRotatedResizeCursor(def.handle, overlayRect.angle ?? 0),
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  gestures.startGesture("resize", e, { resizeHandle: def.handle });
                }}
              >
                <div className="pointer-events-none h-[12px] w-[12px] rounded-full border-[1.5px] border-studio-accent bg-white shadow-[0_0_3px_rgba(0,0,0,0.45)]" />
              </div>
            ),
          )}
      </div>
      {/* Crop owns its element-local oriented frame. Keep it outside the chrome's
          rotated plane or a rotated selection applies the angle twice. */}
      {selection.capabilities.canCrop && groupSelectionCount <= 1 && (
        <DomEditCropHandles
          selection={selection}
          overlayRect={overlayRect}
          onStyleCommit={onStyleCommit}
        />
      )}
    </>
  );
}
