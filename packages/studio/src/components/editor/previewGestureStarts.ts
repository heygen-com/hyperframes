import {
  orientedGroupAwareOverlayRect,
  shiftedOverlayRect,
  type OverlayRect,
} from "./domEditOverlayGeometry";
import { findElementForSelection, type DomEditSelection } from "./domEditing";
import { computeOverlayRootScale } from "./domEditOverlayBasis";
import { resolveCenterResizeScale } from "./domEditResizeLocal";
import {
  PRESS_WAITING_ATTR,
  type WaitingPressState,
  type GestureKind,
  type ResizeHandle,
  type UseDomEditOverlayGesturesOptions,
} from "./domEditOverlayGestures";
import {
  startGesture as _startGesture,
  startGroupDrag as _startGroupDrag,
} from "./domEditOverlayStartGesture";
import { giveUpOnPreviewChange, isPreviewChanging } from "../../player/previewReloading";
import { setStudioWaitingPressCancel } from "../../utils/studioPendingEdits";
import { playheadMoment } from "../../hooks/editMoment";
import type { EditMoment } from "./manualEditsTypes";

const MAX_SETTLED_WAIT_FRAMES = 60;
export const PRESS_WAIT_MAX_MS = 10_000;

export function createPreviewGestureStarts(
  opts: UseDomEditOverlayGesturesOptions,
  moveActiveGesture: (e: React.PointerEvent<HTMLDivElement>) => void,
  releaseActiveGesture: (e: React.PointerEvent<HTMLDivElement>) => void,
) {
  /** Points Cmd+Z at the newest released press still waiting, if any. */
  const offerUndo = () => {
    let p = opts.waitingPressRef.current;
    while (p && !p.released) p = p.after;
    const press = p;
    setStudioWaitingPressCancel(press && (() => dropPress(press)));
  };

  const endWaitingPress = (press: WaitingPressState | null = opts.waitingPressRef.current) => {
    for (let p = press; p && !p.ended; p = p.after) {
      p.ended = true;
      cancelAnimationFrame(p.frame);
    }
    const newest = opts.waitingPressRef.current;
    if (press === newest) {
      opts.waitingPressRef.current = null;
      opts.boxRef.current?.removeAttribute(PRESS_WAITING_ATTR);
      opts.rafPausedRef.current = false;
    }
    // A press queued behind this one keeps waiting, on nothing that has ended.
    else for (let p = newest; p; p = p.after) if (p.after === press) p.after = null;
    offerUndo();
  };

  /** Takes one press out of the queue; the outline shows the newest press left, or the box before this one. */
  const dropPress = (press: WaitingPressState) => {
    if (press.ended) return;
    press.ended = true;
    cancelAnimationFrame(press.frame);
    const newest = opts.waitingPressRef.current;
    if (press === newest) {
      const before = press.after;
      opts.waitingPressRef.current = before;
      const shown = before ?? press;
      const at = before?.moved;
      shown.draw?.(at ? at.clientX - shown.startX : 0, at ? at.clientY - shown.startY : 0);
      if (!before) {
        opts.boxRef.current?.removeAttribute(PRESS_WAITING_ATTR);
        opts.rafPausedRef.current = false;
      }
    } else for (let p = newest; p; p = p.after) if (p.after === press) p.after = press.after;
    offerUndo();
  };

  /** Ends the press still held, if any; presses already released are finished edits and still land. */
  const endHeldPress = () => {
    const held = opts.waitingPressRef.current;
    if (held && !held.released) dropPress(held);
  };

  const releaseWaitingPress = (press: WaitingPressState, e: React.PointerEvent<HTMLDivElement>) => {
    press.released = e;
    offerUndo();
  };

  const drawPressedBox = (origin: OverlayRect | null): WaitingPressState["draw"] =>
    origin && ((dx, dy) => opts.setOverlayRect(shiftedOverlayRect(origin, dx, dy)));

  // A corner resize scales about the element's centre by the pointer's distance from it, as the resize does.
  const drawResizedBox = (
    origin: OverlayRect | null,
    press: { x: number; y: number },
  ): WaitingPressState["draw"] => {
    if (!origin) return null;
    const bounds = opts.overlayRef.current?.getBoundingClientRect();
    const centre = {
      x: (bounds?.left ?? 0) + origin.left + origin.width / 2,
      y: (bounds?.top ?? 0) + origin.top + origin.height / 2,
    };
    return (dx, dy) => {
      const pointer = { x: press.x + dx, y: press.y + dy };
      const scale = resolveCenterResizeScale({ pointer, pointerStart: press, centerStart: centre });
      const [width, height] = [origin.width * scale, origin.height * scale];
      opts.setOverlayRect({
        ...origin,
        left: origin.left + (origin.width - width) / 2,
        top: origin.top + (origin.height - height) / 2,
        width,
        height,
      });
    };
  };

  // A press on the page a reload is replacing would edit it by its old rules: it starts on the new page instead.
  const startOnShownPreview = (
    e: React.PointerEvent<HTMLElement>,
    pressed: () => HTMLElement[],
    start: (e: React.PointerEvent<HTMLElement>, at: EditMoment, waited: boolean) => boolean,
    draw: WaitingPressState["draw"] = null,
  ): boolean => {
    const at = playheadMoment();
    if (!isPreviewChanging() && !opts.waitingPressRef.current) return start(e, at, false);
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    // The press already holds the pointer, which may be up by the time the gesture starts.
    const held = { setPointerCapture() {} };
    const down = { ...e, currentTarget: held, preventDefault() {}, stopPropagation() {} };
    const press: WaitingPressState = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      draw,
      frame: 0,
      moved: null,
      released: null,
      after: opts.waitingPressRef.current,
      ended: false,
    };
    opts.waitingPressRef.current = press;
    opts.boxRef.current?.setAttribute(PRESS_WAITING_ATTR, "true");
    opts.rafPausedRef.current = true;
    let shownFrames = 0;
    let settledFrames = 0;
    const since = performance.now();
    const poll = () => {
      if (press.ended) return;
      if (press.after && !press.after.ended) {
        press.frame = requestAnimationFrame(poll);
        return;
      }
      const elements = pressed();
      const live = opts.iframeRef.current?.contentDocument;
      const settled = !isPreviewChanging();
      const shown = settled && elements.every((el) => el.ownerDocument === live);
      shownFrames = shown ? shownFrames + 1 : 0;
      settledFrames = settled ? settledFrames + 1 : 0;
      // The waiting outline stays drawn while replay measures the live element separately.
      const lost = elements.length === 0 || settledFrames > MAX_SETTLED_WAIT_FRAMES;
      // A change that never ends (a save with no reply) would hold every press: run on the page shown, as before waiting.
      const overdue = performance.now() - since > PRESS_WAIT_MAX_MS;
      if (overdue) giveUpOnPreviewChange();
      if (!lost && shownFrames < 2 && !overdue) {
        press.frame = requestAnimationFrame(poll);
        return;
      }
      endWaitingPress(press);
      if (lost || !start(down as unknown as React.PointerEvent<HTMLElement>, at, true)) return;
      if (press.moved) moveActiveGesture(press.moved);
      if (press.released) releaseActiveGesture(press.released);
    };
    press.frame = requestAnimationFrame(poll);
    return true;
  };

  const shownSelection = (selection: DomEditSelection) => {
    const doc = opts.iframeRef.current?.contentDocument;
    if (!doc) return null;
    const element = findElementForSelection(doc, selection, opts.activeCompositionPathRef.current);
    return element && { ...selection, element };
  };
  const shownRect = (element: HTMLElement) => {
    const overlay = opts.overlayRef.current;
    const iframe = opts.iframeRef.current;
    return overlay && iframe && orientedGroupAwareOverlayRect(overlay, iframe, element);
  };

  const startGroupDrag = (e: React.PointerEvent<HTMLElement>) => {
    const items = opts.groupOverlayItemsRef.current;
    return startOnShownPreview(
      e,
      () =>
        items.flatMap((item) => {
          const selection = shownSelection(item.selection);
          return selection ? [selection.element] : [];
        }),
      (pressed, at, waited) => {
        if (!waited) return _startGroupDrag(pressed, opts, at);
        const overlay = opts.overlayRef.current;
        const iframe = opts.iframeRef.current;
        if (!overlay || !iframe) return false;
        const scale = computeOverlayRootScale(overlay, iframe, iframe.contentDocument);
        const measured = items.flatMap((item) => {
          const selection = shownSelection(item.selection);
          const rect =
            selection && orientedGroupAwareOverlayRect(overlay, iframe, selection.element, scale);
          return selection && rect
            ? [{ ...item, selection, element: selection.element, rect }]
            : [];
        });
        if (measured.length !== items.length) return false;
        return _startGroupDrag(
          pressed,
          { ...opts, groupOverlayItemsRef: { current: measured } },
          at,
        );
      },
      (dx, dy) =>
        opts.setGroupOverlayItems(
          items.map((item) => ({ ...item, rect: shiftedOverlayRect(item.rect, dx, dy) })),
        ),
    );
  };
  const startGesture = (
    kind: GestureKind,
    e: React.PointerEvent<HTMLElement>,
    options?: {
      selection?: DomEditSelection;
      rect?: OverlayRect | null;
      resizeHandle?: ResizeHandle;
    },
  ) => {
    // A replay edits what was pressed, though another element may be selected by then.
    const target = options?.selection ?? opts.selectionRef.current;
    let draw: WaitingPressState["draw"] = null;
    if (kind === "drag") draw = drawPressedBox(opts.overlayRectRef.current);
    if (kind === "resize")
      draw = drawResizedBox(opts.overlayRectRef.current, { x: e.clientX, y: e.clientY });
    return startOnShownPreview(
      e,
      () => {
        const shown = target && shownSelection(target);
        return shown ? [shown.element] : [];
      },
      (pressed, at, waited) => {
        if (!waited) return _startGesture(kind, pressed, opts, { ...options, at });
        const selection = target && shownSelection(target);
        const rect = selection && shownRect(selection.element);
        return (
          !!(selection && rect) &&
          _startGesture(kind, pressed, opts, {
            selection,
            rect,
            resizeHandle: options?.resizeHandle,
            at,
          })
        );
      },
      draw,
    );
  };

  return { startGesture, startGroupDrag, endWaitingPress, endHeldPress, releaseWaitingPress };
}
