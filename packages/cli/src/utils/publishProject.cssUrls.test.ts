import { describe, expect, it } from "vitest";
import { rewriteCssUrls } from "./publishProject.js";

describe("publish CSS url rewriting", () => {
  it("rewrites the urls a resolver claims", () => {
    const css = `a{background:url( "img/a.png" )} b{background:url(b.png)}`;
    const out = rewriteCssUrls(css, "/p", "index.html", (url) =>
      url === "b.png" ? "assets/b.png" : null,
    );
    expect(out).toEqual({
      css: `a{background:url( "img/a.png" )} b{background:url(assets/b.png)}`,
      modified: true,
    });
  });

  it("scans 1 MB of unclosed url( in well under a second", () => {
    const css = "url(".repeat(250_000);
    const started = performance.now();
    expect(rewriteCssUrls(css, "/p", "index.html", () => null)).toEqual({ css, modified: false });
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
