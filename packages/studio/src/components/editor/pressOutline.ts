import type { RefObject } from "react";
import {
  PRESS_WAITING_ATTR,
  type UseDomEditOverlayGesturesOptions,
} from "./domEditOverlayGestures";
import { previewDraftsSent } from "./previewDrafts";

type OutlineRefs = Pick<UseDomEditOverlayGesturesOptions, "boxRef" | "rafPausedRef" | "iframeRef">;
type ReplayDrawWait = { frame: HTMLIFrameElement };

function createPressOutline({ boxRef, rafPausedRef, iframeRef }: OutlineRefs) {
  let drawWait: ReplayDrawWait | null = null;
  const idle = () => {
    drawWait = null;
    boxRef.current?.removeAttribute(PRESS_WAITING_ATTR);
    rafPausedRef.current = false;
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
    waitOnSave() {
      drawWait = null;
      boxRef.current?.setAttribute(PRESS_WAITING_ATTR, "true");
      rafPausedRef.current = true;
    },
    waitOnDraw(frame: HTMLIFrameElement) {
      drawWait = { frame };
      confirm(drawWait);
    },
  };
}

export type PressOutline = ReturnType<typeof createPressOutline>;

const outlines = new WeakMap<RefObject<unknown>, PressOutline>();

/** The waiting outline's one owner per overlay mount: idle, waiting on a save, or waiting on a replay's draw. */
export function pressOutlineOf(
  opts: OutlineRefs & Pick<UseDomEditOverlayGesturesOptions, "waitingPressRef">,
) {
  let outline = outlines.get(opts.waitingPressRef);
  if (!outline) outlines.set(opts.waitingPressRef, (outline = createPressOutline(opts)));
  return outline;
}
