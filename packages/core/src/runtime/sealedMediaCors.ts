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

// Per element: withCors while our crossorigin is on it, withoutCors once its last candidate failed with it.
const state = new WeakMap<HTMLMediaElement, "withCors" | "withoutCors">();
// A crossorigin change we did not write, even to our own value, makes the attribute the composition's for good.
const authored = new WeakSet<HTMLMediaElement>();
const pendingWrites = new WeakMap<HTMLMediaElement, number>();
const failedWithCors = new WeakMap<HTMLMediaElement, Set<string>>();
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
  if (media.hasAttribute("crossorigin") && state.get(media) !== "withCors") {
    authored.add(media);
    return;
  }
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

function failedCandidate(event: Event): { el: Element; media: HTMLMediaElement } | null {
  const target = event.target as Node | null;
  if (target?.nodeType !== 1) return null;
  const media = mediaOf(target as Element);
  if (!media || authored.has(media) || state.get(media) !== "withCors") return null;
  return { el: target as Element, media };
}

const laterCandidateRemains = (media: HTMLMediaElement, failed: Element) => {
  const candidates = candidatesOf(media);
  const at = candidates.indexOf(failed);
  return failed !== media && at >= 0 && at < candidates.length - 1;
};

function recordFailure(media: HTMLMediaElement, el: Element, home: string): Set<string> {
  const failed = failedWithCors.get(media) ?? new Set<string>();
  failedWithCors.set(media, failed);
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

function fallBackWithoutCors(event: Event, home: string): void {
  const failure = failedCandidate(event);
  if (!failure) return;
  const { el, media } = failure;
  const failed = recordFailure(media, el, home);
  if (laterCandidateRemains(media, el)) return;
  state.set(media, "withoutCors");
  failedWithCors.delete(media);
  rememberRefused(failed);
  write(media, null);
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
 * media whose host refuses CORS falls back to loading without it, once. */
export function corsForSealedMedia(): MutationObserver | null {
  if (
    typeof MutationObserver === "undefined" ||
    typeof document === "undefined" ||
    window.origin !== "null"
  )
    return null;
  const home = document.baseURI;
  visit(document.documentElement, home);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.attributeName === "crossorigin" && isMedia(record.target as Element))
        crossOriginChanged(record.target as HTMLMediaElement);
      if (record.type === "attributes") visit(record.target, home);
      else record.addedNodes.forEach((node) => visit(node, home));
    }
  });
  // Media errors do not bubble; a capture listener on the document hears every element's.
  document.addEventListener("error", (event) => fallBackWithoutCors(event, home), true);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src", "crossorigin"],
  });
  return observer;
}
