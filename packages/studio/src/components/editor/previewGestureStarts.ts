import { orientedGroupAwareOverlayRect, shiftedOverlayRect } from "./domEditOverlayGeometry";
import { findElementForSelection, type DomEditSelection } from "./domEditing";
import { computeOverlayRootScale } from "./domEditOverlayBasis";
import type { OverlayRect } from "./domEditOverlayGeometry";
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
import { isPreviewChanging } from "../../player/previewReloading";
import { playheadMoment } from "../../hooks/editMoment";
import type { EditMoment } from "./manualEditsTypes";

const MAX_SETTLED_WAIT_FRAMES = 60;

export function createPreviewGestureStarts(
  opts: UseDomEditOverlayGesturesOptions,
  moveActiveGesture: (e: React.PointerEvent<HTMLDivElement>) => void,
  releaseActiveGesture: (e: React.PointerEvent<HTMLDivElement>) => void,
) {
  const setDraftOverlayRect = opts.setOverlayRect;
  const setDraftGroupOverlayItems = opts.setGroupOverlayItems;
  const endWaitingPress = (press: WaitingPressState | null = opts.waitingPressRef.current) => {
    for (let p = press; p && !p.ended; p = p.after) {
      p.ended = true;
      cancelAnimationFrame(p.frame);
    }
    // A press queued behind this one keeps waiting.
    if (press !== opts.waitingPressRef.current) return;
    opts.waitingPressRef.current = null;
    opts.boxRef.current?.removeAttribute(PRESS_WAITING_ATTR);
    opts.rafPausedRef.current = false;
  };

  const drawPressedBox = (origin: OverlayRect | null): WaitingPressState["draw"] =>
    origin && ((dx, dy) => setDraftOverlayRect(shiftedOverlayRect(origin, dx, dy)));

  // A corner resize grows about the element's centre.
  const drawResizedBox = (
    origin: OverlayRect | null,
    handle: ResizeHandle = "se",
  ): WaitingPressState["draw"] => {
    const sx = handle.includes("e") ? 1 : -1;
    const sy = handle.includes("s") ? 1 : -1;
    return (
      origin &&
      ((dx, dy) =>
        setDraftOverlayRect({
          ...origin,
          left: origin.left - sx * dx,
          top: origin.top - sy * dy,
          width: Math.max(1, origin.width + 2 * sx * dx),
          height: Math.max(1, origin.height + 2 * sy * dy),
        }))
    );
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
      if (!lost && shownFrames < 2) {
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
        setDraftGroupOverlayItems(
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
    let draw: WaitingPressState["draw"] = null;
    if (kind === "drag") draw = drawPressedBox(opts.overlayRectRef.current);
    if (kind === "resize")
      draw = drawResizedBox(opts.overlayRectRef.current, options?.resizeHandle);
    return startOnShownPreview(
      e,
      () => {
        const element = opts.selectionRef.current?.element;
        return element ? [element] : [];
      },
      (pressed, at, waited) => {
        if (!waited) return _startGesture(kind, pressed, opts, { ...options, at });
        const selection = opts.selectionRef.current;
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

  return { startGesture, startGroupDrag, endWaitingPress };
}
