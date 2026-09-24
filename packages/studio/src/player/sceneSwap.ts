type SwapWindow = Window & { __hfSwapScenes?: (html: string) => Promise<void> };

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
  };
}
