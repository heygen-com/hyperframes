import { parseHTML } from "linkedom";
import { sanitizeRichTextChildren } from "../utils/richTextSanitize";

function escape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Preserve the existing inline-formatting contract, with one safe serialization. */
export function richTextHtml(content: string): string {
  const { document } = parseHTML("<html><body></body></html>");
  const host = document.createElement("div");
  host.innerHTML = content;
  sanitizeRichTextChildren(host);
  // Linkedom does not re-escape entity-looking ampersands in attributes.
  // Serialize the sanitized tree explicitly so a browser parse preserves values.
  const result: string[] = [];
  const pending: Array<Node | string> = Array.from(host.childNodes).reverse();
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (typeof node === "string") {
      result.push(node);
      continue;
    }
    if (node.nodeType === 3) {
      result.push(escape(node.textContent ?? ""));
      continue;
    }
    if (node.nodeType !== 1) continue;
    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    const attrs = Array.from(
      element.attributes,
      (attr) => ` ${attr.name}="${escape(attr.value)}"`,
    ).join("");
    result.push(`<${tag}${attrs}>`);
    if (tag === "br") continue;
    pending.push(`</${tag}>`, ...Array.from(element.childNodes).reverse());
  }
  return result.join("");
}
