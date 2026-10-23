import {
  isFunctionNode,
  isTokenNode,
  isWhiteSpaceOrCommentNode,
  parseListOfComponentValues,
  sourceIndices,
} from "@csstools/css-parser-algorithms";
import { isTokenIdent, isTokenString, isTokenURL, tokenize } from "@csstools/css-tokenizer";
import { decodedUrlPath } from "@hyperframes/parsers/asset-paths";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import postcss, { CssSyntaxError, type AtRule, type Container, type Rule } from "postcss";
import { createFontMediaEvaluator, type MediaTruth } from "./fontMediaQuery.js";
import type { FontMediaContext } from "./fontMediaContext.js";

export function parseCssRoot(css: string): postcss.Root | null {
  if (!/font-family|--|@import/i.test(css)) return null;
  try {
    return postcss.parse(css);
  } catch (error) {
    if (error instanceof CssSyntaxError) return null;
    throw error;
  }
}

// The @import prelude grammar: CSS Cascade 5, "Importing Style Sheets".
// fallow-ignore-next-line complexity
export function parseStylesheetImport(params: string): {
  source: string;
  url: string;
  media: string;
  hasLayer: boolean;
  hasSupportsCondition: boolean;
} | null {
  let invalid = false;
  const onParseError = () => {
    invalid = true;
  };
  const nodes = parseListOfComponentValues(tokenize({ css: params }, { onParseError }), {
    onParseError,
  }).filter((node) => !isWhiteSpaceOrCommentNode(node));
  if (invalid) return null;
  const first = nodes[0];
  if (!first) return null;
  let url: string;
  if (isTokenNode(first) && (isTokenString(first.value) || isTokenURL(first.value))) {
    url = first.value[4].value;
  } else if (isFunctionNode(first) && first.getName().toLowerCase() === "url") {
    const contents = first.value.filter((node) => !isWhiteSpaceOrCommentNode(node));
    const value = contents[0];
    if (contents.length !== 1 || !value || !isTokenNode(value) || !isTokenString(value.value))
      return null;
    url = value.value[4].value;
  } else return null;
  let index = 1;
  const layer = nodes[index];
  const hasLayer =
    !!layer &&
    ((isTokenNode(layer) &&
      isTokenIdent(layer.value) &&
      layer.value[4].value.toLowerCase() === "layer") ||
      (isFunctionNode(layer) && layer.getName().toLowerCase() === "layer"));
  if (hasLayer) index++;
  const supports = nodes[index];
  const hasSupportsCondition =
    !!supports && isFunctionNode(supports) && supports.getName().toLowerCase() === "supports";
  if (hasSupportsCondition) index++;
  const remaining = nodes[index];
  return {
    source: params.slice(sourceIndices(first)[0], sourceIndices(first)[1] + 1),
    url,
    media: remaining ? params.slice(sourceIndices(remaining)[0]).trim() : "",
    hasLayer,
    hasSupportsCondition,
  };
}

function importTruth(
  imported: NonNullable<ReturnType<typeof parseStylesheetImport>>,
  evaluate: MediaEvaluator,
): MediaTruth {
  const media = evaluate(imported.media);
  if (media === false) return false;
  return imported.hasSupportsCondition ? "unknown" : media;
}

type MediaEvaluator = ReturnType<typeof createFontMediaEvaluator>;
type PropertyAlternatives<Values = ReadonlySet<string>> = {
  readonly values: Values;
  readonly mayBeUnset: boolean;
};
export type FontCustomPropertyValue = string | PropertyAlternatives;

function conditionalTruth(node: AtRule, evaluate: MediaEvaluator): MediaTruth {
  switch (node.name.toLowerCase()) {
    case "media":
      return evaluate(node.params);
    case "font-face":
    case "layer":
      return true;
    default:
      return "unknown";
  }
}
function conditionAccepted(value: MediaTruth, includeUnknown: boolean): boolean {
  return value === true || (value === "unknown" && includeUnknown);
}
// @import and conditional group rules: CSS Conditional 3, "Processing of conditional group rules".
// fallow-ignore-next-line complexity
function activeCss(container: Container, evaluate: MediaEvaluator, includeUnknown: boolean): void {
  for (const node of [...(container.nodes ?? [])]) {
    if (node.type === "atrule" && node.name.toLowerCase() === "import") {
      const imported = parseStylesheetImport(node.params);
      if (!imported || !conditionAccepted(importTruth(imported, evaluate), includeUnknown))
        node.remove();
      else node.params = imported.source;
      continue;
    }
    if (node.type === "atrule" && node.nodes) {
      const truth = conditionalTruth(node, evaluate);
      if (!conditionAccepted(truth, includeUnknown)) {
        node.remove();
        continue;
      }
      activeCss(node, evaluate, includeUnknown);
      // Preserve unknown ancestry for custom-property candidate discovery.
      if (node.name.toLowerCase() === "media" && truth === true)
        node.replaceWith(...(node.nodes ?? []));
      continue;
    }
    if ("nodes" in node && node.nodes) activeCss(node, evaluate, includeUnknown);
  }
}

function stylesheetActive(element: Element, matches: (media: string | null) => boolean): boolean {
  if (
    element.localName === "link" &&
    (element.hasAttribute("disabled") || !(element.getAttribute("href") ?? "").trim())
  )
    return false;
  if (!matches(element.getAttribute("media"))) return false;
  const type = (element.getAttribute("type") ?? "").trim().toLowerCase();
  return type === "" || type === "text/css";
}

