import { describe, expect, it } from "vitest";
import {
  patchElementInHtml,
  removeElementsFromHtml,
  splitElementInHtml,
  unwrapElementsFromHtml,
  wrapElementsInHtml,
} from "./sourceMutation.js";

// A regression test: each of these removed, cut, grouped or dissolved the script, style or page shell it was aimed at.
describe("a structural edit aimed at code or the page shell, not a layer", () => {
  const PAGE = `<!doctype html><html><head><title id="name">Film</title><style id="css">.a { color: red; }</style></head><body data-hf-group="page">
<div id="root" data-composition-id="main">
  <div id="hero" data-start="0" data-duration="4">Hello</div>
  <template id="tpl"><p>kept</p></template>
  <script id="code" data-start="0" data-duration="4">window.ready = true;</script>
</div>
</body></html>`;
  const NOT_LAYERS = [
    { id: "code" },
    { selector: "#root > script" },
    { id: "css" },
    { id: "tpl" },
    { id: "name" },
    { selector: "head" },
    { selector: "body" },
    { selector: "html" },
  ];
  const BOX = { left: 0, top: 0, width: 10, height: 10 };

  for (const target of NOT_LAYERS) {
    const aim = JSON.stringify(target);
    it(`delete leaves the file as it was for ${aim}`, () => {
      expect(removeElementsFromHtml(PAGE, [target])).toBe(PAGE);
    });
    it(`cut is refused for ${aim}`, () => {
      const result = splitElementInHtml(PAGE, target, 2, "half", { start: 0, duration: 4 });
      expect(result).toMatchObject({ html: PAGE, matched: false, refusal: "target-not-found" });
    });
    it(`group is refused for ${aim}`, () => {
      const result = wrapElementsInHtml(PAGE, [target], "g", BOX, []);
      expect(result).toMatchObject({ html: PAGE, matched: false });
    });
    it(`ungroup is refused for ${aim}`, () => {
      expect(unwrapElementsFromHtml(PAGE, target)).toEqual({ html: PAGE, unwrapped: false });
    });
  }

  it("delete leaves a file with no page shell as it was when aimed at its body", () => {
    const notAPage = `export const answer = 42;\n`;
    expect(removeElementsFromHtml(notAPage, [{ selector: "body" }])).toBe(notAPage);
  });

  it("still saves a style set on the page's body", () => {
    const result = patchElementInHtml(PAGE, { selector: "body" }, [
      { type: "inline-style", property: "background", value: "black" },
    ]);
    expect(result.matched).toBe(true);
    expect(result.html).toMatch(/<body[^>]*background:\s*black/);
  });

  it("still deletes, cuts and groups an ordinary layer on the same page", () => {
    expect(removeElementsFromHtml(PAGE, [{ id: "hero" }, { id: "code" }])).not.toContain("Hello");
    expect(removeElementsFromHtml(PAGE, [{ id: "hero" }, { id: "code" }])).toContain(
      "window.ready",
    );
    expect(splitElementInHtml(PAGE, { id: "hero" }, 2, "half").matched).toBe(true);
    expect(wrapElementsInHtml(PAGE, [{ id: "hero" }, { id: "code" }], "g", BOX, []).matched).toBe(
      true,
    );
  });
});
