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

// Per element, never shared: a source refused CORS here; this element reloaded once without CORS, or with, for it.
const refused = new WeakMap<HTMLMediaElement, Set<string>>();
const retriedWithout = new WeakMap<HTMLMediaElement, Set<string>>();
const rearmedFor = new WeakMap<HTMLMediaElement, Set<string>>();
const retrying = new WeakSet<HTMLMediaElement>();
const lastPlayed = new WeakMap<HTMLMediaElement, string>();
const warned = new WeakMap<HTMLMediaElement, Set<string>>();
const seen = new WeakSet<HTMLMediaElement>();
// A crossorigin change we did not write, even to our own value, makes the attribute the composition's for good.
const authored = new WeakSet<HTMLMediaElement>();
const pendingWrites = new WeakMap<HTMLMediaElement, number>();

function setOf(map: WeakMap<HTMLMediaElement, Set<string>>, media: HTMLMediaElement): Set<string> {
  let set = map.get(media);
  if (!set) map.set(media, (set = new Set()));
  return set;
}

function listedUrls(media: HTMLMediaElement, home: string): string[] {
  const sources = media.hasAttribute("src") ? [media] : [...media.querySelectorAll("source")];
  return sources.flatMap((el) => {
    const src = el.getAttribute("src");
    return src ? [resolved(src, home)] : [];
  });
}

// As unsealed Studio reads pixels: only the preview's own host, and only a source that has not refused CORS here.
const wantsCors = (media: HTMLMediaElement, url: string | undefined, home: string) =>
  Boolean(url) && originOf(url!, home) === originOf(home, home) && !refused.get(media)?.has(url!);

function write(media: HTMLMediaElement, value: string | null): void {
  pendingWrites.set(media, (pendingWrites.get(media) ?? 0) + 1);
  if (value === null) media.removeAttribute("crossorigin");
  else media.setAttribute("crossorigin", value);
}

function crossOriginChanged(media: HTMLMediaElement): void {
  const pending = pendingWrites.get(media) ?? 0;
  if (pending > 0) pendingWrites.set(media, pending - 1);
  else authored.add(media);
}

function setCors(media: HTMLMediaElement, want: boolean): void {
  if (want !== media.hasAttribute("crossorigin")) write(media, want ? "anonymous" : null);
}

// The guess for what the browser picks: what played last, else the first source that has not refused CORS here.
function guess(media: HTMLMediaElement, home: string): string | undefined {
  const urls = listedUrls(media, home);
  const played = lastPlayed.get(media);
  if (played && urls.includes(played)) return played;
  return urls.find((url) => !refused.get(media)?.has(url)) ?? urls[0];
}

function sync(media: HTMLMediaElement, home: string): void {
  if (!seen.has(media)) {
    seen.add(media);
    if (media.hasAttribute("crossorigin")) authored.add(media);
  }
  if (!authored.has(media)) setCors(media, wantsCors(media, guess(media, home), home));
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

// The browser's own word that it has nothing left to try: the element's error, or a source's with no source left.
const exhausted = (media: HTMLMediaElement, el: Element) =>
  el === media || media.networkState === HTMLMediaElement.NETWORK_NO_SOURCE;

// Down both ways, not refusing: forget it. No write: Chrome retries an exhausted element's sources on that change.
function wasDown(media: HTMLMediaElement, home: string): void {
  retrying.delete(media);
  for (const url of listedUrls(media, home)) {
    refused.get(media)?.delete(url);
    retriedWithout.get(media)?.delete(url);
    rearmedFor.get(media)?.delete(url);
  }
}

function ranOut(event: Event, home: string): void {
  const target = event.target as Node | null;
  if (target?.nodeType !== 1) return;
  const media = mediaOf(target as Element);
  if (!media || authored.has(media)) return;
  const armed = media.hasAttribute("crossorigin");
  const src = target === media ? media.currentSrc : (target as HTMLSourceElement).src;
  if (armed && src) setOf(refused, media).add(src);
  if (!exhausted(media, target as Element)) return;
  if (!armed) return void (retrying.has(media) && wasDown(media, home));
  const tried = setOf(retriedWithout, media);
  const retry = listedUrls(media, home).filter(
    (url) => refused.get(media)?.has(url) && !tried.has(url),
  );
  if (!retry.length) return;
  retry.forEach((url) => tried.add(url));
  retrying.add(media);
  write(media, null);
  media.load();
}

function firstFrame(event: Event, home: string): void {
  const media = event.target as HTMLMediaElement;
  if (!isMedia(media) || authored.has(media)) return;
  retrying.delete(media);
  const chosen = media.currentSrc;
  lastPlayed.set(media, chosen);
  const armed = media.hasAttribute("crossorigin");
  if (!armed && refused.get(media)?.has(chosen)) warnOnce(media, chosen);
  const tried = setOf(rearmedFor, media);
  if (armed || tried.has(chosen) || !wantsCors(media, chosen, home)) return;
  tried.add(chosen);
  write(media, "anonymous");
  media.load();
}

function visit(node: Node, home: string): void {
  if (node.nodeType !== 1) return;
  const el = node as Element;
  const media = mediaOf(el);
  if (media) sync(media, home);
  for (const inner of el.querySelectorAll("video, audio")) sync(inner as HTMLMediaElement, home);
}

/** In a sealed document, opts the preview server's own media into CORS as it parses or changes src, before it loads;
 * a source that refuses CORS on an element plays there without it, after one more load. */
export function corsForSealedMedia(): MutationObserver | null {
  if (
    typeof MutationObserver === "undefined" ||
    typeof document === "undefined" ||
    window.origin !== "null"
  )
    return null;
  const home = document.baseURI;
  // Every crossorigin change in a batch is accounted for first, so an author's write beside a src change wins.
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.attributeName === "crossorigin" && isMedia(record.target as Element))
        crossOriginChanged(record.target as HTMLMediaElement);
    }
    for (const record of records) {
      if (record.attributeName === "crossorigin") continue;
      const target = record.target as Element;
      if (record.type === "attributes") visit(target, home);
      // Chrome tries an exhausted element's sources again on a crossorigin write; only an insertion resumes it.
      else if (
        isMedia(target) &&
        (record.addedNodes.length || target.networkState !== HTMLMediaElement.NETWORK_NO_SOURCE)
      )
        sync(target, home);
      if (record.type === "childList") record.addedNodes.forEach((node) => visit(node, home));
    }
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
  document.addEventListener("error", (event) => ranOut(event, home), true);
  document.addEventListener("loadeddata", (event) => firstFrame(event, home), true);
  return observer;
}
