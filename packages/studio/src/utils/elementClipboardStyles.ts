import {
  decodeAuthoredAttribute,
  scanHtmlOpeningTags,
  type HtmlOpeningTagSpan,
} from "@hyperframes/parsers/html-attribute-spans";

import { elementCssBlock, ownedElementCss, appendElementCss } from "./elementClipboardStyleBlocks";

const OWNER = "data-hf-element-style";

export function includeElementClipboardStyles(saved: Document, html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  const ids = new Set(Array.from(template.content.querySelectorAll("[id]"), (node) => node.id));
  const styles = Array.from(saved.querySelectorAll("style"))
    .flatMap((style) => {
      const id = style.getAttribute(OWNER);
      return id
        ? [{ owner: id, css: style.textContent ?? "" }]
        : ownedElementCss(style.textContent ?? "");
    })
    .filter((block) => ids.has(block.owner))
    .map((block) => {
      const carrier = document.createElement("style");
      carrier.setAttribute(OWNER, block.owner);
      carrier.textContent = block.css;
      return carrier.outerHTML;
    })
    .join("");
  if (!styles) return html;
  const close = html.match(/<\/[^>]+>\s*$/);
  if (!close || close.index === undefined) return html;
  return html.slice(0, close.index) + styles + html.slice(close.index);
}

function insertStyles(source: string, styles: string): string {
  const closes: number[] = [];
  const tags = scanHtmlOpeningTags(source, (name, start) => {
    if (name === "head") closes.push(start);
  });
  const head = tags.find((tag) => tag.name === "head");
  if (head) {
    const end =
      closes.find((start) => start >= head.end) ??
      tags.find((tag) => tag.name === "body")?.start ??
      source.length;
    return source.slice(0, end) + styles + source.slice(end);
  }
  const html = tags.find((tag) => tag.name === "html");
  const index = html?.end ?? tags[0]?.start ?? source.length;
  return source.slice(0, index) + `<head>${styles}</head>` + source.slice(index);
}

function activeSheets(source: string, tags: readonly HtmlOpeningTagSpan[]): Map<number, boolean> {
  const sheets = tags.filter((tag) => tag.name === "style" || tag.name === "link");
  let marker = "data-hf-style-probe";
  const names = new Set(tags.flatMap((tag) => tag.attributes.map((attr) => attr.name)));
  while (names.has(marker)) marker += "-x";
  let probe = source;
  for (let index = sheets.length - 1; index >= 0; index--) {
    const tag = sheets[index]!;
    const at = tag.start + tag.name.length + 1;
    probe = probe.slice(0, at) + ` ${marker}="${index}"` + probe.slice(at);
  }
  const doc = new DOMParser().parseFromString(probe, "text/html");
  return new Map(
    Array.from(doc.querySelectorAll(`style[${marker}],link[${marker}]`))
      .filter((sheet) =>
        ["", "text/css"].includes((sheet.getAttribute("type") ?? "").trim().toLowerCase()),
      )
      .filter(
        (sheet) =>
          sheet.localName === "style" ||
          (sheet.getAttribute("rel") ?? "").toLowerCase().split(/\s+/).includes("stylesheet"),
      )
      .map((sheet) => [
        sheets[Number(sheet.getAttribute(marker))]!.start,
        doc.head.contains(sheet),
      ]),
  );
}

function appendToSheet(
  source: string,
  previous: HtmlOpeningTagSpan | undefined,
  active: ReadonlyMap<number, boolean>,
  css: string,
): string {
  if (previous?.name === "link" && !active.get(previous.start))
    throw new Error("Cannot paste styled content after a body stylesheet link.");
  if (previous?.rawTextEnd === null || previous?.rawTextEnd === undefined)
    return insertStyles(source, `<style>${css}</style>`);
  return appendToExistingSheet(source, previous, previous.rawTextEnd, css);
}

function attributeValue(tag: HtmlOpeningTagSpan, name: string): string {
  const attr = tag.attributes.find((candidate) => candidate.name === name);
  return attr?.kind === "value" ? decodeAuthoredAttribute(attr.value) : "";
}

function appendToExistingSheet(
  source: string,
  previous: HtmlOpeningTagSpan,
  end: number,
  css: string,
): string {
  if (attributeValue(previous, "title"))
    throw new Error("Cannot paste styled content into a titled stylesheet.");
  const media = previous.attributes.find((attr) => attr.name === "media");
  const condition = attributeValue(previous, "media").trim();
  const normalized = appendElementCss(source.slice(previous.end, end), condition, css);
  let opening = source.slice(previous.start, previous.end);
  if (media && condition && condition.toLowerCase() !== "all")
    opening = source.slice(previous.start, media.start) + source.slice(media.end, previous.end);
  return source.slice(0, previous.start) + opening + normalized + source.slice(end);
}

/** Carriers leave the content tree; their CSS keeps its source order in the preceding sheet. */
export function hoistElementClipboardStyles(
  source: string,
  renames: ReadonlyMap<string, string>,
): string {
  while (true) {
    const tags = scanHtmlOpeningTags(source);
    const tag = tags.find(
      (candidate) =>
        candidate.name === "style" && candidate.attributes.some((attr) => attr.name === OWNER),
    );
    if (!tag || tag.rawTextEnd === null) return source;
    const attribute = tag.attributes.find((attr) => attr.name === OWNER)!;
    if (attribute.kind !== "value") return source;
    const id = decodeAuthoredAttribute(attribute.value);
    const css = elementCssBlock(renames.get(id) ?? id, source.slice(tag.end, tag.rawTextEnd));
    const close = source.indexOf(">", tag.rawTextEnd);
    source = source.slice(0, tag.start) + source.slice(close < 0 ? source.length : close + 1);
    const active = activeSheets(source, scanHtmlOpeningTags(source));
    const previous = tags
      .filter((candidate) => candidate.start < tag.start && active.has(candidate.start))
      .at(-1);
    source = appendToSheet(source, previous, active, css);
  }
}
