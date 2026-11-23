/**
 * HDR passthrough: overlay content is accepted only when it is known not to
 * paint on its own clock.
 *
 * Capture renders each distinct overlay once and reuses it across frames,
 * which is right only for content whose pixels follow the seek: the DOM,
 * styles and GSAP's writes. Content that paints from a clock of its own (an
 * animated image, a canvas a worker draws, a caret, a media control's
 * progress) differs between frames the fingerprint calls equal. Earlier
 * versions declined each such thing by name, and each round found another
 * place one could hide (a pseudo-element the list did not name, a canvas in
 * a shadow root). So this module lists what is accepted, and everything
 * else declines:
 *
 * - elements (`findUnsupportedElements`, from the DevTools DOM snapshot,
 *   which pierces every shadow tree): static HTML and SVG elements, an
 *   `<audio>` without controls and the one source `<video>`; pseudo-elements
 *   `::before`, `::after` and `::marker`. No canvas, form control, custom
 *   element, media control, SVG animation element, MathML or anything new;
 * - CSS (`findUnsupportedCss`, every stylesheet in the document, its open
 *   shadow roots and `@import`s, read in the isolated world, plus the text of
 *   every stylesheet the page loaded): pseudo-elements from a short list of
 *   static ones (no `::scroll-button()`, `::picker-icon`, `::checkmark`,
 *   `::scroll-marker`, `::cue`, view transitions), and no `paint()`;
 * - images (`recordImageResources`): every image the page loads, whoever
 *   references it and however (an element, a pseudo-element, a mask, a
 *   `data:` or `blob:` URL), is read from the network record and decoded
 *   enough to tell: a single-frame GIF, PNG, WebP, AVIF/HEIF, JPEG, BMP or
 *   ICO, or an SVG with no animation, script or embedded image. Anything
 *   else, or an image whose bytes cannot be read, declines.
 *
 * Workers, offscreen canvases, worklets and view transitions are declined
 * where they are created (`registrationWatch.ts`).
 */

import type { getCdpSession } from "@hyperframes/engine";
import type { DomSnapshotLike } from "./overlayFingerprint.js";
import { evaluateIsolated } from "./isolatedWorld.js";

type Client = Awaited<ReturnType<typeof getCdpSession>>;
type Page = Parameters<typeof evaluateIsolated>[0];

const HTML_ELEMENTS =
  "html head body title meta link style script noscript template base div span p a b i u s q em " +
  "strong small sub sup mark code pre kbd samp var abbr cite dfn time data br wbr hr h1 h2 h3 h4 " +
  "h5 h6 header footer main section article aside nav address figure figcaption blockquote ul ol " +
  "li dl dt dd menu table caption thead tbody tfoot tr th td col colgroup img picture source " +
  "label font center big tt strike bdi bdo ruby rt rp del ins slot";

const SVG_ELEMENTS =
  "svg g defs symbol use path rect circle ellipse line polyline polygon text tspan textpath " +
  "lineargradient radialgradient stop clippath mask pattern filter image title desc metadata " +
  "marker foreignobject style switch view a feblend fecolormatrix fecomponenttransfer " +
  "fecomposite feconvolvematrix fediffuselighting fedisplacementmap fedistantlight fedropshadow " +
  "feflood fefunca fefuncb fefuncg fefuncr fegaussianblur feimage femerge femergenode " +
  "femorphology feoffset fepointlight fespecularlighting fespotlight fetile feturbulence";

/** Element names (lower case) the passthrough accepts anywhere in the overlay. */
const ACCEPTED_ELEMENTS: ReadonlySet<string> = new Set(
  `${HTML_ELEMENTS} ${SVG_ELEMENTS}`.split(/\s+/),
);

/** Pseudo-element nodes the DOM snapshot lists that paint only what the CSS says. */
const ACCEPTED_PSEUDO_NODES: ReadonlySet<string> = new Set(["before", "after", "marker"]);

