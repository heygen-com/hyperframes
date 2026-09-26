type SwapWindow = Window & { __hfSwapScenes?: (html: string) => Promise<void> };

const SCENES_SWAPPED = "hf-scenes-swapped";
export const SCENE_SWAP_MS = 5000;

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

/** Null when the preview cannot swap; rejects when superseded or a full reload is needed. */
export function sceneSwapFor(
  iframe: HTMLIFrameElement,
): ((url: string, isCurrent: () => boolean) => Promise<void>) | null {
  const win = iframe.contentWindow as SwapWindow | null;
  const swap = win?.__hfSwapScenes;
  if (typeof swap !== "function") return null;
  return async (url, isCurrent) => {
    const deadline = new AbortController();
    const timer = setTimeout(
      () => deadline.abort(new Error("the preview took too long to swap")),
      SCENE_SWAP_MS,
    );
    const swapping = (async () => {
      const response = await fetch(url, { signal: deadline.signal });
      if (!response.ok) throw new Error(`preview request failed with ${response.status}`);
      const html = await response.text();
      if (!isCurrent()) throw new Error("superseded by a newer reload");
      await swap.call(win, html);
    })();
    const expired = new Promise<never>((_resolve, reject) =>
      deadline.signal.addEventListener("abort", () => reject(deadline.signal.reason)),
    );
    try {
      await Promise.race([swapping, expired]);
    } finally {
      clearTimeout(timer);
    }
    iframe.dispatchEvent(new Event(SCENES_SWAPPED));
  };
}
