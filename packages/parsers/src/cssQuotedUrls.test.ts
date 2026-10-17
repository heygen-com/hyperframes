import { describe, expect, it } from "vitest";
import { CSS_URL_RE } from "./assetPaths.js";
import { rewriteCssAssetUrls } from "./rewriteSubCompPaths.js";

const quoted = [
  {
    name: "double-quoted parentheses",
    quote: '"',
    path: "../cover(1).svg",
    encoded: "cover%281%29.svg",
  },
  {
    name: "single-quoted parentheses",
    quote: "'",
    path: "../cover(1).svg",
    encoded: "cover%281%29.svg",
  },
  {
    name: "apostrophe inside double quotes",
    quote: '"',
    path: "../author's.svg",
    encoded: "author%27s.svg",
  },
  {
    name: "double quote inside single quotes",
    quote: "'",
    path: '../say"hi.svg',
    encoded: "say%22hi.svg",
  },
];

describe("quoted CSS asset URL scanning", () => {
  it.each(quoted)("retains exactly two captures for $name", ({ quote, path }) => {
    const text = "url(" + quote + path + quote + ")";
    const matches = [...text.matchAll(CSS_URL_RE)];
    expect(matches).toHaveLength(1);
    expect(matches[0]?.slice(1)).toEqual([quote, path]);
    expect(matches[0]).toHaveLength(3);
  });

  it.each([
    ["escaped space", "../cover\\ 1.svg"],
    ["escaped LF", "../cover\\\n1.svg"],
    ["escaped CRLF", "../cover\\\r\n1.svg"],
    ["hex escape", "../cover\\20 name.svg"],
  ])("preserves the raw captures for %s", (_name, path) => {
    const matches = [...('url("' + path + '")').matchAll(CSS_URL_RE)];
    expect(matches).toHaveLength(1);
    expect(matches[0]?.slice(1)).toEqual(['"', path]);
    expect(matches[0]).toHaveLength(3);
  });

  it.each(quoted)("rebases $name from the subcomposition", ({ quote, path, encoded }) => {
    const css = ".card{background-image:url(" + quote + path + quote + ")}";
    expect(rewriteCssAssetUrls(css, "scenes/scene.html")).toBe(
      ".card{background-image:url(" + quote + encoded + quote + ")}",
    );
  });

  it.each([
    ["unquoted", "url( ../cover.svg )", "url(cover.svg)"],
    ["spaced quoted", 'url( "../cover.svg" )', 'url("cover.svg")'],
    [
      "remote",
      'url("https://example.test/cover(1).svg")',
      'url("https://example.test/cover(1).svg")',
    ],
    [
      "inline",
      'url("data:image/svg+xml,<svg>(owned)</svg>")',
      'url("data:image/svg+xml,<svg>(owned)</svg>")',
    ],
    ["root relative", 'url("/cover(1).svg")', 'url("/cover(1).svg")'],
  ])("preserves the %s control", (_name, input, expected) => {
    expect(rewriteCssAssetUrls(input, "scenes/scene.html")).toBe(expected);
  });

  it.each(['url("../cover.svg)', 'url("../cover.svg"', 'url("")', "url()"])(
    "leaves the malformed or empty URL unchanged: %s",
    (input) => {
      expect([...input.matchAll(CSS_URL_RE)]).toEqual([]);
      expect(rewriteCssAssetUrls(input, "scenes/scene.html")).toBe(input);
    },
  );

  it("keeps each URL boundary when rewriting several values", () => {
    const css = 'background:url("../cover(1).svg"),url(../plain.svg);color:red';
    expect(rewriteCssAssetUrls(css, "scenes/scene.html")).toBe(
      'background:url("cover%281%29.svg"),url(plain.svg);color:red',
    );
  });

  it("rejects long malformed and whitespace-boundary inputs", () => {
    for (const size of [10_000, 100_000, 1_000_000]) {
      for (const input of [
        "url(" + " ".repeat(size) + "x",
        'url("x' + " ".repeat(size) + "x",
        'url("x"' + " ".repeat(size) + "x",
        "url(x" + " ".repeat(size) + "x",
      ]) {
        expect([...input.matchAll(CSS_URL_RE)]).toEqual([]);
      }
    }
  }, 5_000);
});
