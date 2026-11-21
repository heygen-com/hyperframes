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

// Per element: withCors while our crossorigin is on it; withoutCors once the browser ran out of sources with it,
// until the element's sources change.
const state = new WeakMap<HTMLMediaElement, "withCors" | "withoutCors">();
// A crossorigin change we did not write, even to our own value, makes the attribute the composition's for good.
const authored = new WeakSet<HTMLMediaElement>();
const pendingWrites = new WeakMap<HTMLMediaElement, number>();
const failedInSelection = new WeakMap<HTMLMediaElement, Set<string>>();
const fellBackFor = new WeakMap<HTMLMediaElement, Set<string>>();
const loadsWithoutCors = new Set<string>();

const playable = (media: HTMLMediaElement, source: Element) => {
  const type = source.getAttribute("type");
  return !type || media.canPlayType(type) !== "";
};

/** What the browser tries, in order: `src` alone, else the `<source>` children it can play. */
function candidatesOf(media: HTMLMediaElement): Element[] {
  if (media.hasAttribute("src")) return [media];
  return [...media.children].filter(
    (el) => el.localName === "source" && el.getAttribute("src") && playable(media, el),
  );
}

function wantsCors(media: HTMLMediaElement, home: string): boolean {
  const urls = candidatesOf(media).map((el) => resolved(el.getAttribute("src") ?? "", home));
  const own = originOf(home, home);
  if (!urls.length || !urls.every((url) => originOf(url, home) === own)) return false;
  return !urls.every((url) => loadsWithoutCors.has(url));
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

function sync(media: HTMLMediaElement, home: string): void {
  if (authored.has(media)) return;
  const current = state.get(media);
  if (media.hasAttribute("crossorigin") && current !== "withCors") {
    authored.add(media);
    return;
  }
  if (current === "withoutCors") return;
  const want = wantsCors(media, home);
  if (want && !media.hasAttribute("crossorigin")) {
    write(media, "anonymous");
    state.set(media, "withCors");
  } else if (!want && state.get(media) === "withCors") {
    write(media, null);
    state.delete(media);
  }
}

// The parser can add a <source> after its media element, and a script can change either's src.
function mediaOf(el: Element): HTMLMediaElement | null {
  if (isMedia(el)) return el;
  const parent = el.localName === "source" ? el.parentElement : null;
  return parent && isMedia(parent) ? parent : null;
}

function failedWithOurCors(event: Event): { el: Element; media: HTMLMediaElement } | null {
  const target = event.target as Node | null;
  if (target?.nodeType !== 1) return null;
  const media = mediaOf(target as Element);
  if (!media || authored.has(media) || state.get(media) !== "withCors") return null;
  return { el: target as Element, media };
}

function recordFailure(media: HTMLMediaElement, el: Element, home: string): Set<string> {
  const failed = failedInSelection.get(media) ?? new Set<string>();
  failedInSelection.set(media, failed);
  const src = el.getAttribute("src");
  if (src) failed.add(resolved(src, home));
  return failed;
}

function rememberRefused(urls: Set<string>): void {
  for (const url of urls) {
    if (loadsWithoutCors.has(url)) continue;
    loadsWithoutCors.add(url);
    console.warn(
      `[hyperframes] ${url} did not load with CORS, so it plays without: colour grading, canvas reads and ` +
        "audio effects are off for it. Serve it with Access-Control-Allow-Origin to keep them.",
    );
  }
}

// The browser's own word that it has nothing left to try: the element's error, or a source's with no source left.
const exhausted = (media: HTMLMediaElement, el: Element) =>
  el === media || media.networkState === HTMLMediaElement.NETWORK_NO_SOURCE;

function fallBackWithoutCors(event: Event, home: string): void {
  const failure = failedWithOurCors(event);
  if (!failure) return;
  const { el, media } = failure;
  const failed = recordFailure(media, el, home);
  if (!exhausted(media, el)) return;
  failedInSelection.delete(media);
  const done = fellBackFor.get(media) ?? new Set<string>();
  fellBackFor.set(media, done);
  if ([...failed].every((url) => done.has(url))) return;
  failed.forEach((url) => done.add(url));
  state.set(media, "withoutCors");
  rememberRefused(failed);
  write(media, null);
  media.load();
}

function loadedWithCors(event: Event): void {
  const media = event.target as HTMLMediaElement;
  if (!isMedia(media) || state.get(media) !== "withCors") return;
  failedInSelection.delete(media);
  loadsWithoutCors.delete(media.currentSrc);
}

// A src or <source> change starts a new selection: its failures and fallback start over.
function sourcesChanged(record: MutationRecord): void {
  const target = record.target as Element;
  const media = record.type === "attributes" ? mediaOf(target) : isMedia(target) ? target : null;
  if (!media) return;
  failedInSelection.delete(media);
  if (state.get(media) === "withoutCors") state.delete(media);
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
      sourcesChanged(record);
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
  document.addEventListener("error", (event) => fallBackWithoutCors(event, home), true);
  document.addEventListener("loadeddata", loadedWithCors, true);
  return observer;
}
