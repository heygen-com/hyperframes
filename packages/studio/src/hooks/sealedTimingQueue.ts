import { previewFrameOpaque, previewRequest } from "../player/lib/previewChannel";
import { applySoftReloadFinalization } from "../utils/gsapSoftReload";

const sealedWrites = new WeakMap<HTMLIFrameElement, Promise<unknown>>();

/** A sealed frame's timing writes and reads run one after another, in the order the edit made them. */
export function inOrder(iframe: HTMLIFrameElement, step: () => Promise<unknown>): void {
  const next = (sealedWrites.get(iframe) ?? Promise.resolve()).then(step).catch(() => undefined);
  sealedWrites.set(iframe, next);
}

export function rebindIframeTiming(
  iframe: HTMLIFrameElement | null,
  currentTime: number,
  reload: () => void,
): void {
  if (iframe && previewFrameOpaque(iframe)) {
    inOrder(iframe, async () => {
      const answer = await previewRequest(iframe, "rebind-timing", { time: currentTime });
      if (answer?.rebound !== true) reload();
    });
    return;
  }
  if (!applySoftReloadFinalization(iframe, currentTime)) reload();
}
