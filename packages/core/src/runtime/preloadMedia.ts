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

/** Ends a fetch in flight for good, which preload none alone does not. */
export function stopMediaDownload(media: HTMLMediaElement): void {
  for (const source of media.querySelectorAll("source")) source.remove();
  media.removeAttribute("src");
  media.load();
}

/** Stops a clip's fetch and keeps its src. A clip on <source> children is left alone: putting them
 * back restarts the download and reorders the markup a scene swap compares. */
export function releaseMedia(media: HTMLMediaElement): void {
  if (media.querySelector("source")) return;
  const src = media.getAttribute("src");
  stopMediaDownload(media);
  if (src !== null) media.setAttribute("src", src);
}

export function lengthIsAuthored(media: Element): boolean {
  return parseStrictFiniteTimingNumber(media.getAttribute("data-duration")) != null;
}

type DeferralWindow = Window & { __hfMediaDeferral?: MutationObserver };

/** Preview only: later clips parse at preload none, as Chromium ignores a none set mid-fetch.
 * One watcher per page: a runtime evaluated again replaces the last one's. */
export function deferMediaUntilDue(): void {
  const win = window as DeferralWindow;
  win.__hfMediaDeferral?.disconnect();
  win.__hfMediaDeferral = undefined;
  if (!skipsHiddenImages()) return;
  const defer = (el: Element) => {
    const start = parseStrictFiniteTimingNumber(el.getAttribute("data-start"));
    if (start != null && start > 0 && lengthIsAuthored(el))
      (el as HTMLMediaElement).preload = "none";
  };
  win.__hfMediaDeferral = new MutationObserver((records) => {
    for (const record of records)
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        const el = node as Element;
        if (el.matches("video, audio")) defer(el);
        for (const media of el.querySelectorAll("video, audio")) defer(media);
      }
  });
  win.__hfMediaDeferral.observe(document.documentElement, { childList: true, subtree: true });
}
