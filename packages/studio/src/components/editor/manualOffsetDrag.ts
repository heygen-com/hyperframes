import type { DomEditSelection } from "./domEditing";
import {
  applyStudioPathOffset,
  applyStudioPathOffsetDraft,
  beginStudioManualEditGesture,
  captureStudioPathOffset,
  endStudioManualEditGesture,
  readStudioPathOffset,
  restoreStudioPathOffset,
  type StudioPathOffsetSnapshot,
} from "./manualEdits";

const DEFAULT_OFFSET_PROBE_PX = 100;
const MIN_PROBE_VECTOR_LENGTH_PX = 0.01;
const MIN_MATRIX_DETERMINANT = 0.000001;

export interface ManualOffsetDragMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
}

export interface ManualOffsetDragRect {
  left: number;
  top: number;
  width: number;
  height: number;
  editScaleX: number;
  editScaleY: number;
}

export interface ManualOffsetDragMember {
  key: string;
  selection: DomEditSelection;
  element: HTMLElement;
  initialOffset: { x: number; y: number };
  initialPathOffset: StudioPathOffsetSnapshot;
  gestureToken: string;
  screenToOffset: ManualOffsetDragMatrix;
  originRect: ManualOffsetDragRect;
}

export type ManualOffsetDragMemberResult =
  | { ok: true; member: ManualOffsetDragMember }
  | { ok: false; reason: string; selection: DomEditSelection };

type Point = { x: number; y: number };

function finitePoint(point: Point): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function vectorLength(point: Point): number {
  return Math.hypot(point.x, point.y);
}

function finiteRect(rect: DOMRect): boolean {
  return (
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.top) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height)
  );
}

function readViewportSize(win: Window): { width: number; height: number } {
  const docEl = win.document.documentElement;
  const width = win.innerWidth || docEl.clientWidth || 1;
  const height = win.innerHeight || docEl.clientHeight || 1;
  return {
    width: width > 0 ? width : 1,
    height: height > 0 ? height : 1,
  };
}

function getFrameElement(win: Window): HTMLElement | null {
  try {
    const frameElement = win.frameElement;
    if (!frameElement) return null;
    const ownerWin = frameElement.ownerDocument.defaultView;
    const htmlElement = ownerWin?.HTMLElement;
    return htmlElement && frameElement instanceof htmlElement ? frameElement : null;
  } catch {
    return null;
  }
}

function getRectCenter(element: HTMLElement): Point | null {
  const rect = element.getBoundingClientRect();
  if (!finiteRect(rect) || (rect.width <= 0 && rect.height <= 0)) {
    return null;
  }

  let point = {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };

  let win: Window | null = element.ownerDocument.defaultView;
  while (win) {
    const frameElement = getFrameElement(win);
    if (!frameElement) break;

    const frameRect = frameElement.getBoundingClientRect();
    if (!finiteRect(frameRect) || frameRect.width <= 0 || frameRect.height <= 0) return null;

    const viewport = readViewportSize(win);
    point = {
      x: frameRect.left + point.x * (frameRect.width / viewport.width),
      y: frameRect.top + point.y * (frameRect.height / viewport.height),
    };
    win = frameElement.ownerDocument.defaultView;
  }

  return point;
}

export function invertManualOffsetDragMatrix(
  matrix: ManualOffsetDragMatrix,
): ManualOffsetDragMatrix | null {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < MIN_MATRIX_DETERMINANT) {
    return null;
  }

  return {
    a: matrix.d / determinant,
    b: -matrix.b / determinant,
    c: -matrix.c / determinant,
    d: matrix.a / determinant,
  };
}

export function applyManualOffsetDragMatrix(matrix: ManualOffsetDragMatrix, point: Point): Point {
  return {
    x: matrix.a * point.x + matrix.c * point.y,
    y: matrix.b * point.x + matrix.d * point.y,
  };
}

