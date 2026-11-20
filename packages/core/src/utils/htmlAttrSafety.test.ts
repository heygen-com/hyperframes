// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { unsafeMarkupAttributes } from "./htmlAttrSafety";

const root = (html: string) => {
  const holder = document.createElement("template");
  holder.innerHTML = html;
  return holder.content.firstElementChild!;
};

describe("unsafeMarkupAttributes", () => {
  it("names each handler and script link anywhere in the tree", () => {
    const tree = root(
      `<div onclick="a()"><a href=" javascript:b()">x</a><img src="data:text/html,c" onerror="d()"></div>`,
    );
    expect(unsafeMarkupAttributes(tree)).toEqual([
      "div[onclick]",
      "a[href]",
      "img[src]",
      "img[onerror]",
    ]);
  });

  it("names nothing in ordinary markup", () => {
    const tree = root(
      `<section id="s" data-start="1" style="color: red"><video src="clip.mp4" poster="p.png" playsinline></video><svg viewBox="0 0 1 1"><path d="M0 0"/></svg></section>`,
    );
    expect(unsafeMarkupAttributes(tree)).toEqual([]);
  });
});
