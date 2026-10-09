import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { inlineSubCompositions } from "./inlineSubCompositions.js";

describe("subcomposition quoted CSS asset paths", () => {
  it.each([
    ["../cover(1).svg", "cover%281%29.svg"],
    ["../author's.svg", "author%27s.svg"],
    ["../cover.svg", "cover.svg"],
    ["https://example.test/cover(1).svg", "https://example.test/cover(1).svg"],
  ])("preserves the resource named %s in hoisted and inline CSS", (path, encoded) => {
    const { document } = parseHTML(
      '<html><head></head><body><div data-composition-id="root"><div data-composition-id="scene" data-composition-src="scenes/scene.html"></div></div></body></html>',
    );
    const host = document.querySelector("[data-composition-src]");
    if (!host) throw new Error("owned subcomposition host missing");
    const css = '.card{background-image:url("' + path + '")}';
    const result = inlineSubCompositions(document, [host], {
      resolveHtml: () =>
        "<html><head><style>" +
        css +
        '</style></head><body><div data-composition-id="scene"><div class="card" style="background-image:url(&quot;' +
        path +
        '&quot;)">owned</div></div></body></html>',
      parseHtml: (html) => parseHTML(html).document,
      rewriteInlineStyles: true,
    });
    expect(result.styles.map((style) => style.css).join("\n")).toContain(
      'background-image:url("' + encoded + '")',
    );
    expect(document.querySelector(".card")?.getAttribute("style")).toBe(
      'background-image:url("' + encoded + '")',
    );
  });
});
