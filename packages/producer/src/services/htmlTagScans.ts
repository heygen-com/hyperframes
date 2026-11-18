/**
 * Forward scans that return exactly what the compiler's and the render telemetry's tag regexes
 * return, in time linear in the HTML. Each of those regexes rescans to the end of the page from
 * every tag opener that never closes, or from every character of a long whitespace run in one tag.
 *
 * Two facts make the scans below exact. A `[^>]*` after an opener can only reach the first `>`
 * after it, so every opener inside that span sees the same span, minus a prefix. And the parts
 * matched after an attribute (a quoted value, the closing `>`) do not depend on where the tag began.
 */

type Finder = (from: number) => RegExpExecArray | null;

/** The first match of the global `pattern` at or after `from`. Cheap when `from` only grows. */
function forwardFinder(text: string, pattern: RegExp): Finder {
  let start = -1;
  let found: RegExpExecArray | null = null;
  return (from) => {
    if (start < 0 || from < start || (found !== null && from > found.index)) {
      start = from;
      pattern.lastIndex = from;
      found = pattern.exec(text);
    }
    return found;
  };
}

function indexFinder(text: string, pattern: RegExp): (from: number) => number {
  const find = forwardFinder(text, pattern);
  return (from) => find(from)?.index ?? -1;
}

