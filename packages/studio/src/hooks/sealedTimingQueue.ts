import { previewFrameOpaque, previewRequest } from "../player/lib/previewChannel";
import { applySoftReloadFinalization } from "../utils/gsapSoftReload";

const sealedWrites = new WeakMap<HTMLIFrameElement, Promise<unknown>>();
const missedPatches = new WeakSet<HTMLIFrameElement>();

/** A sealed frame's timing writes and reads run one after another, in the order the edit made them. */
export function inOrder(iframe: HTMLIFrameElement, step: () => Promise<unknown>): void {
  const next = (sealedWrites.get(iframe) ?? Promise.resolve()).then(step).catch(() => undefined);
  sealedWrites.set(iframe, next);
}

/** A live timing patch that did not land: the next rebind reloads the saved file instead. */
export function noteTimingPatch(iframe: HTMLIFrameElement, applied: boolean): void {
  if (!applied) missedPatches.add(iframe);
}

export function rebindIframeTiming(
  iframe: HTMLIFrameElement | null,
  currentTime: number,
  reload: () => void,
): void {
  if (iframe && previewFrameOpaque(iframe)) {
    inOrder(iframe, async () => {
      const missed = missedPatches.delete(iframe);
      const answer = missed
        ? null
        : await previewRequest(iframe, "rebind-timing", { time: currentTime });
      if (answer?.rebound !== true) reload();
    });
    return;
  }
  const missed = iframe !== null && missedPatches.delete(iframe);
  if (missed || !applySoftReloadFinalization(iframe, currentTime)) reload();
}
