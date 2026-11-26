import { frameFactsChanged } from "../lib/frameFacts";
import { usePlayerStore } from "./playerStore";
import { usePreviewIframeStore } from "./previewIframeStore";

let watching = false;
let sized: ResizeObserver | null = null;

/** Raises the frame facts the stores own: the playhead and playback, the live frame and its size. Installed once,
 *  by the first cache of frame reads, so module load order cannot reach a store before it exists. */
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
    let first = true;
    // Its first report is the size the frame already had.
    sized = new ResizeObserver(() => (first ? (first = false) : frameFactsChanged("size")));
    sized.observe(iframe);
  });
}
