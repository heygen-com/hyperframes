import { posix, sep } from "node:path";
import { decodeCssEscapes, decodedUrlPath, encodeUrlPath } from "@hyperframes/parsers/asset-paths";
import {
  HTML_ATTRIBUTE_ENTITIES,
  decodeAuthoredAttribute,
  scanHtmlOpeningTags,
  type HtmlAttributeSpan,
} from "@hyperframes/parsers/html-attribute-spans";
import { decodeWellFormedEscapes } from "./requestSubPath.js";

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const SEPARATOR = String.raw`\\{0,2}[\\/]`;
const REFERENCE_START = String.raw`(?<![\w./\\+-])`;
const FILE_END = String.raw`(?![\w-]|\.\w)`;

const ENTITY_SPELLINGS = HTML_ATTRIBUTE_ENTITIES;

const BACKSLASHED = ["'", '"', "`", "$", " ", "(", ")"];

function urlSpellings(char: string): string[] {
  const encoded = encodeUrlPath(char);
  return encoded === char
    ? []
    : [encoded.replace(/[A-F]/g, (hex) => `[${hex}${hex.toLowerCase()}]`)];
}

function escapedSpellings(char: string): string[] {
  const spellings = BACKSLASHED.includes(char)
    ? [escapeRegExp(`&#92;${char}`), escapeRegExp(`&#92;${escapeHtmlReference(char)}`)]
    : [];
  const scriptSpelling = escapeQuotedReference(char, '"');
  if (scriptSpelling !== char) spellings.push(escapeRegExp(scriptSpelling));
  if (BACKSLASHED.includes(char) && char !== '"') spellings.push(escapeRegExp(`\\${char}`));
  return spellings;
}

