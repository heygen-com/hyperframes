export type LayerKind = "image" | "video" | "audio" | "vector" | "group" | "text" | "shape";

// Phrasing tags a text block may hold and still read as one piece of text.
const INLINE = new Set(["b", "strong", "i", "em", "u", "s", "span", "a", "br", "sup", "sub", "mark", "small", "code"]);

/** What a Layers row tells a person an element is: its media tag, a group, text, or else a shape. */
export function layerKindOf(el: Element): LayerKind {
  const tag = el.tagName.toLowerCase();
  if (tag === "img" || tag === "picture") return "image";
  if (tag === "video") return "video";
  if (tag === "audio") return "audio";
  if (tag === "svg") return "vector";
  if (el.hasAttribute("data-hf-group") || el.hasAttribute("data-composition-src")) return "group";
  const inlineOnly = [...el.querySelectorAll("*")].every((child) => INLINE.has(child.tagName.toLowerCase()));
  return inlineOnly && el.textContent?.trim() ? "text" : "shape";
}
