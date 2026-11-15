// Forward scans that answer what an open/any/close regex answers, without its rescan to the end from every unclosed opener.

function execFrom(pattern: RegExp, source: string, from: number): RegExpExecArray | null {
  pattern.lastIndex = from;
  return pattern.exec(source);
}

/** Every `/* … *\/` match of `/\/\*[\s\S]*?\*\//g`, in order. */
export function* blockComments(source: string): Generator<{ index: number; text: string }> {
  for (let from = 0; ; ) {
    const start = source.indexOf("/*", from);
    if (start < 0) return;
    const close = source.indexOf("*/", start + 2);
    if (close < 0) return;
    yield { index: start, text: source.slice(start, close + 2) };
    from = close + 2;
  }
}

/** `source.replace(/\/\*[\s\S]*?\*\//g, replacement)`. */
export function replaceBlockComments(source: string, replacement: string): string {
  let out = "";
  let kept = 0;
  for (const { index, text } of blockComments(source)) {
    out += source.slice(kept, index) + replacement;
    kept = index + text.length;
  }
  return out + source.slice(kept);
}

/** `/<script[^>]*>[\s\S]*?<\s*\/\s*script(?!>)/i.test(source)`. */
export function hasInvalidScriptClose(source: string): boolean {
  const open = execFrom(/<script/gi, source, 0);
  const gt = open ? source.indexOf(">", open.index + open[0].length) : -1;
  return gt >= 0 && execFrom(/<\s*\/\s*script(?!>)/gi, source, gt + 1) !== null;
}

/** `source.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "<style></style>")`. */
export function emptyStyleBlocks(source: string): string {
  let out = "";
  let kept = 0;
  const opener = /<style\b/gi;
  for (let open = execFrom(opener, source, 0); open; open = opener.exec(source)) {
    const gt = source.indexOf(">", open.index + 6);
    const close = gt < 0 ? null : execFrom(/<\/style>/gi, source, gt + 1);
    if (!close) break;
    out += `${source.slice(kept, open.index)}<style></style>`;
    kept = close.index + close[0].length;
    opener.lastIndex = kept;
  }
  return out + source.slice(kept);
}

/** The `<style` and `</style>` tokens of `/<script\b[\s\S]*?<\/script[^>]*>|<style\b|<\/style\s*>/gi`, scripts skipped. */
export function styleTagTokens(source: string): string[] {
  const tokens: string[] = [];
  const token = /<script\b|<style\b|<\/style\s*>/gi;
  let scriptsClose = true;
  for (let match = token.exec(source); match; match = token.exec(source)) {
    if (!/^<script/i.test(match[0])) {
      tokens.push(match[0]);
      continue;
    }
    if (!scriptsClose) continue;
    const close = execFrom(/<\/script/gi, source, match.index + 7);
    const gt = close ? source.indexOf(">", close.index + 8) : -1;
    if (gt < 0) scriptsClose = false;
    else token.lastIndex = gt + 1;
  }
  return tokens;
}

const PROTECTED_NAMES = "style|script|template|title|noscript|pre|code|textarea|text";

/** The spans of `/<(style|script|template|title|noscript|pre|code|textarea|text)\b[^>]*>[\s\S]*?<\/\1(?:\s[^>]*)?>/gi`. */
export function protectedBlockRanges(source: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const unclosed = new Set<string>();
  const lastGt = source.lastIndexOf(">");
  const opener = new RegExp(`<(${PROTECTED_NAMES})\\b`, "gi");
  for (let open = opener.exec(source); open; open = opener.exec(source)) {
    const name = open[1]!.toLowerCase();
    if (unclosed.has(name)) continue;
    const gt = source.indexOf(">", open.index + open[0].length);
    if (gt < 0) break;
    const end = protectedBlockEnd(source, name, gt + 1, lastGt);
    if (end < 0) {
      unclosed.add(name);
      continue;
    }
    ranges.push({ start: open.index, end });
    opener.lastIndex = end;
  }
  return ranges;
}

function protectedBlockEnd(source: string, name: string, from: number, lastGt: number): number {
  const closer = new RegExp(`</${name}`, "gi");
  for (let close = execFrom(closer, source, from); close; close = closer.exec(source)) {
    const after = close.index + close[0].length;
    if (after > lastGt) return -1;
    if (source[after] === ">") return after + 1;
    if (/\s/.test(source[after] ?? "")) return source.indexOf(">", after) + 1;
  }
  return -1;
}

/** Whether `index` falls inside a start or end tag, read as one forward pass over increasing indexes. */
export function htmlTagTracker(source: string): (index: number) => boolean {
  let i = 0;
  let inTag = false;
  let quote: string | null = null;
  return (index) => {
    for (; i < index; i++) {
      const char = source[i];
      if (!inTag) inTag = char === "<";
      else if (quote) quote = char === quote ? null : quote;
      else if (char === '"' || char === "'") quote = char;
      else if (char === ">") inTag = false;
    }
    return inTag;
  };
}

/** `/<script\b[^>]*\bsrc\s*=/i.test(source)`, reading each start tag once. */
export function hasScriptWithSrc(source: string): boolean {
  for (const [tag] of source.matchAll(/<script\b[^>]*>?/gi))
    if (/\bsrc\s*=/i.test(tag)) return true;
  return false;
}
