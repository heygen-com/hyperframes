import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";
import {
  bareOrQuotedCssUrlMatches,
  blockCommentMatches,
  cssImportMatches,
  cssRuleMatches,
  fontFaceBlockMatches,
  maskImageUrlMatches,
  styleBlockMatches,
  cssUrlMatches,
  hasBackgroundImageDeclaration,
  importRuleMatches,
  localFontFaceUrlMatches,
  rawCssUrlMatches,
  remoteBackgroundUrlMatches,
  remoteFontFaceUrlMatches,
  replaceMatches,
  sceneCssUrlMatches,
  stylesheetLinkMatches,
  urlHashRefMatches,
  type ScanMatch,
} from "./cssUrlScans";
import { rewriteCssAssetUrls } from "./rewriteSubCompPaths";

type Scan = (source: string) => Iterable<ScanMatch<Array<string | undefined>>>;

const SCANS: Array<[Scan, RegExp]> = [
  [cssUrlMatches, /\burl\(\s*(["']?)([^)"'\s](?:[^)"']*[^)"'\s])?)\1\s*\)/g],
  [rawCssUrlMatches, /\burl\(\s*(["']?)([^)"']+)\1\s*\)/g],
  [
    cssImportMatches,
    /@import\s+(?:url\(\s*(["']?)([^)"']+)\1\s*\)|(["'])([^"']+)\3)\s*([^;]*);\s*/g,
  ],
  [urlHashRefMatches, /(url\(\s*)(["']?)#([^"')\s]+)\2(\s*\))/gi],
  [sceneCssUrlMatches, /url\(\s*(['"]?)(.*?)\1\s*\)|@import\s+(['"])(.*?)\3/gi],
  [importRuleMatches, /@import\s+url\([^)]*\)\s*;|@import\s+["'][^"']+["']\s*;/gi],
  [
    remoteBackgroundUrlMatches,
    /background(?:-image)?\s*:\s*[^;}"']*?url\(\s*["']?(https?:\/\/[^"')]+)["']?\s*\)/gi,
  ],
  [remoteFontFaceUrlMatches, /url\(["']?(https?:\/\/[^"')]+)["']?\)/gi],
  [localFontFaceUrlMatches, /url\(["']?(?!data:|file:|https?:\/\/)([^"')]+)["']?\)/gi],
  [bareOrQuotedCssUrlMatches, /\burl\(\s*(?:"([^"]+)"|'([^']+)'|([^"')\s]+))\s*\)/gi],
  [
    maskImageUrlMatches,
    /\b(?:-webkit-)?mask-image\s*:\s*[^;{}]*url\(\s*(?:"([^"]+)"|'([^']+)'|([^"')\s]+))\s*\)/gi,
  ],
  [styleBlockMatches, /<style\b[^>]*>([\s\S]*?)<\/style>/gi],
  [fontFaceBlockMatches, /@font-face\s*\{([^}]*)\}/gi],
  [blockCommentMatches, /\/\*[\s\S]*?\*\//g],
  [stylesheetLinkMatches, /<link\b[^>]*\brel=["']stylesheet["'][^>]*>/gi],
  [cssRuleMatches, /([^{}]+)\{([^}]*)\}/g],
];
const BACKGROUND_IMAGE_DECL =
  /(?:^|;|\{)\s*background(?:-image)?\s*:[^;}]*(?:\bgradient\s*\(|url\s*\()/i;

const TOKENS = [
  "url(",
  "URL(",
  "uRl(",
  "xurl(",
  "url",
  "@import",
  "@IMPORT ",
  "@import ",
  "@import url(",
  "@import 'a",
  '@import "b c"',
  "@import\turl( '",
  "background",
  "BACKGROUND-IMAGE",
  "-image",
  "background:",
  "background: url(",
  "background-image:url( 'https://",
  " url(http://a",
  "url(https://",
  "url('http://x",
  "url(#a)",
  "url(",
  "gradient(",
  "xgradient(",
  "-gradient (",
  "http://",
  "HTTPS://",
  "https:/",
  "data:",
  "file:",
  "#",
  "#a",
  '"',
  "'",
  ")",
  "(",
  ";",
  "{",
  "}",
  ":",
  " ",
  "  ",
  "\n",
  "\t",
  "\r",
  "\u2028",
  "\u00a0",
  "a",
  "b c",
  "_",
  "\\",
  "-",
  "/x.png",
  "mask-image:",
  'url("")',
  "url('' )",
  "-WEBKIT-mask-image",
  "a-webkit-mask-image :",
  "<style",
  "<STYLE x>",
  ">",
  "</style>",
  "</STYLE>",
  "@font-face",
  "@FONT-FACE {",
  "/*",
  "*/",
  "/*/",
  "<link",
  "<LINK ",
  ' rel="stylesheet"',
  "REL='STYLESHEET'",
  "xrel='stylesheet'",
  "rel=\"stylesheet'",
];

function pages(count: number): string[] {
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  return Array.from({ length: count }, () =>
    Array.from(
      { length: 1 + Math.floor(next() * 24) },
      () => TOKENS[Math.floor(next() * TOKENS.length)],
    ).join(""),
  );
}

function disagreements(page: string): string[] {
  const out: string[] = [];
  for (const [scan, pattern] of SCANS) {
    const scanned = [...scan(page)].map((m) => [m.index, ...m.parts]);
    const matched = [...page.matchAll(pattern)].map((m) => [m.index, ...m]);
    if (!isDeepStrictEqual(scanned, matched)) out.push(`${scan.name}: ${JSON.stringify(page)}`);
  }
  if (hasBackgroundImageDeclaration(page) !== BACKGROUND_IMAGE_DECL.test(page))
    out.push(`hasBackgroundImageDeclaration: ${JSON.stringify(page)}`);
  return out;
}

describe("CSS url scans", () => {
  it("find every match the regexes they replace find, groups included", () => {
    expect(pages(20_000).flatMap(disagreements)).toEqual([]);
  });

  it("find quoted urls with parentheses, the other quote, spaces, escapes and an empty url( )", () => {
    const css = `a{b:url( "x (1).png" )} c{d:url('say "hi"')} e{f:url(\\(g\\))} h{i:url(  )}`;
    for (const [scan, pattern] of SCANS.slice(0, 2)) {
      expect([...scan(css)].map((m) => m.parts)).toEqual(
        [...css.matchAll(pattern)].map((m) => [...m]),
      );
    }
  });

  it.each([
    "{background:xgradient(1px)}",
    "{background:-gradient (1px)}",
    "a;background-image : url (x)",
    "{background:red;url(x)}",
  ])("tell a background image in %j as the regex does", (css) => {
    expect(hasBackgroundImageDeclaration(css)).toBe(BACKGROUND_IMAGE_DECL.test(css));
  });

  it("replace like String.prototype.replace with a function", () => {
    const css = `a{b:url(x.png)} c{d:url( 'y.png' )}`;
    const replace = (full: string, quote: string, url: string) => `url(${quote}<${url}>${quote})`;
    expect(replaceMatches(css, cssUrlMatches(css), replace)).toBe(
      css.replace(SCANS[0]![1], replace),
    );
  });

  // At 1 MB each regex above runs for minutes or more on these pages; the scans take milliseconds.
  it.each([
    "url(",
    "url( ",
    "url(a ",
    "url('",
    "url(#a",
    "@import url(",
    "@import 'a",
    "{background:",
    "background:url(http://",
    "url(http://",
    "url(a",
    " ",
    "mask-image:url(",
    "mask-image:",
    "<style",
    "<style>",
    "@font-face{",
    "/* ",
    "<link ",
    "a",
    "{a",
  ])("finish a 1 MB page of unclosed %j in well under a second", (unit) => {
    const page = unit.repeat(Math.floor(1_000_000 / unit.length));
    const started = performance.now();
    for (const [scan] of SCANS) Array.from(scan(page));
    hasBackgroundImageDeclaration(page);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("let rewriteCssAssetUrls finish a 1 MB page of unclosed url( in well under a second", () => {
    const css = "url(".repeat(250_000);
    const started = performance.now();
    expect(rewriteCssAssetUrls(css, "compositions/scene.html")).toBe(css);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
