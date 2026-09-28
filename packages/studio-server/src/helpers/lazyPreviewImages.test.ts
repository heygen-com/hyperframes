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
    expect(html.match(/<img[^>]*data-hf-preview-lazy[^>]*>/g)).toEqual([
      '<img loading="lazy" data-hf-preview-lazy id="later" src="b.png">',
    ]);
  });

  it("keeps an authored loading attribute in any letter case", () => {
    const html = doc(
      '<div data-start="5"><IMG LOADING="eager" src="a.png"><img Loading="eager" src="b.png"></div>',
    );
    expect(lazyPreviewImages(html)).toBe(html);
  });

  it("marks a later image after a comment, script or template that holds an image", () => {
    const html = lazyPreviewImages(
      doc(
        '<!-- <img src="x.png"> --><script>el.innerHTML = "<img src=y.png>";</script>' +
          '<template><img id="cloned" src="t.png"></template>' +
          '<div data-start="5"><template><img src="u.png"></template><img id="later" src="b.png"></div>',
      ),
    );
    expect(["cloned", "later"].map((id) => loadingOf(html, id))).toEqual([null, "lazy"]);
  });

  it("changes nothing when the scanner and the DOM disagree on the images", () => {
    const html = doc('<xmp><img src="x.png"></xmp><div data-start="5"><img src="b.png"></div>');
    expect(lazyPreviewImages(html)).toBe(html);
  });

  it("leaves script text and fragments untouched", () => {
    const script = '<script>el.innerHTML = "<img src=x.png>";</script>';
    expect(lazyPreviewImages(doc(`${script}<div data-start="5"></div>`))).toContain(script);
    const fragment = '<div data-start="5"><img src="b.png"></div>';
    expect(lazyPreviewImages(fragment)).toBe(fragment);
  });

  it("changes nothing but the attribute, entities included", () => {
    const head = "<head><title>a &amp;lt;x &amp; y</title></head>";
    const body = '<div title="a &amp;amp;lt;b" data-start="5"><img src="b.png?x=1&amp;y=2"></div>';
    const html = `<!DOCTYPE html><html>${head}<body>${body}</body></html>`;
    expect(lazyPreviewImages(html)).toBe(
      html.replace("<img ", '<img loading="lazy" data-hf-preview-lazy '),
    );
  });

  it("stays linear on unclosed comments and raw text", () => {
    for (const unit of ["<!--", "<script>"]) {
      const html = doc(
        `<div data-start="5"><img src="a.png"></div>${unit.repeat(2_000_000 / unit.length)}`,
      );
      const started = performance.now();
      const out = lazyPreviewImages(html);
      expect(performance.now() - started, unit).toBeLessThan(1000);
      expect(out, unit).toBe(html.replace("<img ", '<img loading="lazy" data-hf-preview-lazy '));
    }
  });
});
