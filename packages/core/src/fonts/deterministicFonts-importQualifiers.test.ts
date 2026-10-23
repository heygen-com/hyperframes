// @vitest-environment node
import { beforeEach, expect, it } from "vitest";
import {
  _clearGoogleFontCssCacheForTests,
  injectDeterministicFontFaces,
} from "./deterministicFonts.js";
import { analyzeFontStylesheets, parseStylesheetImport } from "./fontStylesheets.js";
const context = { viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 };
const authoredUrl =
  "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500&text=Title";
beforeEach(() => _clearGoogleFontCssCacheForTests());
it.each([
  "/* trailing comment */",
  "layer(fonts) screen",
  "layer screen",
  "layer() screen",
  "layer(fonts) supports((display:grid) and selector(:is(.a,.b))) screen",
])("offers the authored font import with %s", async (qualifiers) => {
  const requested: string[] = [];
  const fetchImpl = Object.assign(
    async (input: RequestInfo | URL) => {
      requested.push(String(input));
      return new Response("", { status: 404 });
    },
    { preconnect: fetch.preconnect },
  );
  await injectDeterministicFontFaces(
    `<html><head><style>@import url("${authoredUrl}") ${qualifiers}; p{font-family:Fraunces}</style></head><body><p>Text</p></body></html>`,
    {
      mediaContext: context,
      allowSystemFontCapture: false,
      fetchImpl,
    },
  );
  expect(requested).toContain(authoredUrl);
});
it.each(["layer(fonts) print", "layer(fonts) supports(display:grid) print"])(
  "excludes the authored import when residual media is inactive: %s",
  (qualifiers) => {
    const result = analyzeFontStylesheets(
      `<html><head><style>@import url("${authoredUrl}") ${qualifiers};</style></head></html>`,
      context,
    );
    expect(result).not.toContain(authoredUrl);
  },
);
it("offers supports-qualified imports without granting suppression authority", () => {
  const html = `<html><head><style>@import url("${authoredUrl}") layer(fonts) supports(display:grid) screen;</style></head></html>`;
  expect(analyzeFontStylesheets(html, context)).toContain(authoredUrl);
  expect(analyzeFontStylesheets(html, context, undefined, "suppression")).not.toContain(
    authoredUrl,
  );
});
it.each([
  ['"theme colors.css"', "theme colors.css"],
  ["url(theme.css)", "theme.css"],
  ['url("theme\\20 colors.css")', "theme colors.css"],
])("preserves URL source and decodes its CSS token: %s", (source, url) => {
  expect(parseStylesheetImport(`${source} layer(fonts) screen`)).toEqual({
    source,
    url,
    media: "screen",
    hasLayer: true,
    hasSupportsCondition: false,
  });
});
it("rejects an unclosed import through the public analysis boundary", () => {
  const html = `<html><head><style>@import url(${" ".repeat(100000)}x; p{font-family:Inter}</style></head></html>`;
  const start = performance.now();
  expect(analyzeFontStylesheets(html, context)).not.toContain("@import");
  expect(performance.now() - start).toBeLessThan(1000);
});
