import { memo, useMemo, useRef, useState, type RefObject } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";
import { type DomEditSelection, findElementForSelection } from "./domEditing";
import {
  applyManualOffsetDragCommit,
  applyManualOffsetDragDraft,
  createManualOffsetDragMember,
  endManualOffsetDragMembers,
  restoreManualOffsetDragMembers,
  type ManualOffsetDragMember,
} from "./manualOffsetDrag";
import {
  applyStudioBoxSize,
  applyStudioBoxSizeDraft,
  applyStudioRotation,
  applyStudioRotationDraft,
  beginStudioManualEditGesture,
  captureStudioBoxSize,
  captureStudioPathOffset,
  captureStudioRotation,
  endStudioManualEditGesture,
  isStudioManualEditGestureCurrent,
  readStudioBoxSize,
  readStudioRotation,
  restoreStudioBoxSize,
  restoreStudioPathOffset,
  restoreStudioRotation,
  type StudioBoxSizeSnapshot,
  type StudioPathOffsetSnapshot,
  type StudioRotationSnapshot,
} from "./manualEdits";

interface OverlayRect {
  left: number;
  top: number;
  width: number;
  height: number;
  editScaleX: number;
  editScaleY: number;
}

interface GroupOverlayItem {
  key: string;
  selection: DomEditSelection;
  element: HTMLElement;
  rect: OverlayRect;
}

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
  const rootScaleX = iframeRect.width / rootWidth;
  const rootScaleY = iframeRect.height / rootHeight;
  const sourceBoundary = findSourceBoundary(element);
  const sourceBoundaryRect = sourceBoundary?.getBoundingClientRect();
  const editScale = resolveDomEditCoordinateScale({
    rootScaleX,
    rootScaleY,
    sourceRectWidth: sourceBoundaryRect?.width,
    sourceRectHeight: sourceBoundaryRect?.height,
    sourceWidth: readPositiveDimension(sourceBoundary?.getAttribute("data-width") ?? null),
    sourceHeight: readPositiveDimension(sourceBoundary?.getAttribute("data-height") ?? null),
  });

  return {
    left: iframeRect.left - overlayRect.left + (elementRect.left - rootRect.left) * rootScaleX,
    top: iframeRect.top - overlayRect.top + (elementRect.top - rootRect.top) * rootScaleY,
    width: elementRect.width * rootScaleX,
    height: elementRect.height * rootScaleY,
    editScaleX: editScale.scaleX,
    editScaleY: editScale.scaleY,
  };
}

