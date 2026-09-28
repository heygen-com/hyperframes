import { parseStrictFiniteTimingNumber } from "./playbackRate";
import { skipsHiddenImages } from "./timedClipHide";

type PreloadableMedia = Pick<
  HTMLMediaElement,
  "tagName" | "preload" | "readyState" | "networkState" | "load"
>;

export function preloadMedia(media: PreloadableMedia): void {
  if (media.preload !== "auto") media.preload = "auto";
  // load() resets an in-flight video fetch, discarding its selected resource and buffered data.
  const videoAlreadyLoading = media.tagName === "VIDEO" && media.networkState === 2;
  if (media.readyState < 3 && !videoAlreadyLoading) media.load();
}

/** A clip whose window needs no metadata: an untrimmed one's length is read from its duration. */
export function waitsUnloaded(media: Element): boolean {
  return parseStrictFiniteTimingNumber(media.getAttribute("data-duration")) != null;
}

/** Studio's preview: a parsed clip after the first frame gets preload none before it can fetch, as
 * Chromium ignores a later none; the visibility pass arms it when due. */
export function deferMediaUntilDue(): void {
  const defer = (el: Element) => {
    const start = parseStrictFiniteTimingNumber(el.getAttribute("data-start"));
    if (start != null && start > 0 && waitsUnloaded(el)) (el as HTMLMediaElement).preload = "none";
  };
  new MutationObserver((records) => {
    if (!skipsHiddenImages()) return;
    for (const record of records)
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        const el = node as Element;
        if (el.matches("video, audio")) defer(el);
        for (const media of el.querySelectorAll("video, audio")) defer(media);
      }
  }).observe(document.documentElement, { childList: true, subtree: true });
}
