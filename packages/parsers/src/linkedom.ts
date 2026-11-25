// The one linkedom entry point: linkedom wrote <title>/<textarea> text raw, so "</title>" closed it on save.
import {
  DOMParser as LinkedomDOMParser,
  HTMLElement,
  HTMLTextAreaElement,
  HTMLTitleElement,
  parseHTML as linkedomParseHTML,
} from "linkedom";

// Parse decodes <title> text but keeps <textarea> text as written: each escapes only what keeps bytes intact.
const escapeDecodedTitleText = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const neutraliseTextareaEndTag = (text: string) => text.replace(/<(\/textarea)/gi, "&lt;$1");

const writeEmptyElement = HTMLElement.prototype.toString;
let installed = false;

// Runs from the parsers below, not at import: "sideEffects": false lets a bundler drop an import-time patch.
function escapeTextOnWrite(): void {
  if (installed) return;
  installed = true;
  for (const [Element, escape] of [
    [HTMLTitleElement, escapeDecodedTitleText],
    [HTMLTextAreaElement, neutraliseTextareaEndTag],
  ] as const) {
    Object.defineProperty(Element.prototype, "toString", {
      configurable: true,
      writable: true,
      value(this: InstanceType<typeof Element>) {
        const empty = writeEmptyElement.call(this.cloneNode());
        const close = empty.lastIndexOf("</");
        return empty.slice(0, close) + escape(this.textContent ?? "") + empty.slice(close);
      },
    });
  }
}

// Typed with the DOM's own types: published declarations that name linkedom's fail a strict consumer.
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
export function parseHTML(html: string, globals?: unknown): Window & typeof globalThis {
  escapeTextOnWrite();
  const parsed = linkedomParseHTML(html, globals) as Window & typeof globalThis;
  if (readsUnlikeBrowser(parsed.document)) throw new HtmlReadUnlikeBrowserError();
  return parsed;
}

/** linkedom's `DOMParser`, with the same refusal for `text/html`. */
export const DOMParser = class extends LinkedomDOMParser {
  constructor() {
    super();
    escapeTextOnWrite();
  }

  override parseFromString<Mime extends Parameters<LinkedomDOMParser["parseFromString"]>[1]>(
    markup: string,
    mimeType: Mime,
    globals?: unknown,
  ) {
    const parsed = super.parseFromString(markup, mimeType, globals);
    if (mimeType === "text/html" && readsUnlikeBrowser(parsed as unknown as Document))
      throw new HtmlReadUnlikeBrowserError();
    return parsed;
  }
} as unknown as { new (): globalThis.DOMParser };