type SnapshotNodes = DomSnapshotLike["documents"][number]["nodes"] & {
  nodeType?: number[];
  pseudoType?: { index: number[]; value: number[] };
};

/** Nodes inside a user-agent shadow tree: the browser's own parts of an accepted element. */
function userAgentNodes(nodes: SnapshotNodes, strings: readonly string[]): Set<number> {
  const out = new Set<number>();
  const types = nodes.shadowRootType ?? { index: [], value: [] };
  types.index.forEach((node, i) => {
    if (strings[types.value[i] ?? -1] === "user-agent") out.add(node);
  });
  return out;
}

/**
 * Elements and pseudo-elements in a DOM snapshot outside the accepted set,
 * as a log detail, or null. The video and audio gates run before this one
 * (`findOwnClockElementsInSnapshot`); here a `<video>` is the source and an
 * `<audio>` has no controls.
 */
export function findUnsupportedElements(snapshot: DomSnapshotLike): string | null {
  const { strings } = snapshot;
  const counts = new Map<string, number>();
  const add = (what: string) => counts.set(what, (counts.get(what) ?? 0) + 1);
  for (const { nodes: raw } of snapshot.documents) {
    const nodes = raw as SnapshotNodes;
    const userAgent = userAgentNodes(nodes, strings);
    const pseudo = new Map<number, string>();
    const pseudoTypes = nodes.pseudoType ?? { index: [], value: [] };
    pseudoTypes.index.forEach((node, i) =>
      pseudo.set(node, strings[pseudoTypes.value[i] ?? -1] ?? ""),
    );
    // fallow-ignore-next-line complexity
    (nodes.nodeName ?? []).forEach((nameIndex, i) => {
      if ((nodes.nodeType?.[i] ?? 1) !== 1 || userAgent.has(i)) return;
      const type = pseudo.get(i);
      if (type !== undefined) {
        if (!ACCEPTED_PSEUDO_NODES.has(type)) add(`::${type}`);
        return;
      }
      const name = (strings[nameIndex] ?? "").toLowerCase();
      if (name === "video" || name === "audio") return;
      if (!ACCEPTED_ELEMENTS.has(name)) add(`<${name}>`);
    });
  }
  if (counts.size === 0) return null;
  return [...counts]
    .slice(0, 5)
    .map(([what, n]) => `${n} ${what}`)
    .join(", ");
}

/** Pseudo-elements a stylesheet may style: they paint only what the rule says. */
const ACCEPTED_PSEUDO_ELEMENTS: ReadonlySet<string> = new Set([
  "before",
  "after",
  "marker",
  "first-line",
  "first-letter",
  "selection",
  "placeholder",
  "backdrop",
  "highlight",
  "part",
  "slotted",
  "-webkit-scrollbar",
  "-webkit-scrollbar-thumb",
  "-webkit-scrollbar-track",
  "-webkit-scrollbar-track-piece",
  "-webkit-scrollbar-corner",
  "-webkit-scrollbar-button",
  "-webkit-resizer",
  "-webkit-input-placeholder",
  "-moz-selection",
  "-moz-placeholder",
]);

/**
 * What in CSS text declines the passthrough, or null: a pseudo-element
 * outside the accepted list (`::name`, either case), or a `paint()` image.
 * Reads the text as written, comments and strings included: a false
 * positive only declines.
 */
