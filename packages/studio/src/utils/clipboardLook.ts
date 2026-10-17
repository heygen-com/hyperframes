import { copyAnimationsInScript } from "@hyperframes/parsers/gsap-writer-acorn";
import { scanHtmlOpeningTags } from "@hyperframes/parsers/html-attribute-spans";
import { clipboardAttributeRewrites, rebindClipboardUrls } from "./clipboardReferences";
import { rebindClipboardSelector, type ClipboardAttributeRewrite } from "./clipboardSelectors";
import { ID_ATTR_RE } from "./clipboardPayload";
import { escapeRegex } from "./sourcePatcher";

import { unownedElementCss } from "./elementClipboardStyleBlocks";

const ID_ATTRS = new RegExp(ID_ATTR_RE.source, "g");
// One pass over both, so a `<style>` written inside a script's text is left as script.
const BLOCKS =
  /(<script\b(?![^>]*\bsrc=)[^>]*>)([\s\S]*?)(<\/script>)|(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi;

function ownedStyle(opening: string): boolean {
  return (
    scanHtmlOpeningTags(opening)[0]?.attributes.some(
      (attr) => attr.name === "data-hf-element-style",
    ) ?? false
  );
}

/** Each id a paste renamed (`goodbye` to `goodbye-2`), from the same markup before and after the rename. */
export function renamedIds(before: string, after: string): Map<string, string> {
  const ids = (html: string) => Array.from(html.matchAll(ID_ATTRS), (match) => match[1] as string);
  const renamed = ids(after);
  const renames = new Map<string, string>();
  ids(before).forEach((from, index) => {
    const to = renamed[index];
    if (to && to !== from) renames.set(from, to);
  });
  return renames;
}

/** Gives each renamed copy the look and motion its original has in `html`: a copy of every CSS rule keyed to
 *  the original's id, and of every tween on it, moved by `delta` seconds. */
export function carryLook(
  html: string,
  renames: ReadonlyMap<string, string>,
  delta: number,
): string {
  let result = html;
  const attributes = clipboardAttributeRewrites(html, renames);
  for (const [from, to] of renames) {
    result = result.replace(
      BLOCKS,
      (block, scriptOpen, script, scriptClose, styleOpen, css, styleClose) =>
        scriptOpen !== undefined
          ? scriptOpen + copyAnimationsInScript(script, `#${from}`, `#${to}`, delta) + scriptClose
          : styleOpen !== undefined && !ownedStyle(styleOpen)
            ? styleOpen + withCopiedRules(css, from, renames, attributes) + styleClose
            : block,
    );
  }
  return result;
}

function withCopiedRules(
  css: string,
  from: string,
  renames: ReadonlyMap<string, string>,
  attributes: readonly ClipboardAttributeRewrite[],
): string {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(unownedElementCss(css));
  const indent = css.match(/\n([ \t]*)\S/)?.[1] ?? "";
  const copies = copiedCssRules(sheet.cssRules, from, indent, renames, attributes);
  if (copies.length === 0) return css;
  const body = css.trimEnd();
  return body + copies.join("") + css.slice(body.length);
}

function supportedCssGroup(rule: CSSRule): rule is CSSMediaRule | CSSSupportsRule {
  return rule.type === CSSRule.MEDIA_RULE || rule.type === CSSRule.SUPPORTS_RULE;
}

function copiedCssRules(
  rules: CSSRuleList,
  from: string,
  indent: string,
  renames: ReadonlyMap<string, string>,
  attributes: readonly ClipboardAttributeRewrite[],
): string[] {
  const id = new RegExp(`#${escapeRegex(from)}(?![\\w-])`, "g");
  const excluded = new RegExp(`:not\\([^)]*#${escapeRegex(from)}(?![\\w-])`);
  return Array.from(rules).flatMap((rule) => {
    // Keep the same conditions when copying rules nested in a supported group.
    if (supportedCssGroup(rule)) {
      const copies = copiedCssRules(rule.cssRules, from, indent + "  ", renames, attributes);
      const header = rule.cssText.slice(0, rule.cssText.indexOf("{"));
      return copies.length ? [`\n${indent}${header}{${copies.join("")}\n${indent}}`] : [];
    }
    if (!(rule instanceof CSSStyleRule)) return [];
    // Only the selectors naming the original, so the copy restyles nothing else.
    const selectors = selectorList(rule.selectorText).filter(
      (selector) => selector.match(id) && !excluded.test(selector),
    );
    if (selectors.length === 0) return [];
    const copied = selectors
      .map((selector) => rebindClipboardSelector(selector, renames, attributes))
      .join(", ");
    return [
      `\n${indent}${copied}${rebindClipboardUrls(rule.cssText.slice(rule.selectorText.length), renames)}`,
    ];
  });
}

/** A selector list's own entries: its commas outside brackets and parentheses. */
function selectorList(text: string): string[] {
  const selectors: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth--;
    else if (char === "," && depth === 0) {
      selectors.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  selectors.push(text.slice(start).trim());
  return selectors;
}
