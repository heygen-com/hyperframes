import { parseStrictFiniteTimingNumber, readMediaStart } from "./playbackRate";
import { createRuntimeStartTimeResolver } from "./startResolver";
import { readMediaRenderId } from "./renderFrameSibling";
import { defersMedia } from "./timedClipHide";
import { swallow } from "./diagnostics";

type PreloadableMedia = Pick<
  HTMLMediaElement,
  "id" | "tagName" | "getAttribute" | "preload" | "readyState" | "networkState" | "load"
>;

export function isRenderFrameVideo(
  media: Pick<Element, "getAttribute" | "id" | "tagName">,
): boolean {
  const ids = (window as Window & { __HF_RENDER_FRAME_VIDEO_IDS?: readonly string[] })
    .__HF_RENDER_FRAME_VIDEO_IDS;
  return media.tagName === "VIDEO" && ids?.includes(readMediaRenderId(media) ?? "") === true;
}

export function preloadMedia(media: PreloadableMedia): void {
  if (isRenderFrameVideo(media)) return;
  if (media.preload !== "auto") media.preload = "auto";
  // load() resets an in-flight video fetch, discarding its selected resource and buffered data.
  const videoAlreadyLoading = media.tagName === "VIDEO" && media.networkState === 2;
  if (media.readyState < 3 && !videoAlreadyLoading) media.load();
}

const pendingPlaybackStart = new WeakMap<HTMLMediaElement, () => void>();

function cancelPlaybackStart(media: HTMLMediaElement): void {
  pendingPlaybackStart.get(media)?.();
}

export function prepareUpcomingMedia(media: HTMLMediaElement, isUpcoming: () => boolean): void {
  cancelPlaybackStart(media);
  if (media.tagName !== "VIDEO" || isRenderFrameVideo(media)) return;
  const prepare = () => {
    if (!media.isConnected || !media.paused || media.seeking || !isUpcoming()) return;
    const start = readMediaStart(media);
    if (Math.abs(media.currentTime - start) <= 0.02) return;
    try {
      media.currentTime = start;
    } catch (error) {
      swallow("runtime.preload.playbackStart", error);
    }
  };
  if (media.readyState > 0) {
    prepare();
    return;
  }
  const cancel = () => {
    media.removeEventListener("loadedmetadata", loaded);
    media.removeEventListener("error", cancel);
    media.removeEventListener("abort", cancel);
    pendingPlaybackStart.delete(media);
  };
  const loaded = () => {
    cancel();
    prepare();
  };
  pendingPlaybackStart.set(media, cancel);
  media.addEventListener("loadedmetadata", loaded);
  media.addEventListener("error", cancel);
  media.addEventListener("abort", cancel);
}

/** Ends a fetch in flight for good, which preload none alone does not. */
export function stopMediaDownload(media: HTMLMediaElement): void {
  cancelPlaybackStart(media);
  for (const source of media.querySelectorAll("source")) source.remove();
  media.removeAttribute("src");
  media.load();
}

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
  if (!defersMedia()) return;
  const defer = (el: Element, startInFilm: (el: Element) => number) => {
    const start = parseStrictFiniteTimingNumber(el.getAttribute("data-start"));
    if (start != null && lengthIsAuthored(el) && startInFilm(el) > 0)
      (el as HTMLMediaElement).preload = "none";
  };
  win.__hfMediaDeferral = new MutationObserver((records) => {
    const startInFilm = createRuntimeStartTimeResolver({}).resolveMediaStartForElement;
    for (const record of records)
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        const el = node as Element;
        if (el.matches("video, audio")) defer(el, startInFilm);
        for (const media of el.querySelectorAll("video, audio")) defer(media, startInFilm);
      }
  });
  win.__hfMediaDeferral.observe(document.documentElement, { childList: true, subtree: true });
}
