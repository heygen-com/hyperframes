import { describe, expect, it } from "vitest";
import { lintHyperframeHtml } from "../hyperframeLinter.js";

function baseHtml(body: string, style = ""): string {
  return `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080">
    ${body}
  </div>
  <style>${style}</style>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
</body></html>`;
}

const textureCss = `
.hf-texture-text {
  color: #fff;
  -webkit-mask-size: var(--mask-size, cover);
  mask-size: var(--mask-size, cover);
}
.hf-texture-lava {
  -webkit-mask-image: url("masks/lava.png");
  mask-image: url("masks/lava.png");
}
`;

describe("texture rules", () => {
  it("does not warn for a valid texture mask text usage", () => {
    const html = baseHtml(
      '<div class="shadow"><div class="hf-texture-text hf-texture-lava">TEXT</div></div>',
      `${textureCss}.shadow { filter: drop-shadow(1px 2px 1px rgba(0,0,0,.48)); }`,
    );

    const result = lintHyperframeHtml(html);

    expect(result.findings.filter((finding) => finding.code.startsWith("texture_"))).toEqual([]);
  });

  it("warns when a material class is used without hf-texture-text", () => {
    const html = baseHtml('<div class="hf-texture-lava">TEXT</div>', textureCss);

    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((item) => item.code === "texture_class_missing_base");

    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
    expect(finding?.fixHint).toContain("hf-texture-text");
  });

  it("warns when hf-texture-text has no material class or custom mask image", () => {
    const html = baseHtml('<div class="hf-texture-text">TEXT</div>', textureCss);

    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((item) => item.code === "texture_text_missing_mask");

    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
  });

  it("allows hf-texture-text with an inline custom mask image", () => {
    const html = baseHtml(
      '<div class="hf-texture-text" style="-webkit-mask-image:url(custom.png); mask-image:url(custom.png)">TEXT</div>',
      textureCss,
    );

    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((item) => item.code === "texture_text_missing_mask");

    expect(finding).toBeUndefined();
  });

  it("warns when a texture material class is not defined by local CSS", () => {
    const html = baseHtml('<div class="hf-texture-text hf-texture-marbel">TEXT</div>', textureCss);

    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((item) => item.code === "texture_class_unknown");

    expect(finding).toBeDefined();
    expect(finding?.message).toContain("hf-texture-marbel");
  });

  it("warns when drop-shadow is applied inline to the textured text element", () => {
    const html = baseHtml(
      '<div class="hf-texture-text hf-texture-lava" style="filter: drop-shadow(1px 2px 1px black)">TEXT</div>',
      textureCss,
    );

    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((item) => item.code === "texture_drop_shadow_on_text");

    expect(finding).toBeDefined();
    expect(finding?.fixHint).toContain("wrapper");
  });

  it("warns when drop-shadow is applied by CSS directly to hf-texture-text", () => {
    const html = baseHtml(
      '<div class="hf-texture-text hf-texture-lava">TEXT</div>',
      `${textureCss}.hf-texture-text { filter: drop-shadow(1px 2px 1px black); }`,
    );

    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((item) => item.code === "texture_drop_shadow_on_text");

    expect(finding).toBeDefined();
    expect(finding?.selector).toBe(".hf-texture-text");
  });

  it("warns when drop-shadow targets a material class before the mask rule is declared", () => {
    const html = baseHtml(
      '<div class="hf-texture-text hf-texture-lava">TEXT</div>',
      `.hf-texture-lava { filter: drop-shadow(1px 2px 1px black); }
       ${textureCss}`,
    );

    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((item) => item.code === "texture_drop_shadow_on_text");

    expect(finding).toBeDefined();
    expect(finding?.selector).toBe(".hf-texture-lava");
  });

  it("warns when drop-shadow targets another class on the textured text element", () => {
    const html = baseHtml(
      '<div class="hf-texture-text hf-texture-lava headline">TEXT</div>',
      `${textureCss}.headline { filter: drop-shadow(1px 2px 1px black); }`,
    );

    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((item) => item.code === "texture_drop_shadow_on_text");

    expect(finding).toBeDefined();
    expect(finding?.selector).toBe(".headline");
  });

  it("does not warn when another-class drop-shadow selector needs an unmatched ancestor", () => {
    const html = baseHtml(
      '<div class="hf-texture-text hf-texture-lava headline">TEXT</div>',
      `${textureCss}.card .headline { filter: drop-shadow(1px 2px 1px black); }`,
    );

    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((item) => item.code === "texture_drop_shadow_on_text");

    expect(finding).toBeUndefined();
  });
});
