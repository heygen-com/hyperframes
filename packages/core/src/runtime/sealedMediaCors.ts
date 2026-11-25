import { mediaElementTime } from "./mediaClock";
import { forgetRuntimeAttribute, recordRuntimeAttribute } from "./runtimeAttributes";
import { loadedByRuntime, runtimeLoad } from "./runtimeLoad";

// A sealed preview's document has an opaque origin, so its own server's media is cross-origin to it. Without
// `crossorigin` the browser loads that media in no-cors mode: WebGL and canvases refuse its frames, Web Audio treats it
// as foreign. The preview server answers CORS loads from an opaque origin, so its own media opts in; other hosts don't.

const isMedia = (el: Element): el is HTMLMediaElement =>
  el.localName === "video" || el.localName === "audio";

function originOf(url: string, base: string): string | null {
  try {
    return new URL(url, base).origin;
  } catch {
    return null;
  }
}

const resolved = (src: string, home: string) => {
  try {
    return new URL(src, home).href;
  } catch {
    return src;
  }
};

// Per element, never shared: a source that refused CORS here, and one that failed both ways, its host down.
const refused = new WeakMap<HTMLMediaElement, Set<string>>();
const down = new WeakMap<HTMLMediaElement, Set<string>>();
const warned = new WeakMap<HTMLMediaElement, Set<string>>();
const seen = new WeakSet<HTMLMediaElement>();
// A crossorigin change we did not write, even to our own value, makes the attribute the composition's for good.
const authored = new WeakSet<HTMLMediaElement>();
const pendingWrites = new WeakMap<HTMLMediaElement, number>();
const pendingPlays = new WeakMap<HTMLMediaElement, Set<object>>();
const retryOf = new WeakMap<object, Promise<void>>();
let nativePlay: HTMLMediaElement["play"];
let nativeLoad: HTMLMediaElement["load"];

function setOf<T>(map: WeakMap<HTMLMediaElement, Set<T>>, media: HTMLMediaElement): Set<T> {
  let set = map.get(media);
  if (!set) map.set(media, (set = new Set()));
  return set;
}

const has = (map: WeakMap<HTMLMediaElement, Set<string>>, media: HTMLMediaElement, url: string) =>
  map.get(media)?.has(url) ?? false;

function candidate(media: HTMLMediaElement, el: HTMLSourceElement, home: string): string | null {
  const src = el.getAttribute("src");
  const type = el.getAttribute("type");
  const query = el.getAttribute("media");
  const playable = !type || (type !== PINNED_OUT && media.canPlayType(type));
  if (!src || !playable || (query && !matchMedia(query).matches)) return null;
  return resolved(src, home);
}

function selectable(media: HTMLMediaElement, home: string): string[] {
  const own = media.getAttribute("src");
  if (media.hasAttribute("src")) return own ? [resolved(own, home)] : [];
  return [...media.querySelectorAll("source")].flatMap((el) => candidate(media, el, home) ?? []);
}

const isHome = (url: string, home: string) => originOf(url, home) === originOf(home, home);
// As unsealed Studio reads pixels: only the preview's own host; a list naming another host loads as written first.
const allHome = (urls: string[], home: string) =>
  urls.length > 0 && urls.every((url) => isHome(url, home));

function write(media: HTMLMediaElement, value: string | null): void {
  pendingWrites.set(media, (pendingWrites.get(media) ?? 0) + 1);
  if (value === null) {
    media.removeAttribute("crossorigin");
    forgetRuntimeAttribute(media, "crossorigin");
  } else {
    media.setAttribute("crossorigin", value);
    recordRuntimeAttribute(media, "crossorigin");
  }
}

function crossOriginChanged(media: HTMLMediaElement): void {
  const pending = pendingWrites.get(media) ?? 0;
  if (pending > 0) pendingWrites.set(media, pending - 1);
  else {
    authored.add(media);
    forgetRuntimeAttribute(media, "crossorigin");
  }
}

function setCors(media: HTMLMediaElement, want: boolean): void {
  if (want !== media.hasAttribute("crossorigin")) write(media, want ? "anonymous" : null);
}

function sync(media: HTMLMediaElement, home: string): void {
  if (!seen.has(media)) {
    seen.add(media);
    if (media.hasAttribute("crossorigin")) authored.add(media);
  }
  if (authored.has(media)) return;
  const urls = selectable(media, home);
  setCors(media, allHome(urls, home) && !has(refused, media, urls[0]!));
}

