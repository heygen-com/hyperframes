/** The short name an editor shows for an element: its text for text tags, otherwise its role. */
export function buildElementLabel(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const text = (el.textContent ?? "").trim().replace(/\s+/g, " ");
  const trimLabel = (value: string, maxChars: number) => {
    const chars = Array.from(value);
    return chars.length > maxChars ? `${chars.slice(0, maxChars - 1).join("")}…` : value;
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
