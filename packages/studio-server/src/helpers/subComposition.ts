import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import {
  rewriteAssetPaths,
  rewriteCssAssetUrls,
  rewriteInlineStyleAssetUrls,
} from "@hyperframes/core";
import { stripEmbeddedRuntimeScripts } from "@hyperframes/core/compiler";

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
 * Escape a CSS identifier whose first character is a digit so it is a valid
 * selector. A CSS ident cannot start with a digit, so it must be written as an
 * escaped code point: `01-foo` → `\30 1-foo` (leading `0` → `\30 `, rest kept).
 *
 * Only the leading digit needs escaping (per CSS Syntax Level 3 §4.3.11): once
 * the parser consumes the `\<hex> ` escape, the rest of the ident continues
 * normally, so `123-scene` → `\31 23-scene` is valid (the `23-scene` tail is
 * consumed as identifier continuation). The trailing space terminates the hex
 * escape so a following hex digit isn't folded into the code point.
 */
function escapeLeadingDigitIdent(id: string): string {
  return `\\${id.charCodeAt(0).toString(16)} ${id.slice(1)}`;
}

const REGEXP_SPECIALS = /[.*+?^${}()|[\]\\]/g;

/**
 * Fix `#<digit-leading-id>` selectors in the tree's `<style>` blocks.
 *
 * CSS identifiers cannot start with a digit, so an authored rule like
 * `#01-wall-pushes-back { width: 1920px; height: 1080px; background: #F0EBDE }`
 * is an invalid selector and the browser silently drops the WHOLE rule — taking
 * the root's size and background with it. In a full composition the frame is
 * stretched/painted by its `data-composition-src` host so the collapse is
 * masked, but a standalone preview has no host: the root falls back to
 * `height: 0` + transparent and the frame renders blank (black).
 *
 * Rewrite each such selector to its escaped, valid form (`#\30 1-wall-pushes-back`,
 * which still matches `id="01-wall-pushes-back"`) so the rule applies and the
 * whole declaration block — size, background, position, container-type — comes
 * back. Scoped to ids that are actually present on elements in the content and
 * matched only as `#id` not followed by another ident char, so hex colors
 * (`#1F2BE0`) and other values are never touched (they are not element ids).
 */
