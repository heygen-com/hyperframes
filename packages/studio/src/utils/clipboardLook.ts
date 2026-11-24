import { copyAnimationsInScript } from "@hyperframes/parsers/gsap-writer-acorn";
import { tagsOutsideCommentsAndRawText } from "@hyperframes/core/compiler/html-document";
import { escapeRegex } from "./sourcePatcher";

/** Gives each renamed copy the look and motion its original has in `html`: a copy of every CSS rule keyed to
 *  the original's id, and of every tween on it, moved by `delta` seconds. Only real <style> and inline <script>
 *  elements are read, found with the tag scanner, so text in a comment or another element is never touched. */
export function carryLook(
  html: string,
  renames: ReadonlyMap<string, string>,
  delta: number,
): string {
  let result = html;
  for (const [from, to] of renames) {
    result = editBlocks(result, (kind, text) =>
      kind === "script"
        ? copyAnimationsInScript(text, `#${from}`, `#${to}`, delta)
        : withCopiedRules(text, from, to),
    );
  }
  return result;
}

function editBlocks(
  html: string,
  edit: (kind: "script" | "style", text: string) => string,
): string {
  const tags = [...tagsOutsideCommentsAndRawText(html)];
  let out = "";
  let at = 0;
  tags.forEach((tag, index) => {
    const kind = tag.lowercaseName;
    if (tag.closing || (kind !== "script" && kind !== "style")) return;
    if (kind === "script" && /\ssrc\s*=/i.test(html.slice(tag.start, tag.endAfterBracket))) return;
    const close = tags.slice(index + 1).find((t) => t.closing && t.lowercaseName === kind);
    if (!close) return;
    out +=
      html.slice(at, tag.endAfterBracket) +
      edit(kind, html.slice(tag.endAfterBracket, close.start));
    at = close.start;
  });
  return out + html.slice(at);
}

// Top-level rules only: a rule inside @media or @supports is not copied.
function withCopiedRules(css: string, from: string, to: string): string {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  const id = new RegExp(`#${escapeRegex(from)}(?![\\w-])`, "g");
  const excluded = new RegExp(`:not\\([^)]*#${escapeRegex(from)}(?![\\w-])`);
  const indent = css.match(/\n([ \t]*)\S/)?.[1] ?? "";
  const copies = Array.from(sheet.cssRules).flatMap((rule) => {
    if (!(rule instanceof CSSStyleRule)) return [];
    // Only the selectors naming the original, so the copy restyles nothing else.
    const selectors = selectorList(rule.selectorText).filter(
      (selector) => selector.match(id) && !excluded.test(selector),
    );
    if (selectors.length === 0) return [];
    const copied = selectors.map((selector) => selector.replace(id, `#${to}`)).join(", ");
    const text = `${copied}${rule.cssText.slice(rule.selectorText.length)}`;
    // Raw <style> text ends at "</style": a rule holding "<" is not copied.
    return text.includes("<") ? [] : [`\n${indent}${text}`];
  });
  if (copies.length === 0) return css;
  const body = css.trimEnd();
  return body + copies.join("") + css.slice(body.length);
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
