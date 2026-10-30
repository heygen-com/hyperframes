import { closeSync, fstatSync, openSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { extname, join, posix, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import { parse, type Node } from "acorn";
import { Parser } from "htmlparser2";
import postcss from "postcss";
import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";
import type { BundleScriptProvenance } from "../../core/src/compiler/htmlBundler";
import type { ElementRef, Snippet } from "./types";
import { sourceDependencies, type SourceRange } from "./sourceDependencies";
import { PREVIEW_IGNORED_DIRS } from "../../core/src/projectFolders";

interface Chunk {
  file: string;
  text: string;
  offset: number;
  dependencies: (range: SourceRange) => SourceRange[];
  statements: { start: number; end: number; type: string }[];
}
interface SourceFile {
  text: string;
  lines: number[];
}
const starts = (text: string) => [0, ...[...text.matchAll(/\n/g)].map((m) => m.index + 1)];
function position(lines: number[], offset: number) {
  let lo = 0,
    hi = lines.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (lines[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - lines[lo] };
}
function occurrences(text: string, needle: string) {
  const hits: number[] = [];
  if (!needle) return hits;
  let at = text.indexOf(needle);
  while (at >= 0) {
    hits.push(at);
    at = text.indexOf(needle, at + needle.length);
  }
  return hits;
}
function realPath(path: string) {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}
const SHOWN_WHOLE = 2000;
const excluded = new Set([...PREVIEW_IGNORED_DIRS, ".agents", ".claude", "evidence", "snapshots"]);
function sourceFiles(project: string) {
  const files: string[] = [];
  function visit(dir: string) {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      if (excluded.has(item.name) || item.isSymbolicLink()) continue;
      const path = join(dir, item.name);
      if (item.isDirectory()) visit(path);
      else if ([".html", ".js", ".mjs", ".css", ".json"].includes(extname(path))) files.push(path);
    }
  }
  visit(project);
  return files.sort();
}
const HF_ID_ATTRIBUTE = /\sdata-hf-id\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/g;
export function fingerprint(project: string, { ignoreHfIds = false } = {}) {
  const hash = createHash("sha256");
  for (const path of sourceFiles(project)) {
    hash.update(relative(project, path));
    hash.update(
      ignoreHfIds && extname(path) === ".html"
        ? readFileSync(path, "utf8").replace(HF_ID_ATTRIBUTE, "")
        : readFileSync(path),
    );
  }
  return hash.digest("hex");
}
function statements(text: string) {
  const result: { start: number; end: number; type: string }[] = [];
  function visit(value: unknown) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (
      "type" in value &&
      "start" in value &&
      "end" in value &&
      typeof value.type === "string" &&
      typeof value.start === "number" &&
      typeof value.end === "number"
    ) {
      if (
        [
          "ExpressionStatement",
          "VariableDeclaration",
          "ReturnStatement",
          "ThrowStatement",
          "FunctionDeclaration",
        ].includes(value.type)
      )
        result.push({ start: value.start, end: value.end, type: value.type });
    }
    for (const entry of Object.values(value)) if (typeof entry === "object") visit(entry);
  }
  try {
    const ast: Node = parse(text, {
      ecmaVersion: "latest",
      sourceType: "module",
      allowReturnOutsideFunction: true,
    });
    visit(ast);
  } catch {
    /* Unparseable chunks remain explicitly unmapped. */
  }
  return result;
}
function rawTextElements(text: string, tag: "script" | "style") {
  const lower = text.toLowerCase();
  const opening = `<${tag}`;
  const closing = `</${tag}`;
  const elements: { attributes: string; content: string; contentStart: number }[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const start = lower.indexOf(opening, cursor);
    if (start < 0) break;
    const boundary = lower[start + opening.length];
    if (boundary && boundary !== ">" && !/\s/.test(boundary)) {
      cursor = start + opening.length;
      continue;
    }
    const contentStart = lower.indexOf(">", start + opening.length);
    if (contentStart < 0) break;
    let close = lower.indexOf(closing, contentStart + 1);
    let closeEnd = -1;
    while (close >= 0) {
      let at = close + closing.length;
      while (at < lower.length && /\s/.test(lower[at])) at++;
      if (lower[at] === ">") {
        closeEnd = at + 1;
        break;
      }
      close = lower.indexOf(closing, at);
    }
    if (close < 0) break;
    elements.push({
      attributes: text.slice(start + opening.length, contentStart),
      content: text.slice(contentStart + 1, close),
      contentStart: contentStart + 1,
    });
    cursor = closeEnd;
  }
  return elements;
}
export interface HtmlTag {
  file: string;
  start: number;
  end: number;
  id?: string;
  hfId?: string;
  classes: string[];
  tag: string;
  compositionId?: string;
  compositionSrc?: string;
  inMarkup: boolean;
  parent?: number;
}
function nesting(text: string) {
  const parents = new Map<number, number | undefined>();
  const open: number[] = [];
  const parser = new Parser({
    onopentag() {
      parents.set(parser.startIndex, open.at(-1));
      open.push(parser.startIndex);
    },
    onclosetag() {
      open.pop();
    },
  });
  parser.write(text);
  parser.end();
  return parents;
}
function htmlTagsOf(file: string, text: string): HtmlTag[] {
  const parents = nesting(text);
  return [...text.matchAll(/<([a-z][\w-]*)\b[^>]*>/gi)].map((m) => {
    const attr = (name: string) => {
      const quoted = new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(m[0]);
      if (quoted) return quoted[1];
      return new RegExp(`\\s${name}\\s*=\\s*([^\\s"'=<>]+)`, "i").exec(m[0])?.[1];
    };
    return {
      file,
      start: m.index,
      end: m.index + m[0].length,
      tag: m[1].toLowerCase(),
      id: attr("id"),
      hfId: attr("data-hf-id"),
      classes: (attr("class") ?? "").split(/\s+/).filter(Boolean),
      compositionId: attr("data-composition-id"),
      compositionSrc: attr("data-composition-src"),
      inMarkup: parents.has(m.index),
      parent: parents.get(m.index),
    };
  });
}
export interface AuthoredHtml {
  files: Map<string, { text: string }>;
  htmlTags: HtmlTag[];
}
export function authoredHtml(project: string): AuthoredHtml {
  const html: AuthoredHtml = { files: new Map(), htmlTags: [] };
  for (const path of sourceFiles(project)) {
    const file = relative(project, path);
    if (!file.endsWith(".html") || /(?:^|\/)(?:vendor|lib)\//.test(file)) continue;
    const text = readFileSync(path, "utf8");
    if (text.length > 2_000_000) continue;
    html.files.set(file, { text });
    html.htmlTags.push(...htmlTagsOf(file, text));
  }
  return html;
}
export class Sources {
  readonly files = new Map<string, SourceFile>();
  readonly chunks: Chunk[] = [];
  readonly cssRules: { id: string; selector: string; file: string; start: number; end: number }[] =
    [];
  readonly htmlTags: HtmlTag[] = [];
  constructor(
    readonly project: string,
    served?: Iterable<string>,
  ) {
    const root = realPath(project);
    const bundled = served && new Set([...served].map((path) => relative(root, realPath(path))));
    for (const path of sourceFiles(project)) {
      const file = relative(project, path);
      if (/(?:^|\/)(?:vendor|lib)\//.test(file)) continue;
      if (bundled && !bundled.has(file)) continue;
      const fd = openSync(path, "r");
      let text: string;
      try {
        if (fstatSync(fd).size > 2_000_000) continue;
        text = readFileSync(fd, "utf8");
      } finally {
        closeSync(fd);
      }
      this.files.set(file, { text, lines: starts(text) });
      if (/\.m?js$/.test(file)) this.addChunk(file, text, 0);
      if (/\.css$/.test(file)) this.addCss(file, text, 0);
      if (/\.html$/.test(file)) {
        for (const script of rawTextElements(text, "script"))
          if (!/\bsrc\s*=/.test(script.attributes))
            this.addChunk(file, script.content, script.contentStart);
        for (const style of rawTextElements(text, "style"))
          this.addCss(file, style.content, style.contentStart);
        this.htmlTags.push(...htmlTagsOf(file, text));
      }
    }
  }
  private addChunk(file: string, source: string, offset: number) {
    const text = source.trim();
    const lead = source.length - source.trimStart().length;
    if (text) {
      let ranges: ReturnType<typeof statements> | undefined;
      let dependencies: ReturnType<typeof sourceDependencies> | undefined;
      this.chunks.push({
        file,
        text,
        offset: offset + lead,
        get statements() {
          return (ranges ??= statements(text));
        },
        dependencies(range) {
          return (dependencies ??= sourceDependencies(text))(range);
        },
      });
    }
  }
  private addCss(file: string, text: string, offset: number) {
    try {
      postcss.parse(text).walkRules((rule) => {
        const start = rule.source?.start?.offset;
        const end = rule.source?.end?.offset;
        if (start != null && end != null)
          this.cssRules.push({
            id: `css:${this.cssRules.length}`,
            selector: rule.selector,
            file,
            start: offset + start,
            end: offset + end + 1,
          });
      });
    } catch {
      /* Invalid styles are not guessed. */
    }
  }
  slice(file: string, start: number, end: number, kind: string, target: number): Snippet | null {
    const source = this.files.get(file);
    if (!source) return null;
    const first = position(source.lines, start).line;
    const last = position(source.lines, Math.max(start, end - 1)).line;
    const code = source.text.slice(
      source.lines[first - 1],
      source.lines[last] ?? source.text.length,
    );
    return {
      id: `${file}:${first}-${last}`,
      file,
      startLine: first,
      endLine: last,
      kind: [kind],
      targets: [target],
      code,
      uniqueInFile: occurrences(source.text, code).length === 1,
    };
  }
  markup(element: ElementRef, target: number) {
    const tag = this.markupTag(element);
    return tag ? this.slice(tag.file, tag.start, tag.end, "html opening tag", target) : null;
  }
  markupTag(element: ElementRef): HtmlTag | null {
    const sameTag = this.htmlTags.filter((tag) => tag.tag === element.tag);
    const byHfId = element.hfId ? sameTag.filter((tag) => tag.hfId === element.hfId) : [];
    const tags = byHfId.length
      ? byHfId
      : sameTag.filter((tag) =>
          element.id
            ? tag.id === element.id
            : element.classes.length > 0 && element.classes.every((c) => tag.classes.includes(c)),
        );
    return tags.length === 1 ? tags[0] : null;
  }
  private nestingIndex?: { tagAt: Map<string, HtmlTag>; hostsOf: Map<string, HtmlTag[]> };
  private get nested() {
    if (this.nestingIndex) return this.nestingIndex;
    const tagAt = new Map(this.htmlTags.map((t) => [`${t.file}:${t.start}`, t]));
    const hostsOf = new Map<string, HtmlTag[]>();
    for (const host of this.htmlTags.filter((t) => t.inMarkup && t.compositionSrc)) {
      const file = this.mountedFile(host);
      if (file) hostsOf.set(file, [...(hostsOf.get(file) ?? []), host]);
    }
    return (this.nestingIndex = { tagAt, hostsOf });
  }
  private fileByPath?: Map<string, string>;
  private mountedFile(host: HtmlTag) {
    const files = (this.fileByPath ??= new Map(
      [...this.files.keys()].map((file) => [file.replace(/\\/g, "/"), file]),
    ));
    const src = (host.compositionSrc ?? "").split(/[?#]/)[0].replace(/\\/g, "/");
    const path = [
      posix.normalize(src.replace(/^\.?\//, "")),
      posix.join(posix.dirname(host.file.replace(/\\/g, "/")), src),
    ].find((file) => files.has(file));
    return path === undefined ? undefined : files.get(path);
  }
  compositions(tag: HtmlTag, target: number): Snippet[] {
    const { tagAt, hostsOf } = this.nested;
    const shown = new Set<HtmlTag>([tag]);
    const result: Snippet[] = [];
    const show = (t: HtmlTag, kind: string) => {
      if (shown.has(t)) return false;
      shown.add(t);
      const snippet = this.slice(t.file, t.start, t.end, kind, target);
      if (snippet) result.push(snippet);
      return true;
    };
    const mounted = tag.compositionSrc && this.mountedFile(tag);
    const root =
      mounted &&
      this.htmlTags.find(
        (t) =>
          t.file === mounted &&
          t.inMarkup &&
          t.compositionId &&
          (!tag.compositionId || t.compositionId === tag.compositionId),
      );
    if (root) show(root, "composition root");
    const parentOf = (t: HtmlTag) =>
      t.parent === undefined ? undefined : tagAt.get(`${t.file}:${t.parent}`);
    const climb = [{ tag, candidate: false }];
    for (let from = climb.shift(); from; from = climb.shift()) {
      for (let at = parentOf(from.tag); at; at = parentOf(at))
        if (at.compositionId)
          show(at, from.candidate ? "composition root candidate" : "composition root");
      const hosts = hostsOf.get(from.tag.file) ?? [];
      const candidate = from.candidate || hosts.length > 1;
      for (const host of hosts)
        if (show(host, candidate ? "composition host candidate" : "composition host"))
          climb.push({ tag: host, candidate });
    }
    return result;
  }
  mapper(html: string, provenance: BundleScriptProvenance[]) {
    const htmlLines = starts(html);
    const maps = provenance.flatMap((p) =>
      occurrences(html, p.output).map((at) => ({
        at,
        p,
        lines: starts(p.output),
        inputLines: starts(p.input),
        map: new TraceMap(p.sourceMap),
      })),
    );
    const ranges = new Map<string, { chunk: Chunk; at: number }[]>();
    for (const text of [html, ...provenance.map((p) => p.input)])
      ranges.set(
        text,
        this.chunks.flatMap((chunk) => occurrences(text, chunk.text).map((at) => ({ chunk, at }))),
      );
    const locate = (text: string, offset: number) => {
      const found = (ranges.get(text) ?? [])
        .filter(({ chunk, at }) => offset >= at && offset < at + chunk.text.length)
        .map(({ chunk, at }) => ({ chunk, local: offset - at }));
      const unique = new Map(
        found.map((hit) => [`${hit.chunk.file}:${hit.chunk.offset + hit.local}`, hit]),
      );
      return unique.size === 1 ? [...unique.values()][0] : null;
    };
    const cache = new Map<string, Snippet[]>();
    return (stack: string, target: number): Snippet[] => {
      const cached = cache.get(stack);
      if (cached) return cached.map((snippet) => ({ ...snippet, targets: [target] }));
      const result: Snippet[] = [];
      for (const frame of stack.split("\n")) {
        const script = /(hf-inspect-[a-f0-9]+\.js):(\d+):(\d+)\)?$/.exec(frame);
        const m = /https?:\/\/[^/]+\/(?:index\.html)?:(\d+):(\d+)\)?$/.exec(frame);
        if (!m && !script) continue;
        const offset = m ? htmlLines[Number(m[1]) - 1] + Number(m[2]) - 1 : -1;
        let hit = m ? locate(html, offset) : null;
        if (!hit)
          for (const map of maps) {
            if (
              script
                ? map.p.sourceURL !== script[1]
                : offset < map.at || offset >= map.at + map.p.output.length
            )
              continue;
            const generated = script
              ? { line: Number(script[2]), column: Number(script[3]) - 1 }
              : position(map.lines, offset - map.at);
            const original = originalPositionFor(map.map, generated);
            if (original.line != null && original.column != null)
              hit = locate(map.p.input, map.inputLines[original.line - 1] + original.column);
          }
        if (!hit) continue;
        const enclosing = hit.chunk.statements
          .filter((s) => hit.local >= s.start && hit.local < s.end)
          .sort((a, b) => a.end - a.start - (b.end - b.start))[0];
        if (!enclosing) continue;
        const helper = hit.chunk.statements
          .filter(
            (s) =>
              s.type === "FunctionDeclaration" &&
              hit.local >= s.start &&
              hit.local < s.end &&
              s.end - s.start <= SHOWN_WHOLE,
          )
          .sort((a, b) => a.end - a.start - (b.end - b.start))[0];
        const caller = result.length > 0;
        const callLine = caller && !helper && enclosing.end - enclosing.start > SHOWN_WHOLE;
        const range = callLine ? { start: hit.local, end: hit.local + 1 } : (helper ?? enclosing);
        const snippet = this.slice(
          hit.chunk.file,
          hit.chunk.offset + range.start,
          hit.chunk.offset + range.end,
          caller ? "animation caller" : "animation creation",
          target,
        );
        if (snippet) result.push(snippet);
        if (callLine) continue;
        for (const dependency of hit.chunk.dependencies(range)) {
          const definition = this.slice(
            hit.chunk.file,
            hit.chunk.offset + dependency.start,
            hit.chunk.offset + dependency.end,
            "animation source dependency",
            target,
          );
          if (definition) result.push(definition);
        }
      }
      cache.set(stack, result);
      return result;
    };
  }
}

export function mergeSnippets(snippets: Snippet[], sources: Sources): Snippet[] {
  const sorted = snippets.sort((a, b) => a.file.localeCompare(b.file) || a.startLine - b.startLine);
  const output: Snippet[] = [];
  for (const snippet of sorted) {
    const last = output.at(-1);
    if (last && last.file === snippet.file && snippet.startLine <= last.endLine + 1) {
      last.endLine = Math.max(last.endLine, snippet.endLine);
      last.id = `${last.file}:${last.startLine}-${last.endLine}`;
      const source = sources.files.get(last.file)!;
      last.code = source.text.slice(
        source.lines[last.startLine - 1],
        source.lines[last.endLine] ?? source.text.length,
      );
      last.targets = [...new Set([...last.targets, ...snippet.targets])];
      last.kind = [...new Set([...last.kind, ...snippet.kind])];
      last.uniqueInFile = occurrences(source.text, last.code).length === 1;
    } else output.push({ ...snippet });
  }
  return output;
}
