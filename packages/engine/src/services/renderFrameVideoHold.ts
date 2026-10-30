/** In-page, before any script: holds replaced videos at preload none from parse (Chrome ignores a later none). */
export function holdRenderFrameVideos(ids: readonly string[], renderIdAttr: string): void {
  const held = new Set(ids);
  (
    window as Window & { __HF_RENDER_FRAME_VIDEO_IDS?: readonly string[] }
  ).__HF_RENDER_FRAME_VIDEO_IDS = ids;
  const hold = (el: Element) => {
    if (el instanceof HTMLVideoElement && held.has(el.getAttribute(renderIdAttr) || el.id))
      el.preload = "none";
  };
  new MutationObserver((records) => {
    for (const record of records)
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        hold(node as Element);
        for (const video of (node as Element).querySelectorAll("video")) hold(video);
      }
  }).observe(document, { childList: true, subtree: true });
}
