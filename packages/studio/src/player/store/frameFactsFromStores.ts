import { frameFactsChanged } from "../lib/frameFacts";
import { usePlayerStore } from "./playerStore";
import { usePreviewIframeStore } from "./previewIframeStore";

let watching = false;
let sized: ResizeObserver | null = null;

/** The stores' frame facts. Installed at runtime by the first cache, so load order never reaches a store early. */
export function watchStoreFrameFacts(): void {
  if (watching) return;
  watching = true;
  usePlayerStore.subscribe((state, before) => {
    if (state.currentTime !== before.currentTime || state.isPlaying !== before.isPlaying)
      frameFactsChanged("time");
  });
  usePreviewIframeStore.subscribe(({ iframe }, before) => {
    if (iframe === before.iframe) return;
    frameFactsChanged("load");
    sized?.disconnect();
    if (!iframe || typeof ResizeObserver === "undefined") return void (sized = null);
    let alreadySized = true;
    sized = new ResizeObserver(() =>
      alreadySized ? (alreadySized = false) : frameFactsChanged("size"),
    );
    sized.observe(iframe);
  });
}
