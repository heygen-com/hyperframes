const holds = new WeakMap<HTMLIFrameElement, Set<symbol>>();
const canvasHolds = new WeakMap<HTMLIFrameElement, Set<symbol>>();
const reclaims = new WeakMap<HTMLIFrameElement, () => void>();

export function hasSealedCanvasKeyboardHold(iframe: HTMLIFrameElement): boolean {
  return Boolean(canvasHolds.get(iframe)?.size);
}

export function keepKeyboardOutOfSealedFrame(iframe: HTMLIFrameElement): () => void {
  const studioWindow = iframe.ownerDocument.defaultView;
  let attached = true;
  // Chrome drops a blur while focus is still moving into the frame; on the next task the move has settled.
  const reclaim = () =>
    studioWindow?.setTimeout(() => {
      const holder = (iframe.getRootNode() as Document | ShadowRoot).activeElement;
      if (attached && !holds.get(iframe)?.size && holder === iframe) iframe.blur();
    }, 0);
  reclaims.set(iframe, reclaim);
  reclaim();
  studioWindow?.addEventListener("blur", reclaim);
  return () => {
    attached = false;
    // Studio re-attaches on the same frame as it re-syncs; only a frame that left the page drops its edit's hold.
    if (!iframe.isConnected) {
      holds.delete(iframe);
      canvasHolds.delete(iframe);
    }
    if (reclaims.get(iframe) === reclaim) reclaims.delete(iframe);
    studioWindow?.removeEventListener("blur", reclaim);
  };
}

export function holdSealedFrameKeyboard(iframe: HTMLIFrameElement): () => void {
  const session = Symbol("sealed text edit");
  const root = () => iframe.getRootNode() as Document | ShadowRoot;
  const opener = root().activeElement;
  holds.set(iframe, (holds.get(iframe) ?? new Set()).add(session));
  const release = () => {
    iframe.removeEventListener("load", release);
    if (!holds.get(iframe)?.delete(session)) return;
    const keysBackToOpener = !holds.get(iframe)?.size && root().activeElement === iframe;
    if (
      keysBackToOpener &&
      opener instanceof HTMLElement &&
      opener !== iframe.ownerDocument.body &&
      opener.isConnected
    )
      opener.focus({ preventScroll: true });
    reclaims.get(iframe)?.();
  };
  iframe.addEventListener("load", release, { once: true });
  return release;
}

/** Holds keyboard focus in the sealed iframe for an active canvas selection; releases on blur/clear/load. */
export function holdSealedCanvasKeyboard(iframe: HTMLIFrameElement): () => void {
  const session = Symbol("sealed canvas keys");
  holds.set(iframe, (holds.get(iframe) ?? new Set()).add(session));
  canvasHolds.set(iframe, (canvasHolds.get(iframe) ?? new Set()).add(session));
  const release = () => {
    iframe.removeEventListener("load", release);
    canvasHolds.get(iframe)?.delete(session);
    if (!holds.get(iframe)?.delete(session)) return;
    reclaims.get(iframe)?.();
  };
  iframe.addEventListener("load", release, { once: true });
  return release;
}
