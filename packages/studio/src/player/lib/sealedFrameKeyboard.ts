const framesHoldingKeyboard = new WeakSet<HTMLIFrameElement>();

export function letStudioTextEditHoldKeyboardInSealedFrame(iframe: HTMLIFrameElement): () => void {
  framesHoldingKeyboard.add(iframe);
  return () => framesHoldingKeyboard.delete(iframe);
}

/** A sealed frame's key reports are its own word, so it never keeps the keyboard: focus goes back to Studio. */
export function keepKeyboardOutOfSealedFrame(iframe: HTMLIFrameElement): () => void {
  const studioWindow = iframe.ownerDocument.defaultView;
  const reclaim = () => {
    const holder = (iframe.getRootNode() as Document | ShadowRoot).activeElement;
    if (holder === iframe && !framesHoldingKeyboard.has(iframe)) iframe.blur();
  };
  reclaim();
  studioWindow?.addEventListener("blur", reclaim);
  return () => studioWindow?.removeEventListener("blur", reclaim);
}
