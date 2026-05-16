import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import {
  rewriteAssetPaths,
  rewriteCssAssetUrls,
  rewriteInlineStyleAssetUrls,
} from "../../compiler/rewriteSubCompPaths.js";

/**
 * Detect whether `html` is a full document (has `<html>`, `<head>`, or
 * `<!doctype`), as opposed to a `<template>`-wrapped fragment.
 * Anchored to start-of-string (ignoring leading whitespace) so stray
 * occurrences inside script/template content don't false-positive.
 */
function isFullHtmlDocument(html: string): boolean {
  return /^\s*(?:<!doctype\s|<html[\s>])/i.test(html);
}

/**
 * Rewrite relative asset paths in a parsed DOM tree. Shared across all
 * three dispatch branches (template, full-doc, fragment) to avoid drift.
 */
function rewriteRelativePaths(root: ParentNode, compPath: string): void {
  rewriteAssetPaths(
    root.querySelectorAll("[src], [href]"),
    compPath,
    (el: Element, attr: string) => el.getAttribute(attr),
    (el: Element, attr: string, value: string) => el.setAttribute(attr, value),
  );
  rewriteInlineStyleAssetUrls(
    root.querySelectorAll("[style]"),
    compPath,
    (el: Element) => el.getAttribute("style"),
    (el: Element, value: string) => el.setAttribute("style", value),
  );
  for (const styleEl of root.querySelectorAll("style")) {
    styleEl.textContent = rewriteCssAssetUrls(styleEl.textContent || "", compPath);
  }
}

/**
 * Parse a full HTML document and extract its head elements and body
 * content separately, so they can be reassembled into a clean standalone
 * page without nesting `<html>` inside `<body>`.
 *
 * Extracts the full innerHTML of `<head>` — this preserves `<style>`,
 * `<script>`, `<link>`, `<meta>`, and any other head-level tags the
 * composition declares. Dropping `<link rel="stylesheet">` or `<meta>`
 * would cause silent rendering failures for compositions that ship with
 * external CSS or viewport-dependent meta.
 *
 * `<html>` and `<body>` attributes (lang, class, data-*) are extracted
 * so callers can forward them to the assembled page.
 */
function extractFullDocumentParts(
  rawHtml: string,
  compPath: string,
): {
  headContent: string;
  bodyContent: string;
  htmlAttrs: string;
  bodyAttrs: string;
} {
  const { document: doc } = parseHTML(rawHtml);

  const rewriteTargets = [doc.head, doc.body].filter(Boolean);
  for (const target of rewriteTargets) {
    rewriteRelativePaths(target, compPath);
  }

  const headContent = doc.head?.innerHTML ?? "";
  const bodyContent = doc.body?.innerHTML ?? "";

  const htmlEl = doc.documentElement;
  const htmlAttrs = extractElementAttrs(htmlEl);
  const bodyAttrs = doc.body ? extractElementAttrs(doc.body) : "";

  return { headContent, bodyContent, htmlAttrs, bodyAttrs };
}

function extractElementAttrs(el: Element): string {
  const parts: string[] = [];
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i]!;
    if (attr.value === "") {
      parts.push(attr.name);
    } else {
      parts.push(`${attr.name}="${attr.value}"`);
    }
  }
  return parts.join(" ");
}

/**
 * Build a standalone HTML page for a sub-composition.
 *
 * Uses the project's own index.html `<head>` so all dependencies (GSAP, fonts,
 * Lottie, reset styles, runtime) are preserved — instead of building a minimal
 * page from scratch that would miss important scripts/styles.
 *
 * Three dispatch modes, tried in order:
 *   1. `<template>` wrapper → extract template content (existing compositions)
 *   2. Full HTML document → parse and extract head/body separately (registry blocks)
 *   3. Raw fragment → wrap in a minimal document
 *
 * For full-doc mode, the composition's own `<head>` content (styles, scripts,
 * links, meta) is appended AFTER the project's index.html head. When both
 * declare the same dependency (e.g. GSAP CDN), the composition's copy wins
 * by last-write-wins script execution order — this is intentional so the
 * composition can pin a specific version.
 */
export function buildSubCompositionHtml(
  projectDir: string,
  compPath: string,
  runtimeUrl: string,
  baseHref?: string,
): string | null {
  const compFile = join(projectDir, compPath);
  if (!existsSync(compFile)) return null;

  const rawComp = readFileSync(compFile, "utf-8");

  let compHeadContent = "";
  let rewrittenContent: string;
  let htmlAttrs = "";
  let bodyAttrs = "";

  const templateMatch = rawComp.match(/<template[^>]*>([\s\S]*)<\/template>/i);

  if (templateMatch) {
    const content = templateMatch[1];
    const { document: contentDoc } = parseHTML(
      `<!DOCTYPE html><html><head></head><body>${content}</body></html>`,
    );
    rewriteRelativePaths(contentDoc, compPath);
    rewrittenContent = contentDoc.body.innerHTML || content!;
  } else if (isFullHtmlDocument(rawComp)) {
    const parts = extractFullDocumentParts(rawComp, compPath);
    compHeadContent = parts.headContent;
    rewrittenContent = parts.bodyContent;
    htmlAttrs = parts.htmlAttrs;
    bodyAttrs = parts.bodyAttrs;
  } else {
    const { document: contentDoc } = parseHTML(
      `<!DOCTYPE html><html><head></head><body>${rawComp}</body></html>`,
    );
    rewriteRelativePaths(contentDoc, compPath);
    rewrittenContent = contentDoc.body.innerHTML || rawComp;
  }

  // Use the project's index.html <head> to preserve all dependencies
  const indexPath = join(projectDir, "index.html");
  let headContent = "";

  if (existsSync(indexPath)) {
    const indexHtml = readFileSync(indexPath, "utf-8");
    const headMatch = indexHtml.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
    headContent = headMatch?.[1] ?? "";
  }

  // Inject <base> for relative asset resolution (before other tags)
  if (baseHref && !headContent.includes("<base")) {
    headContent = `<base href="${baseHref}">\n${headContent}`;
  }

  // Append the sub-composition's own <head> content so its CSS, scripts,
  // links, and meta tags are preserved. Placed after the project head so
  // the composition's deps take precedence (last-write-wins for scripts).
  if (compHeadContent) headContent += `\n${compHeadContent}`;

  // Ensure runtime is present (might differ from the one in index.html)
  if (
    !headContent.includes("hyperframe.runtime") &&
    !headContent.includes("hyperframes-preview-runtime")
  ) {
    headContent += `\n<script data-hyperframes-preview-runtime="1" src="${runtimeUrl}"></script>`;
  }

  // Fallback: if no index.html head was found, add minimal deps
  if (!headContent.includes("gsap")) {
    headContent += `\n<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>`;
  }

  const htmlOpen = htmlAttrs ? `<html ${htmlAttrs}>` : "<html>";
  const bodyOpen = bodyAttrs ? `<body ${bodyAttrs}>` : "<body>";

  return `<!DOCTYPE html>
${htmlOpen}
<head>
${headContent}
</head>
${bodyOpen}
<script>window.__timelines=window.__timelines||{};</script>
${rewrittenContent}
</body>
</html>`;
}
