// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { isSafeAttributeValue, unsafeMarkup } from "./htmlAttrSafety";

const root = (html: string) => {
  const holder = document.createElement("template");
  holder.innerHTML = html;
  return holder.content.firstElementChild!;
};

describe("unsafeMarkup", () => {
  it("names each handler and script link anywhere in the tree", () => {
    const tree = root(
      `<div onclick="a()"><a href=" javascript:b()">x</a><img src="data:text/html,c" onerror="d()"></div>`,
    );
    expect(unsafeMarkup(tree)).toEqual(["div[onclick]", "a[href]", "img[src]", "img[onerror]"]);
  });

  it("names elements that carry code, wherever they sit, a template's content included", () => {
    const tree = root(
      `<div><script>a()</script><iframe srcdoc="<b>x</b>"></iframe><object data="x"></object><embed src="y"><template><p><script>b()</script></p></template></div>`,
    );
    expect(unsafeMarkup(tree)).toEqual(["script", "iframe[srcdoc]", "object", "embed", "script"]);
  });

  it("names an SVG animation that sets a script link", () => {
    const tree = root(
      `<svg><a><set attributeName="href" to="javascript:a()"/><animate attributeName="xlink:href" values="x.svg;javascript:b()"/></a></svg>`,
    );
    expect(unsafeMarkup(tree)).toEqual(["set[to]", "animate[values]"]);
  });

  it("names nothing in ordinary markup", () => {
    const tree = root(
      `<section id="s" data-start="1" style="color: red"><video src="clip.mp4" poster="p.png" playsinline></video><iframe src="https://example.com/"></iframe><svg viewBox="0 0 1 1"><path d="M0 0"/><animate attributeName="opacity" values="0;1"/></svg></section>`,
    );
    expect(unsafeMarkup(tree)).toEqual([]);
  });
});

describe("isSafeAttributeValue", () => {
  it("reads a link the way a browser does: no tab, newline or leading control character hides its scheme", () => {
    for (const link of [
      "java\tscript:a()",
      "\njavascript:a()",
      "\u0001 javascript:a()",
      "JAVA\r\nSCRIPT:a()",
    ])
      expect(isSafeAttributeValue("href", link)).toBe(false);
    expect(isSafeAttributeValue("data", "javascript:a()")).toBe(false);
    expect(isSafeAttributeValue("href", "https://example.com/java\tscript")).toBe(true);
  });
});
