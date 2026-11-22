// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { isSafeAttributeValue, markupOutsideAllowlist } from "./htmlAttrSafety";

const root = (html: string) => {
  const holder = document.createElement("template");
  holder.innerHTML = html;
  return holder.content.firstElementChild!;
};

describe("markupOutsideAllowlist", () => {
  it("names each handler and script link anywhere in the tree", () => {
    const tree = root(
      `<div onclick="a()"><a href=" javascript:b()">x</a><img src="data:text/html,c" onerror="d()"></div>`,
    );
    expect(markupOutsideAllowlist(tree)).toEqual([
      "div[onclick]",
      "a[href]",
      "img[src]",
      "img[onerror]",
    ]);
  });

  it("names elements that carry code, wherever they sit, a template's content included", () => {
    const tree = root(
      `<div><script>a()</script><iframe srcdoc="<b>x</b>"></iframe><object data="x"></object><embed src="y"><template><p><script>b()</script></p></template></div>`,
    );
    expect(markupOutsideAllowlist(tree)).toEqual(
      expect.arrayContaining(["script", "iframe", "iframe[srcdoc]", "object", "embed"]),
    );
    expect(markupOutsideAllowlist(tree).filter((found) => found === "script")).toHaveLength(2);
  });

  it("names an SVG animation that sets a script link, and a script link in xlink:href", () => {
    const tree = root(
      `<svg><a><set attributeName="href" to="javascript:a()"/><use xlink:href="javascript:b()"/></a></svg>`,
    );
    expect(markupOutsideAllowlist(tree)).toEqual([
      "set",
      "set[attributeName]",
      "set[to]",
      "use[xlink:href]",
    ]);
  });

  it("names nothing in ordinary markup, inline SVG with its namespace declarations included", () => {
    const tree = root(
      `<section id="s" data-start="1" style="color: red"><video src="clip.mp4" poster="p.png" playsinline></video><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1 1"><path d="M0 0"/><use xlink:href="#p"/></svg></section>`,
    );
    expect(markupOutsideAllowlist(tree)).toEqual([]);
  });

  it("names a namespace declaration that holds anything but its own namespace", () => {
    const tree = root(`<svg xmlns:xlink="http://example.com/"><path d="M0 0"/></svg>`);
    expect(markupOutsideAllowlist(tree)).toEqual(["svg[xmlns:xlink]"]);
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
