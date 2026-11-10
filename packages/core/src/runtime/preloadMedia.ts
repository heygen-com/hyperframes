import { parseStrictFiniteTimingNumber, readMediaStart } from "./playbackRate";
import {
  authoredSrcOf,
  isHeldUntilDue,
  isOpenedAtInPoint,
  recordOpenedAtInPoint,
  unproxiedSrc,
} from "./proxySrc";
import { createRuntimeStartTimeResolver } from "./startResolver";
import { readMediaRenderId } from "./renderFrameSibling";
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
  if (heldWhenIdle.has(media) && isOpenedAtInPoint(media)) return holdUntilDue(media);
  const src = media.getAttribute("src");
  stopMediaDownload(media);
  if (src !== null) media.setAttribute("src", src);
}

export function lengthIsAuthored(media: Element): boolean {
  return parseStrictFiniteTimingNumber(media.getAttribute("data-duration")) != null;
}

// WebKit reads about 35 MB from the head of the file for each fresh element, so only a file larger than that
// loses anything to the head reads.
const LONG_SOURCE_BYTES = 32 * 1024 * 1024;
const sourceBytes = new Map<string, Promise<number | null>>();

const knownBytes = new Map<string, number>();

/** True once the clip's file is known to be long; false while its size is unknown. */
export function isLongSource(el: Element): boolean {
  const src = unproxiedSrc(el);
  if (!src) return false;
  try {
    return (knownBytes.get(new URL(src, document.baseURI).href) ?? 0) >= LONG_SOURCE_BYTES;
  } catch {
    return false;
  }
}

/** The size of a file in bytes from a one-byte range request, or null where the page cannot read it. */
export function bytesOfSource(src: string): Promise<number | null> {
  let url: string;
  try {
    url = new URL(src, document.baseURI).href;
  } catch {
    return Promise.resolve(null);
  }
  const known = sourceBytes.get(url);
  if (known) return known;
  const asked = (async () => {
    const abort = new AbortController();
    try {
      const response = await fetch(url, { headers: { Range: "bytes=0-0" }, signal: abort.signal });
      const total =
        /\/(\d+)$/.exec(response.headers.get("content-range") ?? "")?.[1] ??
        (response.status === 200 ? response.headers.get("content-length") : null);
      if (total === null) return null;
      knownBytes.set(url, Number(total));
      return Number(total);
    } catch {
      return null;
    } finally {
      abort.abort();
    }
  })();
  sourceBytes.set(url, asked);
  return asked;
}

function openAtInPoint(el: HTMLMediaElement): void {
  const src = el.getAttribute("src");
  const start = readMediaStart(el);
  // Only the player: Studio copies and saves what it reads from the page, and must never see the fragment.
  if (!inPlayerFrame(document) || !src || src.includes("#") || el.loop) return;
  if (el.querySelector("source")) return;
  if (!(start > 0)) return;
  const written = `${src}#t=${start}`;
  recordOpenedAtInPoint(el, src, written);
  el.setAttribute("src", written);
}

// Later clips of a long file: WebKit opens the file for any clip that has a src, whatever its preload.
const heldWhenIdle = new WeakSet<HTMLMediaElement>();

function holdUntilDue(el: HTMLMediaElement): void {
  const authored = unproxiedSrc(el);
  if (authored === null) return;
  recordOpenedAtInPoint(el, authored, null);
  stopMediaDownload(el);
}

/** A held clip gets its src back, opening at its in-point, once the runtime decides it is due. */
export function giveBackWhenDue(el: HTMLMediaElement): void {
  if (!isHeldUntilDue(el)) return;
  const authored = authoredSrcOf(el)!;
  const start = readMediaStart(el);
  const written = start > 0 ? `${authored}#t=${start}` : authored;
  recordOpenedAtInPoint(el, authored, written);
  el.setAttribute("src", written);
}

/** A clip of a long file opens at its in-point; a later one holds no src until it is due, so only the clips
 * on screen and the next take read the file at once. A short file is left as it is. */
export function openLongSourceAtInPoint(el: HTMLMediaElement, later: boolean, opened: () => void): void {
  const src = el.getAttribute("src");
  if (!isWebKit() || !inPlayerFrame(document) || !src) return;
  void bytesOfSource(src).then((bytes) => {
    if (bytes === null || bytes < LONG_SOURCE_BYTES || el.getAttribute("src") !== src) return;
    const idle = el.preload === "none" && el.networkState !== 2;
    if (later && idle && !src.includes("#") && !el.loop && !el.querySelector("source")) {
      heldWhenIdle.add(el);
      holdUntilDue(el);
      return;
    }
    openAtInPoint(el);
    if (isOpenedAtInPoint(el)) opened();
  });
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
    const authoredPreload = media.preload;
    const later = startInFilm(el) > 0;
    if (later) media.preload = "none";
    openLongSourceAtInPoint(media, later, () => {
      media.preload = authoredPreload;
    });
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
