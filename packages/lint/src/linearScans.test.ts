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

describe("linear scans", () => {
  it("answer every page exactly as the regexes they replace", () => {
    expect(pages(20_000).flatMap(disagreements)).toEqual([]);
  });

  // At 4 MB each regex above runs for minutes or more on these pages; the scans take milliseconds.
  it.each(["<script ", "<script>", "<style ", "<style>", "/*", "<pre>", "<text ", "< / script"])(
    "finish a 4 MB page of unclosed %j in well under a second",
    (unit) => {
      const page = unit.repeat(Math.floor(4_000_000 / unit.length));
      const started = performance.now();
      replaceBlockComments(page, "");
      hasInvalidScriptClose(page);
      emptyStyleBlocks(page);
      styleTagTokens(page);
      protectedBlockRanges(page);
      htmlTagTracker(page)(page.length);
      hasScriptWithSrc(page);
      expect(performance.now() - started).toBeLessThan(1000);
    },
  );
});
