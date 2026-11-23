import type { ElementDom, ElementNode } from "./elementMap.js";
import type { AuthoredHtml, HtmlTag as SourceTag } from "./sources";

const PLAIN_CLASS = /^[a-zA-Z_-][\w-]*$/;

export function withAuthoredState(snapshot: ElementDom, sources: AuthoredHtml): ElementDom {
  const byHfId = group(sources.htmlTags, (tag) => tag.hfId);
  const byId = group(sources.htmlTags, (tag) => tag.id);
  const live = snapshot.nodes;
  const matched = live.map((node) => sourceTag(node, byHfId, byId));
  const generated = generatedInsideText(live, matched, sources);
  const nodes = live.map((node, index) =>
    generated.has(index)
      ? steadyGenerated(node, live, generated)
      : authoredNode(node, matched[index], sources, live),
  );
  return { ...snapshot, nodes };
}

function authoredNode(
  node: ElementNode,
  tag: SourceTag | undefined,
  sources: AuthoredHtml,
  live: ElementNode[],
): ElementNode {
  if (!tag) return node;
  const text = directText(sources, tag) ?? node.text;
  const id = node.id || tag.id || "";
  const classes = authoredClasses(node, tag, live);
  const next = { ...node, text, id };
  return classes ? { ...next, ...classes } : next;
}

function generatedInsideText(
  live: ElementNode[],
  matched: (SourceTag | undefined)[],
  sources: AuthoredHtml,
) {
  const generated = new Set<number>();
  for (const [index, tag] of matched.entries()) {
    if (!tag || !directText(sources, tag)) continue;
    for (const child of live[index]!.children)
      if (!matched[child]) markGenerated(child, live, matched, generated);
  }
  return generated;
}

function markGenerated(
  index: number,
  live: ElementNode[],
  matched: (SourceTag | undefined)[],
  generated: Set<number>,
) {
  if (generated.has(index) || matched[index]) return;
  generated.add(index);
  for (const child of live[index]!.children) markGenerated(child, live, matched, generated);
}

function steadyGenerated(
  node: ElementNode,
  live: ElementNode[],
  generated: Set<number>,
): ElementNode {
  const siblings =
    node.parent === null ? [node] : live[node.parent]!.children.map((index) => live[index]!);
  const siblingMatchCount = siblings.filter(
    (other) => generated.has(other.index) && other.tag === node.tag,
  ).length;
  return {
    ...node,
    id: "",
    classes: [],
    text: "",
    generated: true,
    groupSelector: node.tag,
    relative: `${node.tag}:nth-child(${node.position})`,
    siblingMatchCount,
  };
}

function group(tags: SourceTag[], key: (tag: SourceTag) => string | undefined) {
  const groups = new Map<string, SourceTag[]>();
  for (const tag of tags) {
    const value = key(tag);
    if (value) groups.set(value, [...(groups.get(value) ?? []), tag]);
  }
  return groups;
}

function sourceTag(
  node: ElementNode,
  byHfId: Map<string, SourceTag[]>,
  byId: Map<string, SourceTag[]>,
): SourceTag | undefined {
  const named = (node.hfId && byHfId.get(node.hfId)) || (node.id && byId.get(node.id)) || [];
  const matches = named.filter((tag) => tag.tag === node.tag);
  return matches.length === 1 ? matches[0] : undefined;
}

const RAW_TEXT = new Set(["script", "style", "textarea", "title", "xmp", "noembed", "noframes"]);
const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

function directText(sources: AuthoredHtml, tag: SourceTag): string | null {
  const text = sources.files.get(tag.file)?.text;
  if (text === undefined) return null;
  if (VOID.has(tag.tag)) return "";
  return normalizedInner(text, tag);
}

function normalizedInner(text: string, tag: SourceTag): string | null {
  const inner = sliceUntilClose(text, tag.end, tag.tag);
  if (inner === null) return null;
  return decodeEntities(textNodes(inner)).replace(/\s+/g, " ").trim();
}

function sliceUntilClose(html: string, from: number, tag: string): string | null {
  const end = closeOffset(html, from, tag, 1);
  return end === null ? null : html.slice(from, end);
}

function closeOffset(html: string, from: number, tag: string, depth: number): number | null {
  let cursor = from;
  let level = depth;
  for (;;) {
    const step = closeStep(html, cursor, tag, level);
    if (!step) return null;
    if (step.done) return step.at;
    cursor = step.at;
    level = step.depth;
  }
}

function closeStep(html: string, from: number, tag: string, depth: number): Step | null {
  const found = nextMarkup(html, from);
  if (!found) return null;
  if (found.kind !== "tag") return { at: found.end, depth, done: false };
  if (isRawOpen(found)) return rawStep(html, found, depth);
  return tagStep(found, tag, depth);
}

function isRawOpen(found: TagMarkup): boolean {
  return !found.closing && RAW_TEXT.has(found.name);
}

type Step = { at: number; depth: number; done: boolean };

function rawStep(html: string, found: TagMarkup, depth: number): Step | null {
  const rawEnd = rawElementEnd(html.toLowerCase(), found.name, found.bracket);
  if (rawEnd < 0) return null;
  return { at: rawEnd, depth, done: false };
}

function tagStep(found: TagMarkup, tag: string, depth: number): Step {
  const same = found.name === tag && !VOID.has(found.name);
  if (!same || !found.closing) return openStep(found, depth, same);
  return closingStep(found, depth);
}

