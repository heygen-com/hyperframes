type SwapWindow = Window & { __hfSwapScenes?: (html: string) => Promise<void> };

const SCENES_SWAPPED = "hf-scenes-swapped";

/**
 * Run `onReplaced` whenever the preview's content is replaced: a document load, or scenes swapped
 * in place. Anything holding preview DOM nodes must re-resolve them then. Returns the unsubscribe.
 */
export function onPreviewContentReplaced(
  iframe: HTMLIFrameElement,
  onReplaced: () => void,
): () => void {
  iframe.addEventListener("load", onReplaced);
  iframe.addEventListener(SCENES_SWAPPED, onReplaced);
  return () => {
    iframe.removeEventListener("load", onReplaced);
    iframe.removeEventListener(SCENES_SWAPPED, onReplaced);
  };
}

/**
 * The live preview's scene swap, or null when this preview cannot swap scenes. The swap fetches
 * the rebuilt preview document and asks the preview to swap in its changed scenes; it rejects when
 * only a full reload can show the change, or when `isCurrent()` turns false while the document
 * downloads (a newer reload owns the preview).
 */
export function sceneSwapFor(
  iframe: HTMLIFrameElement,
): ((url: string, isCurrent: () => boolean) => Promise<void>) | null {
  const win = iframe.contentWindow as SwapWindow | null;
  const swap = win?.__hfSwapScenes;
  if (typeof swap !== "function") return null;
  return async (url, isCurrent) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`preview request failed with ${response.status}`);
    const html = await response.text();
    if (!isCurrent()) throw new Error("superseded by a newer reload");
    await swap.call(win, html);
    iframe.dispatchEvent(new Event(SCENES_SWAPPED));
  };
}
