import { describe, expect, it } from "vitest";
import { lazyPreviewImages } from "./lazyPreviewImages.js";

describe("lazyPreviewImages", () => {
  it("marks images lazy and keeps an authored loading attribute", () => {
    const html =
      '<div><img src="a.png"><IMG class="x" src="b.png"><img loading="eager" src="c.png"></div>';
    expect(lazyPreviewImages(html)).toBe(
      '<div><img loading="lazy" src="a.png"><img loading="lazy" class="x" src="b.png"><img loading="eager" src="c.png"></div>',
    );
  });

  it("leaves script and style text untouched", () => {
    const html =
      '<script>el.innerHTML = "<img src=x.png>";</script><style>img{}</style><img src="a.png">';
    expect(lazyPreviewImages(html)).toBe(
      '<script>el.innerHTML = "<img src=x.png>";</script><style>img{}</style><img loading="lazy" src="a.png">',
    );
  });
});
