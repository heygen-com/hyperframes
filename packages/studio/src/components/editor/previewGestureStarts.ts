import {
  orientedGroupAwareOverlayRect,
  shiftedOverlayRect,
  type OverlayRect,
} from "./domEditOverlayGeometry";
import { findElementForSelection, type DomEditSelection } from "./domEditing";
import { computeOverlayRootScale } from "./domEditOverlayBasis";
import { resolveCenterResizeScale } from "./domEditResizeLocal";
import {
  type WaitingPressState,
  type GestureKind,
  type ResizeHandle,
  type UseDomEditOverlayGesturesOptions,
  pressStillHeld,
} from "./domEditOverlayGestures";
import {
  startGesture as _startGesture,
  startGroupDrag as _startGroupDrag,
} from "./domEditOverlayStartGesture";
import { giveUpOnPreviewChange, isPreviewChanging } from "../../player/previewReloading";
import { isStudioEditSaving, setStudioWaitingPressCancel } from "../../utils/studioPendingEdits";
import { playheadMoment } from "../../hooks/editMoment";
import type { EditMoment } from "./manualEditsTypes";
import { previewFrameOpaque } from "../../player/lib/previewChannel";
import { pressOutlineOf } from "./pressOutline";
import {
  askShownGestureStarts,
  PRESS_WAIT_MAX_MS,
  UNANSWERED,
  unansweredMoveReason,
  shownFromRead,
  type OverChannel,
  type Shown,
} from "./previewGestureStartRead";
import { checkReadAheadWithFrame, gestureStartReadAhead } from "./gestureStartReadAhead";

type ShownStart = (
  e: React.PointerEvent<HTMLElement>,
  at: EditMoment,
  findAgain: boolean,
  overChannel?: OverChannel,
) => boolean;

const MAX_SETTLED_WAIT_FRAMES = 60;
export { PRESS_WAIT_MAX_MS };

const pollFirst = (
  channel: HTMLIFrameElement | null,
  press: WaitingPressState,
  poll: () => void,
) => {
  if (channel) poll();
  else press.frame = requestAnimationFrame(poll);
};

