import { findStartTags } from "@hyperframes/core/compiler/html-document";
import { parseHTML } from "linkedom";
import { STUDIO_PREVIEW_LAZY_ATTR } from "@hyperframes/core/studio-preview-mark";

// A start that is not a plain number (a reference) counts as unknown and keeps the image eager.
function startsAfterZero(el: Element): boolean {
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (Number(node.getAttribute("data-start")) > 0) return true;
  }
  return false;
}

const hasLoading = (img: Element) =>
  Array.from(img.attributes).some((attr) => attr.name.toLowerCase() === "loading");

export function lazyPreviewImages(html: string): string {
  if (!/<!doctype|<html[\s>]/i.test(html)) return html;
  const images = [...parseHTML(html).document.querySelectorAll("img")];
  // The scanner skips comments and raw text, so its `<img` offsets line up with the DOM's images.
  const tags = findStartTags(html, "img");
  if (tags.length !== images.length) return html;
  const parts: string[] = [];
  let from = 0;
  images.forEach((img, i) => {
    if (hasLoading(img) || !startsAfterZero(img)) return;
    const at = (tags[i] ?? 0) + 4;
    parts.push(html.slice(from, at), ` loading="lazy" ${STUDIO_PREVIEW_LAZY_ATTR}`);
    from = at;
  });
  parts.push(html.slice(from));
  return parts.join("");
}
