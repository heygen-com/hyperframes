import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";
import {
  blockComments,
  emptyStyleBlocks,
  hasInvalidScriptClose,
  hasScriptWithSrc,
  htmlTagTracker,
  protectedBlockRanges,
  replaceBlockComments,
  styleTagTokens,
} from "./linearScans";

const PATTERNS = {
  blockComment: /\/\*[\s\S]*?\*\//g,
  invalidScriptClose: /<script[^>]*>[\s\S]*?<\s*\/\s*script(?!>)/i,
  scriptWithSrc: /<script\b[^>]*\bsrc\s*=/i,
  styleBlock: /<style\b[^>]*>[\s\S]*?<\/style>/gi,
  styleTokens: /<script\b[\s\S]*?<\/script[^>]*>|<style\b|<\/style\s*>/gi,
  protectedBlock:
    /<(style|script|template|title|noscript|pre|code|textarea|text)\b[^>]*>[\s\S]*?<\/\1(?:\s[^>]*)?>/gi,
};

function insideHtmlTag(source: string, index: number): boolean {
  let inTag = false;
  let quote: string | null = null;
  for (let i = 0; i < index; i++) {
    const char = source[i];
    if (!inTag) {
      if (char === "<") inTag = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === ">") inTag = false;
  }
  return inTag;
}

const TOKENS = [
  "<script",
  "<SCRIPT ",
  "<script>",
  "</script>",
  "</script >",
  "</scripts",
  "< / script",
  "<style",
  "<STYLE x>",
  "</style>",
  "</style >",
  "</STYLE\n>",
  "<template>",
  "</template x>",
  "<text>",
  "</text>",
  "</textarea>",
  "<textarea>",
  "<pre>",
  "</pre\t>",
  "</prex>",
  "<code>",
  "</code>",
  "/*",
  "*/",
  "/*/",
  "a",
  " ",
  "\n",
  ">",
  "<",
  '"',
  "'",
  "=",
  " src=",
  "xsrc =",
  "\tSRC\n=",
];

function pages(count: number): string[] {
  let seed = 11;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  return Array.from({ length: count }, () =>
    Array.from(
      { length: 1 + Math.floor(next() * 24) },
      () => TOKENS[Math.floor(next() * TOKENS.length)],
    ).join(""),
  );
}

function disagreements(page: string): string[] {
  const tracked = htmlTagTracker(page);
  const checks: [string, unknown, unknown][] = [
    [
      "blockComments",
      [...blockComments(page)].map((c) => [c.index, c.text]),
      [...page.matchAll(PATTERNS.blockComment)].map((m) => [m.index, m[0]]),
    ],
    [
      "replaceBlockComments",
      replaceBlockComments(page, " "),
      page.replace(PATTERNS.blockComment, " "),
    ],
    ["hasInvalidScriptClose", hasInvalidScriptClose(page), PATTERNS.invalidScriptClose.test(page)],
    ["hasScriptWithSrc", hasScriptWithSrc(page), PATTERNS.scriptWithSrc.test(page)],
    [
      "emptyStyleBlocks",
      emptyStyleBlocks(page),
      page.replace(PATTERNS.styleBlock, "<style></style>"),
    ],
    [
      "styleTagTokens",
      styleTagTokens(page),
      [...page.matchAll(PATTERNS.styleTokens)].map((m) => m[0]).filter((t) => !/^<script/i.test(t)),
    ],
    [
      "protectedBlockRanges",
      protectedBlockRanges(page),
      [...page.matchAll(PATTERNS.protectedBlock)].map((m) => ({
        start: m.index,
        end: m.index + m[0].length,
      })),
    ],
  ];
  for (let i = 0; i <= page.length; i += 3)
    checks.push([`htmlTagTracker@${i}`, tracked(i), insideHtmlTag(page, i)]);
  return checks
    .filter(([, actual, expected]) => !isDeepStrictEqual(actual, expected))
    .map(([name]) => `${name}: ${JSON.stringify(page)}`);
}

function scanAll(page: string): void {
  replaceBlockComments(page, "");
  hasInvalidScriptClose(page);
  emptyStyleBlocks(page);
  styleTagTokens(page);
  protectedBlockRanges(page);
  htmlTagTracker(page)(page.length);
  hasScriptWithSrc(page);
}

/** Characters the searches inside `run` read: each regex exec and indexOf from where it starts to where it stops. */
function charactersRead(run: () => void): number {
  let read = 0;
  const { exec } = RegExp.prototype;
  const { indexOf, lastIndexOf } = String.prototype;
  RegExp.prototype.exec = function (this: RegExp, input: string) {
    const from = this.global || this.sticky ? this.lastIndex : 0;
    const found = exec.call(this, input);
    read += (found ? found.index + found[0].length : input.length) - from;
    return found;
  };
  String.prototype.indexOf = function (this: string, search: string, from = 0) {
    const at = indexOf.call(this, search, from);
    read += (at < 0 ? this.length : at + search.length) - from;
    return at;
  };
  String.prototype.lastIndexOf = function (this: string, search: string, from?: number) {
    read += this.length;
    return lastIndexOf.call(this, search, from);
  };
  try {
    run();
  } finally {
    RegExp.prototype.exec = exec;
    String.prototype.indexOf = indexOf;
    String.prototype.lastIndexOf = lastIndexOf;
  }
  return read;
}

describe("linear scans", () => {
  it("answer every page exactly as the regexes they replace", () => {
    expect(pages(20_000).flatMap(disagreements)).toEqual([]);
  });

  // fails without the fix: the same scans were held to 1,000 ms of wall clock and took 1,027 ms on a loaded runner.
  // Counting characters read is the same on any machine; a scan that rereads from every unclosed opener grows as n².
  it.each(["<script ", "<script>", "<style ", "<style>", "/*", "<pre>", "<text ", "< / script"])(
    "read a page of unclosed %j a bounded number of times over",
    (unit) => {
      const page = unit.repeat(Math.floor(200_000 / unit.length));
      expect(charactersRead(() => scanAll(page)) / page.length).toBeLessThan(16);
    },
  );

  // A regex that rescans inside one call is invisible to the count. At 4 MB those regexes run for minutes; the scans
  // take milliseconds quiet and about a second on a loaded runner, so 15 s fails only a reversion.
  it.each(["<script ", "<script>", "<style ", "<style>", "/*", "<pre>", "<text ", "< / script"])(
    "finish a 4 MB page of unclosed %j in seconds, not the minutes a backtracking regex takes",
    (unit) => {
      const page = unit.repeat(Math.floor(4_000_000 / unit.length));
      const started = performance.now();
      scanAll(page);
      expect(performance.now() - started).toBeLessThan(15_000);
    },
    30_000,
  );
});
