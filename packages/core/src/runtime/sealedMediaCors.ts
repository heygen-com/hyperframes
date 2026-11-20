// A sealed preview's document has an opaque origin, so its own server's media is cross-origin to it. Without
// `crossorigin` the browser loads that media in no-cors mode: WebGL and canvases refuse its frames, Web Audio treats it
// as foreign. The preview server answers CORS loads from an opaque origin, so its own media opts in; other hosts don't.

const isMedia = (el: Element): el is HTMLMediaElement =>
  el.localName === "video" || el.localName === "audio";

const sourcesOf = (media: HTMLMediaElement): string[] =>
  [media, ...media.querySelectorAll("source")]
    .map((el) => el.getAttribute("src"))
    .filter((src): src is string => Boolean(src));

function servedHere(media: HTMLMediaElement, home: string): boolean {
  const urls = sourcesOf(media);
  const own = originOf(home, home);
  return urls.length > 0 && urls.every((src) => originOf(src, home) === own);
}

function originOf(url: string, base: string): string | null {
  try {
    return new URL(url, base).origin;
  } catch {
    return null;
  }
}

// Only a crossorigin added here is taken back when a src moves to a host that may not answer CORS.
const optedIn = new WeakSet<HTMLMediaElement>();
const loadsWithoutCors = new Set<string>();

const resolved = (src: string, home: string) => {
  try {
    return new URL(src, home).href;
  } catch {
    return src;
  }
};

function sync(media: HTMLMediaElement, home: string): void {
  const own = servedHere(media, home);
  const refused = sourcesOf(media).some((src) => loadsWithoutCors.has(resolved(src, home)));
  if (own && !refused && !media.hasAttribute("crossorigin")) {
    media.setAttribute("crossorigin", "anonymous");
    optedIn.add(media);
  } else if (!own && optedIn.delete(media)) {
    media.removeAttribute("crossorigin");
  }
}

// The parser can add a <source> after its media element, and a script can change either's src.
function mediaOf(el: Element): HTMLMediaElement | null {
  if (isMedia(el)) return el;
  const parent = el.localName === "source" ? el.parentElement : null;
  return parent && isMedia(parent) ? parent : null;
}

function fallBackWithoutCors(event: Event, home: string): void {
  const media = event.target instanceof Element ? mediaOf(event.target) : null;
  if (!media || !optedIn.delete(media)) return;
  for (const src of sourcesOf(media)) {
    const url = resolved(src, home);
    if (loadsWithoutCors.has(url)) continue;
    loadsWithoutCors.add(url);
    console.warn(
      `[hyperframes] ${url} did not load with CORS, so it plays without: colour grading, canvas reads and ` +
        "audio effects are off for it. Serve it with Access-Control-Allow-Origin to keep them.",
    );
  }
  media.removeAttribute("crossorigin");
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
    attributeFilter: ["src"],
  });
  return observer;
}
