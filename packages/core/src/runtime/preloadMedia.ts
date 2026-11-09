import { parseStrictFiniteTimingNumber, readMediaStart } from "./playbackRate";
import { holdBackSrc, takeHeldBackSrc } from "./proxySrc";
import { createRuntimeStartTimeResolver } from "./startResolver";
import { readMediaRenderId } from "./renderFrameSibling";
import { isMediaElement } from "./domRealm";
import { defersMedia } from "./timedClipHide";
import { inPlayerFrame } from "../studioPreviewMark";
import { swallow } from "./diagnostics";
import { isWebKit, mediaElementTime } from "./mediaClock";

const MEDIA_EDGE_SECONDS = 0.1;

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
  if (isMediaElement(media)) restoreHeldBackSrc(media);
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
  if ((media.tagName !== "VIDEO" && !isWebKit()) || isRenderFrameVideo(media)) return;
  const prepare = () => {
    if (!media.isConnected || !media.paused || media.seeking || !isUpcoming()) return;
    const start = readMediaStart(media);
    if (Math.abs(media.currentTime - start) <= 0.02) return;
    try {
      media.currentTime = mediaElementTime(start);
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

function wholeFileBuffered(media: HTMLMediaElement): boolean {
  const { buffered, duration } = media;
  return (
    Number.isFinite(duration) &&
    duration > 0 &&
    buffered.length === 1 &&
    buffered.start(0) <= MEDIA_EDGE_SECONDS &&
    buffered.end(0) >= duration - MEDIA_EDGE_SECONDS
  );
}

export function releaseMedia(media: HTMLMediaElement, whenBuffered = false): void {
  if (media.querySelector("source") || (!whenBuffered && wholeFileBuffered(media))) return;
  const src = media.getAttribute("src");
  stopMediaDownload(media);
  if (src !== null) media.setAttribute("src", src);
}

export function lengthIsAuthored(media: Element): boolean {
  return parseStrictFiniteTimingNumber(media.getAttribute("data-duration")) != null;
}

/** WebKit reads about 35 MB from the head of the file for every element that has a src, however late the clip
 * is due, so a film of many cuts from one file moves many times its size and starves the clip on screen.
 * The player keeps a clip's src off until it is near. */
function holdBackUntilNear(el: HTMLMediaElement): void {
  const src = el.getAttribute("src");
  if (!inPlayerFrame(document) || !src || el.querySelector("source")) return;
  holdBackSrc(el, src);
  el.removeAttribute("src");
  // A load the parser started before this ran is only ended by a load of the now empty element.
  el.load();
}

/** Puts a held-back src on its element; true when there was one. The element loads only when preloaded. */
export function restoreHeldBackSrc(el: HTMLMediaElement): boolean {
  const src = takeHeldBackSrc(el);
  if (src === null) return false;
  el.setAttribute("src", src);
  return true;
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
    if (start == null || !lengthIsAuthored(el)) return;
    const media = el as HTMLMediaElement;
    if (startInFilm(el) <= 0) return;
    media.preload = "none";
    holdBackUntilNear(media);
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
  // A runtime loaded after the clips parsed missed them; WebKit has already begun their head reads.
  if (isWebKit()) {
    const startInFilm = createRuntimeStartTimeResolver({}).resolveMediaStartForElement;
    for (const media of document.querySelectorAll("video, audio")) defer(media, startInFilm);
  }
}
