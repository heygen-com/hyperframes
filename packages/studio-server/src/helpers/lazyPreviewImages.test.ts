import { describe, expect, it } from "vitest";
import { lazyPreviewImages } from "./lazyPreviewImages.js";

const doc = (body: string) => `<!DOCTYPE html><html><head></head><body>${body}</body></html>`;
const loadingOf = (html: string, id: string) =>
  new RegExp(`<img[^>]*id="${id}"[^>]*>`).exec(html)?.[0].match(/loading="(\w+)"/)?.[1] ?? null;

describe("lazyPreviewImages", () => {
  it("marks only images in clips that start after 0 lazy", () => {
    const html = lazyPreviewImages(
      doc(
        '<div data-start="0"><img id="first" src="a.png">' +
          '<div data-start="5"><img id="later" src="b.png"><img id="authored" loading="eager" src="c.png"></div>' +
          '<div data-start="intro.end"><img id="referenced" src="d.png"></div></div>' +
          '<img id="untimed" src="e.png">',
      ),
    );
    expect(
      ["first", "later", "authored", "referenced", "untimed"].map((id) => loadingOf(html, id)),
    ).toEqual([null, "lazy", "eager", null, null]);
  });

  it("leaves script text and fragments untouched", () => {
    const script = '<script>el.innerHTML = "<img src=x.png>";</script>';
    expect(lazyPreviewImages(doc(`${script}<div data-start="5"></div>`))).toContain(script);
    const fragment = '<div data-start="5"><img src="b.png"></div>';
    expect(lazyPreviewImages(fragment)).toBe(fragment);
  });
});
