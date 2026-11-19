// A sealed preview's document has an opaque origin, so its own server's media is cross-origin to it. Without
// `crossorigin` the browser loads that media in no-cors mode: WebGL and canvases refuse its frames, Web Audio treats it
// as foreign. The preview server answers CORS loads from an opaque origin, so its own media opts in; other hosts don't.

const isMedia = (el: Element): el is HTMLMediaElement =>
  el.localName === "video" || el.localName === "audio";

function servedHere(media: HTMLMediaElement, home: string): boolean {
  const urls = [media, ...media.querySelectorAll("source")]
    .map((el) => el.getAttribute("src"))
    .filter((src): src is string => Boolean(src));
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

function sync(media: HTMLMediaElement, home: string): void {
  const own = servedHere(media, home);
  if (own && !media.hasAttribute("crossorigin")) {
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

function visit(node: Node, home: string): void {
  if (node.nodeType !== 1) return;
  const el = node as Element;
  const media = mediaOf(el);
  if (media) sync(media, home);
  for (const inner of el.querySelectorAll("video, audio")) sync(inner as HTMLMediaElement, home);
}

/** In a sealed document, opts the preview server's own media into CORS as it parses or changes src, before it loads. */
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
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src"],
  });
  return observer;
}
