import type { DomEditSelection } from "./domEditing";
import type {
  StudioBoxSizeSnapshot,
  StudioPathOffsetSnapshot,
  StudioRotationSnapshot,
} from "./manualEdits";
import type { ManualOffsetDragMember } from "./manualOffsetDrag";
import type { GroupOverlayItem } from "./domEditOverlayGeometry";
import type { SnapContext } from "./snapTargetCollection";

export type GestureKind = "drag" | "resize" | "rotate";

export const BLOCKED_MOVE_THRESHOLD_PX = 4;
const MIN_RESIZE_EDGE_PX = 20;
const ROTATION_COMMIT_EPSILON_DEGREES = 0.05;
const ROTATION_SNAP_DEGREES = 15;

export interface GestureState {
  kind: GestureKind;
  mode: "path-offset" | "box-size" | "rotation";
  selection: DomEditSelection;
  startX: number;
  startY: number;
  centerX: number;
  centerY: number;
  initialPathOffset: StudioPathOffsetSnapshot;
  initialRotation: StudioRotationSnapshot;
  initialBoxSize: StudioBoxSizeSnapshot;
  pathOffsetMember?: ManualOffsetDragMember;
  originLeft: number;
  originTop: number;
  originWidth: number;
  originHeight: number;
  actualWidth: number;
  actualHeight: number;
  actualRotation: number;
  editScaleX: number;
  editScaleY: number;
  manualEditDragToken?: string;
  snapContext?: SnapContext;
  lastSnappedDx?: number;
  lastSnappedDy?: number;
}

export interface GroupGestureState {
  startX: number;
  startY: number;
  originItems: GroupOverlayItem[];
  members: ManualOffsetDragMember[];
  snapContext?: SnapContext;
  lastSnappedDx?: number;
  lastSnappedDy?: number;
}

export interface BlockedMoveState {
  pointerId: number;
  startX: number;
  startY: number;
  notified: boolean;
}

export type FocusableDomEditOverlay = {
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

export function hasDomEditRotationChanged(initialAngle: number, nextAngle: number): boolean {
  return Math.abs(nextAngle - initialAngle) >= ROTATION_COMMIT_EPSILON_DEGREES;
}
