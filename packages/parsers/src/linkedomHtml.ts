import { DOMParser as LinkedomDOMParser, parseHTML as linkedomParseHTML } from "linkedom";

// linkedom reads these as plain text even inside svg or math, where a browser reads their markup.
const READ_AS_TEXT = new Set(["title", "style", "script", "textarea", "xmp"]);
const FOREIGN = new Set(["svg", "math"]);
const BACK_TO_HTML = new Set(["foreignobject", "desc"]);
const TAG_OR_COMMENT = /<[A-Za-z!/?]/;
const CDATA = /<!\[CDATA\[[\s\S]*?\]\]>/g;

export class HtmlReadUnlikeBrowserError extends Error {
  constructor() {
    super(
      "This HTML has tags or comments inside an SVG or MathML title, style, script, textarea or xmp element, which can't be read the way a browser reads them.",
    );
    this.name = "HtmlReadUnlikeBrowserError";
  }
}

export interface ParsedHtml {
  document: Document;
  window: Window & typeof globalThis;
}

function insideForeign(element: Element): boolean {
  for (let up = element.parentElement; up; up = up.parentElement) {
    const name = up.localName.toLowerCase();
    if (BACK_TO_HTML.has(name)) return false;
    if (FOREIGN.has(name)) return true;
  }
  return false;
}

function readAsTextUnlikeBrowser(element: Element): boolean {
  return (
    READ_AS_TEXT.has(element.localName.toLowerCase()) &&
    insideForeign(element) &&
    TAG_OR_COMMENT.test((element.textContent ?? "").replace(CDATA, ""))
  );
}

function nextInDocumentOrder(element: Element): Element | null {
  if (element.firstElementChild) return element.firstElementChild;
  for (let at: Element | null = element; at; at = at.parentElement)
    if (at.nextElementSibling) return at.nextElementSibling;
  return null;
}

// One pass in document order: linkedom keeps the tree as a list, so asking each element for its children is quadratic.
// A parsed template's children are in that list; its `content` is a deep copy linkedom makes and keeps on first read.
function readsUnlikeBrowser(root: ParentNode): boolean {
  for (let element = root.firstElementChild; element; element = nextInDocumentOrder(element))
    if (readAsTextUnlikeBrowser(element)) return true;
  return false;
}

/** linkedom's `parseHTML`, refusing HTML that a browser would read as a different tree. */
export function parseHTML(html: string): ParsedHtml {
  const parsed = linkedomParseHTML(html) as unknown as ParsedHtml;
  if (readsUnlikeBrowser(parsed.document)) throw new HtmlReadUnlikeBrowserError();
  return parsed;
}

/** linkedom's `DOMParser`, with the same refusal for `text/html`. */
export class DOMParser {
  parseFromString(markup: string, mimeType: DOMParserSupportedType): Document {
    const parsed = new LinkedomDOMParser().parseFromString(markup, mimeType as "text/html");
    const document = parsed as unknown as Document;
    if (mimeType === "text/html" && readsUnlikeBrowser(document))
      throw new HtmlReadUnlikeBrowserError();
    return document;
  }
}
