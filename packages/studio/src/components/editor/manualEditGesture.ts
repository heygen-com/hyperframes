import {
  STUDIO_OFFSET_X_PROP,
  STUDIO_OFFSET_Y_PROP,
  STUDIO_WIDTH_PROP,
  STUDIO_HEIGHT_PROP,
  STUDIO_ROTATION_PROP,
  STUDIO_MANUAL_EDIT_GESTURE_ATTR,
  STUDIO_EDIT_MOMENT_ATTR,
  type EditMoment,
} from "./manualEditsTypes";
import { BOX_SIZE_STYLE_PROPS } from "./manualEditsDomPatches";

let studioManualEditGestureId = 0;
const detachedStandInGestures = new WeakMap<Document, Set<Element>>();
const liveGestures = new WeakMap<Element, Array<{ token: string; at: string | null }>>();

export type StudioGestureDraws = "move" | "resize" | "rotate" | "edit";
const MOVE_DRAWS = ["translate", STUDIO_OFFSET_X_PROP, STUDIO_OFFSET_Y_PROP];
const GESTURE_DRAWS: Record<StudioGestureDraws, readonly string[]> = {
  move: MOVE_DRAWS,
  resize: [...MOVE_DRAWS, STUDIO_WIDTH_PROP, STUDIO_HEIGHT_PROP, ...BOX_SIZE_STYLE_PROPS],
  rotate: ["rotate", "transform", "transform-origin", "display", STUDIO_ROTATION_PROP],
  edit: [],
};

export function beginStudioManualEditGesture(
  element: HTMLElement,
  draws: StudioGestureDraws,
  at?: EditMoment,
): string {
  studioManualEditGestureId += 1;
  const token = `gesture-${studioManualEditGestureId}:${draws}`;
  const gesture = { token, at: at ? JSON.stringify(at) : null };
  liveGestures.set(element, [...(liveGestures.get(element) ?? []), gesture]);
  markGesture(element, gesture);
  if (!element.isConnected) {
    const doc = element.ownerDocument;
    detachedStandInGestures.set(doc, (detachedStandInGestures.get(doc) ?? new Set()).add(element));
  }
  return token;
}

function markGesture(element: HTMLElement, { token, at }: { token: string; at: string | null }) {
  element.setAttribute(STUDIO_MANUAL_EDIT_GESTURE_ATTR, token);
  if (at) element.setAttribute(STUDIO_EDIT_MOMENT_ATTR, at);
  else element.removeAttribute(STUDIO_EDIT_MOMENT_ATTR);
}

const GESTURE_ENDED = "hf-manual-edit-gesture-ended";

export function endStudioManualEditGesture(element: HTMLElement, token?: string): void {
  const live = liveGestures.get(element) ?? [];
  if (token && !live.some((gesture) => gesture.token === token)) return;
  const rest = token ? live.filter((gesture) => gesture.token !== token) : [];
  if (rest.length) {
    liveGestures.set(element, rest);
    markGesture(element, rest[rest.length - 1]!);
    return;
  }
  liveGestures.delete(element);
  if (!element.hasAttribute(STUDIO_MANUAL_EDIT_GESTURE_ATTR)) return;
  element.removeAttribute(STUDIO_MANUAL_EDIT_GESTURE_ATTR);
  element.removeAttribute(STUDIO_EDIT_MOMENT_ATTR);
  const doc = element.ownerDocument;
  detachedStandInGestures.get(doc)?.delete(element);
  doc.dispatchEvent(new (doc.defaultView?.Event ?? Event)(GESTURE_ENDED));
}

export function isStudioManualEditGestureLiveIn(doc: Document): boolean {
  if (doc.querySelector(`[${STUDIO_MANUAL_EDIT_GESTURE_ATTR}]`) !== null) return true;
  const standIns = [...(detachedStandInGestures.get(doc) ?? [])];
  return standIns.some((el) => el.hasAttribute(STUDIO_MANUAL_EDIT_GESTURE_ATTR));
}

/** Runs `run` once the last gesture in `doc` ends; the returned function stops waiting. */
export function afterStudioManualEditGestures(doc: Document, run: () => void): () => void {
  const onEnded = () => {
    if (isStudioManualEditGestureLiveIn(doc)) return;
    stop();
    run();
  };
  const stop = () => doc.removeEventListener(GESTURE_ENDED, onEnded);
  doc.addEventListener(GESTURE_ENDED, onEnded);
  return stop;
}

const gestureSaves = new WeakMap<Document, number>();

export function studioManualEditSavesIn(doc: Document): number {
  return gestureSaves.get(doc) ?? 0;
}

export function countStudioPreviewChange(doc: Document): void {
  gestureSaves.set(doc, studioManualEditSavesIn(doc) + 1);
}

/** Runs a gesture's save, counted as it starts and as it settles: a reload requested before shows the old file. */
export function countStudioManualEditSave<R>(element: HTMLElement, save: () => R): R {
  const doc = element.ownerDocument;
  const count = () => countStudioPreviewChange(doc);
  count();
  const result = save();
  void Promise.resolve(result).then(count, count);
  return result;
}

export function studioGestureDraws(element: Element): readonly string[] | null {
  const token = element.getAttribute(STUDIO_MANUAL_EDIT_GESTURE_ATTR);
  if (token === null) return null;
  return GESTURE_DRAWS[token.split(":")[1] as StudioGestureDraws] ?? [];
}

export function isStudioManualEditGestureActive(element: HTMLElement): boolean {
  return element.hasAttribute(STUDIO_MANUAL_EDIT_GESTURE_ATTR);
}

export function isStudioManualEditGestureCurrent(element: HTMLElement, token: string): boolean {
  return element.getAttribute(STUDIO_MANUAL_EDIT_GESTURE_ATTR) === token;
}