export function findUnsupportedCssText(css: string): string | null {
  const found = new Set<string>();
  for (const match of css.matchAll(/::(-?[a-zA-Z][\w-]*)/g)) {
    const name = (match[1] ?? "").toLowerCase();
    if (!ACCEPTED_PSEUDO_ELEMENTS.has(name)) found.add(`::${name}`);
  }
  if (/(^|[^\w-])paint\(/i.test(css)) found.add("a paint() worklet image");
  return found.size > 0 ? [...found].slice(0, 5).join(", ") : null;
}

/**
 * Runs in the isolated world; must stay self-contained. The text of every
 * stylesheet in the document, its open shadow trees (their own and adopted
 * sheets) and their `@import`s, plus inline styles; and the URLs of sheets
 * whose rules cannot be read (cross-origin), whose loaded text the caller
 * reads from the network record instead.
 */
function collectCssText(): { text: string; unreadable: string[] } {
  const parts: string[] = [];
  const unreadable: string[] = [];
  const seen = new Set<CSSStyleSheet>();
  const pushSheet = (sheet: CSSStyleSheet) => {
    if (seen.has(sheet)) return;
    seen.add(sheet);
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      unreadable.push(sheet.href ?? "");
      return;
    }
    for (const rule of Array.from(rules)) {
      parts.push(rule.cssText);
      const imported = (rule as CSSRule & { styleSheet?: CSSStyleSheet | null }).styleSheet;
      if (imported) pushSheet(imported);
    }
  };
  const scopes: Array<Document | ShadowRoot> = [document];
  for (let i = 0; i < scopes.length; i++) {
    const scope = scopes[i] as Document | ShadowRoot;
    for (const sheet of Array.from(scope.styleSheets ?? [])) pushSheet(sheet);
    for (const sheet of scope.adoptedStyleSheets ?? []) pushSheet(sheet);
    for (const el of Array.from(scope.querySelectorAll("*"))) {
      const style = el.getAttribute("style");
      if (style) parts.push(style);
      if (el.shadowRoot) scopes.push(el.shadowRoot);
    }
  }
  return { text: parts.join("\n"), unreadable };
}

/** One image or stylesheet the page loaded. */
interface LoadedResource {
  url: string;
  mimeType: string;
  kind: "image" | "stylesheet";
  finished: boolean;
  failed: boolean;
  verdict?: string | null;
}

/** The network record of what the overlay page loaded: every image and stylesheet. */
export interface ResourceRecord {
  /** An image that is not proven static, as a log detail, or null. */
  findUnsupportedImages(final: boolean): Promise<string | null>;
  /** The loaded text of stylesheets (cross-origin ones included). */
  stylesheetTexts(): Promise<Map<string, string>>;
  failure(): string | undefined;
  dispose(): Promise<void>;
}

/** The fields of the CDP network events this record reads. */
interface ResponseReceivedLike {
  requestId: string;
  type?: string;
  response: { url: string; mimeType?: string };
}

/**
 * Start recording on a page that has not navigated yet. `Network.enable` on
 * the passthrough's own DevTools session, which the page cannot observe.
 */
