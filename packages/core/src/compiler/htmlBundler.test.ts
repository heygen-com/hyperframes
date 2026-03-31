// @vitest-environment node
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { bundleToSingleHtml } from "./htmlBundler";

function makeTempProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-bundler-test-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content, "utf-8");
  }
  return dir;
}

describe("bundleToSingleHtml", () => {
  it("hoists external CDN scripts from sub-compositions into the bundle", async () => {
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html><head>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
</head><body>
  <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
    <div id="rockets-host"
      data-composition-id="rockets"
      data-composition-src="compositions/rockets.html"
      data-start="0" data-duration="2"></div>
  </div>
  <script>window.__timelines={}; const tl=gsap.timeline({paused:true}); window.__timelines["main"]=tl;</script>
</body></html>`,
      "compositions/rockets.html": `<template id="rockets-template">
  <div data-composition-id="rockets" data-width="1920" data-height="1080">
    <div id="rocket-container"></div>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js"></script>
    <script>
      window.__timelines = window.__timelines || {};
      const anim = lottie.loadAnimation({ container: document.querySelector("#rocket-container"), path: "rocket.json" });
      window.__timelines["rockets"] = gsap.timeline({ paused: true });
    </script>
  </div>
</template>`,
    });

    const bundled = await bundleToSingleHtml(dir);

    // Lottie CDN script from sub-composition must be present in the bundle
    expect(bundled).toContain(
      "https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js",
    );

    // Should only appear once (deduped)
    const occurrences = (bundled.match(/cdnjs\.cloudflare\.com\/ajax\/libs\/lottie-web/g) ?? [])
      .length;
    expect(occurrences).toBe(1);

    // GSAP CDN from main doc should still be present
    expect(bundled).toContain("cdn.jsdelivr.net/npm/gsap");

    // data-composition-src should be stripped (composition was inlined)
    expect(bundled).not.toContain("data-composition-src");
  });

  it("does not duplicate CDN scripts already present in the main document", async () => {
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html><head>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
</head><body>
  <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
    <div id="child-host"
      data-composition-id="child"
      data-composition-src="compositions/child.html"
      data-start="0" data-duration="5"></div>
  </div>
  <script>window.__timelines={}; const tl=gsap.timeline({paused:true}); window.__timelines["main"]=tl;</script>
</body></html>`,
      "compositions/child.html": `<template id="child-template">
  <div data-composition-id="child" data-width="1920" data-height="1080">
    <div id="stage"></div>
    <!-- Same GSAP CDN as parent — should not be duplicated -->
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["child"] = gsap.timeline({ paused: true });
    </script>
  </div>
</template>`,
    });

    const bundled = await bundleToSingleHtml(dir);

    // GSAP CDN should appear exactly once (deduped)
    const gsapOccurrences = (
      bundled.match(/cdn\.jsdelivr\.net\/npm\/gsap@3\.14\.2\/dist\/gsap\.min\.js/g) ?? []
    ).length;
    expect(gsapOccurrences).toBe(1);
  });

  it("inlines <template> compositions into matching empty host elements", async () => {
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html><head>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
</head><body>
  <template id="logo-reveal-template">
    <div data-composition-id="logo-reveal" data-width="1920" data-height="1080">
      <style>.logo { opacity: 0; }</style>
      <div class="logo">Logo Here</div>
      <script>
        window.__timelines = window.__timelines || {};
        window.__timelines["logo-reveal"] = gsap.timeline({ paused: true });
      </script>
    </div>
  </template>
  <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
    <div id="logo-host"
      data-composition-id="logo-reveal"
      data-start="0" data-duration="5"
      data-track-index="1"></div>
  </div>
  <script>window.__timelines={}; const tl=gsap.timeline({paused:true}); window.__timelines["main"]=tl;</script>
</body></html>`,
    });

    const bundled = await bundleToSingleHtml(dir);

    // Template element should be removed
    expect(bundled).not.toContain("<template");

    // Host should contain the template content (the logo div)
    expect(bundled).toContain("Logo Here");

    // Styles from template should be hoisted
    expect(bundled).toContain(".logo");

    // Scripts from template should be included
    expect(bundled).toContain('window.__timelines["logo-reveal"]');
  });

  it("does not inline template when host already has content", async () => {
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html><head></head><body>
  <template id="comp-template">
    <div data-composition-id="comp" data-width="800" data-height="600">
      <p>Template content</p>
    </div>
  </template>
  <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
    <div data-composition-id="comp" data-start="0" data-duration="5">
      <span>Already filled</span>
    </div>
  </div>
  <script>window.__timelines={};</script>
</body></html>`,
    });

    const bundled = await bundleToSingleHtml(dir);

    // Existing content should be preserved
    expect(bundled).toContain("Already filled");

    // Template content should NOT replace the existing host content
    // (template element may still exist in the output since it was not consumed)
    const hostMatch = bundled.match(
      /data-composition-id="comp"[^>]*data-start="0"[^>]*>([\s\S]*?)<\/div>/,
    );
    expect(hostMatch).toBeTruthy();
    expect(hostMatch![1]).toContain("Already filled");
    expect(hostMatch![1]).not.toContain("Template content");
  });

  it("copies dimension attributes from inline template to host", async () => {
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html><head></head><body>
  <template id="sized-template">
    <div data-composition-id="sized" data-width="800" data-height="600">
      <p>Sized content</p>
    </div>
  </template>
  <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
    <div data-composition-id="sized" data-start="0" data-duration="3"></div>
  </div>
  <script>window.__timelines={};</script>
</body></html>`,
    });

    const bundled = await bundleToSingleHtml(dir);

    // The host should have dimensions copied from the template inner root
    expect(bundled).toContain('data-width="800"');
    expect(bundled).toContain('data-height="600"');
    expect(bundled).toContain("Sized content");
  });
});
