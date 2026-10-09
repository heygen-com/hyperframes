import { decodeHTMLAttribute } from "entities/decode";

export type HtmlAttributeSpan = {
  name: string;
  start: number;
  end: number;
} & (
  | { kind: "boolean" }
  | { kind: "value"; value: string; valueStart: number; valueEnd: number; quote: string }
);

export interface HtmlOpeningTagSpan {
  name: string;
  start: number;
  end: number;
  bodyEnd: number;
  closed: boolean;
  rawTextEnd: number | null;
  attributes: HtmlAttributeSpan[];
}

function readAttributeValue(html: string, at: number) {
  while (/[\t\n\f\r ]/.test(html.charAt(at))) at++;
  const quote = ['"', "'"].includes(html.charAt(at)) ? html.charAt(at) : "";
  if (quote) at++;
  const valueStart = at;
  if (quote) {
    const closing = html.indexOf(quote, at);
    at = closing === -1 ? html.length : closing;
  } else {
    while (at < html.length && !/[\t\n\f\r >]/.test(html[at]!)) at++;
  }
  const valueEnd = at;
  const end = quote ? Math.min(valueEnd + 1, html.length) : valueEnd;
  return { value: html.slice(valueStart, valueEnd), valueStart, valueEnd, quote, end };
}

function readAttribute(html: string, start: number): HtmlAttributeSpan | null {
  let at = start;
  while (at < html.length && !/[\t\n\f\r =/>]/.test(html[at]!)) at++;
  if (at === start) return null;
  const name = html.slice(start, at).toLowerCase();
  const nameEnd = at;
  while (/[\t\n\f\r ]/.test(html[at] ?? "")) at++;
  if (html[at] !== "=") return { kind: "boolean", name, start, end: nameEnd };
  return { kind: "value", name, start, ...readAttributeValue(html, at + 1) };
}

function readOpeningTag(html: string, start: number, name: string, at: number): HtmlOpeningTagSpan {
  const attributes: HtmlAttributeSpan[] = [];
  while (at < html.length) {
    while (/[\t\n\f\r /]/.test(html[at] ?? "")) at++;
    if (at >= html.length || html[at] === ">") break;
    const attribute = readAttribute(html, at);
    if (attribute === null) {
      at++;
      continue;
    }
    attributes.push(attribute);
    at = attribute.end;
  }
  const closed = html[at] === ">";
  return {
    name: name.toLowerCase(),
    start,
    bodyEnd: at,
    end: closed ? at + 1 : at,
    closed,
    rawTextEnd: null,
    attributes,
  };
}

export function scanHtmlOpeningTags(html: string): HtmlOpeningTagSpan[] {
  const tags: HtmlOpeningTagSpan[] = [];
  const opening = /<!--[\s\S]*?(?:--!?>|$)|<([a-z][^\t\n\f\r />]*)/gi;
  let match: RegExpExecArray | null;
  while ((match = opening.exec(html)) !== null) {
    if (!match[1]) continue;
    const tag = readOpeningTag(html, match.index, match[1], opening.lastIndex);
    tags.push(tag);
    opening.lastIndex = tag.end;
    if (
      [
        "script",
        "style",
        "textarea",
        "title",
        "xmp",
        "iframe",
        "noembed",
        "noframes",
        "plaintext",
      ].includes(tag.name)
    ) {
      if (tag.name === "plaintext") {
        tag.rawTextEnd = html.length;
        break;
      }
      const closing = new RegExp(`</${tag.name}(?=[\\t\\n\\f\\r />])`, "gi");
      closing.lastIndex = tag.end;
      const end = closing.exec(html);
      tag.rawTextEnd = end?.index ?? html.length;
      opening.lastIndex = tag.rawTextEnd;
    }
  }
  return tags;
}

export const HTML_ATTRIBUTE_ENTITIES: Record<string, readonly string[]> = {
  "&": ["&amp;"],
  '"': ["&quot;"],
  "'": ["&#39;", "&apos;"],
  "<": ["&lt;"],
  ">": ["&gt;"],
};
export function decodeAuthoredAttribute(value: string): string {
  return decodeHTMLAttribute(value);
}