const namesReplacedPage = (iframe: HTMLIFrameElement | null, targets: DomEditSelection[]) => {
  const live = iframe?.contentDocument;
  return !!live && targets.some((target) => target.element.ownerDocument !== live);
};

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

  const outline = pressOutlineOf(opts);
  const clearWaitingMark = outline.idle;

  /** Points the press queued right behind `press` at `next` instead. */
  const unlink = (press: WaitingPressState, next: WaitingPressState | null) => {
    for (let p = opts.waitingPressRef.current; p; p = p.after)
      if (p.after === press) p.after = next;
  };

  const endWaitingPress = (
    press: WaitingPressState | null = opts.waitingPressRef.current,
    keepMark = false,
  ) => {
    for (let p = press; p && !p.ended; p = p.after) {
      p.ended = true;
      cancelAnimationFrame(p.frame);
    }
    if (press === opts.waitingPressRef.current) {
      opts.waitingPressRef.current = null;
      if (!keepMark) clearWaitingMark();
    }
    // A press queued behind this one keeps waiting, on nothing that has ended.
    else if (press) unlink(press, null);
    offerUndo();
  };

  /** The newest press goes: the outline shows the press before it, or the box before this one. */
  const showPressBefore = (press: WaitingPressState) => {
    const before = press.after;
    opts.waitingPressRef.current = before;
    const shown = before ?? press;
    const at = before?.moved;
    const [dx, dy] = at ? [at.clientX - shown.startX, at.clientY - shown.startY] : [0, 0];
    shown.draw?.(dx, dy);
    if (!before) clearWaitingMark();
  };

  /** Takes one press out of the queue. */
  const dropPress = (press: WaitingPressState): boolean => {
    if (press.ended) return false;
    press.ended = true;
    cancelAnimationFrame(press.frame);
    if (press === opts.waitingPressRef.current) showPressBefore(press);
    else unlink(press, press.after);
    offerUndo();
    return true;
  };

  /** Ends the press still held, if any; presses already released are finished edits and still land. */
  const endHeldPress = () => {
    const held = opts.waitingPressRef.current;
    if (pressStillHeld(held)) dropPress(held);
  };

  const releaseWaitingPress = (press: WaitingPressState, e: React.PointerEvent<HTMLDivElement>) => {
    press.released = e;
    offerUndo();
  };

  const drawPressedBox = (origin: OverlayRect | null): WaitingPressState["draw"] =>
    origin && ((dx, dy) => opts.setOverlayRect(shiftedOverlayRect(origin, dx, dy)));

  // A corner resize scales about the element's centre by the grabbed corner's distance from it, as the resize does.
  const drawResizedBox = (
    origin: OverlayRect | null,
    grabbed: { x: number; y: number },
  ): WaitingPressState["draw"] => {
    if (!origin) return null;
    const bounds = opts.overlayRef.current?.getBoundingClientRect();
    const centre = {
      x: (bounds?.left ?? 0) + origin.left + origin.width / 2,
      y: (bounds?.top ?? 0) + origin.top + origin.height / 2,
    };
    return (dx, dy) => {
      const pointer = { x: grabbed.x + dx, y: grabbed.y + dy };
      const scale = resolveCenterResizeScale({
        pointer,
        pointerStart: grabbed,
        centerStart: centre,
      });
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

  const startNow = (
    e: React.PointerEvent<HTMLElement>,
    at: EditMoment,
    iframe: HTMLIFrameElement | null,
    channel: HTMLIFrameElement | null,
    start: ShownStart,
    targets: () => DomEditSelection[],
    routeFromSnapshot: boolean,
  ): boolean | null => {
    if (opts.waitingPressRef.current) return null;
    if (!channel)
      return isPreviewChanging() ? null : start(e, at, namesReplacedPage(iframe, targets()));
    const overlay = opts.overlayRef.current;
    const selections = targets();
    const read = overlay && gestureStartReadAhead(opts, channel, selections, routeFromSnapshot);
    const shown = read && shownFromRead(read, channel, overlay, selections);
    if (!read || typeof shown !== "object" || !shown) return null;
    checkReadAheadWithFrame(channel, read);
    return start(e, at, true, shown);
  };

  // A press on the page a reload is replacing would edit it by its old rules: it starts on the new page instead.
  const startOnShownPreview = (
    e: React.PointerEvent<HTMLElement>,
    pressed: () => HTMLElement[],
    start: ShownStart,
    draw: WaitingPressState["draw"] = null,
    targets: () => DomEditSelection[] = () => [],
    routeFromSnapshot = false,
  ): boolean => {
    const at = playheadMoment();
    const iframe = opts.iframeRef.current;
    const channel = iframe && previewFrameOpaque(iframe) ? iframe : null;
    const now = startNow(e, at, iframe, channel, start, targets, routeFromSnapshot);
    if (now !== null) return now;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    // The press already holds the pointer, which may be up by the time the gesture starts.
    const held = { setPointerCapture() {} };
    const down = { ...e, currentTarget: held, preventDefault() {}, stopPropagation() {} };
    const before = opts.waitingPressRef.current;
    const press: WaitingPressState = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      draw,
      frame: 0,
      moved: null,
      released: null,
      after: before,
      ended: false,
      refused: false,
      drawBack: () => {
        if (before?.refused) before.drawBack();
        else draw?.(0, 0);
      },
    };
    opts.waitingPressRef.current = press;
    const onSave = !!press.after || isPreviewChanging() || isStudioEditSaving();
    outline.waitOnSave(onSave ? "save" : "frame");
    let shownFrames = 0;
    let settledFrames = 0;
    const since = performance.now();
    /** Counts this frame toward the shown and settled streaks; returns how many pressed elements remain. */
    const countFrame = () => {
      const elements = pressed();
      const live = opts.iframeRef.current?.contentDocument;
      const settled = !isPreviewChanging();
      const shown = settled && elements.every((el) => el.ownerDocument === live);
      shownFrames = shown ? shownFrames + 1 : 0;
      settledFrames = settled ? settledFrames + 1 : 0;
      return elements.length;
    };
    // An opaque frame's pressed elements are found over the channel of the frame shown once the preview settles.
    let overChannel: OverChannel | null | typeof UNANSWERED | undefined;
    let askedOf: HTMLIFrameElement | null = null;
    let asks = 0;
    const askShownFrame = () => {
      const frame = opts.iframeRef.current ?? channel!;
      if (askedOf === frame || asks >= 2) return;
      [askedOf, asks, overChannel] = [frame, asks + 1, undefined];
      void askShownGestureStarts(
        frame,
        opts.overlayRef.current,
        opts.activeCompositionPathRef.current,
        targets(),
        routeFromSnapshot,
      ).then((answer) => {
        if (askedOf !== frame) return;
        overChannel = answer;
        pollNow();
      });
    };
    const channelStep = (): "wait" | "lost" | "run" | "unanswered" => {
      const overdue = performance.now() - since > PRESS_WAIT_MAX_MS;
      if (overdue) giveUpOnPreviewChange();
      if (isPreviewChanging() && !overdue) return "wait";
      askShownFrame();
      if (overChannel === undefined) return "wait";
      if (overChannel === UNANSWERED) return "unanswered";
      return overChannel ? "run" : "lost";
    };
    const waitStep = (): "wait" | "lost" | "run" | "unanswered" => {
      if (press.after && !press.after.ended) return "wait";
      if (channel) return channelStep();
      const found = countFrame();
      // A change that never ends (a save with no reply) would hold every press: run on the page shown.
      const overdue = performance.now() - since > PRESS_WAIT_MAX_MS;
      if (overdue) giveUpOnPreviewChange();
      // The waiting outline stays drawn while replay measures the live element separately.
      if (found === 0 || settledFrames > MAX_SETTLED_WAIT_FRAMES) return "lost";
      return overdue || shownFrames >= 2 ? "run" : "wait";
    };
    const startsFrom = (step: "lost" | "run" | "unanswered"): OverChannel | undefined | false => {
      if (step !== "run") return false;
      return typeof overChannel === "object" && overChannel ? overChannel : undefined;
    };
    const poll = () => {
      if (press.ended) return;
      const step = waitStep();
      if (step === "wait") {
        press.frame = requestAnimationFrame(poll);
        return;
      }
      endWaitingPress(press, !!channel);
      const read = startsFrom(step);
      if (read === false) sayWhyNotStarted(step);
      outline.replayEnded(replay(read) && channel ? opts.iframeRef.current : null);
    };
    const pollNow = () => {
      cancelAnimationFrame(press.frame);
      poll();
    };
    const replay = (read: ReturnType<typeof startsFrom>): boolean => {
      const pointerDown = down as unknown as React.PointerEvent<HTMLElement>;
      if (read === false || !start(pointerDown, at, true, read)) return false;
      if (press.moved) moveActiveGesture(press.moved);
      if (press.released) releaseActiveGesture(press.released);
      return true;
    };
    const sayWhyNotStarted = (step: "lost" | "run" | "unanswered") => {
      if (step !== "unanswered" || !channel) return;
      press.refused = true;
      press.drawBack();
      const pressed = opts.selectionRef.current;
      if (pressed) opts.onBlockedMoveRef.current(pressed, unansweredMoveReason(channel));
    };
    pollFirst(channel, press, poll);
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
  const shownOnPage = (target: DomEditSelection | null): Shown | null => {
    const selection = target && shownSelection(target);
    const rect = selection && shownRect(selection.element);
    return selection && rect ? { selection, rect } : null;
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
      (pressed, at, findAgain, overChannel) => {
        if (!findAgain) return _startGroupDrag(pressed, opts, at);
        if (overChannel) {
          const measured = items.map((item, i) => ({ ...item, ...overChannel.shown[i]! }));
          return _startGroupDrag(
            pressed,
            { ...opts, groupOverlayItemsRef: { current: measured } },
            at,
            overChannel.snap,
          );
        }
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
      () => items.map((item) => item.selection),
    );
  };
  const startGesture = (
    kind: GestureKind,
    e: React.PointerEvent<HTMLElement>,
    options?: {
      selection?: DomEditSelection;
      rect?: OverlayRect | null;
      resizeHandle?: ResizeHandle;
      resizeCorner?: { x: number; y: number };
    },
  ) => {
    // A replay edits what was pressed, though another element may be selected by then.
    const target = options?.selection ?? opts.selectionRef.current;
    const pressedRect = opts.overlayRectRef.current;
    let draw: WaitingPressState["draw"] = null;
    if (kind === "drag") draw = drawPressedBox(pressedRect);
    if (kind === "resize")
      draw = drawResizedBox(pressedRect, options?.resizeCorner ?? { x: e.clientX, y: e.clientY });
    return startOnShownPreview(
      e,
      () => {
        const shown = target && shownSelection(target);
        return shown ? [shown.element] : [];
      },
      (pressed, at, findAgain, overChannel) => {
        if (!findAgain) return _startGesture(kind, pressed, opts, { ...options, at });
        const shown = overChannel ? overChannel.shown[0] : shownOnPage(target);
        return (
          !!shown &&
          _startGesture(kind, pressed, opts, {
            selection: shown.selection,
            rect: shown.rect,
            resizeHandle: options?.resizeHandle,
            resizeCorner: options?.resizeCorner,
            at,
            start: shown.start,
            snap: overChannel?.snap,
          })
        );
      },
      draw,
      () => (target ? [target] : []),
      kind === "resize",
    );
  };

  return { startGesture, startGroupDrag, endWaitingPress, endHeldPress, releaseWaitingPress };
}
