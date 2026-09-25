type SwapWindow = Window & { __hfSwapScenes?: (html: string) => Promise<void> };

const SCENES_SWAPPED = "hf-scenes-swapped";

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

/** Null when the preview cannot swap; the swap rejects when only a full reload shows the edit. */
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
