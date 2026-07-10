import type { RefObject } from "react";
import type { DomEditSelection } from "./domEditing";
import type {
  StudioBoxSizeSnapshot,
  StudioPathOffsetSnapshot,
  StudioRotationSnapshot,
} from "./manualEdits";
import type { ManualOffsetDragMember } from "./manualOffsetDrag";
import type { GroupOverlayItem, OverlayRect } from "./domEditOverlayGeometry";
import type { SnapContext } from "./snapTargetCollection";
import type { SnapGuidesState } from "./SnapGuideOverlay";
import type { PreviewMouseDownOptions } from "../../hooks/usePreviewInteraction";

export type GestureKind = "drag" | "resize" | "rotate";

/** Which corner handle initiated a resize gesture. */
export type ResizeHandle = "nw" | "ne" | "sw" | "se";

export const BLOCKED_MOVE_THRESHOLD_PX = 4;
const ROTATION_COMMIT_EPSILON_DEGREES = 0.05;
const ROTATION_SNAP_DEGREES = 15;
/**
 * Above this rotation, resize/move edge-snapping is bypassed. Industry editors
 * (tldraw/Figma) don't edge-snap rotated boxes — the snap targets are axis-aligned
 * AABBs, so snapping a rotated box's AABB to them shifts the box in a way the user
 * can't predict; a wrong snap is worse than none. Rotation ~0 keeps snapping exactly
 * as before.
 */
export const ROTATED_SNAP_BYPASS_DEGREES = 0.5;

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
  /** Corner the resize gesture grabbed (resize gestures only). */
  resizeHandle?: ResizeHandle;
  /** Last anchoring translation applied during a corner resize (overlay px). */
  lastResizeAnchor?: { dx: number; dy: number };
  /**
   * The FIXED corner's overlay position at gesture start (the corner opposite the
   * grabbed handle, in the element's real — possibly rotated — geometry). A corner
   * resize keeps this point pinned; the per-frame anchor translation is computed as
   * the shift of this exact corner, not an AABB width/height delta (which only holds
   * the corner still when the element is unrotated). Undefined for SE (no anchor)
   * and when the corner geometry can't be measured.
   */
  resizeFixedCornerStart?: { x: number; y: number };
}

/** The element corner a handle keeps FIXED: opposite the grabbed corner. */
export function anchorCornerForHandle(handle: ResizeHandle): "nw" | "ne" | "sw" | "se" {
  switch (handle) {
    case "nw":
      return "se";
    case "ne":
      return "sw";
    case "sw":
      return "ne";
    case "se":
      return "nw";
  }
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

/**
 * Overlay-px translation that keeps the opposite corner fixed while a west or
 * north handle resizes: the element's visual origin shifts by exactly the size
 * change on the anchored axis. This is the UNROTATED (AABB) fallback used only
 * when the element's real transformed corners can't be measured — the primary
 * anchor path pins the measured corner (rotation-safe) in useDomEditOverlayGestures.
 * Which axes translate is derived from the handle here (was resolveResizeHandleDeltas).
 */
export function resolveResizeAnchorOffset(input: {
  originWidth: number;
  originHeight: number;
  overlayWidth: number;
  overlayHeight: number;
  handle: ResizeHandle;
}): { dx: number; dy: number } {
  // West/north handles anchor the opposite (east/south) edge, so the element's
  // top-left must shift by the size change on that axis to hold it fixed.
  const anchorX = input.handle === "nw" || input.handle === "sw";
  const anchorY = input.handle === "nw" || input.handle === "ne";
  return {
    dx: anchorX ? input.originWidth - input.overlayWidth : 0,
    dy: anchorY ? input.originHeight - input.overlayHeight : 0,
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

// ── Shared types for DomEditOverlay gesture wiring ──
// These live here (rather than in DomEditOverlay.tsx or useDomEditOverlayGestures.ts)
// to break circular imports between those files.

export interface DomEditGroupPathOffsetCommit {
  selection: DomEditSelection;
  next: { x: number; y: number };
}

// Refs are stable across renders; values are read via .current.
export type UseDomEditOverlayGesturesOptions = {
  overlayRef: RefObject<HTMLDivElement | null>;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  boxRef: RefObject<HTMLDivElement | null>;
  selectionRef: RefObject<DomEditSelection | null>;
  hoverSelectionRef: RefObject<DomEditSelection | null>;
  overlayRectRef: RefObject<OverlayRect | null>;
  groupOverlayItemsRef: RefObject<GroupOverlayItem[]>;
  gestureRef: RefObject<GestureState | null>;
  groupGestureRef: RefObject<GroupGestureState | null>;
  blockedMoveRef: RefObject<BlockedMoveState | null>;
  rafPausedRef: RefObject<boolean>;
  suppressNextBoxClickRef: RefObject<boolean>;
  setOverlayRect: (next: OverlayRect | null) => void;
  setGroupOverlayItems: (next: GroupOverlayItem[]) => void;
  onBlockedMoveRef: RefObject<(selection: DomEditSelection) => void>;
  onManualDragStartRef: RefObject<(() => void) | undefined>;
  onPathOffsetCommitRef: RefObject<
    (
      s: DomEditSelection,
      n: { x: number; y: number },
      m?: { altKey?: boolean },
    ) => Promise<void> | void
  >;
  onGroupPathOffsetCommitRef: RefObject<
    (updates: DomEditGroupPathOffsetCommit[]) => Promise<void> | void
  >;
  onBoxSizeCommitRef: RefObject<
    (
      s: DomEditSelection,
      n: { width: number; height: number },
      offset?: { x: number; y: number },
    ) => Promise<void> | void
  >;
  onRotationCommitRef: RefObject<
    (s: DomEditSelection, n: { angle: number }) => Promise<void> | void
  >;
  onCanvasPointerMoveRef: RefObject<
    (
      e: React.PointerEvent<HTMLDivElement>,
      o?: { preferClipAncestor?: boolean },
    ) => Promise<DomEditSelection | null>
  >;
  onCanvasMouseDown: (e: React.MouseEvent<HTMLDivElement>, o?: PreviewMouseDownOptions) => void;
  snapGuidesRef: RefObject<SnapGuidesState | null>;
};