const isLetter = (code: number) => (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
const isDigit = (code: number) => code >= 48 && code <= 57;
const isNameChar = (code: number) => isLetter(code) || isDigit(code) || code === 45;
const isWordChar = (code: number) => isLetter(code) || isDigit(code) || code === 95;

/** The end of the `[-a-zA-Z0-9]*` run that starts at `from`. */
function nameRunEnd(text: string, from: number): number {
  let end = from;
  while (isNameChar(text.charCodeAt(end))) end++;
  return end;
}

/**
 * Where `<[a-zA-Z][-a-zA-Z0-9]*\b` ends when it matches at `open` (a `<` before a letter), taking
 * the longest name the `\b` allows. -1 when no name length leaves a word boundary after it.
 */
function tagNameEnd(text: string, open: number): number {
  for (let end = nameRunEnd(text, open + 2); end >= open + 2; end--) {
    if (isWordChar(text.charCodeAt(end - 1)) !== isWordChar(text.charCodeAt(end))) return end;
  }
  return -1;
}

/** The `attrs` and `body` groups of `/<script\b([^>]*)>([\s\S]*?)<\/script>/gi`, match by match. */
export function* inlineScriptBlocks(html: string): Generator<{ attrs: string; body: string }> {
  const opener = /<script\b/gi;
  const closer = /<\/script>/gi;
  for (let open = opener.exec(html); open; open = opener.exec(html)) {
    const attrsStart = open.index + open[0].length;
    const gt = html.indexOf(">", attrsStart);
    if (gt < 0) return;
    closer.lastIndex = gt + 1;
    const close = closer.exec(html);
    if (!close) return;
    yield { attrs: html.slice(attrsStart, gt), body: html.slice(gt + 1, close.index) };
    opener.lastIndex = close.index + close[0].length;
  }
}

/** `source.replace(/<start>[\s\S]*?<end>/g, "")` for the literal strings `start` and `end`. */
export function removeDelimitedRuns(source: string, start: string, end: string): string {
  let out = "";
  let kept = 0;
  for (let open = source.indexOf(start); open >= 0; open = source.indexOf(start, kept)) {
    const close = source.indexOf(end, open + start.length);
    if (close < 0) break;
    out += source.slice(kept, open);
    kept = close + end.length;
  }
  return out + source.slice(kept);
}

/** What `[^"']*gsap[^"']*\/dist\/([^"']+)` captures over a whole attribute value, or undefined. */
function gsapDistFile(value: string): string | undefined {
  let dist = -1;
  const distPattern = /\/dist\//gi;
  for (let m = distPattern.exec(value); m; m = distPattern.exec(value)) {
    if (m.index + 6 < value.length) dist = m.index;
    distPattern.lastIndex = m.index + 1;
  }
  const gsap = dist < 0 ? null : /gsap/i.exec(value);
  return gsap && gsap.index + 4 <= dist ? value.slice(dist + 6) : undefined;
}

type GsapScriptReplacer = (
  full: string,
  prefix: string,
  src: string,
  file: string,
  suffix: string,
) => string;

type GsapMatch = { valueStart: number; close: number; end: number; file: string };

/**
 * The last `src=` in one `<script` tag that the gsap rewrite matches, which is the one the greedy
 * `[^>]*` keeps. `laterTagsFail` is set when a value never closes or no `>` follows it, since then
 * no later value can close or reach a `>` either.
 */
function lastGsapMatch(
  html: string,
  finders: {
    nextSrc: Finder;
    nextQuote: (from: number) => number;
    nextGt: (from: number) => number;
  },
  tagStart: number,
  gt: number,
): { match?: GsapMatch; laterTagsFail: boolean } {
  const { nextSrc, nextQuote, nextGt } = finders;
  let match: GsapMatch | undefined;
  for (let src = nextSrc(tagStart); src && src.index < gt; src = nextSrc(src.index + 1)) {
    const valueStart = src.index + 5;
    const close = nextQuote(valueStart);
    const end = close < 0 ? -1 : nextGt(close + 1);
    if (end < 0) return { match, laterTagsFail: true };
    const file = gsapDistFile(html.slice(valueStart, close));
    if (file !== undefined) match = { valueStart, close, end, file };
  }
  return { match, laterTagsFail: false };
}

/** `html.replace(/(<script\b[^>]*\bsrc=["'])([^"']*gsap[^"']*\/dist\/([^"']+))(["'][^>]*>)/gi, replace)`. */
export function replaceGsapDistScripts(html: string, replace: GsapScriptReplacer): string {
  const opener = /<script\b/gi;
  const finders = {
    nextSrc: forwardFinder(html, /\bsrc=["']/gi),
    nextQuote: indexFinder(html, /["']/g),
    nextGt: indexFinder(html, />/g),
  };
  let out = "";
  let kept = 0;
  for (let open = opener.exec(html); open; open = opener.exec(html)) {
    const gt = finders.nextGt(open.index);
    if (gt < 0) break;
    const { match, laterTagsFail } = lastGsapMatch(html, finders, open.index, gt);
    if (match) {
      const { valueStart, close, end, file } = match;
      const full = html.slice(open.index, end + 1);
      const src = html.slice(valueStart, close);
      out += html.slice(kept, open.index);
      out += replace(
        full,
        html.slice(open.index, valueStart),
        src,
        file,
        html.slice(close, end + 1),
      );
      kept = end + 1;
    }
    if (laterTagsFail) break;
    opener.lastIndex = match ? kept : gt;
  }
  return out + html.slice(kept);
}

/**
 * Removes one span from each start tag `opener` finds: the span `spanIn` returns for the text
 * from the end of the tag name to the tag's first `>` (or to the end of the page when there is
 * none). The span may run past that `>`. Scanning resumes after each removed span, as a global
 * `replace` would.
 */
function removeSpanPerTag(
  html: string,
  opener: RegExp,
  spanIn: (attrsStart: number, tagEnd: number) => [number, number] | undefined,
): string {
  const nextGt = indexFinder(html, />/g);
  let out = "";
  let kept = 0;
  for (let open = opener.exec(html); open; open = opener.exec(html)) {
    const attrsStart = open.index + open[0].length;
    const gt = nextGt(attrsStart);
    const span = spanIn(attrsStart, gt < 0 ? html.length : gt);
    if (span) {
      out += html.slice(kept, span[0]);
      kept = span[1];
    } else if (gt < 0) break;
    opener.lastIndex = span ? kept : gt;
  }
  return out + html.slice(kept);
}

/** `html.replace(/(<tagName\b[^>]*)\s+crossorigin(?:=["'][^"']*["'])?/gi, "$1")`. */
export function stripCrossoriginAttr(html: string, tagName: "video" | "img" | "audio"): string {
  const nextQuote = indexFinder(html, /["']/g);
  const nextAttr = forwardFinder(html, /\scrossorigin/gi);
  return removeSpanPerTag(html, new RegExp(`<${tagName}\\b`, "gi"), (attrsStart, tagEnd) => {
    // The greedy `[^>]*` leaves the last whitespace character before the last `crossorigin`.
    let last = -1;
    for (let at = nextAttr(attrsStart); at && at.index < tagEnd; at = nextAttr(at.index + 12)) {
      last = at.index;
    }
    if (last < 0) return undefined;
    const nameEnd = last + 12;
    const quote = html[nameEnd + 1];
    const quoted = html[nameEnd] === "=" && (quote === '"' || quote === "'");
    const close = quoted ? nextQuote(nameEnd + 2) : -1;
    return [last, close < 0 ? nameEnd : close + 1];
  });
}

/** `html.replace(/(<(?:video|audio)\b[^>]*?)\s+preload\s*=\s*["']none["']/gi, "$1")`. */
export function stripPreloadNone(html: string): string {
  // Starting only where a whitespace run starts finds the same first match without retrying
  // `\s+` from every character of the run.
  const nextAttr = forwardFinder(html, /(?<!\s)\s+preload\s*=\s*["']none["']/gi);
  return removeSpanPerTag(html, /<(?:video|audio)\b/gi, (attrsStart, tagEnd) => {
    const attr = nextAttr(attrsStart);
    return attr && attr.index < tagEnd ? [attr.index, attr.index + attr[0].length] : undefined;
  });
}

export function hasClosedMediaTag(text: string): boolean {
  const open = /<(?:video|audio)\b/i.exec(text);
  return open !== null && text.includes(">", open.index + open[0].length);
}

// For <img> only a real `src` counts, never `data-src` or `data-*-src` (lazy-loader placeholders
// whose URL is not what Chrome paints). `srcset` never counts, since `\s*=` must follow `src`.
const REMOTE_SRC_TAGS = {
  media: { opener: "<(?:video|audio)\\b", attr: /\bsrc\s*=\s*["'](https?:\/\/)/gi },
  source: { opener: "<source\\b", attr: /\bsrc\s*=\s*["'](https?:\/\/)/gi },
  img: { opener: "<img\\b", attr: /(?<![\w-])src\s*=\s*["'](https?:\/\/)/gi },
} as const;

/**
 * Group 1 of every match of `/<tag\b[^>]*?src\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*>/gi`, in
 * order: `<video>`/`<audio>` and `<source>` use `\bsrc`, `<img>` uses `(?<![\w-])src`.
 */
export function remoteSrcUrls(html: string, tag: keyof typeof REMOTE_SRC_TAGS): string[] {
  const opener = new RegExp(REMOTE_SRC_TAGS[tag].opener, "gi");
  const nextAttr = forwardFinder(html, new RegExp(REMOTE_SRC_TAGS[tag].attr));
  const nextGt = indexFinder(html, />/g);
  const nextQuote = indexFinder(html, /["']/g);
  const urls: string[] = [];
  for (let open = opener.exec(html); open; open = opener.exec(html)) {
    const attrsStart = open.index + open[0].length;
    const gt = nextGt(attrsStart);
    if (gt < 0) break;
    let resumeAt = gt;
    // The lazy `[^>]*?` takes the first `src=` that leads to a full match.
    for (
      let attr = nextAttr(attrsStart);
      attr && attr.index < gt;
      attr = nextAttr(attr.index + 1)
    ) {
      const urlRest = attr.index + attr[0].length;
      const close = nextQuote(urlRest);
      if (close < 0) return urls;
      if (close === urlRest) continue;
      const end = nextGt(close + 1);
      if (end < 0) return urls;
      urls.push(html.slice(urlRest - attr[1]!.length, close));
      resumeAt = end + 1;
      break;
    }
    opener.lastIndex = resumeAt;
  }
  return urls;
}

/** One pass of `markup.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")`. */
export function removeScriptAndStyleBlocks(markup: string): string {
  const opener = /<(script|style)\b/gi;
  const nextGt = indexFinder(markup, />/g);
  const closers: Record<string, Finder> = {
    script: forwardFinder(markup, /<\/script>/gi),
    style: forwardFinder(markup, /<\/style>/gi),
  };
  let out = "";
  let kept = 0;
  for (let open = opener.exec(markup); open; open = opener.exec(markup)) {
    const gt = nextGt(open.index + open[0].length);
    if (gt < 0) break;
    const close = closers[open[1]!.toLowerCase()]!(gt + 1);
    if (!close) continue;
    out += markup.slice(kept, open.index);
    kept = close.index + close[0].length;
    opener.lastIndex = kept;
  }
  return out + markup.slice(kept);
}

const VOID_TAG = /(img|br|hr|input|source|track|area|base|col|embed|link|meta|param|wbr)\b/iy;

/** The name the counting regex captures at the `<` at `open`, and where its match ends. */
function countedTagAt(
  markup: string,
  open: number,
  nextGt: (from: number) => number,
): { name: string; end: number } | undefined {
  const first = markup.charCodeAt(open + 1);
  if (first === 47 && isLetter(markup.charCodeAt(open + 2))) {
    const end = nameRunEnd(markup, open + 3);
    return { name: markup.slice(open + 2, end), end };
  }
  if (!isLetter(first)) return undefined;
  VOID_TAG.lastIndex = open + 1;
  const known = VOID_TAG.exec(markup);
  if (known) return { name: known[1]!, end: open + 1 + known[0].length };
  const nameEnd = tagNameEnd(markup, open);
  const gt = nameEnd < 0 ? -1 : nextGt(open);
  if (gt < 0 || markup.charCodeAt(gt - 1) !== 47) return undefined;
  return { name: markup.slice(open + 1, nameEnd), end: gt + 1 };
}

/**
 * The tag name each match of
 * `/<\/([a-zA-Z][-a-zA-Z0-9]*)|<(img|br|hr|input|source|track|area|base|col|embed|link|meta|param|wbr)\b|<([a-zA-Z][-a-zA-Z0-9]*)\b[^>]*\/>/gi`
 * captures, in order and with its original case.
 */
export function* countedTagNames(markup: string): Generator<string> {
  const nextGt = indexFinder(markup, />/g);
  for (let open = markup.indexOf("<"); open >= 0; ) {
    const tag = countedTagAt(markup, open, nextGt);
    if (tag) yield tag.name;
    open = markup.indexOf("<", tag ? tag.end : open + 1);
  }
}

/** How many matches `/<tagName\b[^>]*ATTR[^>]*>/gi` has, for an `attr` source that matches no `>`. */
export function countTagsWithAttr(markup: string, tagName: string, attr: string): number {
  const opener = new RegExp(`<${tagName}\\b`, "gi");
  const nextGt = indexFinder(markup, />/g);
  const nextAttr = forwardFinder(markup, new RegExp(attr, "gi"));
  let count = 0;
  for (let open = opener.exec(markup); open; open = opener.exec(markup)) {
    const attrsStart = open.index + open[0].length;
    const gt = nextGt(attrsStart);
    if (gt < 0) break;
    const found = nextAttr(attrsStart);
    const inTag = found !== null && found.index < gt;
    if (inTag) count++;
    opener.lastIndex = inTag ? gt + 1 : gt;
  }
  return count;
}

/**
 * The closing quotes of the last two quoted `name` values that start inside one tag, -1 when
 * absent. `unclosed` is set when a value never closes, since no later value can close either.
 */
function lastQuotedValueCloses(
  nextAttr: Finder,
  nextQuote: (from: number) => number,
  from: number,
  tagEnd: number,
): { close: number; earlierClose: number; unclosed: boolean } {
  let close = -1;
  let earlierClose = -1;
  for (let attr = nextAttr(from); attr && attr.index < tagEnd; attr = nextAttr(attr.index + 1)) {
    const quote = nextQuote(attr.index + attr[0].length);
    if (quote < 0) return { close, earlierClose, unclosed: true };
    earlierClose = close;
    close = quote;
  }
  return { close, earlierClose, unclosed: false };
}

/**
 * Each start tag with a quoted `name` attribute, in order, as
 * `/<[a-zA-Z][-a-zA-Z0-9]*\b[^>]*\bname=["'][^"']*["']/gi` matches it: the tag's start, the quote
 * that closes the last such value in the tag, and the quote that closes the one before it. A
 * value may run past the tag's first `>`.
 */
function* tagsWithQuotedAttr(
  html: string,
  name: string,
): Generator<{ start: number; close: number; earlierClose: number }> {
  const opener = /<[a-zA-Z]/g;
  const nextGt = indexFinder(html, />/g);
  const nextQuote = indexFinder(html, /["']/g);
  const nextAttr = forwardFinder(html, new RegExp(`\\b${name}=["']`, "gi"));
  for (let open = opener.exec(html); open; open = opener.exec(html)) {
    if (tagNameEnd(html, open.index) < 0) continue;
    const gt = nextGt(open.index);
    const tagEnd = gt < 0 ? html.length : gt;
    const { close, earlierClose, unclosed } = lastQuotedValueCloses(
      nextAttr,
      nextQuote,
      open.index + 2,
      tagEnd,
    );
    if (close >= 0) yield { start: open.index, close, earlierClose };
    if (unclosed || (close < 0 && gt < 0)) return;
    opener.lastIndex = close >= 0 ? close + 1 : gt;
  }
}

/** How many matches `/<[a-zA-Z][-a-zA-Z0-9]*\b[^>]*\bdata-composition-src=["'][^"']*["']/gi` has. */
export function countCompositionSrcMounts(markup: string): number {
  let count = 0;
  for (const _ of tagsWithQuotedAttr(markup, "data-composition-src")) count++;
  return count;
}

/** What `html.match(/<[a-zA-Z][-a-zA-Z0-9]*\b[^>]*\bdata-composition-id=["'][^"']*["'][^>]*>/i)?.[0]` returns. */
export function firstCompositionIdTag(html: string): string | undefined {
  for (const { start, close, earlierClose } of tagsWithQuotedAttr(html, "data-composition-id")) {
    // With no `>` after the last value, the match falls back to the value before it, which ends
    // before the tag's `>` when the tag has one. No later tag can match either way.
    let end = html.indexOf(">", close + 1);
    if (end < 0 && earlierClose >= 0) end = html.indexOf(">", earlierClose + 1);
    return end < 0 ? undefined : html.slice(start, end + 1);
  }
  return undefined;
}
