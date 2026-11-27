import { previewFrameOpaque, previewRequest } from "../player/lib/previewChannel";
import { applySoftReloadFinalization } from "../utils/gsapSoftReload";

const sealedWrites = new WeakMap<HTMLIFrameElement, { last: Promise<unknown>; waiting: number }>();
const missedPatches = new WeakSet<HTMLIFrameElement>();

/** A sealed frame's timing writes and reads run one after another, in the order the edit made them. */
export function inOrder(iframe: HTMLIFrameElement, step: () => Promise<unknown>): void {
  const writes = sealedWrites.get(iframe) ?? { last: Promise.resolve(), waiting: 0 };
  writes.waiting++;
  writes.last = writes.last
    .then(step)
    .catch(() => undefined)
    .finally(() => writes.waiting--);
  sealedWrites.set(iframe, writes);
}

/** True while a sealed frame has timing writes or reads queued that have not finished. */
export function writesWaiting(iframe: HTMLIFrameElement): boolean {
  return (sealedWrites.get(iframe)?.waiting ?? 0) > 0;
}

/** A live timing patch that did not land: the next rebind reloads the saved file instead. */
export function noteTimingPatch(iframe: HTMLIFrameElement, applied: boolean): void {
  if (!applied) missedPatches.add(iframe);
}

export function rebindIframeTiming(
  iframe: HTMLIFrameElement | null,
  currentTime: () => number,
  reload: () => void,
): void {
  if (iframe && previewFrameOpaque(iframe)) {
    inOrder(iframe, async () => {
      const missed = missedPatches.delete(iframe);
      const answer = missed
        ? null
        : await previewRequest(iframe, "rebind-timing", { time: currentTime() });
      if (answer?.rebound !== true) reload();
    });
    return;
  }
  const missed = iframe !== null && missedPatches.delete(iframe);
  if (missed || !applySoftReloadFinalization(iframe, currentTime())) reload();
}
