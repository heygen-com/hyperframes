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

export function parseHTML(
  ...args: Parameters<typeof linkedomParseHTML>
): ReturnType<typeof linkedomParseHTML> {
  escapeTextOnWrite();
  return linkedomParseHTML(...args);
}

export class DOMParser extends LinkedomDOMParser {
  constructor() {
    super();
    escapeTextOnWrite();
  }
}