function localStylesheetPath(element: Element, baseDir: string | undefined): string | null {
  if (!baseDir) return null;
  const href = element.getAttribute("href") ?? "";
  if (!href || /^([a-z][a-z\d+.-]*:|\/\/)/i.test(href)) return null;
  const path = join(baseDir, decodedUrlPath(href));
  return statSync(path, { throwIfNoEntry: false })?.isFile() ? path : null;
}

// Document-order walk of CSSOM "add a CSS style sheet" and the preferred style sheet set steps.
// fallow-ignore-next-line complexity
export function analyzeFontStylesheets(
  html: string,
  context: FontMediaContext,
  baseDir?: string,
  purpose: "discovery" | "suppression" = "discovery",
): string {
  const evaluate = createFontMediaEvaluator(context);
  const matches = (media: string | null): boolean =>
    conditionAccepted(evaluate(media), purpose === "discovery");
  const { document } = parseHTML(html);
  let preferredTitle = "";
  for (const element of Array.from(document.querySelectorAll("meta, style, link"))) {
    if (element.localName === "meta") {
      if (
        preferredTitle === "" &&
        (element.getAttribute("http-equiv") ?? "").toLowerCase() === "default-style"
      )
        preferredTitle = element.getAttribute("content") ?? "";
      continue;
    }
    const rel =
      element.localName === "link"
        ? (element.getAttribute("rel") ?? "").toLowerCase().split(/\s+/)
        : [];
    if (element.localName === "link" && !rel.includes("stylesheet")) continue;
    if (!stylesheetActive(element as unknown as Element, () => true)) {
      element.remove();
      continue;
    }
    const title = element.getAttribute("title") ?? "";
    const alternate = rel.includes("alternate");
    // Preferred names are selected before media matching, including by empty CSS sheets.
    if (preferredTitle === "" && title !== "" && !alternate) preferredTitle = title;
    if (
      (alternate && title === "") ||
      (title !== "" && title !== preferredTitle) ||
      !matches(element.getAttribute("media"))
    ) {
      element.remove();
      continue;
    }
    // Canonical analysis is re-read downstream; selection must not be decided again after filtering.
    element.removeAttribute("title");
    if (alternate)
      element.setAttribute("rel", rel.filter((token) => token !== "alternate").join(" "));
    if (evaluate(element.getAttribute("media")) !== "unknown") element.removeAttribute("media");
    if (element.localName === "link") {
      const path = localStylesheetPath(element as unknown as Element, baseDir);
      if (!path) continue;
      const style = document.createElement("style");
      const media = element.getAttribute("media");
      if (media !== null) style.setAttribute("media", media);
      const css = parseCssRoot(readFileSync(path, "utf8"));
      if (css) activeCss(css, evaluate, purpose === "discovery");
      style.textContent = css?.toString() ?? "";
      // Analysis follows document order; the emitted document retains the authored link.
      element.replaceWith(style);
      continue;
    }
    const css = parseCssRoot(element.textContent ?? "");
    if (css) activeCss(css, evaluate, purpose === "discovery");
    element.textContent = css?.toString() ?? "";
  }
  return document.toString();
}

/** A declaration under an uncertain condition adds an alternative; a certain one replaces the value. */
function recordCustomProperty(
  properties: Map<string, string | PropertyAlternatives<Set<string>>>,
  name: string,
  value: string,
  uncertain: boolean,
): void {
  if (!uncertain) {
    properties.set(name, value);
    return;
  }
  const previous = properties.get(name);
  if (typeof previous === "string") {
    properties.set(name, { values: new Set([previous, value]), mayBeUnset: false });
  } else if (previous === undefined) {
    properties.set(name, { values: new Set([value]), mayBeUnset: true });
  } else {
    previous.values.add(value);
  }
}

/** Whether rules under `node` are uncertain, or null when its condition is false. */
function nestedUncertainty(
  node: AtRule | Rule,
  uncertain: boolean,
  evaluate: MediaEvaluator,
): boolean | null {
  const truth = node.type === "atrule" ? conditionalTruth(node, evaluate) : true;
  return truth === false ? null : uncertain || truth === "unknown";
}

export function collectFontFamilyCustomPropertyCandidates(
  html: string,
  context: FontMediaContext,
): ReadonlyMap<string, FontCustomPropertyValue> {
  const evaluate = createFontMediaEvaluator(context);
  const properties = new Map<string, string | PropertyAlternatives<Set<string>>>();
  const collect = (container: Container, uncertain: boolean): void => {
    for (const node of container.nodes ?? []) {
      if (node.type === "decl") {
        if (node.prop.startsWith("--"))
          recordCustomProperty(properties, node.prop, node.value, uncertain);
        continue;
      }
      if (!("nodes" in node) || !node.nodes) continue;
      const nested = nestedUncertainty(node, uncertain, evaluate);
      if (nested !== null) collect(node, nested);
    }
  };
  const { document } = parseHTML(html);
  for (const style of Array.from(document.querySelectorAll("style"))) {
    if (
      !stylesheetActive(style as unknown as Element, (media) =>
        conditionAccepted(evaluate(media), true),
      )
    )
      continue;
    const css = parseCssRoot(style.textContent ?? "");
    if (css) collect(css, evaluate(style.getAttribute("media")) === "unknown");
  }
  for (const element of Array.from(document.querySelectorAll("[style]"))) {
    const css = parseCssRoot(`*{${element.getAttribute("style") ?? ""}}`);
    if (css) collect(css, false);
  }
  return properties;
}
