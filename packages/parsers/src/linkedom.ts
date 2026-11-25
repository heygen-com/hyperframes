// The one linkedom entry point: linkedom wrote <title>/<textarea> text raw, so "</title>" closed it on save.
import { HTMLElement, HTMLTextAreaElement, HTMLTitleElement } from "linkedom";

export { DOMParser, parseHTML } from "linkedom";

// Parse decodes <title> text but keeps <textarea> text as written: each escapes only what keeps bytes intact.
const escapeDecodedTitleText = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const neutraliseTextareaEndTag = (text: string) => text.replace(/<(\/textarea)/gi, "&lt;$1");

const writeOpenTag = HTMLElement.prototype.toString;

for (const [Element, escape] of [
  [HTMLTitleElement, escapeDecodedTitleText],
  [HTMLTextAreaElement, neutraliseTextareaEndTag],
] as const) {
  Object.defineProperty(Element.prototype, "toString", {
    configurable: true,
    writable: true,
    value(this: InstanceType<typeof Element>) {
      const empty = writeOpenTag.call(this.cloneNode());
      return empty.replace("><", () => `>${escape(this.textContent ?? "")}<`);
    },
  });
}