// load() resets the playhead, rate and play state; set in the same task, a later change by the composition wins.
function reload(media: HTMLMediaElement): void {
  const { currentTime, playbackRate, paused } = media;
  runtimeLoad(media);
  if (currentTime) media.currentTime = mediaElementTime(currentTime);
  media.playbackRate = playbackRate;
  if (paused) return;
  const retry = nativePlay.call(media);
  retry.catch(() => undefined);
  for (const play of pendingPlays.get(media) ?? []) retryOf.set(play, retry);
}

// The composition's play() settles with the playback our load retried, as it would without us: load() rejects it.
function play(this: HTMLMediaElement): Promise<void> {
  const token = {};
  const plays = setOf(pendingPlays, this);
  plays.add(token);
  const settle = (promise: Promise<void>): Promise<void> =>
    promise.catch((error: unknown) => {
      const retry = retryOf.get(token);
      retryOf.delete(token);
      if (retry) return settle(retry);
      throw error;
    });
  return settle(nativePlay.call(this)).finally(() => plays.delete(token));
}

// Only the composition's own load() tries a down source again, as the browser would; the runtime's keep the mark.
function load(this: HTMLMediaElement): void {
  if (!loadedByRuntime(this)) {
    down.delete(this);
    unpin(this);
  }
  nativeLoad.call(this);
}

function mediaOf(el: Element): HTMLMediaElement | null {
  if (isMedia(el)) return el;
  const parent = el.localName === "source" ? el.parentElement : null;
  return parent && isMedia(parent) ? parent : null;
}

function warnOnce(media: HTMLMediaElement, url: string): void {
  const said = setOf(warned, media);
  if (said.has(url)) return;
  said.add(url);
  console.warn(
    `[hyperframes] ${url} did not load with CORS, so it plays without: colour grading, canvas reads and ` +
      "audio effects are off for it. Serve it with Access-Control-Allow-Origin to keep them.",
  );
}

function failedUrl(media: HTMLMediaElement, el: Element, home: string): string {
  const own = media.getAttribute("src");
  return el !== media
    ? (el as HTMLSourceElement).src
    : own
      ? resolved(own, home)
      : media.currentSrc;
}

// Refused with CORS: drop it at once, so the browser picks as it would without us. Failed without too: host down.
function failure(event: Event, home: string): { media: HTMLMediaElement; url: string } | null {
  const el = event.target as Element | null;
  const media = el?.nodeType === 1 ? mediaOf(el) : null;
  if (!el || !media || authored.has(media)) return null;
  const url = failedUrl(media, el, home);
  return url && selectable(media, home).includes(url) ? { media, url } : null;
}

function wasDown(media: HTMLMediaElement, url: string): void {
  if (setOf(refused, media).delete(url)) setOf(down, media).add(url);
}

const PINNED_OUT = "video/x-hyperframes-pinned-out";
const pinned = new WeakMap<HTMLMediaElement, Array<[HTMLSourceElement, string | null]>>();
const erredThisPick = new WeakMap<HTMLMediaElement, Set<Element>>();

function pinTo(media: HTMLMediaElement, keep: Element | null): void {
  if (!keep || keep === media) return;
  const held: Array<[HTMLSourceElement, string | null]> = [];
  for (const el of media.querySelectorAll("source")) {
    if (el === keep) break;
    held.push([el, el.getAttribute("type")]);
    el.setAttribute("type", PINNED_OUT);
  }
  if (held.length) pinned.set(media, held);
}

function playingSource(media: HTMLMediaElement, chosen: string, home: string): Element | null {
  const erred = erredThisPick.get(media);
  return (
    [...media.querySelectorAll("source")].find(
      (el) => candidate(media, el, home) === chosen && !erred?.has(el),
    ) ?? null
  );
}

function unpin(media: HTMLMediaElement): void {
  for (const [el, type] of pinned.get(media) ?? []) {
    if (el.getAttribute("type") !== PINNED_OUT) continue;
    if (type === null) el.removeAttribute("type");
    else el.setAttribute("type", type);
  }
  pinned.delete(media);
}

function pinnedOutError(target: Element | null): boolean {
  const owner = target?.nodeType === 1 ? mediaOf(target) : null;
  if (!owner) return false;
  if (target !== owner) setOf(erredThisPick, owner).add(target!);
  if (pinned.get(owner)?.some(([el]) => el === target)) return true;
  unpin(owner);
  return false;
}

