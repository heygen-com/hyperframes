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
  // Rendered-per-CSS-pixel factor of the element itself at gesture start (a GSAP
  // scale() transform makes this > 1) — the resize draft divides by it so the box
  // follows the cursor instead of overshooting by the live scale.
  contentScaleX: number;
  contentScaleY: number;
  // Resize anchor pinning: with a live scale transform, growing the CSS box
  // shifts the rendered box (scaling happens around the element center), so the
  // un-dragged corner creeps during the draft. The move handler measures the
  // gesture-start top-left drift each frame and counters it through the GSAP
  // position channel; the pin accumulates so the correction converges.
  // Present only on resize gestures.
  resizeAnchor?: {
    anchorX: number;
    anchorY: number;
    baseGsapX: number;
    baseGsapY: number;
    pinX: number;
    pinY: number;
  };
  manualEditDragToken?: string;
  snapContext?: SnapContext;
  lastSnappedDx?: number;
  lastSnappedDy?: number;
  /** Corner the resize gesture grabbed (resize gestures only). */
  resizeHandle?: ResizeHandle;
  /** Last anchoring translation applied during a corner resize (overlay px). */
  lastResizeAnchor?: { dx: number; dy: number };
  /**
   * The element's rendered CENTER in overlay px at gesture start (the centroid of
   * its four real — possibly rotated — corners). A center-anchored resize keeps this
   * point pinned; the per-frame anchor translation is computed as the shift of this
   * exact center, not an AABB width/height delta (which only holds the center still
   * when the element grows symmetrically from an unrotated layout box). Undefined
   * when the corner geometry can't be measured (member creation still succeeded).
   */
  resizeFixedCenterStart?: { x: number; y: number };
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
 * Overlay-px translation that keeps the element's CENTER fixed while a corner
 * resizes: a CSS width/height change grows the layout box from its top-left, so
 * the center drifts by half the size change on each axis; translating back by that
 * half-delta re-pins the center. This is the UNROTATED (AABB) fallback used only
 * when the element's real transformed corners can't be measured — the primary path
 * pins the measured center (rotation-safe) in useDomEditOverlayGestures.
 */
export function resolveResizeCenterAnchorOffset(input: {
  originWidth: number;
  originHeight: number;
  overlayWidth: number;
  overlayHeight: number;
}): { dx: number; dy: number } {
  return {
    dx: (input.originWidth - input.overlayWidth) / 2,
    dy: (input.originHeight - input.overlayHeight) / 2,
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
      restore?: () => void,
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
