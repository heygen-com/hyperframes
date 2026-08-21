import { describe, expect, it } from "vitest";
import { urlOccurrenceRe } from "./htmlCompiler.js";

/**
 * The embed step used `result.replaceAll(localPath, dataUri)` — a bare
 * substring rewrite over the whole compiled document. These pin the collision
 * that made unsafe: it is invisible in ordinary projects and easy to
 * reintroduce, because the naive form passes every test that uses one font.
 */
describe("font embed url() anchoring", () => {
  const DATA_URI = "data:font/woff2;base64,AAAA";
  const replace = (html: string, path: string) =>
    html.replace(urlOccurrenceRe(path), `url("${DATA_URI}")`);

  it("rewrites the exact occurrence, quoted or bare", () => {
    expect(replace(`src: url("fonts/x.ttf")`, "fonts/x.ttf")).toBe(`src: url("${DATA_URI}")`);
    expect(replace(`src: url(fonts/x.ttf)`, "fonts/x.ttf")).toBe(`src: url("${DATA_URI}")`);
    expect(replace(`src: url('fonts/x.ttf')`, "fonts/x.ttf")).toBe(`src: url("${DATA_URI}")`);
  });

  it("does not corrupt a longer url whose tail matches the embedded path", () => {
    // The reported corruption: embedding `fonts/x.ttf` rewrote the tail of an
    // untouched absolute rule, producing `url("file:///abs/<data-uri>")`.
    const html = `a { src: url("fonts/x.ttf") } b { src: url("file:///abs/fonts/x.ttf") }`;
    const out = replace(html, "fonts/x.ttf");
    expect(out).toContain(`a { src: url("${DATA_URI}") }`);
    expect(out).toContain(`b { src: url("file:///abs/fonts/x.ttf") }`);
  });

  it("does not corrupt a sibling whose path is a suffix of another project path", () => {
    // No file:// needed. Any two paths where one is a suffix of the other
    // collide under a bare substring replace.
    const html = `a { src: url("img/logo.ttf") } b { src: url("assets/img/logo.ttf") }`;
    const out = replace(html, "img/logo.ttf");
    expect(out).toContain(`a { src: url("${DATA_URI}") }`);
    expect(out).toContain(`b { src: url("assets/img/logo.ttf") }`);
  });

  it("leaves the path alone outside a url() wrapper", () => {
    const html = `/* see fonts/x.ttf for the source */ a { src: url("fonts/x.ttf") }`;
    const out = replace(html, "fonts/x.ttf");
    expect(out).toContain("/* see fonts/x.ttf for the source */");
  });

  it("treats regex metacharacters in a path literally", () => {
    const html = `a { src: url("fonts/x+y(1).ttf") }`;
    expect(replace(html, "fonts/x+y(1).ttf")).toBe(`a { src: url("${DATA_URI}") }`);
  });
});