function readPositiveDimension(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function findSourceBoundary(element: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = element;
  while (current) {
    if (
      current.hasAttribute("data-composition-file") ||
      current.hasAttribute("data-composition-src")
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

export function resolveDomEditCoordinateScale(input: {
  rootScaleX: number;
  rootScaleY: number;
  sourceRectWidth?: number;
  sourceRectHeight?: number;
  sourceWidth?: number | null;
  sourceHeight?: number | null;
}): { scaleX: number; scaleY: number } {
  const rootScaleX = input.rootScaleX > 0 ? input.rootScaleX : 1;
  const rootScaleY = input.rootScaleY > 0 ? input.rootScaleY : 1;
  const sourceScaleX =
    input.sourceRectWidth && input.sourceRectWidth > 0 && input.sourceWidth && input.sourceWidth > 0
      ? (input.sourceRectWidth * rootScaleX) / input.sourceWidth
      : rootScaleX;
  const sourceScaleY =
    input.sourceRectHeight &&
    input.sourceRectHeight > 0 &&
    input.sourceHeight &&
    input.sourceHeight > 0
      ? (input.sourceRectHeight * rootScaleY) / input.sourceHeight
      : rootScaleY;
  return {
    scaleX: sourceScaleX > 0 ? sourceScaleX : rootScaleX,
    scaleY: sourceScaleY > 0 ? sourceScaleY : rootScaleY,
  };
}

type GestureKind = "drag" | "resize" | "rotate";
const BLOCKED_MOVE_THRESHOLD_PX = 4;
const MIN_RESIZE_EDGE_PX = 20;
const OVERLAY_RECT_EPSILON_PX = 0.5;
const ROTATION_COMMIT_EPSILON_DEGREES = 0.05;
const ROTATION_SNAP_DEGREES = 15;

function rectsEqual(a: OverlayRect | null, b: OverlayRect | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    Math.abs(a.left - b.left) < OVERLAY_RECT_EPSILON_PX &&
    Math.abs(a.top - b.top) < OVERLAY_RECT_EPSILON_PX &&
    Math.abs(a.width - b.width) < OVERLAY_RECT_EPSILON_PX &&
    Math.abs(a.height - b.height) < OVERLAY_RECT_EPSILON_PX &&
    Math.abs(a.editScaleX - b.editScaleX) < 0.001 &&
    Math.abs(a.editScaleY - b.editScaleY) < 0.001
  );
}

function groupOverlayItemsEqual(a: GroupOverlayItem[], b: GroupOverlayItem[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((item, index) => {
    const other = b[index];
    return Boolean(
      other &&
      item.key === other.key &&
      item.element === other.element &&
      item.selection === other.selection &&
      rectsEqual(item.rect, other.rect),
    );
  });
}

export function resolveDomEditGroupOverlayRect(rects: OverlayRect[]): OverlayRect | null {
  const first = rects[0];
  if (!first) return null;

  let left = first.left;
  let top = first.top;
  let right = first.left + first.width;
  let bottom = first.top + first.height;

  for (const rect of rects.slice(1)) {
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.left + rect.width);
    bottom = Math.max(bottom, rect.top + rect.height);
  }

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
    editScaleX: 1,
    editScaleY: 1,
  };
}

export function filterNestedDomEditGroupItems<T extends { element: HTMLElement }>(items: T[]): T[] {
  return items.filter(
    (item) => !items.some((other) => other !== item && other.element.contains(item.element)),
  );
}

function selectionCacheKey(
  selection: Pick<DomEditSelection, "id" | "selector" | "selectorIndex" | "sourceFile">,
): string {
  return [
    selection.sourceFile ?? "",
    selection.id ?? "",
    selection.selector ?? "",
    selection.selectorIndex ?? "",
  ].join("|");
}

type FocusableDomEditOverlay = {
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

interface GestureState {
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
}

interface GroupGestureState {
  startX: number;
  startY: number;
  originItems: GroupOverlayItem[];
  members: ManualOffsetDragMember[];
}

interface BlockedMoveState {
  pointerId: number;
  startX: number;
  startY: number;
  notified: boolean;
}

type ResolvedElementRef = {
  current: { key: string; element: HTMLElement } | null;
};

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
  const [overlayRect, setOverlayRect] = useState<OverlayRect | null>(null);
  const [hoverRect, setHoverRect] = useState<OverlayRect | null>(null);
  const [groupOverlayItems, setGroupOverlayItems] = useState<GroupOverlayItem[]>([]);
  const gestureRef = useRef<GestureState | null>(null);
  const groupGestureRef = useRef<GroupGestureState | null>(null);
  const blockedMoveRef = useRef<BlockedMoveState | null>(null);
  const suppressNextBoxClickRef = useRef(false);
  const suppressNextBoxMouseDownRef = useRef(false);
  const suppressNextOverlayMouseDownRef = useRef(false);
  const rafPausedRef = useRef(false);
  const resolvedElementRef = useRef<{ key: string; element: HTMLElement } | null>(null);
  const resolvedHoverElementRef = useRef<{ key: string; element: HTMLElement } | null>(null);
  const resolvedGroupElementRef = useRef<Map<string, HTMLElement>>(new Map());

  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const activeCompositionPathRef = useRef(activeCompositionPath);
  activeCompositionPathRef.current = activeCompositionPath;
  const groupSelectionsRef = useRef(groupSelections);
  groupSelectionsRef.current = groupSelections;
  const hoverSelectionRef = useRef(hoverSelection);
  hoverSelectionRef.current = hoverSelection;
  const overlayRectRef = useRef(overlayRect);
  overlayRectRef.current = overlayRect;
  const hoverRectRef = useRef(hoverRect);
  hoverRectRef.current = hoverRect;
  const groupOverlayItemsRef = useRef(groupOverlayItems);
  groupOverlayItemsRef.current = groupOverlayItems;
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

  useMountEffect(() => {
    let frame = 0;
    const clearOverlayRect = () => {
      if (!overlayRectRef.current) return;
      overlayRectRef.current = null;
      setOverlayRect(null);
    };
    const setNextOverlayRect = (next: OverlayRect | null) => {
      if (rectsEqual(overlayRectRef.current, next)) return;
      overlayRectRef.current = next;
      setOverlayRect(next);
    };
    const clearHoverRect = () => {
      if (!hoverRectRef.current) return;
      hoverRectRef.current = null;
      setHoverRect(null);
    };
    const setNextHoverRect = (next: OverlayRect | null) => {
      if (rectsEqual(hoverRectRef.current, next)) return;
      hoverRectRef.current = next;
      setHoverRect(next);
    };
    const clearGroupOverlayItems = () => {
      if (groupOverlayItemsRef.current.length === 0) return;
      groupOverlayItemsRef.current = [];
      setGroupOverlayItems([]);
    };
    const setNextGroupOverlayItems = (next: GroupOverlayItem[]) => {
      if (groupOverlayItemsEqual(groupOverlayItemsRef.current, next)) return;
      groupOverlayItemsRef.current = next;
      setGroupOverlayItems(next);
    };
    const resolveElement = (doc: Document, sel: DomEditSelection, cacheRef: ResolvedElementRef) => {
      const key = selectionCacheKey(sel);
      const cached = cacheRef.current;
      if (
        cached?.key === key &&
        cached.element.isConnected &&
        cached.element.ownerDocument === doc
      ) {
        return cached.element;
      }

      const next = findElementForSelection(doc, sel, activeCompositionPathRef.current);
      cacheRef.current = next ? { key, element: next } : null;
      return next;
    };
    const resolveGroupElement = (doc: Document, sel: DomEditSelection) => {
      const key = selectionCacheKey(sel);
      const cached = resolvedGroupElementRef.current.get(key);
      if (cached?.isConnected && cached.ownerDocument === doc) return cached;

      const next = findElementForSelection(doc, sel, activeCompositionPathRef.current);
      if (next) {
        resolvedGroupElementRef.current.set(key, next);
      } else {
        resolvedGroupElementRef.current.delete(key);
      }
      return next;
    };

    const update = () => {
      frame = requestAnimationFrame(update);
      if (rafPausedRef.current) return;

      const sel = selectionRef.current;
      const iframe = iframeRef.current;
      const overlayEl = overlayRef.current;
      if (!iframe || !overlayEl) {
        resolvedElementRef.current = null;
        resolvedHoverElementRef.current = null;
        resolvedGroupElementRef.current.clear();
        clearOverlayRect();
        clearHoverRect();
        clearGroupOverlayItems();
        return;
      }

      const doc = iframe.contentDocument;
      if (!doc) {
        resolvedElementRef.current = null;
        resolvedHoverElementRef.current = null;
        resolvedGroupElementRef.current.clear();
        clearOverlayRect();
        clearHoverRect();
        clearGroupOverlayItems();
        return;
      }

      if (sel) {
        const el = resolveElement(doc, sel, resolvedElementRef);
        if (el) {
          setNextOverlayRect(toOverlayRect(overlayEl, iframe, el));
        } else {
          clearOverlayRect();
        }
      } else {
        resolvedElementRef.current = null;
        clearOverlayRect();
      }

      const group = groupSelectionsRef.current;
      if (group.length > 0) {
        const nextGroupItems: GroupOverlayItem[] = [];
        const liveGroupKeys = new Set<string>();
        for (const groupSelection of group) {
          const key = selectionCacheKey(groupSelection);
          liveGroupKeys.add(key);
          const el = resolveGroupElement(doc, groupSelection);
          const rect = el ? toOverlayRect(overlayEl, iframe, el) : null;
          if (el && rect)
            nextGroupItems.push({ key, selection: groupSelection, element: el, rect });
        }
        for (const key of resolvedGroupElementRef.current.keys()) {
          if (!liveGroupKeys.has(key)) resolvedGroupElementRef.current.delete(key);
        }
        setNextGroupOverlayItems(nextGroupItems);
      } else {
        resolvedGroupElementRef.current.clear();
        clearGroupOverlayItems();
      }

      const hoverSel = hoverSelectionRef.current;
      const hoverMatchesSelection = Boolean(
        sel && hoverSel && selectionCacheKey(sel) === selectionCacheKey(hoverSel),
      );
      const hoverMatchesGroup = Boolean(
        hoverSel && group.some((entry) => selectionCacheKey(entry) === selectionCacheKey(hoverSel)),
      );
      if (!hoverSel || hoverMatchesSelection || hoverMatchesGroup) {
        resolvedHoverElementRef.current = null;
        clearHoverRect();
        return;
      }

      const hoverEl = resolveElement(doc, hoverSel, resolvedHoverElementRef);
      if (!hoverEl) {
        clearHoverRect();
        return;
      }

      setNextHoverRect(toOverlayRect(overlayEl, iframe, hoverEl));
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
  const groupBounds = useMemo(
    () => resolveDomEditGroupOverlayRect(groupOverlayItems.map((item) => item.rect)),
    [groupOverlayItems],
  );
  const hasGroupSelection = groupSelections.length > 1;
  const groupCanMove =
    hasGroupSelection &&
    groupOverlayItems.length > 1 &&
    groupOverlayItems.every((item) => item.selection.capabilities.canApplyManualOffset);

  const setDraftOverlayRect = (next: OverlayRect) => {
    if (rectsEqual(overlayRectRef.current, next)) return;
    overlayRectRef.current = next;
    setOverlayRect(next);
  };

  const restoreGestureOverlayRect = (g: GestureState) => {
    setDraftOverlayRect({
      left: g.originLeft,
      top: g.originTop,
      width: g.originWidth,
      height: g.originHeight,
      editScaleX: g.editScaleX,
      editScaleY: g.editScaleY,
    });
  };

  const setDraftGroupOverlayItems = (next: GroupOverlayItem[]) => {
    if (groupOverlayItemsEqual(groupOverlayItemsRef.current, next)) return;
    groupOverlayItemsRef.current = next;
    setGroupOverlayItems(next);
  };

  const restoreGroupGestureOverlayItems = (g: GroupGestureState) => {
    setDraftGroupOverlayItems(g.originItems);
  };

  const startGroupDrag = (e: React.PointerEvent<HTMLElement>) => {
    const items = groupOverlayItemsRef.current;
    if (items.length <= 1) return false;

    const blockedSelection = items.find(
      (item) => !item.selection.capabilities.canApplyManualOffset,
    )?.selection;
    if (blockedSelection) {
      e.preventDefault();
      e.stopPropagation();
      onBlockedMoveRef.current(blockedSelection);
      return false;
    }

    onManualDragStartRef.current?.();

    const dragItems = filterNestedDomEditGroupItems(items);

    const members: ManualOffsetDragMember[] = [];
    for (const item of dragItems) {
      const result = createManualOffsetDragMember({
        key: item.key,
        selection: item.selection,
        element: item.element,
        rect: item.rect,
      });
      if (!result.ok) {
        restoreManualOffsetDragMembers(members);
        e.preventDefault();
        e.stopPropagation();
        onBlockedMoveRef.current(result.selection);
        return false;
      }
      members.push(result.member);
    }

    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);

    rafPausedRef.current = true;
    groupGestureRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originItems: items,
      members,
    };
    return true;
  };

  const restoreGroupPathOffsets = (g: GroupGestureState) => {
    restoreManualOffsetDragMembers(g.members);
    restoreGroupGestureOverlayItems(g);
  };

  const startGesture = (
    kind: GestureKind,
    e: React.PointerEvent<HTMLElement>,
    options?: { selection?: DomEditSelection; rect?: OverlayRect | null },
  ) => {
    const sel = options?.selection ?? selectionRef.current;
    const rect = options?.rect ?? overlayRectRef.current;
    const box = boxRef.current;
    const overlayEl = overlayRef.current;
    if (!sel || !rect) return false;
    if (kind !== "drag" && !box) return false;
    const mode: GestureState["mode"] =
      kind === "rotate" ? "rotation" : kind === "drag" ? "path-offset" : "box-size";
    if (kind === "drag" && !sel.capabilities.canApplyManualOffset) return false;
    if (kind === "resize" && !sel.capabilities.canApplyManualSize) return false;
    if (kind === "rotate" && !sel.capabilities.canApplyManualRotation) return false;
    if (kind === "resize" && (!Number.isFinite(rect.width) || !Number.isFinite(rect.height))) {
      return false;
    }
    const size = readStudioBoxSize(sel.element);
    const rotation = readStudioRotation(sel.element);
    const actualWidth = size.width > 0 ? size.width : rect.width / rect.editScaleX;
    const actualHeight = size.height > 0 ? size.height : rect.height / rect.editScaleY;
    let initialPathOffset = captureStudioPathOffset(sel.element);
    let manualEditDragToken: string | undefined;
    let pathOffsetMember: ManualOffsetDragMember | undefined;
    if (kind === "drag") {
      onManualDragStartRef.current?.();
      const result = createManualOffsetDragMember({
        key: selectionCacheKey(sel),
        selection: sel,
        element: sel.element,
        rect,
      });
      if (!result.ok) {
        onBlockedMoveRef.current(result.selection);
        return false;
      }
      pathOffsetMember = result.member;
      initialPathOffset = result.member.initialPathOffset;
      manualEditDragToken = result.member.gestureToken;
    } else {
      manualEditDragToken = beginStudioManualEditGesture(sel.element);
    }
    const overlayBounds = overlayEl?.getBoundingClientRect();
    const centerX = (overlayBounds?.left ?? 0) + rect.left + rect.width / 2;
    const centerY = (overlayBounds?.top ?? 0) + rect.top + rect.height / 2;

    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);

    rafPausedRef.current = true;

    gestureRef.current = {
      kind,
      mode,
      selection: sel,
      startX: e.clientX,
      startY: e.clientY,
      centerX,
      centerY,
      initialPathOffset,
      initialRotation: captureStudioRotation(sel.element),
      initialBoxSize: captureStudioBoxSize(sel.element),
      pathOffsetMember,
      originLeft: rect.left,
      originTop: rect.top,
      originWidth: rect.width,
      originHeight: rect.height,
      actualWidth,
      actualHeight,
      actualRotation: rotation.angle,
      editScaleX: rect.editScaleX,
      editScaleY: rect.editScaleY,
      manualEditDragToken,
    };
    return true;
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    const groupG = groupGestureRef.current;
    const sel = g?.selection ?? selectionRef.current;
    const box = boxRef.current;
    const blockedMove = blockedMoveRef.current;
    if (!blockedMove && !g && !groupG) {
      onCanvasPointerMoveRef.current(e, { preferClipAncestor: false });
    }

    if (blockedMove && sel) {
      const dx = e.clientX - blockedMove.startX;
      const dy = e.clientY - blockedMove.startY;
      if (!blockedMove.notified && Math.hypot(dx, dy) >= BLOCKED_MOVE_THRESHOLD_PX) {
        blockedMove.notified = true;
        suppressNextBoxClickRef.current = true;
        onBlockedMoveRef.current(sel);
      }
      return;
    }

    if (groupG) {
      const dx = e.clientX - groupG.startX;
      const dy = e.clientY - groupG.startY;
      setDraftGroupOverlayItems(
        groupG.originItems.map((item) => ({
          ...item,
          rect: {
            ...item.rect,
            left: item.rect.left + dx,
            top: item.rect.top + dy,
          },
        })),
      );
      for (const member of groupG.members) {
        applyManualOffsetDragDraft(member, dx, dy);
      }
      return;
    }

    if (!g || !sel) return;

    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;

    if (g.kind === "rotate") {
      const nextRotation = resolveDomEditRotationGesture({
        centerX: g.centerX,
        centerY: g.centerY,
        startX: g.startX,
        startY: g.startY,
        currentX: e.clientX,
        currentY: e.clientY,
        actualAngle: g.actualRotation,
        snap: e.shiftKey,
      });
      applyStudioRotationDraft(sel.element, nextRotation);
      return;
    }

    if (g.kind === "drag") {
      const nextBoxLeft = g.originLeft + dx;
      const nextBoxTop = g.originTop + dy;
      setDraftOverlayRect({
        left: nextBoxLeft,
        top: nextBoxTop,
        width: g.originWidth,
        height: g.originHeight,
        editScaleX: g.editScaleX,
        editScaleY: g.editScaleY,
      });
      if (box) {
        box.style.left = `${nextBoxLeft}px`;
        box.style.top = `${nextBoxTop}px`;
      }
      if (g.pathOffsetMember) applyManualOffsetDragDraft(g.pathOffsetMember, dx, dy);
    } else {
      if (!box) return;
      const nextSize = resolveDomEditResizeGesture({
        originWidth: g.originWidth,
        originHeight: g.originHeight,
        actualWidth: g.actualWidth,
        actualHeight: g.actualHeight,
        scaleX: g.editScaleX,
        scaleY: g.editScaleY,
        dx,
        dy,
        uniform: e.shiftKey,
      });
      setDraftOverlayRect({
        left: g.originLeft,
        top: g.originTop,
        width: nextSize.overlayWidth,
        height: nextSize.overlayHeight,
        editScaleX: g.editScaleX,
        editScaleY: g.editScaleY,
      });
      box.style.width = `${nextSize.overlayWidth}px`;
      box.style.height = `${nextSize.overlayHeight}px`;
      applyStudioBoxSizeDraft(sel.element, nextSize);
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    const groupG = groupGestureRef.current;
    const sel = g?.selection ?? selectionRef.current;
    const box = boxRef.current;
    blockedMoveRef.current = null;

    if (groupG) {
      groupGestureRef.current = null;
      rafPausedRef.current = false;

      const dx = e.clientX - groupG.startX;
      const dy = e.clientY - groupG.startY;
      const movedDistance = Math.hypot(e.clientX - groupG.startX, e.clientY - groupG.startY);
      if (movedDistance < BLOCKED_MOVE_THRESHOLD_PX) {
        restoreGroupPathOffsets(groupG);
        suppressNextBoxClickRef.current = true;
        return;
      }

      setDraftGroupOverlayItems(
        groupG.originItems.map((item) => ({
          ...item,
          rect: {
            ...item.rect,
            left: item.rect.left + dx,
            top: item.rect.top + dy,
          },
        })),
      );
      const updates = groupG.members.map((member) => {
        const finalOffset = applyManualOffsetDragCommit(member, dx, dy);
        return { selection: member.selection, next: finalOffset };
      });
      void Promise.resolve(onGroupPathOffsetCommitRef.current(updates))
        .catch(() => {
          for (const member of groupG.members) {
            if (
              member.gestureToken &&
              isStudioManualEditGestureCurrent(member.element, member.gestureToken)
            ) {
              restoreStudioPathOffset(member.element, member.initialPathOffset);
            }
          }
        })
        .finally(() => {
          endManualOffsetDragMembers(groupG.members);
        });
      return;
    }

    if (!g || !sel) {
      gestureRef.current = null;
      rafPausedRef.current = false;
      return;
    }

    gestureRef.current = null;
    rafPausedRef.current = false;

    const movedDistance = Math.hypot(e.clientX - g.startX, e.clientY - g.startY);
    if (g.kind === "drag" && movedDistance < BLOCKED_MOVE_THRESHOLD_PX) {
      restoreStudioPathOffset(sel.element, g.initialPathOffset);
      endStudioManualEditGesture(sel.element, g.manualEditDragToken);
      if (box) {
        box.style.left = `${g.originLeft}px`;
        box.style.top = `${g.originTop}px`;
      }
      restoreGestureOverlayRect(g);
      suppressNextBoxClickRef.current = true;
      onCanvasMouseDown(e as unknown as React.MouseEvent<HTMLDivElement>, {
        preferClipAncestor: false,
      });
      return;
    }

    if (g.kind === "resize" && movedDistance < BLOCKED_MOVE_THRESHOLD_PX) {
      restoreStudioBoxSize(sel.element, g.initialBoxSize);
      endStudioManualEditGesture(sel.element, g.manualEditDragToken);
      if (box) {
        box.style.width = `${g.originWidth}px`;
        box.style.height = `${g.originHeight}px`;
      }
      restoreGestureOverlayRect(g);
      return;
    }

    if (g.kind === "rotate") {
      const finalRotation = resolveDomEditRotationGesture({
        centerX: g.centerX,
        centerY: g.centerY,
        startX: g.startX,
        startY: g.startY,
        currentX: e.clientX,
        currentY: e.clientY,
        actualAngle: g.actualRotation,
        snap: e.shiftKey,
      });
      if (!hasDomEditRotationChanged(g.actualRotation, finalRotation.angle)) {
        restoreStudioRotation(sel.element, g.initialRotation);
        endStudioManualEditGesture(sel.element, g.manualEditDragToken);
        return;
      }
      applyStudioRotation(sel.element, finalRotation);
      void Promise.resolve(onRotationCommitRef.current(sel, finalRotation))
        .catch(() => {
          if (
            g.manualEditDragToken &&
            isStudioManualEditGestureCurrent(sel.element, g.manualEditDragToken)
          ) {
            restoreStudioRotation(sel.element, g.initialRotation);
          }
        })
        .finally(() => {
          endStudioManualEditGesture(sel.element, g.manualEditDragToken);
        });
    } else if (g.kind === "drag") {
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      if (!g.pathOffsetMember) return;
      const finalOffset = applyManualOffsetDragCommit(g.pathOffsetMember, dx, dy);
      const nextBoxLeft = g.originLeft + dx;
      const nextBoxTop = g.originTop + dy;
      setDraftOverlayRect({
        left: nextBoxLeft,
        top: nextBoxTop,
        width: g.originWidth,
        height: g.originHeight,
        editScaleX: g.editScaleX,
        editScaleY: g.editScaleY,
      });
      if (box) {
        box.style.left = `${nextBoxLeft}px`;
        box.style.top = `${nextBoxTop}px`;
      }
      void Promise.resolve(onPathOffsetCommitRef.current(sel, finalOffset))
        .catch(() => {
          if (
            g.pathOffsetMember?.gestureToken &&
            isStudioManualEditGestureCurrent(sel.element, g.pathOffsetMember.gestureToken)
          ) {
            restoreStudioPathOffset(sel.element, g.initialPathOffset);
          }
        })
        .finally(() => {
          if (g.pathOffsetMember) endManualOffsetDragMembers([g.pathOffsetMember]);
        });
    } else {
      const finalSize = readStudioBoxSize(sel.element);
      applyStudioBoxSize(sel.element, finalSize);
      void Promise.resolve(onBoxSizeCommitRef.current(sel, finalSize))
        .catch(() => {
          if (
            g.manualEditDragToken &&
            isStudioManualEditGestureCurrent(sel.element, g.manualEditDragToken)
          ) {
            restoreStudioBoxSize(sel.element, g.initialBoxSize);
          }
        })
        .finally(() => {
          endStudioManualEditGesture(sel.element, g.manualEditDragToken);
        });
    }
  };

  // Click on overlay background → select whatever is under the pointer in the iframe.
  // This handles clicking children inside an already-selected parent: the selection
  // box stops propagation for drag gestures, but clicks on the transparent overlay
  // area outside the box pass through to the iframe pick logic.
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
        onCanvasPointerMoveRef.current(event, {
          preferClipAncestor: false,
        }) ?? hoverSelectionRef.current;
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

    const hoverCandidate = onCanvasPointerMoveRef.current(event, {
      preferClipAncestor: false,
    });
    const candidate = hoverCandidate ?? hoverSelectionRef.current;
    if (!candidate?.capabilities.canApplyManualOffset) return;

    const overlayEl = overlayRef.current;
    const iframe = iframeRef.current;
    const candidateRect =
      overlayEl && iframe ? toOverlayRect(overlayEl, iframe, candidate.element) : null;
    if (!candidateRect) return;

    suppressNextOverlayMouseDownRef.current = true;
    selectionRef.current = candidate;
    overlayRectRef.current = candidateRect;
    hoverRectRef.current = null;
    setOverlayRect(candidateRect);
    setHoverRect(null);
    const didStartGesture = startGesture("drag", event, {
      selection: candidate,
      rect: candidateRect,
    });
    if (!didStartGesture) {
      suppressNextOverlayMouseDownRef.current = false;
      return;
    }
    onSelectionChangeRef.current(candidate);
  };

  // Click on the selection box itself → re-pick the element under the pointer.
  // This lets you click a child element even when a parent is selected, because
  // the click coordinates are forwarded to the iframe's element picker.
  const handleBoxClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (gestureRef.current || groupGestureRef.current) return;
    if (suppressNextBoxClickRef.current) {
      suppressNextBoxClickRef.current = false;
      event.stopPropagation();
      return;
    }
    onCanvasMouseDown(event, { preferClipAncestor: false });
  };

  const clearPointerState = () => {
    const groupG = groupGestureRef.current;
    if (groupG) restoreGroupPathOffsets(groupG);
    const g = gestureRef.current;
    const sel = g?.selection ?? selectionRef.current;
    if (g?.mode === "path-offset" && sel) {
      restoreStudioPathOffset(sel.element, g.initialPathOffset);
      endStudioManualEditGesture(sel.element, g.manualEditDragToken);
      restoreGestureOverlayRect(g);
    }
    if (g?.mode === "box-size" && sel) {
      restoreStudioBoxSize(sel.element, g.initialBoxSize);
      endStudioManualEditGesture(sel.element, g.manualEditDragToken);
      restoreGestureOverlayRect(g);
    }
    if (g?.mode === "rotation" && sel) {
      restoreStudioRotation(sel.element, g.initialRotation);
      endStudioManualEditGesture(sel.element, g.manualEditDragToken);
    }
    blockedMoveRef.current = null;
    groupGestureRef.current = null;
    gestureRef.current = null;
    rafPausedRef.current = false;
  };

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 z-10 pointer-events-auto outline-none"
      tabIndex={-1}
      aria-label="Composition canvas"
      onPointerDownCapture={(event) => focusDomEditOverlayElement(event.currentTarget)}
      onPointerDown={handleOverlayPointerDown}
      onMouseDown={handleOverlayMouseDown}
      onPointerMove={onPointerMove}
      onPointerLeave={() => onCanvasPointerLeaveRef.current()}
      onPointerUp={onPointerUp}
      onPointerCancel={clearPointerState}
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
              if (!allowCanvasMovement) return;
              if (e.shiftKey) return;
              startGroupDrag(e);
            }}
            onMouseDown={(e) => {
              if (!suppressNextBoxMouseDownRef.current) return;
              suppressNextBoxMouseDownRef.current = false;
              e.preventDefault();
              e.stopPropagation();
            }}
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
                  startGesture("rotate", e);
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
              if (!allowCanvasMovement) return;
              if (e.shiftKey) return;
              if (selection.capabilities.canApplyManualOffset) {
                startGesture("drag", e);
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
            onMouseDown={(e) => {
              if (!suppressNextBoxMouseDownRef.current) return;
              suppressNextBoxMouseDownRef.current = false;
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={handleBoxClick}
          >
            {/* Resize handle — bottom-right corner */}
            {allowCanvasMovement && selection.capabilities.canApplyManualSize && (
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
        </>
      )}
    </div>
  );
});
