// @vitest-environment node
import { describe, expect, it } from "vitest";
import { sanitizeSvg } from "./sanitizeSvg";

describe("sanitizeSvg", () => {
  it("strips <script> blocks including content", () => {
    const dirty = `<svg><script>alert(1)</script><rect width="1" height="1"/></svg>`;
    const clean = sanitizeSvg(dirty);
    expect(clean).not.toContain("script");
    expect(clean).toContain("<rect");
  });

  it("strips foreignObject subtrees", () => {
    const dirty = `<svg><foreignObject><iframe src="https://evil"/></foreignObject><circle r="2"/></svg>`;
    const clean = sanitizeSvg(dirty);
    expect(clean).not.toContain("foreignObject");
    expect(clean).not.toContain("iframe");
    expect(clean).toContain("<circle");
  });

  it("strips on* event handler attributes", () => {
    const dirty = `<svg onload="evil()"><rect onclick="evil()" width="1"/></svg>`;
    const clean = sanitizeSvg(dirty);
    expect(clean).not.toContain("onload");
    expect(clean).not.toContain("onclick");
    expect(clean).toContain('width="1"');
  });

  it("strips javascript: and external http(s) hrefs but keeps local fragments", () => {
    const dirty = [
      `<svg>`,
      `<a href="javascript:evil()"><text>x</text></a>`,
      `<use xlink:href="https://evil.example/sprite.svg#icon"/>`,
      `<use href="#localClip"/>`,
      `</svg>`,
    ].join("");
    const clean = sanitizeSvg(dirty);
    expect(clean).not.toContain("javascript:");
    expect(clean).not.toContain("evil.example");
    expect(clean).toContain('href="#localClip"');
  });

  it("keeps data:image hrefs (figma embeds rasters this way)", () => {
    const dirty = `<svg><image href="data:image/png;base64,AAAA"/></svg>`;
    expect(sanitizeSvg(dirty)).toContain("data:image/png;base64,AAAA");
  });

  it("leaves a typical clean figma export untouched apart from whitespace", () => {
    const clean = `<svg width="10" height="10" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"><path d="M0 0h10v10H0z" fill="#123456" clip-path="url(#clip0)"/><defs><clipPath id="clip0"><rect width="10" height="10"/></clipPath></defs></svg>`;
    expect(sanitizeSvg(clean)).toBe(clean);
  });
});

describe("sanitizeSvg hardening", () => {
  it("strips nested script/foreignObject without leaving inner content", () => {
    const dirty = `<svg><foreignObject><foreignObject><iframe/></foreignObject></foreignObject></svg>`;
    const clean = sanitizeSvg(dirty);
    expect(clean).not.toContain("foreignObject");
    expect(clean).not.toContain("iframe");
  });
  it("strips <style> blocks (css @import exfil)", () => {
    const clean = sanitizeSvg(`<svg><style>@import url("https://x/y.css");</style><rect/></svg>`);
    expect(clean).not.toContain("style");
    expect(clean).toContain("<rect");
  });
  it("strips unquoted on* handlers", () => {
    expect(sanitizeSvg(`<svg><rect onclick=evil() /></svg>`)).not.toContain("onclick");
  });
  it("drops non-image data: hrefs but keeps data:image and #fragments", () => {
    const dirty = `<svg><a href="data:text/html,<script>1</script>">x</a><use href="#clip"/><image href="data:image/png;base64,AA"/></svg>`;
    const clean = sanitizeSvg(dirty);
    expect(clean).not.toContain("data:text/html");
    expect(clean).toContain('href="#clip"');
    expect(clean).toContain("data:image/png");
  });
  it("drops blob: and protocol-relative hrefs", () => {
    const clean = sanitizeSvg(`<svg><a href="blob:x">a</a><a href='//evil/x'>b</a></svg>`);
    expect(clean).not.toContain("blob:");
    expect(clean).not.toContain("//evil");
  });
});

describe("sanitizeSvg close-tag variants (js/bad-tag-filter)", () => {
  it("strips scripts whose close tag carries whitespace or junk before >", () => {
    const dirty = "<svg><script>evil()</script\t\n bar><rect/></svg>";
    const clean = sanitizeSvg(dirty);
    expect(clean).not.toContain("script");
    expect(clean).not.toContain("evil");
    expect(clean).toContain("<rect");
  });
  it("strips style/foreignObject with attribute-bearing close tags", () => {
    const dirty = `<svg><style>@import url(x)</style x><foreignObject><iframe/></foreignObject foo="1"></svg>`;
    const clean = sanitizeSvg(dirty);
    expect(clean).not.toContain("style");
    expect(clean).not.toContain("foreignObject");
    expect(clean).not.toContain("iframe");
  });
});
