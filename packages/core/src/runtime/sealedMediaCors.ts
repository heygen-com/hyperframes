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

// What the helper has done to an element: armed CORS; dropped it and reloaded; played without it; or failed both ways.
type Fallback = "cors" | "retrying" | { playedWithout: string } | "failed";
const fallback = new WeakMap<HTMLMediaElement, Fallback>();
// A crossorigin change we did not write, even to our own value, makes the attribute the composition's for good.
const authored = new WeakSet<HTMLMediaElement>();
const pendingWrites = new WeakMap<HTMLMediaElement, number>();
const playedOnlyWithoutCors = new Set<string>();

function listedUrls(media: HTMLMediaElement, home: string): string[] {
  const sources = media.hasAttribute("src") ? [media] : [...media.querySelectorAll("source")];
  return sources.flatMap((el) => {
    const src = el.getAttribute("src");
    return src ? [resolved(src, home)] : [];
  });
}

function wantsCors(media: HTMLMediaElement, home: string): boolean {
  const urls = listedUrls(media, home);
  const own = originOf(home, home);
  if (!urls.length || !urls.every((url) => originOf(url, home) === own)) return false;
  return !urls.every((url) => playedOnlyWithoutCors.has(url));
}

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

function ownedByAuthor(media: HTMLMediaElement, current: Fallback | undefined): boolean {
  if (authored.has(media)) return true;
  if (!media.hasAttribute("crossorigin") || current === "cors") return false;
  authored.add(media);
  return true;
}

function armCors(media: HTMLMediaElement, want: boolean, armed: boolean): void {
  if (want === armed) return;
  write(media, want ? "anonymous" : null);
  if (want) fallback.set(media, "cors");
  else fallback.delete(media);
}

function sync(media: HTMLMediaElement, home: string): void {
  const current = fallback.get(media);
  if (ownedByAuthor(media, current) || (current !== undefined && current !== "cors")) return;
  armCors(media, wantsCors(media, home), current === "cors");
}

// The parser can add a <source> after its media element, and a script can change either's src.
function mediaOf(el: Element): HTMLMediaElement | null {
  if (isMedia(el)) return el;
  const parent = el.localName === "source" ? el.parentElement : null;
  return parent && isMedia(parent) ? parent : null;
}

function remember(url: string): void {
  if (playedOnlyWithoutCors.has(url)) return;
  playedOnlyWithoutCors.add(url);
  console.warn(
    `[hyperframes] ${url} did not load with CORS, so it plays without: colour grading, canvas reads and ` +
      "audio effects are off for it. Serve it with Access-Control-Allow-Origin to keep them.",
  );
}

// The browser's own word that it has nothing left to try: the element's error, or a source's with no source left.
const exhausted = (media: HTMLMediaElement, el: Element) =>
  el === media || media.networkState === HTMLMediaElement.NETWORK_NO_SOURCE;

function ranOut(event: Event): void {
  const target = event.target as Node | null;
  if (target?.nodeType !== 1) return;
  const media = mediaOf(target as Element);
  if (!media || authored.has(media) || !exhausted(media, target as Element)) return;
  const current = fallback.get(media);
  if (current === "retrying") fallback.set(media, "failed");
  if (current !== "cors") return;
  fallback.set(media, "retrying");
  write(media, null);
  media.load();
}

function firstFrame(event: Event): void {
  const media = event.target as HTMLMediaElement;
  if (!isMedia(media)) return;
  const current = fallback.get(media);
  if (current === "cors") playedOnlyWithoutCors.delete(media.currentSrc);
  if (current !== "retrying") return;
  fallback.set(media, { playedWithout: media.currentSrc });
  remember(media.currentSrc);
}

// A src or <source> change: a fallback holds while the URL it played is still named, else the element starts over.
function sourcesChanged(record: MutationRecord, home: string): void {
  const target = record.target as Element;
  const media = record.type === "attributes" ? mediaOf(target) : isMedia(target) ? target : null;
  const current = media && fallback.get(media);
  if (!media || !current || current === "cors") return;
  if (typeof current === "object" && listedUrls(media, home).includes(current.playedWithout))
    return;
  fallback.delete(media);
}

function visit(node: Node, home: string): void {
  if (node.nodeType !== 1) return;
  const el = node as Element;
  const media = mediaOf(el);
  if (media) sync(media, home);
  for (const inner of el.querySelectorAll("video, audio")) sync(inner as HTMLMediaElement, home);
}

/** In a sealed document, opts the preview server's own media into CORS as it parses or changes src, before it loads;
 * media whose host refuses CORS falls back to loading without it, once. */
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
      sourcesChanged(record, home);
      if (record.type === "attributes") visit(record.target, home);
      else record.addedNodes.forEach((node) => visit(node, home));
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
  document.addEventListener("error", ranOut, true);
  document.addEventListener("loadeddata", firstFrame, true);
  return observer;
}
