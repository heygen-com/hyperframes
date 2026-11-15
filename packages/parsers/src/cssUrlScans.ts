// Forward scans that find what the CSS `url(` regex in each doc comment finds, in linear time.

/** One match as `matchAll` reports it: where it starts, then the full text and each group. */
export interface ScanMatch<G extends Array<string | undefined>> {
  index: number;
  parts: [string, ...G];
}

type Finder = (start: number) => number;
type UrlArgument = { end: number; quote: string; url: string };
type UrlParts = [quote: string, url: string];
type ImportParts = [
  urlQuote: string | undefined,
  url: string | undefined,
  quote: string | undefined,
  path: string | undefined,
  media: string,
];
type HashRefParts = [pre: string, quote: string, id: string, post: string];
type SceneUrlParts = [
  urlQuote: string | undefined,
  url: string | undefined,
  quote: string | undefined,
  path: string | undefined,
];

const WS = /\s/;
const WORD = /\w/;
const BACKGROUND = /background/iy;
const IMAGE_SUFFIX = /-image/iy;
const URL_OPEN = /url\(/iy;
const REMOTE_SCHEME = /https?:\/\//iy;
const NON_LOCAL_SCHEME = /data:|file:|https?:\/\//iy;

const isWs = (char: string | undefined): boolean => char !== undefined && WS.test(char);
const isQuote = (char: string | undefined): boolean => char === '"' || char === "'";

function endOfMatchAt(pattern: RegExp, source: string, index: number): number {
  pattern.lastIndex = index;
  return pattern.test(source) ? pattern.lastIndex : -1;
}

/** Caches `search` so nondecreasing starts never rescan what an earlier call already passed. */
function memoForward(search: Finder): Finder {
  let from = 0;
  let at = -1;
  return (start) => {
    if (start < from || start > at) {
      from = start;
      at = search(start);
    }
    return at;
  };
}

/** The first index at or after a start where the global `pattern` matches, else `source.length`. */
function finder(source: string, pattern: RegExp): Finder {
  return memoForward((start) => {
    pattern.lastIndex = start;
    return pattern.exec(source)?.index ?? source.length;
  });
}

function firstAccepted(source: string, candidates: Finder, accept: (i: number) => boolean): Finder {
  return memoForward((start) => {
    let i = candidates(start);
    while (i < source.length && !accept(i)) i = candidates(i + 1);
    return i;
  });
}

function urlFinders(source: string) {
  return {
    ws: finder(source, /\S/g),
    stop: finder(source, /[)"']/g),
    close: finder(source, /\S/g),
  };
}
type UrlFinders = ReturnType<typeof urlFinders>;

function quotedArgument(
  source: string,
  w: number,
  f: UrlFinders,
  trimmed: boolean,
): UrlArgument | null {
  const quote = source[w]!;
  const e = f.stop(w + 1);
  if (e === w + 1 || source[e] !== quote) return null;
  if (trimmed && (isWs(source[w + 1]) || isWs(source[e - 1]))) return null;
  const z = f.close(e + 1);
  return source[z] === ")" ? { end: z + 1, quote, url: source.slice(w + 1, e) } : null;
}

/** `\s*(["']?)([^)"']+)\1\s*\)` from `start`. */
function rawUrlArgument(source: string, start: number, f: UrlFinders): UrlArgument | null {
  const w = f.ws(start);
  if (isQuote(source[w])) return quotedArgument(source, w, f, false);
  if (source[w] === ")") return w > start ? { end: w + 1, quote: "", url: source[w - 1]! } : null;
  const e = f.stop(w);
  return source[e] === ")" ? { end: e + 1, quote: "", url: source.slice(w, e) } : null;
}

/** `\s*(["']?)([^)"'\s](?:[^)"']*[^)"'\s])?)\1\s*\)` from `start`. */
function trimmedUrlArgument(source: string, start: number, f: UrlFinders): UrlArgument | null {
  const w = f.ws(start);
  if (isQuote(source[w])) return quotedArgument(source, w, f, true);
  const e = f.stop(w);
  if (source[w] === ")" || source[e] !== ")") return null;
  let j = e;
  while (isWs(source[j - 1])) j--;
  return { end: e + 1, quote: "", url: source.slice(w, j) };
}

function* urlMatches(
  source: string,
  argument: (source: string, start: number, f: UrlFinders) => UrlArgument | null,
): Generator<ScanMatch<UrlParts>> {
  const opener = /\burl\(/g;
  const f = urlFinders(source);
  for (let open = opener.exec(source); open; open = opener.exec(source)) {
    const arg = argument(source, open.index + 4, f);
    if (!arg) continue;
    yield { index: open.index, parts: [source.slice(open.index, arg.end), arg.quote, arg.url] };
    opener.lastIndex = arg.end;
  }
}

/** Matches of `/\burl\(\s*(["']?)([^)"'\s](?:[^)"']*[^)"'\s])?)\1\s*\)/g`. */
export const cssUrlMatches = (source: string) => urlMatches(source, trimmedUrlArgument);

/** Matches of `/\burl\(\s*(["']?)([^)"']+)\1\s*\)/g`. */
export const rawCssUrlMatches = (source: string) => urlMatches(source, rawUrlArgument);

type Replacer<M> = M extends ScanMatch<infer G> ? (full: string, ...groups: G) => string : never;

/** `source.replace(pattern, replace)` for the matches a scan found in `source`. */
export function replaceMatches<M extends ScanMatch<Array<string | undefined>>>(
  source: string,
  matches: Iterable<M>,
  replace: Replacer<M>,
): string {
  const call = replace as (...parts: M["parts"]) => string;
  let out = "";
  let kept = 0;
  for (const { index, parts } of matches) {
    out += source.slice(kept, index) + call(...parts);
    kept = index + parts[0].length;
  }
  return out + source.slice(kept);
}

function importTarget(source: string, w: number, f: UrlFinders, quoteStop: Finder) {
  if (source.startsWith("url(", w)) {
    const arg = rawUrlArgument(source, w + 4, f);
    return arg && { end: arg.end, groups: [arg.quote, arg.url, undefined, undefined] as const };
  }
  const quote = source[w];
  if (!isQuote(quote)) return null;
  const e = quoteStop(w + 1);
  if (e === w + 1 || source[e] !== quote) return null;
  return { end: e + 1, groups: [undefined, undefined, quote, source.slice(w + 1, e)] as const };
}

/** Matches of `/@import\s+(?:url\(\s*(["']?)([^)"']+)\1\s*\)|(["'])([^"']+)\3)\s*([^;]*);\s*\/g`. */
export function* cssImportMatches(source: string): Generator<ScanMatch<ImportParts>> {
  const opener = /@import/g;
  const ws = finder(source, /\S/g);
  const quoteStop = finder(source, /["']/g);
  const semicolon = finder(source, /;/g);
  const tail = finder(source, /\S/g);
  const f = urlFinders(source);
  for (let open = opener.exec(source); open; open = opener.exec(source)) {
    const w = ws(open.index + 7);
    const target = w > open.index + 7 ? importTarget(source, w, f, quoteStop) : null;
    if (!target) continue;
    const media = tail(target.end);
    const semi = semicolon(media);
    if (semi === source.length) continue;
    const end = tail(semi + 1);
    const full = source.slice(open.index, end);
    yield { index: open.index, parts: [full, ...target.groups, source.slice(media, semi)] };
    opener.lastIndex = end;
  }
}

/** Matches of `/(url\(\s*)(["']?)#([^"')\s]+)\2(\s*\))/gi`. */
export function* urlHashRefMatches(source: string): Generator<ScanMatch<HashRefParts>> {
  const opener = /url\(/gi;
  const ws = finder(source, /\S/g);
  const idEnd = finder(source, /[\s"')]/g);
  const close = finder(source, /\S/g);
  for (let open = opener.exec(source); open; open = opener.exec(source)) {
    const w = ws(open.index + 4);
    const quote = isQuote(source[w]) ? source[w]! : "";
    const hash = w + quote.length;
    const e = source[hash] === "#" ? idEnd(hash + 1) : hash + 1;
    if (e === hash + 1 || (quote && source[e] !== quote)) continue;
    const post = e + quote.length;
    const z = close(post);
    if (source[z] !== ")") continue;
    const full = source.slice(open.index, z + 1);
    const id = source.slice(hash + 1, e);
    yield {
      index: open.index,
      parts: [full, source.slice(open.index, w), quote, id, source.slice(post, z + 1)],
    };
    opener.lastIndex = z + 1;
  }
}

function sceneFinders(source: string) {
  const closeWs = finder(source, /\S/g);
  const closer = (quote: string) =>
    firstAccepted(
      source,
      finder(source, new RegExp(quote, "g")),
      (j) => source[closeWs(j + 1)] === ")",
    );
  let runEnd = -1;
  let runStart = -1;
  const wsRunStart = (end: number) => {
    if (end !== runEnd) {
      for (runEnd = runStart = end; isWs(source[runStart - 1]); ) runStart--;
    }
    return runStart;
  };
  return {
    ws: finder(source, /\S/g),
    lineEnd: finder(source, /[\n\r\u2028\u2029]/g),
    paren: finder(source, /\)/g),
    close: finder(source, /\S/g),
    closer: { '"': closer('"'), "'": closer("'") } as Record<string, Finder>,
    quote: { '"': finder(source, /"/g), "'": finder(source, /'/g) } as Record<string, Finder>,
    wsRunStart,
  };
}
type SceneFinders = ReturnType<typeof sceneFinders>;
type SceneMatch = { end: number; groups: SceneUrlParts };

function sceneUrlAt(source: string, open: number, f: SceneFinders): SceneMatch | null {
  const w = f.ws(open + 4);
  const quote = source[w]!;
  const line = f.lineEnd(w);
  const closing = isQuote(quote) ? f.closer[quote]!(w + 1) : line;
  if (closing < line) {
    const groups: SceneUrlParts = [quote, source.slice(w + 1, closing), undefined, undefined];
    return { end: f.close(closing + 1) + 1, groups };
  }
  const paren = f.paren(w);
  if (paren === source.length) return null;
  const bodyEnd = Math.max(w, f.wsRunStart(paren));
  if (bodyEnd > line) return null;
  return { end: paren + 1, groups: ["", source.slice(w, bodyEnd), undefined, undefined] };
}

function sceneImportAt(source: string, open: number, f: SceneFinders): SceneMatch | null {
  const w = f.ws(open + 7);
  const quote = source[w]!;
  if (w === open + 7 || !isQuote(quote)) return null;
  const closing = f.quote[quote]!(w + 1);
  if (closing >= f.lineEnd(w + 1)) return null;
  return { end: closing + 1, groups: [undefined, undefined, quote, source.slice(w + 1, closing)] };
}

/** Matches of `/url\(\s*(['"]?)(.*?)\1\s*\)|@import\s+(['"])(.*?)\3/gi`. */
export function* sceneCssUrlMatches(source: string): Generator<ScanMatch<SceneUrlParts>> {
  const opener = /url\(|@import/gi;
  const f = sceneFinders(source);
  for (let open = opener.exec(source); open; open = opener.exec(source)) {
    const at = open[0].length === 4 ? sceneUrlAt : sceneImportAt;
    const match = at(source, open.index, f);
    if (!match) continue;
    yield { index: open.index, parts: [source.slice(open.index, match.end), ...match.groups] };
    opener.lastIndex = match.end;
  }
}

/** Where the `url(…)` or quoted target of `@import\s+` at `w` closes, or -1. */
function importRuleClose(source: string, w: number, paren: Finder, quote: Finder): number {
  const url = endOfMatchAt(URL_OPEN, source, w);
  if (url >= 0) return paren(url) < source.length ? paren(url) : -1;
  if (!isQuote(source[w])) return -1;
  const close = quote(w + 1);
  return close > w + 1 && close < source.length ? close : -1;
}

/** Matches of `/@import\s+url\([^)]*\)\s*;|@import\s+["'][^"']+["']\s*;/gi`. */
export function* importRuleMatches(source: string): Generator<ScanMatch<[]>> {
  const opener = /@import/gi;
  const ws = finder(source, /\S/g);
  const paren = finder(source, /\)/g);
  const quote = finder(source, /["']/g);
  const tail = finder(source, /\S/g);
  for (let open = opener.exec(source); open; open = opener.exec(source)) {
    const w = ws(open.index + 7);
    const close = w > open.index + 7 ? importRuleClose(source, w, paren, quote) : -1;
    const z = close < 0 ? -1 : tail(close + 1);
    if (source[z] !== ";") continue;
    yield { index: open.index, parts: [source.slice(open.index, z + 1)] };
    opener.lastIndex = z + 1;
  }
}

/** Where `background(-image)?\s*:` at `at` ends past its colon, or -1. */
function backgroundValueStart(source: string, at: number, ws: Finder): number {
  let k = endOfMatchAt(BACKGROUND, source, at);
  if (k < 0) return -1;
  k = Math.max(k, endOfMatchAt(IMAGE_SUFFIX, source, k));
  const colon = ws(k);
  return source[colon] === ":" ? colon + 1 : -1;
}

/** `/(?:^|;|\{)\s*background(?:-image)?\s*:[^;}]*(?:\bgradient\s*\(|url\s*\()/i.test(source)`. */
export function hasBackgroundImageDeclaration(source: string): boolean {
  const ws = finder(source, /\S/g);
  const colonWs = finder(source, /\S/g);
  const valueEnd = finder(source, /[;}]/g);
  const tokenWs = finder(source, /\S/g);
  const imageValue = firstAccepted(source, finder(source, /gradient|url/gi), (i) => {
    const gradient = source[i] === "g" || source[i] === "G";
    if (gradient && WORD.test(source[i - 1] ?? "")) return false;
    return source[tokenWs(i + (gradient ? 8 : 3))] === "(";
  });
  const opener = /[;{]/g;
  for (let start: number | null = 0; start !== null; ) {
    const value = backgroundValueStart(source, ws(start), colonWs);
    if (value >= 0 && imageValue(value) < valueEnd(value)) return true;
    const next = opener.exec(source);
    start = next ? next.index + 1 : null;
  }
  return false;
}

/** `\s*["']?(BODY)["']?\s*\)` from `start`, whitespace only with `f.ws`, BODY from `head` on as `[^"')]+`. */
function bareUrlArgument(
  source: string,
  start: number,
  f: { ws?: Finder; stop: Finder; close?: Finder },
  head: (at: number) => number,
): UrlArgument | null {
  const w = f.ws ? f.ws(start) : start;
  const from = isQuote(source[w]) ? w + 1 : w;
  const body = head(from);
  const e = body < 0 ? body : f.stop(body);
  if (e <= body) return null;
  const close = isQuote(source[e]) ? (f.close ? f.close(e + 1) : e + 1) : e;
  return source[close] === ")" ? { end: close + 1, quote: "", url: source.slice(from, e) } : null;
}

const remoteHead = (source: string) => (at: number) => endOfMatchAt(REMOTE_SCHEME, source, at);
const localHead = (source: string) => (at: number) =>
  endOfMatchAt(NON_LOCAL_SCHEME, source, at) < 0 ? at : -1;

/** Matches of `/background(?:-image)?\s*:\s*[^;}"']*?url\(\s*["']?(https?:\/\/[^"')]+)["']?\s*\)/gi`. */
export function* remoteBackgroundUrlMatches(source: string): Generator<ScanMatch<[url: string]>> {
  const opener = /background/gi;
  const ws = finder(source, /\S/g);
  const valueEnd = finder(source, /[;}"']/g);
  const f = urlFinders(source);
  const head = remoteHead(source);
  const urlAt = (open: number) => bareUrlArgument(source, open + 4, f, head);
  const firstUrl = firstAccepted(source, finder(source, /url\(/gi), (i) => urlAt(i) !== null);
  for (let open = opener.exec(source); open; open = opener.exec(source)) {
    const value = backgroundValueStart(source, open.index, ws);
    if (value < 0) continue;
    const start = ws(value);
    const url = firstUrl(start);
    const arg = url < valueEnd(start) ? urlAt(url) : null;
    if (!arg) continue;
    yield { index: open.index, parts: [source.slice(open.index, arg.end), arg.url] };
    opener.lastIndex = arg.end;
  }
}

function* fontFaceUrlMatches(
  source: string,
  head: (at: number) => number,
): Generator<ScanMatch<[url: string]>> {
  const opener = /url\(/gi;
  const f = { stop: finder(source, /[)"']/g) };
  for (let open = opener.exec(source); open; open = opener.exec(source)) {
    const arg = bareUrlArgument(source, open.index + 4, f, head);
    if (!arg) continue;
    yield { index: open.index, parts: [source.slice(open.index, arg.end), arg.url] };
    opener.lastIndex = arg.end;
  }
}

/** Matches of `/url\(["']?(https?:\/\/[^"')]+)["']?\)/gi`. */
export const remoteFontFaceUrlMatches = (source: string) =>
  fontFaceUrlMatches(source, remoteHead(source));

/** Matches of `/url\(["']?(?!data:|file:|https?:\/\/)([^"')]+)["']?\)/gi`. */
export const localFontFaceUrlMatches = (source: string) =>
  fontFaceUrlMatches(source, localHead(source));
