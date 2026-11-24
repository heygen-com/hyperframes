import { DOMParser as LinkedomDOMParser, parseHTML as linkedomParseHTML } from "linkedom";

// linkedom reads these as plain text even inside svg or math, where a browser reads their markup.
const READ_AS_TEXT = new Set(["title", "style", "script", "textarea", "xmp"]);
const FOREIGN = new Set(["svg", "math"]);
const BACK_TO_HTML = new Set(["foreignobject", "desc"]);
const TAG_OR_COMMENT = /<[A-Za-z!/?]/;

export class HtmlReadUnlikeBrowserError extends Error {
  constructor() {
    super(
      "This HTML has tags or comments inside an SVG or MathML title, style, script, textarea or xmp element, which can't be read the way a browser reads them.",
    );
    this.name = "HtmlReadUnlikeBrowserError";
  }
}

function readsUnlikeBrowser(parent: ParentNode, inForeign = false): boolean {
  for (const element of Array.from(parent.children)) {
    const name = element.localName.toLowerCase();
    if (inForeign && READ_AS_TEXT.has(name) && TAG_OR_COMMENT.test(element.textContent ?? ""))
      return true;
    const content = (element as HTMLTemplateElement).content;
    if (name === "template" && content && readsUnlikeBrowser(content)) return true;
    const foreignHere = (inForeign || FOREIGN.has(name)) && !BACK_TO_HTML.has(name);
    if (readsUnlikeBrowser(element, foreignHere)) return true;
  }
  return false;
}

/** linkedom's `parseHTML`, refusing HTML that a browser would read as a different tree. */
export const parseHTML: typeof linkedomParseHTML = (...args) => {
  const window = linkedomParseHTML(...args);
  if (readsUnlikeBrowser(window.document)) throw new HtmlReadUnlikeBrowserError();
  return window;
};

/** linkedom's `DOMParser`, with the same refusal for `text/html`. */
export class DOMParser extends LinkedomDOMParser {}

const linkedomParseFromString = LinkedomDOMParser.prototype.parseFromString;
DOMParser.prototype.parseFromString = function (
  this: LinkedomDOMParser,
  markup,
  mimeType,
  globals,
) {
  const document = linkedomParseFromString.call(this, markup, mimeType, globals);
  if (mimeType === "text/html" && readsUnlikeBrowser(document as unknown as ParentNode))
    throw new HtmlReadUnlikeBrowserError();
  return document;
} as LinkedomDOMParser["parseFromString"];