function controlSpellings(char: string): string[] {
  const spellings = /[\t\n\f\r =<>`]/.test(char) ? [`&#${char.codePointAt(0)!};`] : [];
  const code = char.charCodeAt(0);
  if (code < 0x20 || code === 0x7f) spellings.push(escapeRegExp(`\\${code.toString(16)} `));
  return spellings;
}

function referenceSpellings(char: string): string {
  const spellings = [
    escapeRegExp(char),
    ...urlSpellings(char),
    ...(ENTITY_SPELLINGS[char] ?? []),
    ...escapedSpellings(char),
    ...controlSpellings(char),
  ];
  return spellings.length === 1 ? spellings[0]! : `(?:${spellings.join("|")})`;
}

export type ReferenceSyntax = "html" | "script" | "css" | "plain";
interface ReferenceContext {
  syntax: ReferenceSyntax;
  url: boolean;
  htmlAttribute: boolean;
  encodeAll: boolean;
  quote: string;
}

function escapeHtmlReference(path: string): string {
  return path.replace(/[&"']/g, (char) => ENTITY_SPELLINGS[char]![0]!);
}

function escapeQuotedReference(path: string, quote: string): string {
  const escaped = JSON.stringify(path).slice(1, -1);
  return quote === '"'
    ? escaped
    : escaped.replace(new RegExp(escapeRegExp(quote), "g"), `\\${quote}`);
}

function escapeRawUrlPath(path: string): string {
  const encodeSpaces = path.startsWith(" ") || path.endsWith(" ");
  return path.replace(/[\s\S]/g, (char) => {
    if (char.charCodeAt(0) < 0x20 || ":?%#\\".includes(char) || (encodeSpaces && char === " ")) {
      return encodeUrlPath(char);
    }
    return char;
  });
}

function spellHtml(path: string, { url, quote }: ReferenceContext): string {
  const escaped = escapeHtmlReference(url ? escapeRawUrlPath(path) : path);
  return ["'", '"'].includes(quote)
    ? escaped
    : escaped.replace(/[\t\n\f\r =<>`]/g, (char) => `&#${char.codePointAt(0)!};`);
}

function spellScript(path: string, { quote }: ReferenceContext): string {
  if (!["'", '"', "`"].includes(quote)) return path;
  const escaped = escapeQuotedReference(path, quote);
  return quote === "`" ? escaped.replace(/\$\{/g, "\\${") : escaped;
}

const SPELLINGS = {
  html: spellHtml,
  script: spellScript,
  css: (path, { url }) => (url ? encodeUrlPath(path) : path),
  plain: (path) => path,
} satisfies Record<ReferenceSyntax, (path: string, context: ReferenceContext) => string>;

const encodesWhole = (reference: string, oldPath: string, { url, encodeAll }: ReferenceContext) =>
  url && (encodeAll || (reference !== oldPath && /%[0-9A-Fa-f]{2}/.test(reference)));

function spellLike(
  reference: string,
  path: string,
  oldPath: string,
  context: ReferenceContext,
): string {
  if (encodesWhole(reference, oldPath, context)) return encodeUrlPath(path);
  return SPELLINGS[context.syntax](path, context);
}

function referenceSyntax(file: string): ReferenceSyntax {
  if (/\.html$/i.test(file)) return "html";
  if (/\.css$/i.test(file)) return "css";
  if (/\.(?:[cm]?js|jsx|tsx?|json)$/i.test(file)) return "script";
  return "plain";
}

function decodeQuotedReference(text: string, syntax: ReferenceSyntax): string {
  if (syntax === "css") return decodeCssEscapes(text);
  if (syntax === "script") {
    const controls: Record<string, string> = { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
    return text.replace(
      /\\(?:u([0-9a-fA-F]{4})|([bfnrt"'`$\\/]))/g,
      (_escaped, hex: string | undefined, char: string | undefined) => {
        if (hex !== undefined) return String.fromCharCode(Number.parseInt(hex, 16));
        return controls[char!] ?? char!;
      },
    );
  }
  return text;
}

function referencePattern(oldPath: string, isDirectory: boolean, bareOrDotLead: boolean): RegExp {
  const name = oldPath
    .split("/")
    .map((segment) => Array.from(segment, referenceSpellings).join(""))
    .join(SEPARATOR);
  const end = isDirectory ? `(?=${SEPARATOR})` : FILE_END;
  const lead = bareOrDotLead
    ? String.raw`(?:\.${SEPARATOR})?`
    : String.raw`(?:\.{1,2}${SEPARATOR}|${SEPARATOR}){0,4}`;
  return new RegExp(String.raw`${REFERENCE_START}(?<lead>${lead})${name}${end}`, "g");
}

type ValueAttribute = Extract<HtmlAttributeSpan, { kind: "value" }>;

function rewrittenEntityValue(attr: ValueAttribute, rewrite: (text: string) => string) {
  const decoded = decodeAuthoredAttribute(attr.value);
  if (decoded === attr.value) return null;
  let value = escapeHtmlReference(decoded);
  if (!attr.quote)
    value = value.replace(/[\t\n\f\r =<>`]/g, (char) => `&#${char.codePointAt(0)!};`);
  const source = `<x ${attr.name}=${attr.quote}${value}${attr.quote}>`;
  const updated = rewrite(source);
  if (updated === source) return null;
  const replacement = scanHtmlOpeningTags(updated)[0]!.attributes[0]!;
  if (replacement.kind !== "value") throw new Error("Reference rewrite removed its attribute");
  return replacement.value;
}

function rewriteEntityAttributes(text: string, rewrite: (text: string) => string): string {
  const parts: string[] = [];
  let cursor = 0;
  const values = scanHtmlOpeningTags(text).flatMap((tag) =>
    tag.attributes.flatMap((attr) => (attr.kind === "value" ? [attr] : [])),
  );
  for (const attr of values) {
    const value = rewrittenEntityValue(attr, rewrite);
    if (value === null) continue;
    parts.push(text.slice(cursor, attr.valueStart), value);
    cursor = attr.valueEnd;
  }
  parts.push(text.slice(cursor));
  return parts.join("");
}

type Region<T> = { start: number; end: number } & T;

function advancing<T>(regions: readonly Region<T>[]): (offset: number) => Region<T> | undefined {
  let index = 0;
  return (offset) => {
    while (regions[index] && regions[index]!.end <= offset) index++;
    return regions[index];
  };
}

const inside = (region: { start: number } | undefined, offset: number) =>
  !!region && offset >= region.start;

function matchContext(
  text: string,
  offset: number,
  syntax: ReferenceSyntax,
  region: Region<{ syntax: ReferenceSyntax }> | undefined,
  urlRegion: Region<Omit<ReferenceContext, "url" | "quote">> | undefined,
): ReferenceContext {
  const quote = text[offset - 1] ?? "";
  const matchSyntax = inside(region, offset) ? region!.syntax : syntax;
  if (matchSyntax === "script" || !inside(urlRegion, offset))
    return { syntax: matchSyntax, url: false, htmlAttribute: false, encodeAll: false, quote };
  const { htmlAttribute, encodeAll } = urlRegion!;
  return { syntax: urlRegion!.syntax, url: true, htmlAttribute, encodeAll, quote };
}

// A match inside the longer path of a file or folder that exists (`a.png&b.png`, `other assets/`) is that path's.
// Existing paths are indexed by the text after the old path, then the text before it, so a match costs a few lookups.
function referenceEdits(
  oldPath: string,
  newPath: string,
  isDirectory: boolean,
  existing: readonly string[],
  beside: { targets: ReadonlySet<string> | null } | null = null,
): ReferenceEditor {
  const oldIdentity = sep === "\\" ? oldPath.replace(/\\/g, "/") : oldPath;
  const pattern = referencePattern(oldPath, isDirectory, beside !== null);
  const around = new Map<string, Map<number, Set<string>>>();
  const afterLengths = new Set<number>();
  let window = 0;
  for (const path of existing) {
    if (path.length <= oldPath.length) continue;
    for (const start of occurrences(path, oldPath)) {
      const [before, after] = [path.slice(0, start), path.slice(start + oldPath.length)];
      const befores = around.get(after) ?? around.set(after, new Map()).get(after)!;
      (befores.get(before.length) ?? befores.set(before.length, new Set()).get(before.length)!).add(
        before,
      );
      afterLengths.add(after.length);
      window = Math.max(window, path.length * 9);
    }
  }
  const normalized = (text: string, context: ReferenceContext, full = false) => {
    let value = text;
    if (context.syntax === "html" || context.htmlAttribute) {
      value = decodeAuthoredAttribute(value);
    }
    value = decodeQuotedReference(value, context.syntax);
    if (context.url) {
      value = value.replace(/\\/g, "/");
      value = full ? decodedUrlPath(value) : decodeWellFormedEscapes(value);
    }
    return sep === "\\" ? value.replace(/\\/g, "/") : value;
  };
  const inLonger = (head: string, tail: string) =>
    [...afterLengths].some((after) => {
      const befores = tail.length >= after && around.get(tail.slice(0, after));
      return (
        befores &&
        [...befores].some(
          ([length, set]) => head.length >= length && set.has(head.slice(head.length - length)),
        )
      );
    });
  const namesOldPath = (
    text: string,
    offset: number,
    match: string,
    lead: string,
    context: ReferenceContext,
  ) => {
    const end = offset + match.length;
    if (normalized(match.slice(lead.length), context, true) !== oldIdentity) return false;
    if (isDirectory && !normalized(text.slice(end, end + 4), context).startsWith("/")) return false;
    const at = offset + lead.length;
    const head = normalized(text.slice(Math.max(0, at - window), at), context);
    return !inLonger(head, normalized(text.slice(end, end + window), context, context.url));
  };
  return (text, syntax) => {
    pattern.lastIndex = 0;
    if (!pattern.test(text)) return [];
    pattern.lastIndex = 0;
    const tags = syntax === "html" ? scanHtmlOpeningTags(text) : [];
    const inlineRegions = tags
      .filter(
        (tag) => tag.closed && ["script", "style"].includes(tag.name) && tag.rawTextEnd !== null,
      )
      .map((tag) => ({
        start: tag.end,
        end: tag.rawTextEnd!,
        syntax: tag.name === "style" ? ("css" as const) : ("script" as const),
      }));
    const attributes = tags.flatMap((tag) =>
      tag.attributes.flatMap((attr) => (attr.kind === "value" ? [attr] : [])),
    );
    const cssContexts =
      syntax === "css"
        ? [{ start: 0, end: text.length, htmlAttribute: false }]
        : [
            ...inlineRegions
              .filter((region) => region.syntax === "css")
              .map((region) => ({ ...region, htmlAttribute: false })),
            ...attributes
              .filter((attr) => attr.name === "style")
              .map((attr) => ({ ...attr, htmlAttribute: true })),
          ];
    const cssFields = (pattern: RegExp) =>
      cssContexts.flatMap((context) =>
        [...text.slice(context.start, context.end).matchAll(pattern)].map((match) => {
          const prefix = /^(?:url\(\s*|@import\s+)/i.exec(match[0])![0];
          const rest = match[0].slice(prefix.length);
          const delimiter = context.htmlAttribute
            ? /^(?:["']|&quot;|&#39;|&apos;)/.exec(rest)?.[0]
            : /^["']/.exec(rest)?.[0];
          const start = context.start + match.index! + prefix.length + (delimiter?.length ?? 0);
          return {
            start,
            end: context.start + match.index! + match[0].length,
            syntax: "css" as const,
            htmlAttribute: context.htmlAttribute,
            encodeAll: true,
          };
        }),
      );
    const urlRegions = [
      ...attributes
        .filter((attr) => ["src", "href", "poster", "xlink:href"].includes(attr.name))
        .map((attr) => ({
          start: attr.valueStart + (/^[\t\n\f\r ]*/.exec(attr.value)?.[0].length ?? 0),
          end: attr.valueEnd,
          syntax: "html" as const,
          htmlAttribute: true,
          encodeAll: false,
        })),
      ...attributes
        .filter((attr) => attr.name === "srcset")
        .flatMap((attr) =>
          [...attr.value.matchAll(/(^|,)[\t\n\f\r ]*([^,\t\n\f\r ]+)/g)].map((match) => ({
            start: attr.valueStart + match.index! + match[0].length - match[2]!.length,
            end: attr.valueStart + match.index! + match[0].length,
            syntax: "html" as const,
            htmlAttribute: true,
            encodeAll: true,
          })),
        ),
      ...cssFields(
        /\burl\((?:\s*"(?:\\.|[^"\\])*"\s*|\s*'(?:\\.|[^'\\])*'\s*|(?:\\.|[^)\\])*)\)/gi,
      ),
      ...cssFields(/@import\s+(?:"[^"]*"|'[^']*')/gi),
    ].sort((a, b) => a.start - b.start);
    const inlineAt = advancing(inlineRegions);
    const urlAt = advancing(urlRegions);
    return [...text.matchAll(pattern)].flatMap((found): Edit[] => {
      const [match, offset, lead] = [found[0], found.index, found.groups?.lead ?? ""];
      const urlRegion = urlAt(offset);
      const context = matchContext(text, offset, syntax, inlineAt(offset), urlRegion);
      if (context.url && offset !== urlRegion!.start) return [];
      const reference = match.slice(lead.length);
      if (!namesOldPath(text, offset, match, lead, context)) return [];
      const end = offset + match.length;
      if (
        beside &&
        !besideReaches(beside.targets, context, normalized(restAfter(text, end), context))
      )
        return [];
      return [
        { at: offset + lead.length, end, text: spellLike(reference, newPath, oldPath, context) },
      ];
    });
  };

  function besideReaches(
    targets: ReadonlySet<string> | null,
    context: ReferenceContext,
    rest: string,
  ) {
    if (context.syntax === "script") return false;
    if (isDirectory && leavesFolder(rest)) return false;
    return !targets || reaches(targets, `${newPath}${rest}`);
  }
}

type Edit = { at: number; end: number; text: string };
type ReferenceEditor = (text: string, syntax: ReferenceSyntax) => Edit[];

function rewriteWith(
  editors: readonly ReferenceEditor[],
): (text: string, syntax?: ReferenceSyntax, normalizeEntities?: boolean) => string {
  return function rewriteText(text, syntax = "html", normalizeEntities = true) {
    if (syntax === "html" && normalizeEntities) {
      text = rewriteEntityAttributes(text, (source) => rewriteText(source, "html", false));
    }
    let [out, pos] = ["", 0];
    const edits = editors.flatMap((editor) => editor(text, syntax));
    for (const edit of edits.sort((x, y) => x.at - y.at)) {
      if (edit.at < pos) continue;
      out += text.slice(pos, edit.at) + edit.text;
      pos = edit.end;
    }
    return out + text.slice(pos);
  };
}

export function referenceRewriter(
  oldPath: string,
  newPath: string,
  isDirectory: boolean,
  existing: readonly string[] = [],
): (text: string, syntax?: ReferenceSyntax) => string {
  return rewriteWith([referenceEdits(oldPath, newPath, isDirectory, existing)]);
}

const MAX_REST = 256;
const restAfter = (text: string, end: number) =>
  /^[^"'`<>\r\n]*/.exec(text.slice(end, end + MAX_REST))![0];
const REFERENCE_END = /^(?:$|\)(?=$|[\s;,])|[?#]|,\s|\s+\d+(?:\.\d+)?[wx](?![\w.]))/;

function reaches(targets: ReadonlySet<string>, path: string): boolean {
  for (let i = 0; i <= path.length; i++)
    if (REFERENCE_END.test(path.slice(i)) && targets.has(path.slice(0, i))) return true;
  return false;
}

function filesOnly(paths: readonly string[]): Set<string> {
  const folders = new Set<string>();
  for (const path of paths)
    for (let at = path.indexOf("/"); at > 0; at = path.indexOf("/", at + 1))
      folders.add(path.slice(0, at));
  return new Set(paths.filter((path) => !folders.has(path)));
}

function leavesFolder(rest: string): boolean {
  let depth = 0;
  for (const segment of rest.split("/")) {
    if (segment === ".." && --depth < 0) return true;
    if (segment !== ".." && segment !== "." && segment !== "") depth++;
  }
  return false;
}

export function renameRewriter(
  oldPath: string,
  newPath: string,
  isDirectory: boolean,
  existing: readonly string[],
): (text: string, file: string) => string {
  const rootEdits = referenceEdits(oldPath, newPath, isDirectory, existing);
  const parentFolderEdits = new Map<string, Record<"css" | "html", ReferenceEditor>>();
  for (let at = oldPath.indexOf("/"); at > 0; at = oldPath.indexOf("/", at + 1)) {
    const dir = oldPath.slice(0, at);
    const inside = existing
      .filter((path) => path.startsWith(`${dir}/`))
      .map((path) => path.slice(at + 1));
    const [from, to] = [oldPath.slice(at + 1), posix.relative(dir, newPath)];
    const everywhere = filesOnly(existing.map((path) => posix.relative(dir, path)));
    parentFolderEdits.set(dir, {
      css: referenceEdits(from, to, isDirectory, inside, { targets: null }),
      html: referenceEdits(from, to, isDirectory, inside, { targets: everywhere }),
    });
  }
  return (text, file) => {
    const syntax = referenceSyntax(file);
    const parent = parentFolderEdits.get(posix.dirname(file));
    const beside = syntax === "css" || syntax === "html" ? parent?.[syntax] : undefined;
    return rewriteWith(beside ? [beside, rootEdits] : [rootEdits])(text, syntax);
  };
}

export const canNameFiles = (file: string) =>
  /\.(html|css|js|jsx|ts|tsx|json|mjs|cjs|md|mdx)$/i.test(file);

export const fileNames = (
  file: string,
  text: string,
  path: string,
  existing: readonly string[] = [],
) => referenceRewriter(path, `${path}\0`, false, existing)(text, referenceSyntax(file)) !== text;

function occurrences(text: string, part: string): number[] {
  const at: number[] = [];
  for (let i = text.indexOf(part); i >= 0; i = text.indexOf(part, i + 1)) at.push(i);
  return at;
}
