import { parseHTML } from "linkedom";

// A start that is not a plain number (a reference) counts as unknown and keeps the image eager.
function startsAfterZero(el: Element): boolean {
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (Number(node.getAttribute("data-start")) > 0) return true;
  }
  return false;
}

export function lazyPreviewImages(html: string): string {
  if (!/<!doctype|<html[\s>]/i.test(html)) return html;
  const { document } = parseHTML(html);
  const later = [...document.querySelectorAll("img:not([loading])")].filter(startsAfterZero);
  if (later.length === 0) return html;
  for (const img of later) img.setAttribute("loading", "lazy");
  return document.toString();
}