function failed(event: Event, home: string): void {
  if (pinnedOutError(event.target as Element | null)) return;
  const found = failure(event, home);
  if (!found) return;
  const { media, url } = found;
  if (!media.hasAttribute("crossorigin")) return wasDown(media, url);
  if (has(down, media, url)) return;
  setOf(refused, media).add(url);
  write(media, null);
  pinTo(media, event.target as Element);
  reload(media);
}

function optIn(media: HTMLMediaElement, chosen: string, home: string): void {
  write(media, "anonymous");
  pinTo(media, playingSource(media, chosen, home));
  reload(media);
}

const probed = new WeakMap<HTMLMediaElement, Set<string>>();
const probing = new WeakMap<HTMLMediaElement, Set<string>>();

function askHost(media: HTMLMediaElement, url: string, home: string): void {
  if (!isHome(url, home)) return warnOnce(media, url);
  const asked = setOf(probed, media);
  if (asked.has(url)) return has(probing, media, url) ? undefined : warnOnce(media, url);
  asked.add(url);
  setOf(probing, media).add(url);
  const answered = () => probing.get(media)?.delete(url);
  fetch(url, { method: "HEAD", mode: "cors", cache: "no-store", redirect: "error" }).then(
    (answer) => {
      answered();
      if (!answer.ok) return warnOnce(media, url);
      const still = media.currentSrc === url && !media.hasAttribute("crossorigin");
      if (!still || authored.has(media) || !selectable(media, home).includes(url)) return;
      setOf(refused, media).delete(url);
      optIn(media, url, home);
    },
    () => {
      answered();
      warnOnce(media, url);
    },
  );
}

// Played without CORS from our own host: opt back in; refused here once, ask the host once if that was a refusal.
function firstFrame(event: Event, home: string): void {
  const media = event.target as HTMLMediaElement;
  if (!isMedia(media) || authored.has(media)) return;
  unpin(media);
  const chosen = media.currentSrc;
  down.get(media)?.delete(chosen);
  if (media.hasAttribute("crossorigin")) return;
  if (has(refused, media, chosen)) return askHost(media, chosen, home);
  if (!isHome(chosen, home) || !selectable(media, home).includes(chosen)) return;
  optIn(media, chosen, home);
}

// Chrome tries an exhausted element's sources again on a crossorigin write; only an insertion resumes it.
const resumes = (media: HTMLMediaElement, record: MutationRecord) =>
  record.addedNodes.length > 0 || media.networkState !== HTMLMediaElement.NETWORK_NO_SOURCE;

function changed(record: MutationRecord, home: string): void {
  const target = record.target as Element;
  if (record.type === "attributes") return visit(target, home);
  if (isMedia(target) && resumes(target, record)) sync(target, home);
  record.addedNodes.forEach((node) => visit(node, home));
}

function visit(node: Node, home: string): void {
  if (node.nodeType !== 1) return;
  const el = node as Element;
  const media = mediaOf(el);
  if (media) sync(media, home);
  for (const inner of el.querySelectorAll("video, audio")) sync(inner as HTMLMediaElement, home);
}

let home = "";
// One function each, so a second start adds no second listener.
const onError = (event: Event) => failed(event, home);
const onFirstFrame = (event: Event) => firstFrame(event, home);
const onPickStart = (event: Event) => erredThisPick.delete(event.target as HTMLMediaElement);

/** In a sealed document, opts the preview server's own media into CORS as it parses or changes src, before it loads;
 * a source that refuses CORS on an element plays there without it, after one more load. */
export function corsForSealedMedia(): MutationObserver | null {
  if (
    typeof MutationObserver === "undefined" ||
    typeof document === "undefined" ||
    window.origin !== "null"
  )
    return null;
  home = document.baseURI;
  // Every crossorigin change in a batch is accounted for first, so an author's write beside a src change wins.
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.attributeName === "crossorigin" && isMedia(record.target as Element))
        crossOriginChanged(record.target as HTMLMediaElement);
    }
    for (const record of records) if (record.attributeName !== "crossorigin") changed(record, home);
  });
  // Observing first: the writes the first scan makes are counted against their own records.
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src", "crossorigin"],
  });
  visit(document.documentElement, home);
  // Media events do not bubble; capture listeners on the document hear every element's.
  document.addEventListener("error", onError, true);
  document.addEventListener("loadeddata", onFirstFrame, true);
  document.addEventListener("loadstart", onPickStart, true);
  const media = HTMLMediaElement.prototype;
  if (media.play !== play) [nativePlay, media.play] = [media.play, play];
  if (media.load !== load) [nativeLoad, media.load] = [media.load, load];
  return observer;
}
