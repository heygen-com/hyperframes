// @vitest-environment node
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import { describe, it, expect } from "vitest";
import { bundleToSingleHtml } from "./htmlBundler";
import { getHyperframeRuntimeScript } from "../generated/runtime-inline";

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

  it("preserves `$&` replace-pattern characters in the inlined runtime body", async () => {
    // Regression guard: `injectInterceptor` used to insert the runtime via
    // `sanitized.replace("</head>", `${tag}\n</head>`)`. `String.prototype.replace`'s
    // second argument is a substitution template — `$&` expands to the matched
    // substring (here, `</head>`). The minified runtime IIFE contains legitimate
    // `$&` sequences (e.g. `if(te&&$&!y.hasAttribute(...))`), so the bundler
    // silently injected stray `</head>` tags inside the runtime, producing a JS
    // SyntaxError that broke every timeline in the bundle. Switching to the
    // function-replacer form passes the runtime body through verbatim.
    // Use a document with an explicit `<head>` so the bundler takes the
    // `sanitized.replace("</head>", …)` injection path — the only branch that
    // exercises the substitution-template behavior. Authoring without a
    // `<head>` falls back to slice+concat (safe but doesn't catch this bug).
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html><head></head><body>
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

    const original = getHyperframeRuntimeScript();
    // Sanity: the built runtime exercises this regression (no `$&` means the
    // test would tautologically pass even with the broken implementation).
    expect(original).toContain("$&");

    const runtimeBlock = bundled.match(
      /<script\b[^>]*data-hyperframes-preview-runtime[^>]*>([\s\S]*?)<\/script>/i,
    );
    expect(runtimeBlock).not.toBeNull();
    const runtimeBody = runtimeBlock?.[1] ?? "";
    expect(runtimeBody).toBe(original);

    // Defense in depth: the entire bundled document should contain exactly one
    // `</head>` — the real closing tag. Before the fix, every `$&` in the
    // runtime expanded to an extra `</head>` inside the inlined IIFE,
    // producing a `Unexpected token '<'` SyntaxError at parse time.
    const headCloses = bundled.match(/<\/head>/g) ?? [];
    expect(headCloses.length).toBe(1);
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

  it("inlines local scripts referenced by sub-compositions into the bundle", async () => {
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html><head>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
</head><body>
  <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
    <div id="scene-host"
      data-composition-id="scene"
      data-composition-src="compositions/scene.html"
      data-start="0" data-duration="5"></div>
  </div>
  <script>window.__timelines={}; const tl=gsap.timeline({paused:true}); window.__timelines["main"]=tl;</script>
</body></html>`,
      "compositions/scene.html": `<template id="scene-template">
  <div data-composition-id="scene" data-width="1920" data-height="1080">
    <div id="scene-copy">Scene</div>
    <script src="vendor/effect-plugin.js"></script>
    <script src="assets/scene-runtime.js"></script>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["scene"] = gsap.timeline({ paused: true });
    </script>
  </div>
</template>`,
      "vendor/effect-plugin.js": `window.PowerGlitch = { glitch(){ return { startGlitch(){}, stopGlitch(){} }; } };`,
      "assets/scene-runtime.js": `window.__HF_SHARED_TEST__ = "shared-runtime-loaded";`,
    });

    const bundled = await bundleToSingleHtml(dir);

    expect(bundled).toContain('__HF_SHARED_TEST__ = "shared-runtime-loaded"');
    expect(bundled).toContain("window.PowerGlitch = { glitch()");
    expect(bundled).not.toContain('src="assets/scene-runtime.js"');
    expect(bundled).not.toContain('src="vendor/effect-plugin.js"');
  });

  it("preserves local sub-composition script order before inline scene scripts", async () => {
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
      data-start="0" data-duration="5"></div>
  </div>
  <script>window.__timelines={}; const tl=gsap.timeline({paused:true}); window.__timelines["main"]=tl;</script>
</body></html>`,
      "compositions/scene.html": `<template id="scene-template">
  <div data-composition-id="scene" data-width="1920" data-height="1080">
    <script src="assets/component-runtime.js"></script>
    <script>
      window.__HF_COMPONENT_CALL__ = true;
      window.Component.mount("#scene-host");
    </script>
  </div>
</template>`,
      "assets/component-runtime.js": `window.__HF_COMPONENT_DEF__ = true; window.Component = { mount(){ window.__HF_COMPONENT_MOUNTED__ = true; } };`,
    });

    const bundled = await bundleToSingleHtml(dir);
    const componentIndex = bundled.indexOf("__HF_COMPONENT_DEF__");
    const sceneIndex = bundled.indexOf("__HF_COMPONENT_CALL__");

    expect(componentIndex).toBeGreaterThan(-1);
    expect(sceneIndex).toBeGreaterThan(-1);
    expect(componentIndex).toBeLessThan(sceneIndex);
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

  it("keeps an authored inner root wrapper for root id and class selectors", async () => {
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html><head></head><body>
  <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
    <div
      id="scene-host"
      data-composition-id="scene"
      data-composition-src="compositions/scene.html"
      data-start="0"
      data-duration="5"></div>
  </div>
  <script>window.__timelines={};</script>
</body></html>`,
      "compositions/scene.html": `<template id="scene-template">
  <div id="scene-root" class="scene-root" data-composition-id="scene" data-width="1920" data-height="1080">
    <style>
      .scene-root .title { opacity: 0; }
      #scene-root { font-family: Inter, sans-serif; }
    </style>
    <h1 class="title">Scene</h1>
  </div>
</template>`,
    });

    const bundled = await bundleToSingleHtml(dir);
    const { document } = parseHTML(bundled);
    const host = document.querySelector("#scene-host");
    const authoredRoot = host?.querySelector('[data-hf-authored-id="scene-root"]');

    expect(host).toBeTruthy();
    expect(authoredRoot).toBeTruthy();
    expect(authoredRoot?.id).toBe("");
    expect(authoredRoot?.getAttribute("data-composition-id")).toBeNull();
    expect(authoredRoot?.getAttribute("data-hf-inner-root")).toBe("true");
    expect(authoredRoot?.getAttribute("data-hf-authored-id")).toBe("scene-root");
    expect(bundled).toContain('[data-composition-id="scene"] .scene-root .title');
    expect(bundled).toContain('[data-composition-id="scene"] [data-hf-authored-id="scene-root"]');
  });

  it("does not keep duplicate authored root ids when the same external composition mounts twice", async () => {
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html><head></head><body>
  <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
    <div
      id="scene-host-a"
      data-composition-id="scene"
      data-composition-src="compositions/scene.html"
      data-start="0"
      data-duration="5"></div>
    <div
      id="scene-host-b"
      data-composition-id="scene"
      data-composition-src="compositions/scene.html"
      data-start="5"
      data-duration="5"></div>
  </div>
  <script>window.__timelines={};</script>
</body></html>`,
      "compositions/scene.html": `<template id="scene-template">
  <div id="scene-root" class="scene-root" data-composition-id="scene" data-width="1920" data-height="1080">
    <h1 class="title">Scene</h1>
  </div>
</template>`,
    });

    const bundled = await bundleToSingleHtml(dir);
    const { document } = parseHTML(bundled);
    const authoredRoots = document.querySelectorAll('[data-hf-authored-id="scene-root"]');

    expect(authoredRoots).toHaveLength(2);
    expect(document.querySelectorAll("#scene-root")).toHaveLength(0);
    expect(Array.from(authoredRoots).every((root) => !root.getAttribute("id"))).toBe(true);
  });

  it("mounts duplicate inline-template hosts instead of only the first one", async () => {
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html><head></head><body>
  <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
    <div id="scene-host-a" data-composition-id="scene"></div>
    <div id="scene-host-b" data-composition-id="scene"></div>
  </div>
  <template id="scene-template">
    <div id="scene-root" data-composition-id="scene" data-width="1920" data-height="1080">
      <h1 class="title">Scene</h1>
    </div>
  </template>
  <script>window.__timelines={};</script>
</body></html>`,
    });

    const bundled = await bundleToSingleHtml(dir);
    const { document } = parseHTML(bundled);
    const hostA = document.querySelector("#scene-host-a");
    const hostB = document.querySelector("#scene-host-b");

    expect(hostA?.querySelector(".title")?.textContent).toBe("Scene");
    expect(hostB?.querySelector(".title")?.textContent).toBe("Scene");
    expect(hostA?.getAttribute("data-composition-id")).toBe("scene__hf1");
    expect(hostB?.getAttribute("data-composition-id")).toBe("scene__hf2");
    expect(hostA?.getAttribute("data-hf-original-composition-id")).toBe("scene");
    expect(hostB?.getAttribute("data-hf-original-composition-id")).toBe("scene");
  });

  it("emits scoped style and script chunks for each duplicate inline-template host", async () => {
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html><head></head><body>
  <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
    <div id="scene-host-a" data-composition-id="scene"></div>
    <div id="scene-host-b" data-composition-id="scene"></div>
  </div>
  <template id="scene-template">
    <div id="scene-root" data-composition-id="scene" data-width="1920" data-height="1080">
      <style>.title { opacity: 0; }</style>
      <h1 class="title">Scene</h1>
      <script>
        window.__timelines = window.__timelines || {};
        window.__timelines.scene = { marker: "scene" };
      </script>
    </div>
  </template>
  <script>window.__timelines={};</script>
</body></html>`,
    });

    const bundled = await bundleToSingleHtml(dir);

    expect(bundled).toContain('[data-composition-id="scene__hf1"] .title');
    expect(bundled).toContain('[data-composition-id="scene__hf2"] .title');
    expect(bundled).toContain('var __hfTimelineCompId = "scene__hf1"');
    expect(bundled).toContain('var __hfTimelineCompId = "scene__hf2"');
  });

  it("uniquifies duplicate sub-compositions across inline-template and external hosts", async () => {
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html><head></head><body>
  <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
    <div id="scene-host-inline" data-composition-id="scene"></div>
    <div
      id="scene-host-external"
      data-composition-id="scene"
      data-composition-src="compositions/scene.html"></div>
  </div>
  <template id="scene-template">
    <div data-composition-id="scene" data-width="1920" data-height="1080">
      <p>Inline scene</p>
    </div>
  </template>
  <script>window.__timelines={};</script>
</body></html>`,
      "compositions/scene.html": `<template id="scene-template">
  <div data-composition-id="scene" data-width="1920" data-height="1080">
    <p>External scene</p>
  </div>
</template>`,
    });

    const bundled = await bundleToSingleHtml(dir);
    const { document } = parseHTML(bundled);
    const inlineHost = document.querySelector("#scene-host-inline");
    const externalHost = document.querySelector("#scene-host-external");

    expect(inlineHost?.getAttribute("data-composition-id")).toBe("scene__hf1");
    expect(externalHost?.getAttribute("data-composition-id")).toBe("scene__hf2");
    expect(inlineHost?.getAttribute("data-hf-original-composition-id")).toBe("scene");
    expect(externalHost?.getAttribute("data-hf-original-composition-id")).toBe("scene");
    expect(inlineHost?.querySelector("p")?.textContent).toBe("Inline scene");
    expect(externalHost?.querySelector("p")?.textContent).toBe("External scene");
  });

  it("emits per-instance scoped variables for bundled sub-compositions", async () => {
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html><head></head><body>
  <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
    <div
      id="card-a"
      data-composition-id="card"
      data-composition-src="compositions/card.html"
      data-variable-values='{"title":"Pro"}'></div>
    <div
      id="card-b"
      data-composition-id="card"
      data-composition-src="compositions/card.html"
      data-variable-values='{"title":"Enterprise"}'></div>
  </div>
  <script>window.__timelines={};</script>
</body></html>`,
      "compositions/card.html": `<!doctype html>
<html data-composition-variables='[
  {"id":"title","type":"string","label":"Title","default":"Default Title"},
  {"id":"theme","type":"string","label":"Theme","default":"light"}
]'>
  <body>
    <div id="card-root" data-composition-id="card" data-width="1920" data-height="1080">
      <script>
        window.__timelines = window.__timelines || {};
        window.__timelines[document.currentScript?.dataset.slot || "missing"] = __hyperframes.getVariables();
      </script>
    </div>
  </body>
</html>`,
    });

    const bundled = await bundleToSingleHtml(dir);

    expect(bundled).toContain("window.__hfVariablesByComp");
    expect(bundled).toMatch(/card__hf1[\s\S]*Pro[\s\S]*light/);
    expect(bundled).toMatch(/card__hf2[\s\S]*Enterprise[\s\S]*light/);
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
    expect(bundled).toContain("(function(document, gsap, window, __hyperframes)");
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

  it("resolves CSS @import statements when inlining stylesheets", async () => {
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html><body>
  <link rel="stylesheet" href="styles/canvas.css">
  <div data-composition-id="root" data-width="320" data-height="180"></div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines.root = {}</script>
</body></html>`,
      "styles/canvas.css": `@import url('./tokens.css');\nbody { margin: 0; }`,
      "styles/tokens.css": `:root { --brand: #ff5728; }`,
    });

    const bundled = await bundleToSingleHtml(dir);

    expect(bundled).toContain("--brand: #ff5728");
    expect(bundled).not.toContain("@import");
    expect(bundled).toContain("margin: 0");
  });

  it("resolves nested CSS @import chains", async () => {
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html><body>
  <link rel="stylesheet" href="styles/main.css">
  <div data-composition-id="root" data-width="320" data-height="180"></div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines.root = {}</script>
</body></html>`,
      "styles/main.css": `@import url('./base.css');\n.main { color: red; }`,
      "styles/base.css": `@import url('../tokens.css');\n.base { display: flex; }`,
      "tokens.css": `:root { --tk-teal: #1a3540; }`,
    });

    const bundled = await bundleToSingleHtml(dir);

    expect(bundled).toContain("--tk-teal: #1a3540");
    expect(bundled).toContain("display: flex");
    expect(bundled).toContain("color: red");
    expect(bundled).not.toContain("@import");
  });

  it("wraps @import with media query in @media block", async () => {
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html><body>
  <link rel="stylesheet" href="print.css">
  <div data-composition-id="root" data-width="320" data-height="180"></div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines.root = {}</script>
</body></html>`,
      "print.css": `@import url('./print-tokens.css') print;\nbody { font-size: 12pt; }`,
      "print-tokens.css": `.print-only { display: block; }`,
    });

    const bundled = await bundleToSingleHtml(dir);

    expect(bundled).toContain("@media print");
    expect(bundled).toContain("display: block");
    expect(bundled).not.toContain("@import");
  });

  it("preserves @import for absolute URLs", async () => {
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html><body>
  <link rel="stylesheet" href="app.css">
  <div data-composition-id="root" data-width="320" data-height="180"></div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines.root = {}</script>
</body></html>`,
      "app.css": `@import url('https://fonts.googleapis.com/css2?family=Inter');\nbody { margin: 0; }`,
    });

    const bundled = await bundleToSingleHtml(dir);

    expect(bundled).toContain("@import url('https://fonts.googleapis.com/css2?family=Inter')");
    expect(bundled).toContain("margin: 0");
  });

  it("rebases url() paths in @import-resolved CSS to project root", async () => {
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html><body>
  <link rel="stylesheet" href="styles/canvas.css">
  <div data-composition-id="root" data-width="320" data-height="180"></div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines.root = {}</script>
</body></html>`,
      "styles/canvas.css": `@import url('./tokens.css');\nbody { margin: 0; }`,
      "styles/tokens.css": `@font-face { src: url('assets/fonts/brand.woff2') format('woff2'); }`,
      "styles/assets/fonts/brand.woff2": "fake-font-data",
    });

    const bundled = await bundleToSingleHtml(dir);

    expect(bundled).toContain("url('styles/assets/fonts/brand.woff2')");
    expect(bundled).not.toContain("url('assets/fonts/brand.woff2')");
    expect(bundled).not.toContain("@import");
  });

  it("rebases url() paths in <link>-inlined CSS from subdirectories", async () => {
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html><body>
  <link rel="stylesheet" href="theme/styles.css">
  <div data-composition-id="root" data-width="320" data-height="180"></div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines.root = {}</script>
</body></html>`,
      "theme/styles.css": `.bg { background: url('./images/grain.png'); }`,
      "theme/images/grain.png": "fake-image-data",
    });

    const bundled = await bundleToSingleHtml(dir);

    expect(bundled).toContain("url('theme/images/grain.png')");
    expect(bundled).not.toContain("url('./images/grain.png')");
  });

  it("rebases url() paths with ../ traversal in nested @import", async () => {
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html><body>
  <link rel="stylesheet" href="styles/main.css">
  <div data-composition-id="root" data-width="320" data-height="180"></div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines.root = {}</script>
</body></html>`,
      "styles/main.css": `@import url('./base/reset.css');`,
      "styles/base/reset.css": `body { background: url('../../assets/bg.png'); }`,
      "assets/bg.png": "fake-image",
    });

    const bundled = await bundleToSingleHtml(dir);

    expect(bundled).toContain("url('assets/bg.png')");
    expect(bundled).not.toContain("url('../../assets/bg.png')");
  });

  it("preserves absolute and data url() references during rebasing", async () => {
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html><body>
  <link rel="stylesheet" href="styles/app.css">
  <div data-composition-id="root" data-width="320" data-height="180"></div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines.root = {}</script>
</body></html>`,
      "styles/app.css": [
        `@font-face { src: url('https://cdn.example.com/font.woff2'); }`,
        `.icon { background: url('data:image/svg+xml,<svg/>'); }`,
        `.local { background: url('./img/bg.png'); }`,
      ].join("\n"),
      "styles/img/bg.png": "fake",
    });

    const bundled = await bundleToSingleHtml(dir);

    expect(bundled).toContain("url('https://cdn.example.com/font.woff2')");
    expect(bundled).toContain("url('data:image/svg+xml,<svg/>')");
    expect(bundled).toContain("url('styles/img/bg.png')");
  });

  it("preserves url() query strings and hash fragments during rebasing", async () => {
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html><body>
  <link rel="stylesheet" href="styles/icons.css">
  <div data-composition-id="root" data-width="320" data-height="180"></div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines.root = {}</script>
</body></html>`,
      "styles/icons.css": `.icon { background: url('./sprite.png?v=2#section'); }`,
      "styles/sprite.png": "fake-sprite",
    });

    const bundled = await bundleToSingleHtml(dir);

    expect(bundled).toContain("url('styles/sprite.png?v=2#section')");
  });

  it("deduplicates diamond @import (same file imported by two parents)", async () => {
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html><body>
  <link rel="stylesheet" href="styles/main.css">
  <div data-composition-id="root" data-width="320" data-height="180"></div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines.root = {}</script>
</body></html>`,
      "styles/main.css": `@import url('./a.css');\n@import url('./b.css');`,
      "styles/a.css": `@import url('./shared.css');\n.a { color: red; }`,
      "styles/b.css": `@import url('./shared.css');\n.b { color: blue; }`,
      "styles/shared.css": `:root { --shared: 1; }`,
    });

    const bundled = await bundleToSingleHtml(dir);

    const sharedCount = (bundled.match(/--shared: 1/g) || []).length;
    expect(sharedCount).toBe(1);
    expect(bundled).toContain(".a { color: red; }");
    expect(bundled).toContain(".b { color: blue; }");
    expect(bundled).not.toContain("@import");
  });

  it("does not resolve @import inside CSS comments", async () => {
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html><body>
  <link rel="stylesheet" href="app.css">
  <div data-composition-id="root" data-width="320" data-height="180"></div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines.root = {}</script>
</body></html>`,
      "app.css": `/* @import url('./old.css'); */\nbody { margin: 0; }`,
      "old.css": `.old { display: none; }`,
    });

    const bundled = await bundleToSingleHtml(dir);

    expect(bundled).toContain("/* @import url('./old.css'); */");
    expect(bundled).not.toContain(".old { display: none; }");
  });

  // Forces `text-rendering: geometricPrecision` so headless-shell BeginFrame
  // renders match full Chrome (which is the snapshot/preview path). See
  // `injectTextRenderingRule` in htmlBundler.ts.
  it("injects a single text-rendering:geometricPrecision rule into <head>", async () => {
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html>
<head><title>t</title></head>
<body>
  <div data-composition-id="root" data-width="640" data-height="360">
    <h1>Hello</h1>
  </div>
</body></html>`,
    });

    const bundled = await bundleToSingleHtml(dir);
    const { document } = parseHTML(bundled);
    const styleEls = document.querySelectorAll("style[data-hyperframes-text-rendering]");

    expect(styleEls.length).toBe(1);
    expect((styleEls[0]?.textContent || "").replace(/\s+/g, "")).toContain(
      "html,body,*{text-rendering:geometricPrecision}",
    );
    expect(styleEls[0]?.parentElement?.tagName.toLowerCase()).toBe("head");
  });
});
