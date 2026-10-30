/**
 * Stable hf- element id minting (R1). Node-safe (linkedom only, not browser DOM).
 *
 * Two surfaces share these helpers:
 *  - ensureHfIds(html): node-id surface — mints data-hf-id on every element.
 *  - mintHfId(el, assigned): shared by htmlParser for clip ids.
 *
 * Hash is CONTENT ONLY (tag + sorted attrs + own text) — no sibling position,
 * so inserting a non-identical sibling never shifts another element's id.
 */
import { parseHTML } from "linkedom";
import { assignHfIds, getChildElements } from "./hfIdAssignment.js";
export {
  EXCLUDED_TAGS,
  mintHfId,
  isCompositionTemplate,
  walkCompositionDescendants,
} from "./hfIdAssignment.js";

export function ensureHfIds(html: string): string {
  const { document, wrapped } = parseFragmentOrDocument(html);
  if (!document.body) return html;
  assignHfIds(document.body);
  return wrapped ? document.body.innerHTML || "" : document.toString();
}

function parseFragmentOrDocument(html: string) {
  // Wrap fragments so every body element participates in stable ID assignment.
  const wrapped = !/^(?:<!doctype|<html[\s>/])/i.test(
    html.replace(/^(?:\s|<!--(?:>|->|[\s\S]*?-->))*/, ""),
  );
  const { document } = wrapped
    ? parseHTML(`<!DOCTYPE html><html><head></head><body>${html}</body></html>`)
    : parseHTML(html);
  return { document, wrapped };
}

/** ensureHfIds for a file someone edits: the same ids, inserted into the source text so nothing else in it changes.
 * Markup whose tags the parser did not keep one-to-one falls back to ensureHfIds. */
export function stampHfIdsInPlace(html: string): string {
  const { document, wrapped } = parseFragmentOrDocument(html);
  if (!document.body) return html;
  const elements = wrapped
    ? getChildElements(document.body).flatMap(inDocumentOrder)
    : inDocumentOrder(document.documentElement);
  const existing = elements.map((el) => el.getAttribute("data-hf-id"));
  const pinned = existing.map((id) => id !== null && id.length > 0);
  assignHfIds(document.body);
  const minted = elements.map((el, n) => (pinned[n] ? null : el.getAttribute("data-hf-id")));
  const tags = startTags(html);
  const inserts = tags && alignInserts(html, tags, elements, minted, existing);
  return inserts ? spliceIds(html, inserts) : ensureHfIds(html);
}

function inDocumentOrder(el: Element): Element[] {
  return [el, ...getChildElements(el).flatMap(inDocumentOrder)];
}

const RAW_TEXT = new Set(["script", "style", "textarea", "title", "xmp", "noembed", "noframes"]);
const IMPLIED = new Set(["html", "head", "body", "tbody"]);

type StartTag = { name: string; nameEnd: number; bracket: number };

function startTags(html: string): StartTag[] | null {
  const tags: StartTag[] = [];
  let i = html.indexOf("<");
  while (i >= 0) {
    const name = html.startsWith("<!--", i)
      ? null
      : /^<([a-zA-Z][^\s/>]*)/.exec(html.slice(i, i + 128));
    if (!name) {
      i = nextTagAfter(html, i);
      continue;
    }
    const end = closingBracket(html, i + name[0].length);
    if (end < 0) return null;
    const tag = name[1]!.toLowerCase();
    tags.push({ name: tag, nameEnd: i + name[0].length, bracket: end });
    const after = RAW_TEXT.has(tag) ? rawTextEnd(html, tag, end) : end;
    i = after < 0 ? -1 : html.indexOf("<", after + 1);
  }
  return tags;
}

function rawTextEnd(html: string, tag: string, from: number): number {
  const endTag = new RegExp(`</${tag}(?=[\\s/>]|$)`, "gi");
  endTag.lastIndex = from;
  return endTag.exec(html)?.index ?? -1;
}

function nextTagAfter(html: string, lt: number): number {
  const comment = html.startsWith("<!--", lt);
  const end = comment ? html.indexOf("-->", lt + 4) : html.indexOf(">", lt);
  return end < 0 ? -1 : html.indexOf("<", end + 1);
}

function closingBracket(html: string, from: number): number {
  let quote = "";
  for (let i = from; i < html.length; i++) {
    const c = html[i];
    if (quote) quote = c === quote ? "" : quote;
    else if (c === '"' || c === "'") quote = c;
    else if (c === ">") return i;
  }
  return -1;
}

type Insert = { at: number; text: string };

function alignInserts(
  html: string,
  tags: StartTag[],
  elements: Element[],
  minted: (string | null)[],
  existing: (string | null)[],
) {
  const walked = walkAlign(html, tags, elements, minted, existing);
  if (!walked) return null;
  return walked.next === tags.length ? walked.inserts : null;
}

function walkAlign(
  html: string,
  tags: StartTag[],
  elements: Element[],
  minted: (string | null)[],
  existing: (string | null)[],
) {
  const state = { inserts: [] as Insert[], next: 0 };
  for (const [n, el] of elements.entries()) {
    if (!take(state, html, tags, el, minted[n] ?? null, existing[n] === "")) return null;
  }
  return state;
}

function take(
  state: { inserts: Insert[]; next: number },
  html: string,
  tags: StartTag[],
  el: Element,
  id: string | null,
  fillEmpty: boolean,
) {
  const step = alignOne(html, tags[state.next], el, id, fillEmpty);
  if (!step) return false;
  if (step.insert) state.inserts.push(step.insert);
  if (step.next) state.next += 1;
  return true;
}

function alignOne(
  html: string,
  tag: StartTag | undefined,
  el: Element,
  id: string | null,
  fillEmpty: boolean,
) {
  if (tag?.name === el.tagName.toLowerCase()) return matched(html, tag, id, fillEmpty);
  if (IMPLIED.has(el.tagName.toLowerCase()) && !id) return { insert: null, next: false };
  return null;
}

function matched(html: string, tag: StartTag, id: string | null, fillEmpty: boolean) {
  if (!id) return { insert: null, next: true };
  const placed = placeId(html, tag, id, fillEmpty);
  if (!placed) return null;
  return { insert: placed, next: true };
}

function placeId(html: string, tag: StartTag, id: string, fillEmpty: boolean) {
  if (!fillEmpty) return { at: tag.nameEnd, text: ` data-hf-id="${id}"` };
  const emptyAt = emptyHfIdValue(html, tag);
  if (emptyAt === null) return null;
  return { at: emptyAt, text: id };
}

function emptyHfIdValue(html: string, tag: StartTag): number | null {
  const open = outsideQuotes(html.slice(tag.nameEnd, tag.bracket));
  const match = /\sdata-hf-id\s*=\s*(["'])\1/i.exec(open);
  if (!match) return null;
  return tag.nameEnd + match.index + match[0].length - 1;
}

function outsideQuotes(open: string): string {
  let quote = "";
  let out = "";
  for (const c of open) {
    out += quotedChar(quote, c);
    quote = quoteOf(quote, c);
  }
  return out;
}

function quoteOf(quote: string, c: string): string {
  if (quote) return c === quote ? "" : quote;
  return c === '"' || c === "'" ? c : "";
}

function quotedChar(quote: string, c: string): string {
  if (!quote || c === quote) return c;
  return " ".repeat(c.length);
}

function spliceIds(html: string, inserts: Insert[]): string {
  let out = "";
  let from = 0;
  for (const { at, text } of inserts) {
    out += html.slice(from, at) + text;
    from = at;
  }
  return out + html.slice(from);
}
