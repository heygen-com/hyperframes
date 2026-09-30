import { copyAnimationsInScript } from "@hyperframes/parsers/gsap-writer-acorn";
import { ID_ATTR_RE } from "./clipboardPayload";
import { escapeRegex } from "./sourcePatcher";

const ID_ATTRS = new RegExp(ID_ATTR_RE.source, "g");
const STYLE_BLOCK = /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi;
const INLINE_SCRIPT = /(<script\b(?![^>]*\bsrc=)[^>]*>)([\s\S]*?)(<\/script>)/gi;

/** Each id a paste renamed (`goodbye` to `goodbye-2`), from the same markup before and after the rename. */
export function renamedIds(before: string, after: string): Map<string, string> {
  const renamed = Array.from(after.matchAll(ID_ATTRS), (match) => match[1] as string);
  const renames = new Map<string, string>();
  Array.from(before.matchAll(ID_ATTRS), (match, index) => {
    const to = renamed[index];
    if (to && to !== match[1]) renames.set(match[1] as string, to);
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
  for (const [from, to] of renames) {
    result = result
      .replace(STYLE_BLOCK, (_, open, css, close) => open + withCopiedRules(css, from, to) + close)
      .replace(
        INLINE_SCRIPT,
        (_, open, script, close) =>
          open + copyAnimationsInScript(script, `#${from}`, `#${to}`, delta) + close,
      );
  }
  return result;
}

// ponytail: top-level rules only; a rule inside @media or @supports is not copied.
function withCopiedRules(css: string, from: string, to: string): string {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  const id = new RegExp(`#${escapeRegex(from)}(?![\\w-])`, "g");
  const indent = css.match(/\n([ \t]*)\S/)?.[1] ?? "";
  const copies = Array.from(sheet.cssRules).flatMap((rule) => {
    if (!(rule instanceof CSSStyleRule) || !rule.selectorText.match(id)) return [];
    const selector = rule.selectorText.replace(id, `#${to}`);
    return [`\n${indent}${selector}${rule.cssText.slice(rule.selectorText.length)}`];
  });
  if (copies.length === 0) return css;
  const body = css.trimEnd();
  return body + copies.join("") + css.slice(body.length);
}
