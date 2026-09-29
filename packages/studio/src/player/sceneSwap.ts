type SwapWindow = Window & {
  __hfSwapScenes?: (html: string, signal?: AbortSignal) => Promise<void>;
};

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

export function markScenesStale(iframe: HTMLIFrameElement | null, files: readonly string[]): void {
  const doc = iframe?.contentDocument;
  const meta = doc?.querySelector<HTMLMetaElement>('meta[name="hf-scene-parts"]');
  if (!doc || !meta) return;
  let parts: { shared: string; scenes: Record<string, string> };
  try {
    parts = JSON.parse(meta.content);
  } catch {
    return;
  }
  for (const file of files) {
    const hosts = doc.querySelectorAll(`[data-composition-file="${CSS.escape(file)}"]`);
    if (hosts.length === 0 && file.endsWith(".html")) parts.shared = "";
    for (const host of hosts) {
      const scene = host.closest("[data-hf-scene]")?.getAttribute("data-hf-scene");
      if (scene && scene in parts.scenes) parts.scenes[scene] = "";
    }
  }
  meta.content = JSON.stringify(parts);
}

/** Null when the preview cannot swap; rejects when superseded, cancelled or a full reload is needed. */
export function sceneSwapFor(
  iframe: HTMLIFrameElement,
): ((url: string, isCurrent: () => boolean, cancel?: AbortSignal) => Promise<void>) | null {
  const win = iframe.contentWindow as SwapWindow | null;
  const swap = win?.__hfSwapScenes;
  if (typeof swap !== "function") return null;
  return async (url, isCurrent, cancel) => {
    if (cancel?.aborted) throw cancel.reason;
    const deadline = new AbortController();
    const timer = setTimeout(
      () => deadline.abort(new Error("the preview took too long to swap")),
      SCENE_SWAP_MS,
    );
    cancel?.addEventListener("abort", () => deadline.abort(cancel.reason), { once: true });
    const swapping = (async () => {
      const response = await fetch(url, { signal: deadline.signal });
      if (!response.ok) throw new Error(`preview request failed with ${response.status}`);
      const html = await response.text();
      if (!isCurrent()) throw new Error("superseded by a newer reload");
      // Aborted with the deadline, so a swap still waiting cannot land after the reload has begun.
      await swap.call(win, html, deadline.signal);
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
