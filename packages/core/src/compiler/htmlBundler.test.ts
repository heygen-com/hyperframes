// @vitest-environment node
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseHTML } from "linkedom";
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
  it("does not merge author scripts into the runtime bootstrap placeholder", async () => {
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html><body>
  <div data-composition-id="main" data-width="320" data-height="180">
    <canvas id="scene"></canvas>
  </div>
  <script>
    const canvas = document.getElementById("scene");
    window.__timelines = window.__timelines || {};
    window.__timelines.main = { duration: () => 1, seek() {}, pause() {} };
  </script>
</body></html>`,
    });

    const bundled = await bundleToSingleHtml(dir);
    const runtimeBlock = bundled.match(
      /<script\b[^>]*data-hyperframes-preview-runtime[^>]*>[\s\S]*?<\/script>/i,
    )?.[0];

    expect(runtimeBlock).toBeDefined();
    // The runtime block must contain the inlined HF runtime IIFE — bundled
    // output is self-contained, so the bundle's runtime body is loaded inline,
    // not referenced via src.
    expect(runtimeBlock).toMatch(/data-hyperframes-preview-runtime="1">/);
    expect(runtimeBlock).not.toMatch(/src=""/);
    // The author's specific composition script must NOT be merged INTO the
    // runtime tag — it stays as its own <script> elsewhere in the document.
    expect(runtimeBlock).not.toContain("window.__timelines.main = { duration:");
    expect(bundled).toContain('document.getElementById("scene")');
  });

  it("produces a self-contained runtime script when no HYPERFRAME_RUNTIME_URL is set", async () => {
    // Regression guard: hf#XXX. The bundler used to emit
    // <script ... src=""></script> when no runtime URL was configured. An
    // empty src resolves to the page URL itself, which Chrome flags as an
    // infinite-fetch hazard. Verify that bundleToSingleHtml inlines the
    // runtime body so the bundle is genuinely self-contained.
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html><body>
  <div data-composition-id="root" data-width="320" data-height="180"></div>
</body></html>`,
    });

    const previousUrl = process.env.HYPERFRAME_RUNTIME_URL;
    delete process.env.HYPERFRAME_RUNTIME_URL;
    let bundled: string;
    try {
      bundled = await bundleToSingleHtml(dir);
    } finally {
      if (previousUrl !== undefined) process.env.HYPERFRAME_RUNTIME_URL = previousUrl;
    }

    const runtimeBlock = bundled.match(
      /<script\b[^>]*data-hyperframes-preview-runtime[^>]*>[\s\S]*?<\/script>/i,
    )?.[0];
    expect(runtimeBlock).toBeDefined();
    // Must NOT have an empty src attribute (would self-fetch).
    expect(runtimeBlock).not.toMatch(/src=""/);
    // Must have a non-trivial inlined body (the runtime IIFE is ~150KB).
    const innerLength = (runtimeBlock!.match(/>([\s\S]*?)<\/script>/)?.[1] ?? "").length;
    expect(innerLength).toBeGreaterThan(1000);
  });

  it("preserves chunk integrity when a chunk ends with a line comment (ASI hazard guard)", async () => {
    // Regression guard for the joinJsChunks helper. If a chunk ends with `// ...`
    // and we naively appended `;` on the same line, the appended semicolon would
    // be eaten by the comment, leaving the next chunk's first statement attached
    // to the previous chunk's last expression. Verify the helper appends `\n;`
    // instead so the comment terminates and the semicolon stands alone.
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html><body>
  <div data-composition-id="root" data-width="320" data-height="180"></div>
  <script src="local-a.js"></script>
  <script src="local-b.js"></script>
  <script>window.__timelines = window.__timelines || {}; window.__timelines.root = {}</script>
</body></html>`,
      // Chunk A ends with a // line comment — without the \n separator before
      // the appended ;, that ; would be eaten by the comment.
      "local-a.js": "window.__a = 1 // trailing line comment",
      "local-b.js": "window.__b = 2",
    });

    const bundled = await bundleToSingleHtml(dir);
    // Run every inline script body through esbuild; if the line comment ate
    // the separator, parse would fail with an unexpected-token error somewhere
    // around the chunk boundary. Use a real HTML parser (CodeQL flags regex-
    // based script extraction as bad-tag-filter).
    const { transformSync } = await import("esbuild");
    const { document } = parseHTML(bundled);
    for (const script of document.querySelectorAll("script")) {
      const body = script.textContent;
      if (!body || !body.trim()) continue;
      expect(() => transformSync(body, { loader: "js", minify: false })).not.toThrow();
    }
  });

  it("does not produce stray bare-semicolon lines between concatenated JS chunks", async () => {
    // Regression guard: hf#XXX. Earlier the bundler joined script chunks with
    // `\n;\n`, which produces a lone `;` on its own line between chunks. Valid
    // JS but reads as a code smell. Each chunk should end in `;` and chunks
    // should join with `\n`.
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html><body>
  <div data-composition-id="root" data-width="320" data-height="180">
    <div id="child-host"
         data-composition-id="child"
         data-composition-src="compositions/child.html"
         data-start="0" data-duration="2"></div>
  </div>
  <script src="local-a.js"></script>
  <script src="local-b.js"></script>
  <script>window.__timelines = window.__timelines || {}; window.__timelines.root = {}</script>
</body></html>`,
      "local-a.js": "window.__a = 1",
      "local-b.js": "window.__b = 2",
      "compositions/child.html": `<template id="child-template">
  <div data-composition-id="child" data-width="320" data-height="180">
    <script>window.__c = 3</script>
  </div>
</template>`,
    });

    const bundled = await bundleToSingleHtml(dir);
    // No line is JUST a bare semicolon (with optional surrounding whitespace).
    expect(bundled).not.toMatch(/\n\s*;\s*\n/);
  });

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

    // data-composition-src should be stripped from the host element (composition
    // was inlined). The literal string may still appear inside the inlined
    // runtime IIFE that knows how to look up that attribute — so check the DOM,
    // not the raw text.
    const { document: doc } = parseHTML(bundled);
    const hostEl = doc.getElementById("rockets-host");
    expect(hostEl).toBeTruthy();
    expect(hostEl?.hasAttribute("data-composition-src")).toBe(false);
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
    expect(bundled).toContain('__timelines["logo-reveal"]');
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

  it("flattens the sub-composition root onto the host when inlining external compositions", async () => {
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html><head></head><body>
  <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
    <div
      id="scene-host"
      data-composition-id="scene"
      data-composition-src="compositions/scene.html"
      data-start="intro"
      data-duration="5"></div>
  </div>
  <script>window.__timelines={};</script>
</body></html>`,
      "compositions/scene.html": `<template id="scene-template">
  <div data-composition-id="scene" data-start="0" data-width="1920" data-height="1080">
    <style>[data-composition-id="scene"][data-start="0"] .title { opacity: 0; }</style>
    <h1 class="title">Scene</h1>
    <script>
      window.__timelines = window.__timelines || {};
      const root = document.querySelector('[data-composition-id="scene"][data-start="0"]');
      window.__timelines["scene"] = { root };
    </script>
  </div>
</template>`,
    });

    const bundled = await bundleToSingleHtml(dir);

    const { document } = parseHTML(bundled);
    const host = document.querySelector("#scene-host");

    expect(host?.getAttribute("data-composition-id")).toBe("scene");
    expect(host?.getAttribute("data-composition-file")).toBe("compositions/scene.html");
    expect(host?.getAttribute("data-start")).toBe("intro");
    expect(host?.getAttribute("data-width")).toBe("1920");
    expect(host?.querySelector(".title")?.textContent).toBe("Scene");
    expect(host?.querySelector(".title")?.closest("[data-composition-file]")).toBe(host);
    expect(
      Array.from(host?.children ?? []).some(
        (child) => child.getAttribute("data-composition-id") === "scene",
      ),
    ).toBe(false);
    expect(bundled).toContain('[data-composition-id="scene"] .title');
    expect(bundled).toContain("__hfNormalizeSelector");
  });

  it("scopes external sub-composition styles and classic scripts", async () => {
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html><head>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
</head><body>
  <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
    <div
      id="scene-host"
      data-composition-id="scene"
      data-composition-src="compositions/scene.html"
      data-start="0"
      data-duration="5"></div>
    <div data-composition-id="other"><h1 class="title">Other</h1></div>
  </div>
  <script>window.__timelines={};</script>
</body></html>`,
      "compositions/scene.html": `<template id="scene-template">
  <div data-composition-id="scene" data-width="1920" data-height="1080">
    <style>
      .title { opacity: 0; transform: translateY(30px); }
      @media (min-width: 800px) { .title { color: red; } }
    </style>
    <h1 class="title">Scene</h1>
    <script>
      const tl = gsap.timeline({ paused: true });
      tl.to('.title', { opacity: 1 });
      window.__timelines["scene"] = tl;
    </script>
  </div>
</template>`,
    });

    const bundled = await bundleToSingleHtml(dir);

    expect(bundled).toContain('[data-composition-id="scene"] .title');
    expect(bundled).toContain('[data-composition-id="scene"] .title { color: red; }');
    expect(bundled).toContain("new Proxy(window.document");
    expect(bundled).toContain("new Proxy(__hfBaseGsap");
    expect(bundled).toContain('tl.to(".title"');
  });

  it("isolates sibling instances of the same external sub-composition", async () => {
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html><head>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
</head><body>
  <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
    <div
      id="scene-a"
      data-composition-id="scene"
      data-composition-src="compositions/scene.html"
      data-start="0"
      data-duration="5"></div>
    <div
      id="scene-b"
      data-composition-id="scene"
      data-composition-src="compositions/scene.html"
      data-start="5"
      data-duration="5"></div>
  </div>
  <script>window.__timelines={};</script>
</body></html>`,
      "compositions/scene.html": `<template id="scene-template">
  <div data-composition-id="scene" data-width="1920" data-height="1080">
    <style>[data-composition-id="scene"] .title { opacity: 0; }</style>
    <h1 class="title">Scene</h1>
    <script>
      const tl = gsap.timeline({ paused: true });
      tl.to('[data-composition-id="scene"] .title', { opacity: 1 });
      window.__timelines = window.__timelines || {};
      window.__timelines["scene"] = tl;
    </script>
  </div>
</template>`,
    });

    const bundled = await bundleToSingleHtml(dir);

    const { document } = parseHTML(bundled);
    const sceneA = document.querySelector("#scene-a");
    const sceneB = document.querySelector("#scene-b");
    const sceneAId = sceneA?.getAttribute("data-composition-id") ?? "";
    const sceneBId = sceneB?.getAttribute("data-composition-id") ?? "";

    expect(sceneAId).not.toBe("scene");
    expect(sceneBId).not.toBe("scene");
    expect(sceneAId).not.toBe(sceneBId);
    expect(sceneA?.getAttribute("data-hf-original-composition-id")).toBe("scene");
    expect(sceneB?.getAttribute("data-hf-original-composition-id")).toBe("scene");
    expect(bundled).toContain(`[data-composition-id="${sceneAId}"] .title`);
    expect(bundled).toContain(`[data-composition-id="${sceneBId}"] .title`);
    expect(bundled).toContain('var __hfTimelineCompId = "scene__hf1"');
    expect(bundled).toContain('var __hfTimelineCompId = "scene__hf2"');
    expect(bundled).not.toContain('[data-composition-id="scene"] .title { opacity: 0; }');
  });

  it("rewrites CSS url(...) asset paths from sub-compositions when styles are hoisted", async () => {
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html><head></head><body>
  <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
    <div
      data-composition-id="hero"
      data-composition-src="compositions/hero.html"
      data-start="0"
      data-duration="2"></div>
  </div>
  <script>window.__timelines={};</script>
</body></html>`,
      "compositions/hero.html": `<template id="hero-template">
  <div data-composition-id="hero" data-width="1920" data-height="1080">
    <style>
      @font-face {
        font-family: "Brand Sans";
        src: url("../fonts/brand.woff2") format("woff2");
      }
    </style>
    <p>Hello</p>
  </div>
</template>`,
    });

    const bundled = await bundleToSingleHtml(dir);

    expect(bundled).toContain('url("fonts/brand.woff2")');
    expect(bundled).not.toContain('url("../fonts/brand.woff2")');
  });
});
