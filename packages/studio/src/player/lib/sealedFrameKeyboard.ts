export function keepKeyboardOutOfSealedFrame(iframe: HTMLIFrameElement): () => void {
  const studioWindow = iframe.ownerDocument.defaultView;
  let attached = true;
  // Chrome drops a blur while focus is still moving into the frame; on the next task the move has settled.
  const reclaim = () =>
    studioWindow?.setTimeout(() => {
      const holder = (iframe.getRootNode() as Document | ShadowRoot).activeElement;
      if (attached && holder === iframe) iframe.blur();
    }, 0);
  reclaim();
  studioWindow?.addEventListener("blur", reclaim);
  return () => {
    attached = false;
    studioWindow?.removeEventListener("blur", reclaim);
  };
}
