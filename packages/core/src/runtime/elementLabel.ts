/** Elements whose text is code, not content: left out of every text an editor reads. */
export const NO_TEXT = new Set(["script", "style"]);

/** The element's rendered text, script and style left out, read until it passes `limit` chars. */
export function renderedTextOf(element: Element, limit: number): string {
  if (NO_TEXT.has(element.localName)) return "";
  let text = "";
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) =>
        node.nodeType === Node.ELEMENT_NODE && NO_TEXT.has((node as Element).localName)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    },
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType !== Node.TEXT_NODE) continue;
    text += node.nodeValue;
    if (text.length > limit) break;
  }
  return text;
}

// Enough source text for a 56-character label once whitespace runs collapse.
const LABEL_SOURCE_CHARS = 1000;

/** The short name an editor shows for an element: its text for text tags, otherwise its role. */
export function buildElementLabel(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const text = renderedTextOf(el, LABEL_SOURCE_CHARS).trim().replace(/\s+/g, " ");
  const trimLabel = (value: string, maxChars: number) => {
    const chars = Array.from(value);
    if (chars.length <= maxChars) return value;
    const kept = chars.slice(0, maxChars - 1).join("");
    const cutInsideWord = chars[maxChars - 1] !== " ";
    const lastWordEnd = cutInsideWord ? kept.lastIndexOf(" ") : -1;
    const keepsMostOfIt = lastWordEnd >= kept.length / 2;
    return `${(keepsMostOfIt ? kept.slice(0, lastWordEnd) : kept).trimEnd()}…`;
  };
  const heading = /^h[1-6]$/.test(tag);
  if (heading || tag === "p" || tag === "span" || tag === "div")
    return text.length > 0 ? trimLabel(text, 56) : heading ? "Heading" : "Text";
  if (tag === "img") return "Image";
  if (tag === "video") return "Video";
  if (tag === "audio") return "Audio";
  if (tag === "svg") return "Shape";
  if (el.getAttribute("data-composition-src")) return "Composition";
  if (tag === "section") return "Section";
  return `${tag.charAt(0).toUpperCase()}${tag.slice(1)}`;
}
