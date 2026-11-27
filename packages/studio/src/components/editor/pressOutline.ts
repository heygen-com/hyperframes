import type { RefObject } from "react";
import {
  PRESS_WAITING_ATTR,
  type UseDomEditOverlayGesturesOptions,
} from "./domEditOverlayGestures";
import { previewDraftsSent } from "./previewDrafts";

type OutlineRefs = Pick<
  UseDomEditOverlayGesturesOptions,
  "boxRef" | "rafPausedRef" | "iframeRef" | "waitingPressRef" | "gestureRef" | "groupGestureRef"
>;
type ReplayDrawWait = { frame: HTMLIFrameElement };
type PressWait = "frame" | "save";

function createPressOutline({
  boxRef,
  rafPausedRef,
  iframeRef,
  waitingPressRef,
  gestureRef,
  groupGestureRef,
}: OutlineRefs) {
  let drawWait: ReplayDrawWait | null = null;
  const heldDragDrawsBox = () => !!(gestureRef.current || groupGestureRef.current);
  const idle = () => {
    drawWait = null;
    boxRef.current?.removeAttribute(PRESS_WAITING_ATTR);
    rafPausedRef.current = heldDragDrawsBox();
  };
  const confirm = (wait: ReplayDrawWait): void =>
    void previewDraftsSent(wait.frame).then(() => {
      if (drawWait !== wait) return;
      const shown = iframeRef.current;
      if (shown && shown !== wait.frame) {
        wait.frame = shown;
        return confirm(wait);
      }
      idle();
    });
  return {
    idle,
    waitOnSave(reason: PressWait) {
      drawWait = null;
      boxRef.current?.setAttribute(PRESS_WAITING_ATTR, reason);
      rafPausedRef.current = true;
    },
    /** A replay ended: `drewIn` is the sealed frame its draws went to, null if none. */
    replayEnded(drewIn: HTMLIFrameElement | null) {
      if (waitingPressRef.current) return;
      if (!drewIn) return idle();
      drawWait = { frame: drewIn };
      confirm(drawWait);
    },
  };
}

const outlines = new WeakMap<RefObject<unknown>, ReturnType<typeof createPressOutline>>();

/** The waiting outline's one owner per overlay mount: idle, waiting on a save, or waiting on a replay's draw. */
export function pressOutlineOf(opts: OutlineRefs) {
  let outline = outlines.get(opts.waitingPressRef);
  if (!outline) outlines.set(opts.waitingPressRef, (outline = createPressOutline(opts)));
  return outline;
}