function fixDigitLeadingIdSelectors(root: ParentNode): void {
  const digitIds = new Set<string>();
  for (const el of root.querySelectorAll("[id]")) {
    const id = el.getAttribute("id");
    if (id && /^\d/.test(id)) digitIds.add(id);
  }
  if (digitIds.size === 0) return;

  for (const styleEl of root.querySelectorAll("style")) {
    let css = styleEl.textContent || "";
    for (const id of digitIds) {
      const pattern = new RegExp(`#${id.replace(REGEXP_SPECIALS, "\\$&")}(?![\\w-])`, "g");
      css = css.replace(pattern, `#${escapeLeadingDigitIdent(id)}`);
    }
    styleEl.textContent = css;
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
  // Run on the whole document: ids live in <body> but their rules may live in
  // a <head> <style>, so the scope must span both.
  fixDigitLeadingIdSelectors(doc);

  const headContent = doc.head?.innerHTML ?? "";
  const bodyContent = doc.body?.innerHTML ?? "";

  const htmlEl = doc.documentElement;
  const htmlAttrs = extractElementAttrs(htmlEl);
  const bodyAttrs = doc.body ? extractElementAttrs(doc.body) : "";

  return { headContent, bodyContent, htmlAttrs, bodyAttrs };
}

/**
 * Extract the inner HTML of the composition's wrapping `<template>` element, or
 * `null` if the source has no `<template>`.
 *
 * Located via the DOM rather than a regex. A greedy
 * `/<template[^>]*>([\s\S]*)<\/template>/` can latch onto a literal
 * `"<template>"` that appears inside an HTML comment — e.g. a head note such as
 * "the HF runtime clones ONLY <template> contents" — and mis-slice the capture,
 * leaving the real composition content re-wrapped in an inert `<template>` in
 * the output. That template is never rendered by the browser, so the standalone
 * preview has no `[data-composition-id]` element and no registered timeline, and
 * renders blank. `querySelector("template")` only ever matches a real element
 * node, so comment text can't fool it.
 */
function extractTemplateInnerHtml(rawComp: string): string | null {
  const { document: doc } = parseHTML(rawComp);
  const template = doc.querySelector("template");
  return template ? template.innerHTML : null;
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

const NON_RENDERED_TAGS = new Set(["SCRIPT", "STYLE", "LINK", "META", "TEMPLATE", "NOSCRIPT"]);

/**
 * Carry the `<template>`'s `data-composition-id` onto the content's root
 * rendered element when the author declared it only on the `<template>` tag.
 *
 * In a full composition, each sub-composition is mounted under a wrapper
 * element (the `data-composition-src` host) that carries the composition id,
 * which is how the runtime binds `window.__timelines[id]` into the player's
 * master timeline. A standalone preview has no such wrapper, so it relies on
 * the frame's own root element carrying `data-composition-id`. If the id lives
 * only on the inert `<template>` tag (a common authoring pattern), the rendered
 * body has no `[data-composition-id]` element — the runtime then never selects
 * a root composition, the registered GSAP timeline stays unbound, and seeking
 * does nothing. The frame renders at its pre-animation state (GSAP `fromTo`
 * pins `opacity:0`), producing a blank preview/thumbnail.
 *
 * This is a no-op when the content already exposes a `[data-composition-id]`
 * element (e.g. the id is authored on the root div), so compositions that
 * already render correctly are untouched.
 */
function promoteTemplateCompositionId(rawComp: string, body: Element): void {
  const templateCompositionId = rawComp.match(
    /<template[^>]*\sdata-composition-id\s*=\s*["']([^"']+)["']/i,
  )?.[1];
  if (!templateCompositionId) return;
  if (body.querySelector("[data-composition-id]")) return;

  const root = Array.from(body.children).find((el) => !NON_RENDERED_TAGS.has(el.tagName));
  root?.setAttribute("data-composition-id", templateCompositionId);
}

/**
 * Add `data-composition-file="<compPath>"` to the comp's root composition
 * element (the first `[data-composition-id]` that lacks the attribute), so the
 * studio resolves its top-level elements to the right source file. Idempotent;
 * a no-op when no composition element is present.
 */
function tagRootCompositionFile(bodyHtml: string, compPath: string): string {
  const match = bodyHtml.match(/<[a-zA-Z][^>]*\bdata-composition-id=/);
  if (match?.index == null) return bodyHtml;
  const tagEnd = bodyHtml.indexOf(">", match.index);
  if (tagEnd === -1) return bodyHtml;
  if (bodyHtml.slice(match.index, tagEnd).includes("data-composition-file")) return bodyHtml;
  return (
    bodyHtml.slice(0, tagEnd) + ` data-composition-file="${compPath}"` + bodyHtml.slice(tagEnd)
  );
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

  const templateInner = extractTemplateInnerHtml(rawComp);

  if (templateInner != null) {
    const { document: contentDoc } = parseHTML(
      `<!DOCTYPE html><html><head></head><body>${templateInner}</body></html>`,
    );
    rewriteRelativePaths(contentDoc, compPath);
    fixDigitLeadingIdSelectors(contentDoc);
    promoteTemplateCompositionId(rawComp, contentDoc.body);
    rewrittenContent = contentDoc.body.innerHTML || templateInner;
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
    fixDigitLeadingIdSelectors(contentDoc);
    rewrittenContent = contentDoc.body.innerHTML || rawComp;
  }

  // A composition file may ship a baked inline runtime (from a prior export:
  // data-hyperframes-runtime / __hyperframeRuntime…). The studio injects its own
  // preview runtime below, so strip the baked one from the body — otherwise it's
  // double-loaded AND the baked inline copy can fail to parse inline (the
  // "Unexpected token '<'" SyntaxError seen on comps with a baked runtime).
  rewrittenContent = stripEmbeddedRuntimeScripts(rewrittenContent);

  // The comp's root carries data-composition-id but (unlike inlined sub-comps,
  // which inlineSubCompositions tags) no data-composition-file. Without it the
  // studio can't resolve which file this comp's top-level elements live in and
  // falls back to "index.html" — so the GSAP panel parses the project root (which
  // may be a multi-timeline master) and wrongly reports "multiple timelines",
  // disabling editing for a single-timeline comp. Tag the root with its own path.
  rewrittenContent = tagRootCompositionFile(rewrittenContent, compPath);

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

  // Strip any baked runtime the borrowed index/comp <head> carried, for the same
  // reason as the body above — done before injecting the preview runtime so the
  // injected tag (added next) is never removed.
  headContent = stripEmbeddedRuntimeScripts(headContent);

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