function closingStep(found: TagMarkup, depth: number): Step {
  if (depth === 1) return { at: found.start, depth, done: true };
  return { at: found.bracket + 1, depth: depth - 1, done: false };
}

function openStep(found: TagMarkup, depth: number, same: boolean): Step {
  const nextDepth = same ? depth + 1 : depth;
  return { at: found.bracket + 1, depth: nextDepth, done: false };
}

function textNodes(inner: string): string {
  const found = nextMarkup(inner, 0);
  if (!found) return inner;
  return inner.slice(0, found.start) + textAfter(inner, found);
}

function textAfter(inner: string, found: Markup): string {
  if (found.kind !== "tag") return textNodes(inner.slice(found.end));
  return textAfterTag(inner, found);
}

function textAfterTag(inner: string, found: TagMarkup): string {
  if (skipsTag(found)) return textNodes(inner.slice(found.bracket + 1));
  if (RAW_TEXT.has(found.name)) return textAfterRaw(inner, found);
  return textAfterChild(inner, found);
}

function skipsTag(found: TagMarkup): boolean {
  return found.closing || VOID.has(found.name);
}

function textAfterRaw(inner: string, found: TagMarkup): string {
  const rawEnd = rawElementEnd(inner.toLowerCase(), found.name, found.bracket);
  return textNodes(inner.slice(rawEnd < 0 ? inner.length : rawEnd));
}

function textAfterChild(inner: string, found: TagMarkup): string {
  const child = sliceUntilClose(inner, found.bracket + 1, found.name);
  if (child === null) return "";
  const closeBracket = inner.indexOf(">", found.bracket + 1 + child.length);
  return textNodes(inner.slice(closeBracket < 0 ? inner.length : closeBracket + 1));
}

type SkipMarkup = { kind: "skip"; start: number; end: number };
type TagMarkup = { kind: "tag"; start: number; name: string; closing: boolean; bracket: number };
type Markup = SkipMarkup | TagMarkup;

function nextMarkup(html: string, from: number): Markup | null {
  const start = html.indexOf("<", from);
  if (start < 0) return null;
  return markupAt(html, start);
}

function markupAt(html: string, start: number): Markup | null {
  const skipped = skippedMarkup(html, start);
  if (skipped) return skipped;
  return tagMarkup(html, start);
}

function skippedMarkup(html: string, start: number): SkipMarkup | null {
  if (html.startsWith("<!--", start)) return boundedSkip(html, start, "-->", 4);
  if (html.startsWith("<!", start) || html.startsWith("<?", start))
    return boundedSkip(html, start, ">", 1);
  return null;
}

function boundedSkip(html: string, start: number, marker: string, from: number): SkipMarkup | null {
  const end = html.indexOf(marker, start + from);
  return end < 0 ? null : { kind: "skip", start, end: end + marker.length };
}

function tagMarkup(html: string, start: number): Markup | null {
  const name = /^<\/?([a-zA-Z][^\s/>]*)/.exec(html.slice(start, start + 128));
  if (!name) return { kind: "skip", start, end: start + 1 };
  const bracket = closingBracket(html, start + name[0].length);
  if (bracket < 0) return null;
  return {
    kind: "tag",
    start,
    name: name[1]!.toLowerCase(),
    closing: html[start + 1] === "/",
    bracket,
  };
}

function rawElementEnd(lower: string, tag: string, openBracket: number): number {
  const marker = `</${tag}`;
  const at = nextRawClose(lower, marker, openBracket + 1);
  if (at < 0) return -1;
  const bracket = lower.indexOf(">", at + marker.length);
  return bracket < 0 ? -1 : bracket + 1;
}

function nextRawClose(lower: string, marker: string, from: number): number {
  const at = lower.indexOf(marker, from);
  if (at < 0) return -1;
  const next = lower[at + marker.length];
  if (closesRawText(next)) return at;
  return nextRawClose(lower, marker, at + marker.length);
}

function closesRawText(next: string | undefined): boolean {
  return next !== undefined && /[\s/>]/.test(next);
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

function decodeEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
    (entity, body: string) => {
      const named: Record<string, string> = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
        nbsp: " ",
      };
      const lower = body.toLowerCase();
      if (lower in named) return named[lower]!;
      const code = Number.parseInt(
        lower.slice(lower.startsWith("#x") ? 2 : 1),
        lower.startsWith("#x") ? 16 : 10,
      );
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : entity;
    },
  );
}

function authoredClasses(node: ElementNode, tag: SourceTag, live: ElementNode[]) {
  const classes = [...tag.classes];
  if (classes.join(" ") === node.classes.join(" ")) return null;
  if (!classes.every((c) => PLAIN_CLASS.test(c) && node.classes.includes(c))) return null;
  const simple = `${node.tag}${classes.map((c) => `.${c}`).join("")}`;
  const siblings = node.parent === null ? [node] : live[node.parent]!.children.map((i) => live[i]!);
  const siblingMatchCount = siblings.filter(
    (other) => other.tag === node.tag && classes.every((c) => other.classes.includes(c)),
  ).length;
  const relative = node.relative.startsWith("#")
    ? node.relative
    : siblingMatchCount === 1
      ? simple
      : `${node.tag}:nth-child(${node.position})`;
  return { classes, groupSelector: simple, siblingMatchCount, relative };
}