export async function recordResources(client: Client): Promise<ResourceRecord> {
  const resources = new Map<string, LoadedResource>();
  let failure: string | undefined;
  const onResponse = (event: ResponseReceivedLike) => {
    const mimeType = (event.response.mimeType ?? "").toLowerCase();
    const kind =
      event.type === "Image" || mimeType.startsWith("image/")
        ? "image"
        : event.type === "Stylesheet" || mimeType === "text/css"
          ? "stylesheet"
          : undefined;
    if (!kind || event.type === "Fetch" || event.type === "XHR") return;
    resources.set(event.requestId, {
      url: event.response.url,
      mimeType,
      kind,
      finished: false,
      failed: false,
    });
  };
  const onFinished = (event: { requestId: string }) => {
    const entry = resources.get(event.requestId);
    if (entry) entry.finished = true;
  };
  const onFailed = (event: { requestId: string }) => {
    const entry = resources.get(event.requestId);
    if (entry) entry.failed = true;
  };
  try {
    client.on("Network.responseReceived", onResponse);
    client.on("Network.loadingFinished", onFinished);
    client.on("Network.loadingFailed", onFailed);
    await client.send("Network.enable", {
      maxTotalBufferSize: 256 * 1024 * 1024,
      maxResourceBufferSize: 64 * 1024 * 1024,
    });
  } catch (error) {
    failure = `network record unavailable (${error instanceof Error ? error.message : String(error)})`;
  }

  const body = async (requestId: string): Promise<Buffer | undefined> => {
    try {
      const { body: text, base64Encoded } = (await client.send("Network.getResponseBody", {
        requestId,
      })) as { body: string; base64Encoded: boolean };
      return Buffer.from(text, base64Encoded ? "base64" : "utf8");
    } catch {
      return undefined;
    }
  };
  const short = (url: string) => (url.startsWith("data:") ? `${url.slice(0, 32)}...` : url);

  return {
    // fallow-ignore-next-line complexity
    async findUnsupportedImages(final) {
      for (const [requestId, entry] of resources) {
        if (entry.kind !== "image") continue;
        if (entry.verdict === undefined) {
          if (entry.failed) continue; // never painted
          if (!entry.finished) {
            if (final) return `an image still loading (${short(entry.url)})`;
            continue;
          }
          const bytes = await body(requestId);
          entry.verdict = bytes ? imageVerdict(bytes) : "an image whose bytes cannot be read";
        }
        if (entry.verdict) return `${entry.verdict} (${short(entry.url)})`;
      }
      return null;
    },
    async stylesheetTexts() {
      const out = new Map<string, string>();
      for (const [requestId, entry] of resources) {
        if (entry.kind !== "stylesheet" || !entry.finished) continue;
        const bytes = await body(requestId);
        if (bytes) out.set(entry.url, bytes.toString("utf8"));
      }
      return out;
    },
    failure: () => failure,
    async dispose() {
      client.off("Network.responseReceived", onResponse);
      client.off("Network.loadingFinished", onFinished);
      client.off("Network.loadingFailed", onFailed);
      await client.send("Network.disable").catch(() => undefined);
    },
  };
}

/**
 * The CSS gate: the isolated world's view of every stylesheet, plus the
 * loaded text of the ones it cannot read. A sheet whose text is neither
 * readable nor in the network record declines.
 */
export async function findUnsupportedCss(
  page: Page,
  resources: ResourceRecord,
): Promise<string | null> {
  const { text, unreadable } = await evaluateIsolated(page, collectCssText);
  const inPage = findUnsupportedCssText(text);
  if (inPage) return inPage;
  if (unreadable.length === 0) return null;
  const loaded = await resources.stylesheetTexts();
  for (const href of unreadable) {
    const css = loaded.get(href);
    if (css === undefined) return `a stylesheet the passthrough cannot read (${href || "no url"})`;
    const found = findUnsupportedCssText(css);
    if (found) return `${found} (${href})`;
  }
  return null;
}

const ascii = (b: Uint8Array, at: number, n: number) =>
  String.fromCharCode(...Array.from(b.subarray(at, at + n)));
const u32be = (b: Uint8Array, at: number) =>
  (((b[at] ?? 0) << 24) | ((b[at + 1] ?? 0) << 16) | ((b[at + 2] ?? 0) << 8) | (b[at + 3] ?? 0)) >>>
  0;
const u32le = (b: Uint8Array, at: number) =>
  ((b[at] ?? 0) | ((b[at + 1] ?? 0) << 8) | ((b[at + 2] ?? 0) << 16) | ((b[at + 3] ?? 0) << 24)) >>>
  0;

/** Frames in a GIF, up to 2; -1 when the stream cannot be walked to its end. */
// fallow-ignore-next-line complexity
export function gifFrames(b: Uint8Array): number {
  const colorTable = (flags: number) => (flags & 0x80 ? 3 * (1 << ((flags & 7) + 1)) : 0);
  let p = 13 + colorTable(b[10] ?? 0);
  const skipSubBlocks = () => {
    while (p < b.length) {
      const n = b[p++] ?? 0;
      if (n === 0) return true;
      p += n;
    }
    return false;
  };
  let frames = 0;
  while (p < b.length) {
    const tag = b[p++];
    if (tag === 0x3b) return frames;
    if (tag === 0x21) {
      p++;
      if (!skipSubBlocks()) return -1;
    } else if (tag === 0x2c) {
      frames++;
      if (frames > 1) return frames;
      p += 9 + colorTable(b[p + 8] ?? 0) + 1;
      if (!skipSubBlocks()) return -1;
    } else return -1;
  }
  return -1;
}

