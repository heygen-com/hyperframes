import { isRichTextFormattingTag } from "@hyperframes/core/rich-text-sanitize";

export type LayerKind = "image" | "video" | "audio" | "vector" | "group" | "text" | "shape";

export function isCompositionHost(el: Element): boolean {
  return el.hasAttribute("data-composition-src") || el.hasAttribute("data-composition-file");
}

/** What a Layers row tells a person an element is: its media tag, a group, text, or else a shape. */
export function layerKindOf(el: Element): LayerKind {
  const tag = el.tagName.toLowerCase();
  if (tag === "img" || tag === "picture") return "image";
  if (tag === "video") return "video";
  if (tag === "audio") return "audio";
  if (tag === "svg") return "vector";
  if (el.hasAttribute("data-hf-group") || isCompositionHost(el)) return "group";
  const textOnly = [...el.querySelectorAll("*")].every((child) =>
    isRichTextFormattingTag(child.tagName),
  );
  return textOnly && el.textContent?.trim() ? "text" : "shape";
}