export function measureManualOffsetDragScreenToOffsetMatrix(
  element: HTMLElement,
  initialOffset: { x: number; y: number },
  options: { probeSize?: number } = {},
): { ok: true; matrix: ManualOffsetDragMatrix } | { ok: false; reason: string } {
  const probeSize = options.probeSize ?? DEFAULT_OFFSET_PROBE_PX;
  if (!Number.isFinite(probeSize) || probeSize <= 0) {
    return { ok: false, reason: "Invalid movement probe size." };
  }

  const snapshot = captureStudioPathOffset(element);
  try {
    applyStudioPathOffsetDraft(element, initialOffset);
    const origin = getRectCenter(element);
    if (!origin) {
      return { ok: false, reason: "Element has no measurable box." };
    }

    applyStudioPathOffsetDraft(element, {
      x: initialOffset.x + probeSize,
      y: initialOffset.y,
    });
    const probeX = getRectCenter(element);
    if (!probeX) {
      return { ok: false, reason: "Element X movement could not be measured." };
    }

    applyStudioPathOffsetDraft(element, {
      x: initialOffset.x,
      y: initialOffset.y + probeSize,
    });
    const probeY = getRectCenter(element);
    if (!probeY) {
      return { ok: false, reason: "Element Y movement could not be measured." };
    }

    const xColumn = {
      x: (probeX.x - origin.x) / probeSize,
      y: (probeX.y - origin.y) / probeSize,
    };
    const yColumn = {
      x: (probeY.x - origin.x) / probeSize,
      y: (probeY.y - origin.y) / probeSize,
    };
    if (
      !finitePoint(xColumn) ||
      !finitePoint(yColumn) ||
      vectorLength(xColumn) < MIN_PROBE_VECTOR_LENGTH_PX ||
      vectorLength(yColumn) < MIN_PROBE_VECTOR_LENGTH_PX
    ) {
      return { ok: false, reason: "Element movement response is too small to measure." };
    }

    const offsetToScreen = {
      a: xColumn.x,
      b: xColumn.y,
      c: yColumn.x,
      d: yColumn.y,
    };
    const screenToOffset = invertManualOffsetDragMatrix(offsetToScreen);
    if (!screenToOffset) {
      return { ok: false, reason: "Element movement response is not invertible." };
    }

    return { ok: true, matrix: screenToOffset };
  } finally {
    restoreStudioPathOffset(element, snapshot);
  }
}

export function resolveManualOffsetForPointerDelta(input: {
  initialOffset: { x: number; y: number };
  screenToOffset: ManualOffsetDragMatrix;
  dx: number;
  dy: number;
}): { x: number; y: number } {
  const offsetDelta = applyManualOffsetDragMatrix(input.screenToOffset, {
    x: input.dx,
    y: input.dy,
  });
  return {
    x: input.initialOffset.x + offsetDelta.x,
    y: input.initialOffset.y + offsetDelta.y,
  };
}

export function createManualOffsetDragMember(input: {
  key: string;
  selection: DomEditSelection;
  element: HTMLElement;
  rect: ManualOffsetDragRect;
}): ManualOffsetDragMemberResult {
  const initialOffset = readStudioPathOffset(input.element);
  const initialPathOffset = captureStudioPathOffset(input.element);
  const gestureToken = beginStudioManualEditGesture(input.element);
  const measured = measureManualOffsetDragScreenToOffsetMatrix(input.element, initialOffset);
  if (!measured.ok) {
    restoreStudioPathOffset(input.element, initialPathOffset);
    endStudioManualEditGesture(input.element, gestureToken);
    return { ok: false, reason: measured.reason, selection: input.selection };
  }

  return {
    ok: true,
    member: {
      key: input.key,
      selection: input.selection,
      element: input.element,
      initialOffset,
      initialPathOffset,
      gestureToken,
      screenToOffset: measured.matrix,
      originRect: input.rect,
    },
  };
}

export function resolveManualOffsetDragMemberOffset(
  member: ManualOffsetDragMember,
  dx: number,
  dy: number,
): { x: number; y: number } {
  return resolveManualOffsetForPointerDelta({
    initialOffset: member.initialOffset,
    screenToOffset: member.screenToOffset,
    dx,
    dy,
  });
}

export function applyManualOffsetDragDraft(
  member: ManualOffsetDragMember,
  dx: number,
  dy: number,
): { x: number; y: number } {
  const offset = resolveManualOffsetDragMemberOffset(member, dx, dy);
  applyStudioPathOffsetDraft(member.element, offset);
  return offset;
}

export function applyManualOffsetDragCommit(
  member: ManualOffsetDragMember,
  dx: number,
  dy: number,
): { x: number; y: number } {
  const offset = resolveManualOffsetDragMemberOffset(member, dx, dy);
  applyStudioPathOffset(member.element, offset);
  return offset;
}

export function restoreManualOffsetDragMember(member: ManualOffsetDragMember): void {
  restoreStudioPathOffset(member.element, member.initialPathOffset);
  endStudioManualEditGesture(member.element, member.gestureToken);
}

export function restoreManualOffsetDragMembers(members: ManualOffsetDragMember[]): void {
  for (const member of members) {
    restoreManualOffsetDragMember(member);
  }
}

export function endManualOffsetDragMembers(members: ManualOffsetDragMember[]): void {
  for (const member of members) {
    endStudioManualEditGesture(member.element, member.gestureToken);
  }
}