function pngAnimated(b: Uint8Array): boolean | undefined {
  for (let p = 8; p + 8 <= b.length; p += 12 + u32be(b, p)) {
    const type = ascii(b, p + 4, 4);
    if (type === "acTL") return u32be(b, p + 8) > 1;
    if (type === "IDAT") return false;
  }
  return undefined;
}

function webpAnimated(b: Uint8Array): boolean {
  for (let p = 12; p + 8 <= b.length; p += 8 + u32le(b, p + 4) + (u32le(b, p + 4) & 1)) {
    const type = ascii(b, p, 4);
    if (type === "ANIM" || type === "ANMF") return true;
    if (type === "VP8X" && ((b[p + 8] ?? 0) & 0x02) !== 0) return true;
  }
  return false;
}

function isoSequence(b: Uint8Array): boolean {
  const end = Math.min(b.length, u32be(b, 0));
  for (let p = 8; p + 4 <= end; p += p === 8 ? 8 : 4) {
    if (["avis", "msf1", "hevs", "avcs"].includes(ascii(b, p, 4))) return true;
  }
  return false;
}

/** What makes an SVG document paint on its own, or embed what might. */
const SVG_NOT_STATIC =
  /<(animate|animateColor|animateMotion|animateTransform|set|script|image|feImage|foreignObject|iframe|video|audio|canvas)[\s/>]|@keyframes|animation(-name)?\s*:|transition\s*:|data:|url\(\s*["']?(?!#)/i;

/**
 * Why an image's bytes are not a known static image, or null when they are:
 * a single-frame GIF, a PNG without `acTL`, a WebP without animation, an
 * AVIF/HEIF that is no sequence, a JPEG, BMP or ICO, or an SVG with no
 * animation, script, embedded content or external reference.
 */
export function imageVerdict(bytes: Uint8Array): string | null {
  const format = IMAGE_FORMATS.find(([recognises]) => recognises(bytes));
  return format ? format[1](bytes) : svgVerdict(bytes);
}

/** [recognises the format, why it is not a static image or null], first match decides. */
const IMAGE_FORMATS: ReadonlyArray<[(b: Uint8Array) => boolean, (b: Uint8Array) => string | null]> =
  [
    [(b) => ascii(b, 0, 4) === "GIF8", gifVerdict],
    [(b) => b[0] === 0x89 && ascii(b, 1, 3) === "PNG", pngVerdict],
    [
      (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP",
      (b) => (webpAnimated(b) ? "an animated WebP" : null),
    ],
    [(b) => ascii(b, 4, 4) === "ftyp", (b) => (isoSequence(b) ? "an image sequence" : null)],
    [(b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff, () => null],
    [(b) => ascii(b, 0, 2) === "BM", () => null],
    [(b) => b[0] === 0 && b[1] === 0 && (b[2] === 1 || b[2] === 2) && b[3] === 0, () => null],
  ];

function gifVerdict(b: Uint8Array): string | null {
  const frames = gifFrames(b);
  if (frames === 1) return null;
  return frames > 1 ? "an animated GIF" : "a GIF the passthrough cannot read";
}

function pngVerdict(b: Uint8Array): string | null {
  const animated = pngAnimated(b);
  if (animated === false) return null;
  return animated ? "an APNG" : "a PNG the passthrough cannot read";
}

function svgVerdict(b: Uint8Array): string | null {
  const text = Buffer.from(b.subarray(0, 4 << 20)).toString("utf8");
  if (!/<svg[\s>]/i.test(text)) return "an image of a format the passthrough does not read";
  return SVG_NOT_STATIC.test(text) ? "an SVG that may animate or embed content" : null;
}
