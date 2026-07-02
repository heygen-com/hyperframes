import { describe, expect, it, mock, beforeAll } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import {
  collectExternalAssets,
  compileForRender,
  detectRenderModeHints,
  detectShaderTransitionUsage,
  discoverAudioVolumeAutomationFromTimeline,
  inlineExternalScripts,
  localizeRemoteMediaSources,
  localizeRemoteImageSources,
  localizeRemoteFontFaces,
  recompileWithResolutions,
} from "./htmlCompiler.js";
import { validateNoSystemFonts } from "./render/planValidation.js";

// ── collectExternalAssets ──────────────────────────────────────────────────

describe("collectExternalAssets", () => {
  let projectDir: string;
  let externalDir: string;

  beforeAll(() => {
    // Create a project dir and an external dir with assets
    const base = mkdtempSync(join(tmpdir(), "hf-compiler-test-"));
    projectDir = join(base, "project");
    externalDir = join(base, "external");
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(externalDir, { recursive: true });

    // Internal asset (should NOT be collected)
    writeFileSync(join(projectDir, "logo.png"), "fake-png");

    // External asset (should be collected)
    writeFileSync(join(externalDir, "hero.png"), "fake-hero");
    writeFileSync(join(externalDir, "font.woff2"), "fake-font");
  });

  it("does not collect assets inside projectDir", () => {
    const html = `<html><body><img src="logo.png"></body></html>`;
    const result = collectExternalAssets(html, projectDir);
    expect(result.externalAssets.size).toBe(0);
    expect(result.html).toBe(html); // unchanged
  });

  it("collects and rewrites assets outside projectDir via src attribute", () => {
    const html = `<html><body><img src="../external/hero.png"></body></html>`;
    const result = collectExternalAssets(html, projectDir);
    expect(result.externalAssets.size).toBe(1);

    const [safeKey, absPath] = [...result.externalAssets.entries()][0]!;
    expect(safeKey).toContain("hf-ext/");
    expect(safeKey).toContain("external/hero.png");
    expect(absPath).toBe(join(externalDir, "hero.png"));
    expect(result.html).toContain(safeKey);
    expect(result.html).not.toContain("../external/hero.png");
  });

  it("collects and rewrites CSS url() references outside projectDir", () => {
    const html = `<html><head><style>.bg { background: url(../external/hero.png); }</style></head><body></body></html>`;
    const result = collectExternalAssets(html, projectDir);
    expect(result.externalAssets.size).toBe(1);
    expect(result.html).toContain("hf-ext/");
    expect(result.html).not.toContain("../external/hero.png");
  });

  it("collects and rewrites inline style url() references", () => {
    const html = `<html><body><div style="background-image: url('../external/hero.png')"></div></body></html>`;
    const result = collectExternalAssets(html, projectDir);
    expect(result.externalAssets.size).toBe(1);
    expect(result.html).toContain("hf-ext/");
  });

  it("skips http/https URLs", () => {
    const html = `<html><body><img src="https://cdn.example.com/img.png"></body></html>`;
    const result = collectExternalAssets(html, projectDir);
    expect(result.externalAssets.size).toBe(0);
  });

  it("skips data: URIs", () => {
    const html = `<html><body><img src="data:image/png;base64,abc123"></body></html>`;
    const result = collectExternalAssets(html, projectDir);
    expect(result.externalAssets.size).toBe(0);
  });

  it("skips absolute paths", () => {
    const html = `<html><body><img src="/usr/share/fonts/foo.woff"></body></html>`;
    const result = collectExternalAssets(html, projectDir);
    expect(result.externalAssets.size).toBe(0);
  });

  it("skips fragment references", () => {
    const html = `<html><body><a href="#section">link</a></body></html>`;
    const result = collectExternalAssets(html, projectDir);
    expect(result.externalAssets.size).toBe(0);
  });

  it("skips external paths that don't exist on disk", () => {
    const html = `<html><body><img src="../nonexistent/nope.png"></body></html>`;
    const result = collectExternalAssets(html, projectDir);
    expect(result.externalAssets.size).toBe(0);
  });

  it("deduplicates multiple references to the same external file", () => {
    const html = `<html><head>
      <style>.a { background: url(../external/hero.png); } .b { background: url(../external/hero.png); }</style>
    </head><body><img src="../external/hero.png"></body></html>`;
    const result = collectExternalAssets(html, projectDir);
    // Same file referenced 3 times, but Map deduplicates
    expect(result.externalAssets.size).toBe(1);
  });

  it("handles paths with .. that resolve back into projectDir", () => {
    // projectDir/subdir/../logo.png = projectDir/logo.png (inside project)
    mkdirSync(join(projectDir, "subdir"), { recursive: true });
    const html = `<html><body><img src="subdir/../logo.png"></body></html>`;
    const result = collectExternalAssets(html, projectDir);
    expect(result.externalAssets.size).toBe(0); // stays inside projectDir
  });

  it("collects multiple different external assets", () => {
    const html = `<html><body>
      <img src="../external/hero.png">
      <link href="../external/font.woff2">
    </body></html>`;
    const result = collectExternalAssets(html, projectDir);
    expect(result.externalAssets.size).toBe(2);
  });
});

// ── inlineExternalScripts ──────────────────────────────────────────────────

describe("inlineExternalScripts", () => {
  it("returns HTML unchanged when no external scripts exist", async () => {
    const html = `<html><body><script>var x = 1;</script></body></html>`;
    const result = await inlineExternalScripts(html);
    expect(result).toBe(html);
  });

  it("skips local script src (not http)", async () => {
    const html = `<html><body><script src="./lib/app.js"></script></body></html>`;
    const result = await inlineExternalScripts(html);
    expect(result).toBe(html);
  });

  it("inlines a CDN script on successful fetch", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => new Response("var gsap = {};", { status: 200 })) as any;

    try {
      const html = `<html><body><script src="https://cdn.example.com/gsap.min.js"></script></body></html>`;
      const result = await inlineExternalScripts(html);
      expect(result).toContain("/* inlined: https://cdn.example.com/gsap.min.js */");
      expect(result).toContain("var gsap = {};");
      expect(result).not.toContain('src="https://cdn.example.com/gsap.min.js"');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("preserves non-src script attributes when inlining", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(
      async () => new Response('console.log("module");', { status: 200 }),
    ) as any;

    try {
      const html =
        '<html><body><script type="module" data-role="boot" src="https://cdn.example.com/module.js"></script></body></html>';
      const result = await inlineExternalScripts(html);

      expect(result).toMatch(/<script\b[^>]*\btype="module"/);
      expect(result).toMatch(/<script\b[^>]*\bdata-role="boot"/);
      expect(result).toContain('console.log("module");');
      expect(result).not.toContain('src="https://cdn.example.com/module.js"');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("escapes </script in downloaded content", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(
      async () => new Response('var x = "</script><script>alert(1)</script>";', { status: 200 }),
    ) as any;

    try {
      const html = `<html><body><script src="https://cdn.example.com/evil.js"></script></body></html>`;
      const result = await inlineExternalScripts(html);
      // Should escape </script to <\/script
      expect(result).not.toContain("</script><script>alert(1)</script>");
      expect(result).toContain("<\\/script");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("preserves literal replacement tokens in downloaded script content", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(
      async () =>
        new Response('const before = "$`"; const after = "$\'"; const both = "$&";', {
          status: 200,
        }),
    ) as any;

    try {
      const html = `<html><body><script src="https://cdn.example.com/d3.min.js"></script><div>tail</div></body></html>`;
      const result = await inlineExternalScripts(html);

      expect(result).toContain('const before = "$`";');
      expect(result).toContain('const after = "$\'";');
      expect(result).toContain('const both = "$&";');
      expect(result.match(/<script>/g)?.length).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns a fragment when the input has no html/body wrapper", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => new Response("var d3 = {};", { status: 200 })) as any;

    try {
      const html = '<script src="https://cdn.example.com/d3.min.js"></script><div>tail</div>';
      const result = await inlineExternalScripts(html);

      expect(result).not.toMatch(/<!DOCTYPE|<html|<head|<body/i);
      expect(result).toContain("var d3 = {};");
      expect(result).toContain("<div>tail</div>");
      expect(result).not.toContain('src="https://cdn.example.com/d3.min.js"');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("warns but keeps original tag when fetch fails", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => {
      throw new Error("Network error");
    }) as any;

    try {
      const html = `<html><body><script src="https://cdn.example.com/gsap.min.js"></script></body></html>`;
      const result = await inlineExternalScripts(html);
      // Original script tag should remain since download failed
      expect(result).toContain('src="https://cdn.example.com/gsap.min.js"');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles multiple CDN scripts with mixed success/failure", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (url: string) => {
      if (url.includes("gsap")) {
        return new Response("var gsap = {};", { status: 200 });
      }
      throw new Error("404");
    }) as any;

    try {
      const html = `<html><body>
        <script src="https://cdn.example.com/gsap.min.js"></script>
        <script src="https://cdn.example.com/lottie.min.js"></script>
      </body></html>`;
      const result = await inlineExternalScripts(html);
      // GSAP should be inlined
      expect(result).toContain("var gsap = {};");
      // Lottie should remain as original tag
      expect(result).toContain('src="https://cdn.example.com/lottie.min.js"');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles duplicate CDN URLs (same script referenced twice)", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCount = 0;
    globalThis.fetch = mock(async () => {
      fetchCount++;
      return new Response("var gsap = {};", { status: 200 });
    }) as any;

    try {
      const html = `<html><body>
        <script src="https://cdn.example.com/gsap.min.js"></script>
        <script src="https://cdn.example.com/gsap.min.js"></script>
      </body></html>`;
      const result = await inlineExternalScripts(html);
      // Both identical script tags should be fetched and replaced independently.
      expect(fetchCount).toBe(2);
      expect(
        result.match(/\/\* inlined: https:\/\/cdn\.example\.com\/gsap\.min\.js \*\//g)?.length,
      ).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("detectRenderModeHints", () => {
  it("recommends screenshot mode for iframe compositions", () => {
    const html = `<!DOCTYPE html>
<html><body>
  <div data-composition-id="root" data-width="1920" data-height="1080">
    <iframe src="./target.html"></iframe>
  </div>
</body></html>`;

    const result = detectRenderModeHints(html);

    expect(result.recommendScreenshot).toBe(true);
    expect(result.reasons.map((reason) => reason.code)).toEqual(["iframe"]);
  });

  it("recommends screenshot mode for inline requestAnimationFrame loops", () => {
    const html = `<!DOCTYPE html>
<html><body>
  <div data-composition-id="root" data-width="1920" data-height="1080"></div>
  <script>
    function tick() {
      requestAnimationFrame(tick);
    }
    tick();
  </script>
</body></html>`;

    const result = detectRenderModeHints(html);

    expect(result.recommendScreenshot).toBe(true);
    expect(result.reasons.map((reason) => reason.code)).toEqual(["requestAnimationFrame"]);
  });

  it("ignores requestAnimationFrame inside comments and external scripts", () => {
    const html = `<!DOCTYPE html>
<html><body>
  <div data-composition-id="root" data-width="1920" data-height="1080"></div>
  <script src="./runtime.js"></script>
  <script>
    // requestAnimationFrame(loop);
    /* requestAnimationFrame(otherLoop); */
    const label = "safe";
  </script>
</body></html>`;

    const result = detectRenderModeHints(html);

    expect(result.recommendScreenshot).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  it("ignores compiler-generated nested mount wrappers when detecting requestAnimationFrame", () => {
    const html = `<!DOCTYPE html>
<html><body>
  <div data-composition-id="root" data-width="1920" data-height="1080"></div>
  <script>
    (function(){
      var __compId = "intro";
      var __run = function() {
        const label = "safe";
      };
      if (!__compId) { __run(); return; }
      /* __HF_COMPILER_MOUNT_START__ */
      var __selector = '[data-composition-id="intro"]';
      var __attempt = 0;
      var __tryRun = function() {
        if (document.querySelector(__selector)) { __run(); return; }
        if (++__attempt >= 8) { __run(); return; }
        requestAnimationFrame(__tryRun);
      };
      __tryRun();
      /* __HF_COMPILER_MOUNT_END__ */
    })();
  </script>
</body></html>`;

    const result = detectRenderModeHints(html);

    expect(result.recommendScreenshot).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  it("still flags user-authored requestAnimationFrame inside nested composition scripts", () => {
    const html = `<!DOCTYPE html>
<html><body>
  <div data-composition-id="root" data-width="1920" data-height="1080"></div>
  <script>
    (function(){
      var __compId = "intro";
      var __run = function() {
        function tick() {
          requestAnimationFrame(tick);
        }
        tick();
      };
      if (!__compId) { __run(); return; }
      /* __HF_COMPILER_MOUNT_START__ */
      var __selector = '[data-composition-id="intro"]';
      var __attempt = 0;
      var __tryRun = function() {
        if (document.querySelector(__selector)) { __run(); return; }
        if (++__attempt >= 8) { __run(); return; }
        requestAnimationFrame(__tryRun);
      };
      __tryRun();
      /* __HF_COMPILER_MOUNT_END__ */
    })();
  </script>
</body></html>`;

    const result = detectRenderModeHints(html);

    expect(result.recommendScreenshot).toBe(true);
    expect(result.reasons.map((reason) => reason.code)).toEqual(["requestAnimationFrame"]);
  });

  it("detects html-in-canvas API via layoutsubtree canvas attribute", () => {
    const html = `<!DOCTYPE html>
<html><body>
  <div data-composition-id="root" data-width="1920" data-height="1080">
    <canvas id="glass-canvas" layoutsubtree width="1920" height="1080">
      <div class="panel">Glass content</div>
    </canvas>
  </div>
</body></html>`;

    const result = detectRenderModeHints(html);

    expect(result.reasons.map((reason) => reason.code)).toContain("htmlInCanvas");
    expect(result.recommendScreenshot).toBe(true);
  });

  it("does not flag htmlInCanvas for plain canvas elements without layoutsubtree", () => {
    const html = `<!DOCTYPE html>
<html><body>
  <div data-composition-id="root" data-width="1920" data-height="1080">
    <canvas id="my-canvas" width="1920" height="1080"></canvas>
  </div>
</body></html>`;

    const result = detectRenderModeHints(html);

    expect(result.reasons.map((reason) => reason.code)).not.toContain("htmlInCanvas");
  });

  it("does not recommend screenshot mode for nested compositions that hoist GSAP from a CDN script", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-render-mode-"));
    const compositionsDir = join(projectDir, "compositions");
    mkdirSync(compositionsDir, { recursive: true });

    writeFileSync(
      join(projectDir, "index.html"),
      `<!DOCTYPE html>
<html><body>
  <div data-composition-id="root" data-width="1920" data-height="1080">
    <div data-composition-id="intro" data-composition-src="compositions/intro.html" data-start="0"></div>
  </div>
</body></html>`,
    );
    writeFileSync(
      join(compositionsDir, "intro.html"),
      `<template id="intro-template">
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <div data-composition-id="intro" data-width="1920" data-height="1080">
    <div class="title">Hello</div>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["intro"] = gsap.timeline({ paused: true });
    </script>
  </div>
</template>`,
    );

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => {
      return new Response(
        "window.gsap = { timeline: function() { return { paused: true }; } }; function __ticker(){ requestAnimationFrame(__ticker); }",
        { status: 200 },
      );
    }) as any;

    try {
      const result = await compileForRender(projectDir, join(projectDir, "index.html"), projectDir);

      expect(result.renderModeHints.recommendScreenshot).toBe(false);
      expect(result.renderModeHints.reasons).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // Shared fixture builder for the assertSubCompositionsUsable / EmptyCompositionError
  // pre-flight tests below. `subCompFiles` is a map of compositions/-relative
  // filename to raw file content (empty string / malformed text / valid HTML).
  // `hosts` is the data-composition-src host markup injected into the root
  // composition's timeline div, in order, at 1s each.
  function makeSubCompProject(
    dirPrefix: string,
    hosts: Array<{ id: string; src: string }>,
    subCompFiles: Record<string, string>,
  ): string {
    const projectDir = mkdtempSync(join(tmpdir(), dirPrefix));
    const compositionsDir = join(projectDir, "compositions");
    mkdirSync(compositionsDir, { recursive: true });
    const hostMarkup = hosts
      .map(
        (h, i) =>
          `<div data-composition-id="${h.id}" data-composition-src="${h.src}" data-start="${i}" data-duration="1"></div>`,
      )
      .join("\n      ");
    writeFileSync(
      join(projectDir, "index.html"),
      `<!DOCTYPE html>
<html>
  <head></head>
  <body>
    <div data-composition-id="main" data-width="100" data-height="100" data-start="0" data-duration="${hosts.length}">
      ${hostMarkup}
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines.main = { duration: function() { return ${hosts.length}; } };
    </script>
  </body>
</html>`,
    );
    for (const [name, content] of Object.entries(subCompFiles)) {
      writeFileSync(join(compositionsDir, name), content);
    }
    return projectDir;
  }

  function validSubCompHtml(compId: string, label: string, nestedSrc?: string): string {
    const inner = nestedSrc
      ? `<div data-composition-id="${label}" data-composition-src="${nestedSrc}" data-start="0" data-duration="1"></div>`
      : `<div class="title">${label}</div>`;
    return `<!doctype html><html><body>
  <div data-composition-id="${compId}" data-width="100" data-height="100">
    ${inner}
  </div>
</body></html>`;
  }

  it("compileForRender aborts with EmptyCompositionError when a sub-composition file is empty", async () => {
    // The shared inliner (inlineSubCompositions.ts, packages/core) stays
    // tolerant of empty/unparsable sub-compositions — it skips the scene and
    // keeps going, silently, so preview/studio can keep iterating on a
    // partially-authored project. That tolerance is intentional and tested
    // separately in packages/core/src/compiler/inlineSubCompositions.test.ts.
    //
    // But a *render* that silently drops a scene produces a materially
    // broken video with no visible error — worse than refusing to render.
    // compileForRender (render-only) runs a pre-flight check
    // (assertSubCompositionsUsable, using the same checkSubCompositionUsability
    // helper the inliner and hyperframes lint use) before any compilation
    // work starts, and aborts immediately instead of silently producing a
    // broken render 45+ seconds later.
    const projectDir = makeSubCompProject(
      "hf-empty-subcomp-",
      [{ id: "intro", src: "compositions/intro.html" }],
      { "intro.html": "" },
    );

    await expect(
      compileForRender(projectDir, join(projectDir, "index.html"), projectDir),
    ).rejects.toThrow(/compositions\/intro\.html/);
  });

  it("compileForRender aborts naming every unusable sub-composition at once", async () => {
    const projectDir = makeSubCompProject(
      "hf-empty-subcomp-multi-",
      [
        { id: "intro", src: "compositions/intro.html" },
        { id: "outro", src: "compositions/outro.html" },
      ],
      { "intro.html": "", "outro.html": "not valid html at all, just text" },
    );

    await expect(
      compileForRender(projectDir, join(projectDir, "index.html"), projectDir),
    ).rejects.toThrow(/compositions\/intro\.html[\s\S]*compositions\/outro\.html/);
  });

  it("compileForRender aborts when a data-composition-src reference points at a missing file", async () => {
    const projectDir = makeSubCompProject(
      "hf-missing-subcomp-",
      [{ id: "intro", src: "compositions/does-not-exist.html" }],
      {},
    );

    await expect(
      compileForRender(projectDir, join(projectDir, "index.html"), projectDir),
    ).rejects.toThrow(/compositions\/does-not-exist\.html/);
  });

  it("compileForRender succeeds when the sub-composition file is valid (happy path)", async () => {
    const projectDir = makeSubCompProject(
      "hf-valid-subcomp-",
      [{ id: "intro", src: "compositions/intro.html" }],
      { "intro.html": validSubCompHtml("intro", "Hello") },
    );

    const result = await compileForRender(projectDir, join(projectDir, "index.html"), projectDir);
    expect(result.html).toContain("data-composition-id");
  });

  it("compileForRender succeeds when a valid sub-composition itself references a nested valid sub-composition", async () => {
    // Regression guard: data-composition-src is always root-relative, even
    // from within a nested sub-composition (matches parseSubCompositions,
    // which threads the original projectDir unchanged through every
    // recursion level — never dirname(parentFile)). The pre-flight check
    // must resolve nested references the same way, or it aborts renders
    // that would have actually succeeded (false-positive abort).
    //
    // parent.html lives in compositions/ and references child.html using the
    // same root-relative "compositions/..." form — not "./child.html".
    const projectDir = makeSubCompProject(
      "hf-nested-subcomp-valid-",
      [{ id: "parent", src: "compositions/parent.html" }],
      {
        "parent.html": validSubCompHtml("parent", "child", "compositions/child.html"),
        "child.html": validSubCompHtml("child", "Nested Hello"),
      },
    );

    const result = await compileForRender(projectDir, join(projectDir, "index.html"), projectDir);
    expect(result.html).toContain("data-composition-id");
  });

  it("compileForRender aborts naming a broken nested (grandchild) sub-composition", async () => {
    // child.html is empty — the grandchild scene, referenced root-relative
    // from parent.html which itself lives in compositions/.
    const projectDir = makeSubCompProject(
      "hf-nested-subcomp-broken-",
      [{ id: "parent", src: "compositions/parent.html" }],
      {
        "parent.html": validSubCompHtml("parent", "child", "compositions/child.html"),
        "child.html": "",
      },
    );

    await expect(
      compileForRender(projectDir, join(projectDir, "index.html"), projectDir),
    ).rejects.toThrow(/compositions\/child\.html/);
  });
});

describe("detectShaderTransitionUsage", () => {
  it("detects authored HyperShader initialization", () => {
    const html = `<!doctype html>
<html><body>
  <script src="https://cdn.jsdelivr.net/npm/@hyperframes/shader-transitions/dist/index.global.js"></script>
  <script>
    window.HyperShader.init({
      scenes: ["s1", "s2"],
      transitions: [{ time: 1, shader: "cinematic-zoom", duration: 0.5 }],
    });
  </script>
</body></html>`;

    expect(detectShaderTransitionUsage(html)).toBe(true);
  });

  it("ignores comments and external scripts by themselves", () => {
    const html = `<!doctype html>
<html><body>
  <script src="https://cdn.jsdelivr.net/npm/@hyperframes/shader-transitions/dist/index.global.js"></script>
  <script>
    // window.HyperShader.init({ scenes: ["s1", "s2"], transitions: [] });
    const label = "safe";
  </script>
</body></html>`;

    expect(detectShaderTransitionUsage(html)).toBe(false);
  });
});

describe("system-primary font normalization", () => {
  it("promotes Inter before system/generic primary stacks before distributed plan validation", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-system-primary-font-"));
    writeFileSync(
      join(projectDir, "index.html"),
      `<!doctype html>
<html>
  <head>
    <style>
      :root { --system-font: -apple-system, BlinkMacSystemFont, sans-serif; }
      body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
      .system-ui { font-family: system-ui, sans-serif; }
      .var-font { font-family: var(--system-font), sans-serif; }
      .deterministic { font-family: "Montserrat", system-ui, sans-serif; }
    </style>
  </head>
  <body>
    <div
      data-composition-id="root"
      data-width="640"
      data-height="360"
      data-duration="1"
      data-font-family="ui-monospace, monospace"
      style="--inline-system-font: system-ui, sans-serif; font-family: sans-serif"
    >
      <span class="var-font">Hello</span>
    </div>
  </body>
</html>`,
    );

    const compiled = await compileForRender(projectDir, join(projectDir, "index.html"), projectDir);

    expect(() => validateNoSystemFonts(compiled.html)).not.toThrow();
    const compact = compiled.html.replace(/\s+/g, "");
    expect(compact).toContain("--system-font:Inter,-apple-system,BlinkMacSystemFont,sans-serif");
    expect(compact).toContain("font-family:Inter,-apple-system,BlinkMacSystemFont,sans-serif");
    expect(compact).toContain("font-family:Inter,system-ui,sans-serif");
    expect(compact).toContain("font-family:var(--system-font),sans-serif");
    expect(compact).toContain('font-family:"Montserrat",system-ui,sans-serif');
    expect(compact).toContain('data-font-family="Inter,ui-monospace,monospace"');
    expect(compact).toContain('data-hyperframes-deterministic-fonts="true"');

    const { document } = parseHTML(compiled.html);
    const rootStyle = document.querySelector('[data-composition-id="root"]')?.getAttribute("style");
    expect(rootStyle).toContain("--inline-system-font: Inter, system-ui, sans-serif");
    expect(rootStyle).toContain("font-family: Inter, sans-serif");
  });
});

describe("template-wrapped sub-composition media offsets", () => {
  function writeTemplateWrappedProject(
    hostAttrs: string,
    mediaAttrs: string = 'data-start="0" data-duration="4"',
    extraMediaMarkup: string = "",
  ): {
    projectDir: string;
    indexPath: string;
  } {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-template-offset-"));
    const compositionsDir = join(projectDir, "compositions");
    mkdirSync(compositionsDir, { recursive: true });
    writeFileSync(
      join(projectDir, "index.html"),
      `<!DOCTYPE html>
<html>
  <head></head>
  <body>
    <div
      id="root"
      data-composition-id="root"
      data-start="0"
      data-width="640"
      data-height="360"
      data-duration="4"
    >
      <div
        id="scene-host"
        data-composition-id="scene"
        data-composition-src="compositions/scene.html"
        ${hostAttrs}
      ></div>
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["root"] = { duration: () => 4 };
    </script>
  </body>
</html>`,
    );
    writeFileSync(
      join(compositionsDir, "scene.html"),
      `<template id="scene-template">
  <div
    data-composition-id="scene"
    data-start="0"
    data-width="640"
    data-height="360"
    data-duration="4"
  >
    <style>.title { opacity: 0; }</style>
    <h1 class="title">Scene</h1>
    <video
      id="scene-video"
      src="../assets/clip.mp4"
      ${mediaAttrs}
      data-track-index="0"
    ></video>
    ${extraMediaMarkup}
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["scene"] = { duration: () => 4 };
    </script>
  </div>
</template>`,
    );

    return { projectDir, indexPath: join(projectDir, "index.html") };
  }

  it("offsets template-wrapped media to the host start during compile", async () => {
    const { projectDir, indexPath } = writeTemplateWrappedProject(
      'data-start="2" data-duration="2" data-width="640" data-height="360"',
    );

    const compiled = await compileForRender(projectDir, indexPath, projectDir);

    expect(compiled.videos).toHaveLength(1);
    expect(compiled.videos[0]).toMatchObject({
      id: "scene-video",
      start: 2,
      end: 6,
    });
    expect(compiled.audios).toHaveLength(1);
    expect(compiled.audios[0]).toMatchObject({
      id: "scene-video-audio",
      start: 2,
      end: 6,
    });
  });

  it("preserves first-pass media offsets when durations are resolved after inlining", async () => {
    const { projectDir, indexPath } = writeTemplateWrappedProject(
      'data-start="2" data-width="640" data-height="360"',
    );

    const compiled = await compileForRender(projectDir, indexPath, projectDir);
    expect(compiled.videos[0]?.start).toBe(2);

    const recompiled = await recompileWithResolutions(
      compiled,
      [{ id: "scene-host", duration: 2 }],
      projectDir,
      projectDir,
    );

    expect(recompiled.videos).toHaveLength(1);
    expect(recompiled.videos[0]).toMatchObject({
      id: "scene-video",
      start: 2,
      end: 6,
    });
    expect(recompiled.audios).toHaveLength(1);
    expect(recompiled.audios[0]).toMatchObject({
      id: "scene-video-audio",
      start: 2,
      end: 6,
    });
  });

  it("offsets scene-local media in compositions that start much later on the timeline", async () => {
    const { projectDir, indexPath } = writeTemplateWrappedProject(
      'data-start="20" data-duration="6" data-width="640" data-height="360"',
      'data-start="1.5" data-duration="4"',
    );

    const compiled = await compileForRender(projectDir, indexPath, projectDir);

    expect(compiled.videos).toHaveLength(1);
    expect(compiled.videos[0]).toMatchObject({
      id: "scene-video",
      start: 21.5,
      end: 25.5,
    });
    expect(compiled.audios).toHaveLength(1);
    expect(compiled.audios[0]).toMatchObject({
      id: "scene-video-audio",
      start: 21.5,
      end: 25.5,
    });
  });

  it("includes explicit audio from template-wrapped sub-compositions", async () => {
    const { projectDir, indexPath } = writeTemplateWrappedProject(
      'data-start="5" data-duration="6" data-width="640" data-height="360"',
      'data-start="1" data-duration="4"',
      `<audio
        id="scene-audio"
        src="../assets/narration.wav"
        data-start="2"
        data-duration="3"
        data-track-index="1"
      ></audio>`,
    );

    const compiled = await compileForRender(projectDir, indexPath, projectDir);

    expect(compiled.audios).toContainEqual(
      expect.objectContaining({
        id: "scene-audio",
        start: 7,
        end: 10,
      }),
    );
  });

  it("flattens the sub-composition root onto the host in compiled render HTML", async () => {
    const { projectDir, indexPath } = writeTemplateWrappedProject(
      'data-start="20" data-duration="6" data-width="640" data-height="360"',
      'data-start="1.5" data-duration="4"',
    );

    const compiled = await compileForRender(projectDir, indexPath, projectDir);

    const { document } = parseHTML(compiled.html);
    const host = document.querySelector("#scene-host");

    expect(host?.getAttribute("data-composition-id")).toBe("scene");
    expect(host?.getAttribute("data-start")).toBe("20");
    expect(host?.getAttribute("data-width")).toBe("640");
    expect(host?.querySelector(".title")?.textContent).toBe("Scene");
    expect(
      Array.from(host?.children ?? []).some(
        (child) => child.getAttribute("data-composition-id") === "scene",
      ),
    ).toBe(false);
    expect(compiled.html).toContain('[data-composition-id="scene"] .title');
    expect(compiled.html).toContain("new Proxy(window.document");
    expect(compiled.html).toContain("__hfNormalizeSelector");
  });

  it("preserves the inferred composition boundary when the host has no composition id", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-anonymous-host-"));
    const compositionsDir = join(projectDir, "compositions");
    mkdirSync(compositionsDir, { recursive: true });
    writeFileSync(
      join(projectDir, "index.html"),
      `<!DOCTYPE html>
<html>
  <body>
    <div id="root" data-composition-id="root" data-width="640" data-height="360">
      <div id="scene-host" data-composition-src="compositions/scene.html" data-start="0"></div>
    </div>
  </body>
</html>`,
    );
    writeFileSync(
      join(compositionsDir, "scene.html"),
      `<template id="scene-template">
  <div data-composition-id="scene" data-width="640" data-height="360" data-duration="4">
    <style>.title { opacity: 0; }</style>
    <h1 class="title">Scene</h1>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines.scene = { duration: () => 4 };
    </script>
  </div>
</template>`,
    );

    const compiled = await compileForRender(projectDir, join(projectDir, "index.html"), projectDir);
    const { document } = parseHTML(compiled.html);
    const host = document.querySelector("#scene-host");

    expect(host?.getAttribute("data-composition-id")).toBeNull();
    expect(host?.querySelector('[data-composition-id="scene"] .title')?.textContent).toBe("Scene");
    expect(compiled.html).toContain('var __hfCompId = "scene";');
  });
});

// ── injectTextRenderingRule (via compileForRender) ─────────────────────────
//
// Forces `text-rendering: geometricPrecision` so chrome-headless-shell
// (BeginFrame) and full Chrome lay text out identically. See
// `injectTextRenderingRule` in htmlCompiler.ts for full context.

describe("text-rendering rule injection", () => {
  it("injects a single geometricPrecision rule into <head> for a full-document composition", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-text-rendering-"));
    writeFileSync(
      join(projectDir, "index.html"),
      `<!DOCTYPE html>
<html>
<head><title>t</title></head>
<body>
  <div data-composition-id="root" data-width="640" data-height="360" data-duration="1">
    <h1>Hello</h1>
  </div>
</body>
</html>`,
    );

    const compiled = await compileForRender(projectDir, join(projectDir, "index.html"), projectDir);

    const { document } = parseHTML(compiled.html);
    const styleEls = document.querySelectorAll("style[data-hyperframes-text-rendering]");
    expect(styleEls.length).toBe(1);
    expect((styleEls[0]?.textContent || "").replace(/\s+/g, "")).toContain(
      "html,body,*{text-rendering:geometricPrecision}",
    );
    expect(styleEls[0]?.parentElement?.tagName.toLowerCase()).toBe("head");
  });

  it("includes geometricPrecision in the fragment-wrap fallback stylesheet", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-text-rendering-frag-"));
    // Fragment (no <html>/<head>/<body>) — exercises ensureFullDocument.
    writeFileSync(
      join(projectDir, "index.html"),
      `<div data-composition-id="root" data-width="640" data-height="360" data-duration="1"><h1>Hi</h1></div>`,
    );

    const compiled = await compileForRender(projectDir, join(projectDir, "index.html"), projectDir);

    expect(compiled.html.replace(/\s+/g, "")).toContain("text-rendering:geometricPrecision");
    expect(compiled.html.replace(/\s+/g, "")).toContain('font-family:"Inter",sans-serif');
  });
});

// ── crossorigin stripping ───────────────────────────────────────────────────
//
// External images/videos with crossorigin="anonymous" force CORS-mode requests
// against the renderer's localhost file server. S3 and similar origins reject
// those requests, so the element renders blank. The strip removes the attribute
// so the browser falls back to no-cors (visual-only) mode.

describe("crossorigin attribute stripping", () => {
  it("strips crossorigin from <img> elements", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-crossorigin-img-"));
    writeFileSync(
      join(projectDir, "index.html"),
      `<!DOCTYPE html><html><body>
  <div data-composition-id="root" data-width="640" data-height="360" data-duration="1">
    <img id="hero" src="https://example.com/photo.jpg" crossorigin="anonymous" alt="" />
    <img id="plain" src="local.jpg" alt="" />
  </div>
</body></html>`,
    );

    const compiled = await compileForRender(projectDir, join(projectDir, "index.html"), projectDir);

    expect(compiled.html).not.toContain('crossorigin="anonymous"');
    expect(compiled.html).toContain('id="hero"');
    expect(compiled.html).toContain('id="plain"');
  });

  it("strips crossorigin from <video> elements", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-crossorigin-video-"));
    writeFileSync(
      join(projectDir, "index.html"),
      `<!DOCTYPE html><html><body>
  <div data-composition-id="root" data-width="640" data-height="360" data-duration="1">
    <video id="clip" src="https://example.com/clip.mp4" crossorigin="anonymous" data-start="0" data-duration="1"></video>
  </div>
</body></html>`,
    );

    const compiled = await compileForRender(projectDir, join(projectDir, "index.html"), projectDir);

    expect(compiled.html).not.toContain("crossorigin");
    expect(compiled.html).toContain('id="clip"');
  });

  it("strips crossorigin from <audio> elements", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-crossorigin-audio-"));
    writeFileSync(
      join(projectDir, "index.html"),
      `<!DOCTYPE html><html><body>
  <div data-composition-id="root" data-width="640" data-height="360" data-duration="5">
    <audio id="bgm" src="https://example.com/bgm.mp3" crossorigin="anonymous" data-start="0" data-duration="5" data-volume="0.8"></audio>
  </div>
</body></html>`,
    );

    const compiled = await compileForRender(projectDir, join(projectDir, "index.html"), projectDir);

    expect(compiled.html).not.toContain("crossorigin");
    expect(compiled.html).toContain('id="bgm"');
  });
});

// ── remote media localization ────────────────────────────────────────────────
//
// Tests run on localizeRemoteMediaSources directly (exported for testing) to
// avoid invoking ffprobe / the full compileForRender pipeline. fetch is patched
// in-process for success cases; real 404s from example.com cover fallback.

describe("localizeRemoteMediaSources", () => {
  it("rewrites remote <video> src to _remote_media path when download succeeds", async () => {
    const orig = globalThis.fetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = async () => new Response(new Uint8Array(100), { status: 200 });
    try {
      const dl = mkdtempSync(join(tmpdir(), "hf-dl-ok-"));
      const html = `<video id="v1" src="https://media-ok.example.com/a/clip.mp4" data-start="0" data-end="10" muted></video>`;
      const { html: result, remoteMediaAssets } = await localizeRemoteMediaSources(html, dl);
      expect(result).not.toContain("https://media-ok.example.com/");
      expect(result).toContain("_remote_media/");
      expect(remoteMediaAssets.size).toBe(1);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).fetch = orig;
    }
  });

  it("preserves original URL on download failure without throwing", async () => {
    const dl = mkdtempSync(join(tmpdir(), "hf-dl-fail-"));
    const url = "https://example.com/will-404-localize-test.mp4";
    const html = `<video id="v1" src="${url}" data-start="0" data-end="10" muted></video>`;
    const { html: result, remoteMediaAssets } = await localizeRemoteMediaSources(html, dl);
    expect(result).toContain(url);
    expect(remoteMediaAssets.size).toBe(0);
  });

  it("deduplicates: two tags with the same src URL → one download", async () => {
    const orig = globalThis.fetch;
    let fetchCount = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = async () => {
      fetchCount++;
      return new Response(new Uint8Array(100), { status: 200 });
    };
    try {
      const dl = mkdtempSync(join(tmpdir(), "hf-dl-dedup-"));
      const html = `<video id="v1" src="https://dedup.example.com/b/shared.mp4" data-start="0" data-end="10" muted></video>
<video id="v2" src="https://dedup.example.com/b/shared.mp4" data-start="10" data-end="20" muted></video>`;
      await localizeRemoteMediaSources(html, dl);
      expect(fetchCount).toBe(1);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).fetch = orig;
    }
  });

  it("does not rewrite local (non-HTTP) src paths", async () => {
    const dl = mkdtempSync(join(tmpdir(), "hf-dl-local-"));
    const html = `<video id="v1" src="assets/local.mp4" data-start="0" data-end="10" muted></video>`;
    const { html: result, remoteMediaAssets } = await localizeRemoteMediaSources(html, dl);
    expect(result).toContain("assets/local.mp4");
    expect(result).not.toContain("_remote_media/");
    expect(remoteMediaAssets.size).toBe(0);
  });

  it("rewrites src in both double-quoted and single-quoted attributes", async () => {
    const orig = globalThis.fetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = async () => new Response(new Uint8Array(100), { status: 200 });
    try {
      const dl = mkdtempSync(join(tmpdir(), "hf-dl-quotes-"));
      const html = `<video id="v1" src="https://q.example.com/c/dq.mp4" data-start="0" data-end="10" muted></video>
<audio id="a1" src='https://q.example.com/c/sq.mp3' data-start="0" data-end="10"></audio>`;
      const { html: result } = await localizeRemoteMediaSources(html, dl);
      expect(result).not.toContain("https://q.example.com/");
      expect(result.match(/_remote_media\//g)?.length).toBe(2);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).fetch = orig;
    }
  });

  it("uses path.basename for OS-portable filename extraction from downloaded path", () => {
    // Guards against the prior absPath.split('/').at(-1) pattern. On Windows
    // path.join uses `\` separators; splitting on `/` would return the entire
    // path as a single element, producing a garbage relPath. path.basename is
    // OS-aware and extracts the filename correctly on both platforms.
    const { basename: b } = require("node:path");
    expect(b("/tmp/_remote_media/download_abc123.mp4")).toBe("download_abc123.mp4");
  });
});

// ── localizeRemoteImageSources ───────────────────────────────────────────────
//
// Regression coverage for the agent-pipeline `<img>` flicker bug: producer's
// frame-capture has no `pollImagesReady` analog of `pollVideosReady`, so a
// composition with raw S3 `<img src="https://...">` URLs (astral / daphne /
// hyperion multi-v2 outputs) reaches Chrome with a network dependency that
// races the readiness gate AND can be evicted mid-render. Localising before
// render is the architectural fix; `pollImagesReady` in frameCapture is the
// defense-in-depth layer.
//
// Mirrors the localizeRemoteMediaSources test shape; fetch is patched in
// for success cases and a real 404 covers the fallback path.

describe("localizeRemoteImageSources", () => {
  it("rewrites remote <img> src to _remote_media path when download succeeds", async () => {
    const orig = globalThis.fetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = async () => new Response(new Uint8Array(100), { status: 200 });
    try {
      const dl = mkdtempSync(join(tmpdir(), "hf-img-ok-"));
      const html = `<img class="hero" src="https://img-ok.example.com/photo.png" />`;
      const { html: result, remoteMediaAssets } = await localizeRemoteImageSources(html, dl);
      expect(result).not.toContain("https://img-ok.example.com/");
      expect(result).toContain("_remote_media/");
      expect(remoteMediaAssets.size).toBe(1);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).fetch = orig;
    }
  });

  it("preserves original URL on download failure without throwing", async () => {
    const dl = mkdtempSync(join(tmpdir(), "hf-img-fail-"));
    const url = "https://example.com/will-404-image-localize-test.png";
    const html = `<img src="${url}" />`;
    const { html: result, remoteMediaAssets } = await localizeRemoteImageSources(html, dl);
    expect(result).toContain(url);
    expect(remoteMediaAssets.size).toBe(0);
  });

  it("deduplicates: two <img> tags with the same src URL → one download", async () => {
    const orig = globalThis.fetch;
    let fetchCount = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = async () => {
      fetchCount++;
      return new Response(new Uint8Array(100), { status: 200 });
    };
    try {
      const dl = mkdtempSync(join(tmpdir(), "hf-img-dedup-"));
      const html = `<img src="https://dedup-img.example.com/hero.jpg" />
<img src="https://dedup-img.example.com/hero.jpg" />`;
      await localizeRemoteImageSources(html, dl);
      expect(fetchCount).toBe(1);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).fetch = orig;
    }
  });

  it("does not rewrite local (non-HTTP) src paths", async () => {
    const dl = mkdtempSync(join(tmpdir(), "hf-img-local-"));
    const html = `<img src="assets/hero.png" />`;
    const { html: result, remoteMediaAssets } = await localizeRemoteImageSources(html, dl);
    expect(result).toContain("assets/hero.png");
    expect(result).not.toContain("_remote_media/");
    expect(remoteMediaAssets.size).toBe(0);
  });

  it("does not rewrite data: URI src", async () => {
    const dl = mkdtempSync(join(tmpdir(), "hf-img-data-"));
    const html = `<img src="data:image/svg+xml,%3Csvg/%3E" />`;
    const { html: result, remoteMediaAssets } = await localizeRemoteImageSources(html, dl);
    expect(result).toContain("data:image/svg+xml");
    expect(remoteMediaAssets.size).toBe(0);
  });

  it("rewrites both double-quoted and single-quoted src attributes", async () => {
    const orig = globalThis.fetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = async () => new Response(new Uint8Array(100), { status: 200 });
    try {
      const dl = mkdtempSync(join(tmpdir(), "hf-img-quotes-"));
      const html = `<img src="https://q-img.example.com/dq.png" />
<img src='https://q-img.example.com/sq.jpg' />`;
      const { html: result } = await localizeRemoteImageSources(html, dl);
      expect(result).not.toContain("https://q-img.example.com/");
      expect(result.match(/_remote_media\//g)?.length).toBe(2);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).fetch = orig;
    }
  });

  it("does not match data-src (lazy-loader placeholder), only the real src attribute", async () => {
    // A lazy-loader emits the real asset in `data-src` and a placeholder in
    // `src`. We must localise what Chrome actually paints (the real `src`),
    // not the `data-src` URL — matching `data-src` would download an asset the
    // render never shows and could break the loader's runtime swap.
    const orig = globalThis.fetch;
    let fetchCount = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = async () => {
      fetchCount++;
      return new Response(new Uint8Array(100), { status: 200 });
    };
    try {
      const dl = mkdtempSync(join(tmpdir(), "hf-img-datasrc-"));
      const html = `<img data-src="https://lazy.example.com/real.png" src="https://cdn.example.com/placeholder.png" />`;
      const { html: result } = await localizeRemoteImageSources(html, dl);
      // The real src is localised; the data-src URL is left untouched.
      expect(result).toContain("https://lazy.example.com/real.png");
      expect(result).not.toContain("https://cdn.example.com/placeholder.png");
      expect(fetchCount).toBe(1);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).fetch = orig;
    }
  });

  it("handles src attribute not as the first attribute (agent-pipeline shape)", async () => {
    // The 02_kobe astral-pipeline composition that surfaced this bug emits
    // <img> tags with `class` before `src`. Regex must not assume src position.
    const orig = globalThis.fetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = async () => new Response(new Uint8Array(100), { status: 200 });
    try {
      const dl = mkdtempSync(join(tmpdir(), "hf-img-attr-order-"));
      const html = `<img class="kobe-cutout" alt="kobe" src="https://astral.example.com/d828bca.png" />`;
      const { html: result, remoteMediaAssets } = await localizeRemoteImageSources(html, dl);
      expect(result).not.toContain("https://astral.example.com/");
      expect(result).toContain("_remote_media/");
      expect(remoteMediaAssets.size).toBe(1);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).fetch = orig;
    }
  });
});

// ── localizeRemoteFontFaces ──────────────────────────────────────────────────

describe("localizeRemoteFontFaces", () => {
  const FONT_URL = "https://gen-os-static.s3.us-east-2.amazonaws.com/fonts/komika-axis.ttf";

  it("rewrites @font-face url() inside <style> to _remote_media/ path", async () => {
    const orig = globalThis.fetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = async () => new Response(new Uint8Array(16), { status: 200 });
    try {
      const dl = mkdtempSync(join(tmpdir(), "hf-ff-"));
      const html = `<style>
@font-face {
  font-family: "Komika Axis";
  src: url("${FONT_URL}") format("truetype");
}
</style>`;
      const { html: result, remoteMediaAssets } = await localizeRemoteFontFaces(html, dl);
      expect(result).not.toContain(FONT_URL);
      expect(result).toContain("_remote_media/");
      expect(remoteMediaAssets.size).toBe(1);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("ignores url() references outside @font-face (e.g. background-image)", async () => {
    const orig = globalThis.fetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = async () => new Response(new Uint8Array(16), { status: 200 });
    try {
      const dl = mkdtempSync(join(tmpdir(), "hf-ff-bg-"));
      const BG_URL = "https://cdn.example.com/bg.png";
      const html = `<style>
body { background-image: url("${BG_URL}"); }
@font-face { font-family: "F"; src: url("${FONT_URL}") format("truetype"); }
</style>`;
      const { html: result } = await localizeRemoteFontFaces(html, dl);
      // Font URL rewritten, background URL untouched
      expect(result).not.toContain(FONT_URL);
      expect(result).toContain(BG_URL);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("preserves original URL when download fails", async () => {
    const orig = globalThis.fetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = async () => new Response(null, { status: 403 });
    try {
      const dl = mkdtempSync(join(tmpdir(), "hf-ff-fail-"));
      const FAIL_URL = "https://fail-font.example.com/f.ttf";
      const html = `<style>@font-face { font-family: "F"; src: url("${FAIL_URL}") format("truetype"); }</style>`;
      const { html: result, remoteMediaAssets } = await localizeRemoteFontFaces(html, dl);
      expect(result).toContain(FAIL_URL);
      expect(remoteMediaAssets.size).toBe(0);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("deduplicates: same font URL in two @font-face blocks → 1 download", async () => {
    const orig = globalThis.fetch;
    let fetchCount = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = async () => {
      fetchCount++;
      return new Response(new Uint8Array(16), { status: 200 });
    };
    try {
      const dl = mkdtempSync(join(tmpdir(), "hf-ff-dedup-"));
      const DEDUP_URL = "https://dedup-font.example.com/d.ttf";
      const html = `<style>
@font-face { font-family: "F1"; src: url("${DEDUP_URL}") format("truetype"); font-weight: 400; }
@font-face { font-family: "F2"; src: url("${DEDUP_URL}") format("truetype"); font-weight: 700; }
</style>`;
      const { remoteMediaAssets } = await localizeRemoteFontFaces(html, dl);
      expect(fetchCount).toBe(1);
      expect(remoteMediaAssets.size).toBe(1);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("no-ops when no @font-face blocks are present", async () => {
    const dl = mkdtempSync(join(tmpdir(), "hf-ff-noop-"));
    const html = `<style>body { color: red; }</style>`;
    const { html: result, remoteMediaAssets } = await localizeRemoteFontFaces(html, dl);
    expect(result).toBe(html);
    expect(remoteMediaAssets.size).toBe(0);
  });

  it("ignores local (non-HTTP) @font-face src URLs", async () => {
    const dl = mkdtempSync(join(tmpdir(), "hf-ff-local-"));
    const html = `<style>@font-face { font-family: "F"; src: url("assets/fonts/f.ttf") format("truetype"); }</style>`;
    const { html: result, remoteMediaAssets } = await localizeRemoteFontFaces(html, dl);
    expect(result).toBe(html);
    expect(remoteMediaAssets.size).toBe(0);
  });

  // ── External <link rel="stylesheet"> inlining ──

  it("leaves Google Fonts <link> tags untouched", async () => {
    const dl = mkdtempSync(join(tmpdir(), "hf-ff-gf-"));
    const html = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700">
<link rel="stylesheet" href="https://fonts.gstatic.com/s/inter/inter.css">
<style>body { color: red; }</style>`;
    const { html: result, remoteMediaAssets } = await localizeRemoteFontFaces(html, dl);
    // Google Fonts links should remain as-is — the deterministic font injector handles them
    expect(result).toContain("fonts.googleapis.com");
    expect(result).toContain("fonts.gstatic.com");
    expect(result).toBe(html);
    expect(remoteMediaAssets.size).toBe(0);
  });

  it("does not process non-stylesheet <link> tags (rel=icon, rel=preconnect)", async () => {
    const dl = mkdtempSync(join(tmpdir(), "hf-ff-nonss-"));
    const html = `<link rel="icon" href="https://cdn.example.com/favicon.ico">
<link rel="preconnect" href="https://cdn.example.com">
<link rel="dns-prefetch" href="https://cdn.example.com">`;
    const { html: result, remoteMediaAssets } = await localizeRemoteFontFaces(html, dl);
    expect(result).toBe(html);
    expect(remoteMediaAssets.size).toBe(0);
  });

  it("inlines @font-face rules from external non-Google stylesheet and downloads font files", async () => {
    const EXTERNAL_FONT_URL = "https://cdn.example.com/fonts/custom.woff2";
    const STYLESHEET_URL = "https://cdn.example.com/fonts/style.css";
    const fakeCss = `
/* Reset styles */
body { margin: 0; }
@font-face {
  font-family: "CustomFont";
  src: url("${EXTERNAL_FONT_URL}") format("woff2");
  font-weight: 400;
}
h1 { font-size: 2rem; }`;

    const orig = globalThis.fetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = async (url: string) => {
      if (url === STYLESHEET_URL) {
        return new Response(fakeCss, { status: 200 });
      }
      // Font file download
      return new Response(new Uint8Array(16), { status: 200 });
    };
    try {
      const dl = mkdtempSync(join(tmpdir(), "hf-ff-ext-"));
      const html = `<link rel="stylesheet" href="${STYLESHEET_URL}">
<style>body { color: red; }</style>`;
      const { html: result, remoteMediaAssets } = await localizeRemoteFontFaces(html, dl);
      // The <link> tag should be replaced with an inline <style> containing the @font-face
      expect(result).not.toContain(`href="${STYLESHEET_URL}"`);
      expect(result).not.toContain("<link");
      expect(result).toContain("@font-face");
      expect(result).toContain("CustomFont");
      // The remote font URL should be rewritten to a local path
      expect(result).not.toContain(EXTERNAL_FONT_URL);
      expect(result).toContain("_remote_media/");
      expect(remoteMediaAssets.size).toBe(1);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("keeps <link> tag when external stylesheet fetch fails (graceful degradation)", async () => {
    const STYLESHEET_URL = "https://down.example.com/fonts.css";
    const orig = globalThis.fetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = async () => new Response(null, { status: 503 });
    try {
      const dl = mkdtempSync(join(tmpdir(), "hf-ff-extfail-"));
      const html = `<link rel="stylesheet" href="${STYLESHEET_URL}">`;
      const { html: result, remoteMediaAssets } = await localizeRemoteFontFaces(html, dl);
      // Original link tag preserved on failure
      expect(result).toContain(STYLESHEET_URL);
      expect(result).toContain("<link");
      expect(remoteMediaAssets.size).toBe(0);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("keeps <link> tag when external stylesheet has no @font-face rules", async () => {
    const STYLESHEET_URL = "https://cdn.example.com/reset.css";
    const orig = globalThis.fetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = async () =>
      new Response("body { margin: 0; } h1 { color: blue; }", { status: 200 });
    try {
      const dl = mkdtempSync(join(tmpdir(), "hf-ff-noff-"));
      const html = `<link rel="stylesheet" href="${STYLESHEET_URL}">`;
      const { html: result, remoteMediaAssets } = await localizeRemoteFontFaces(html, dl);
      // No @font-face → keep the original link tag (non-font CSS may be needed)
      expect(result).toContain(STYLESHEET_URL);
      expect(result).toContain("<link");
      expect(remoteMediaAssets.size).toBe(0);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("handles multiple external stylesheets, mixing Google and non-Google", async () => {
    const FONT_CDN_URL = "https://use.typekit.net/abc123.css";
    const FONT_FILE_URL = "https://use.typekit.net/af/font.woff2";
    const fontCss = `@font-face { font-family: "AdobeFont"; src: url("${FONT_FILE_URL}") format("woff2"); }`;

    const orig = globalThis.fetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = async (url: string) => {
      if (url === FONT_CDN_URL) return new Response(fontCss, { status: 200 });
      return new Response(new Uint8Array(16), { status: 200 });
    };
    try {
      const dl = mkdtempSync(join(tmpdir(), "hf-ff-multi-"));
      const html = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto">
<link rel="stylesheet" href="${FONT_CDN_URL}">`;
      const { html: result, remoteMediaAssets } = await localizeRemoteFontFaces(html, dl);
      // Google link untouched
      expect(result).toContain("fonts.googleapis.com");
      // Typekit link inlined — the <link> tag is replaced; the URL only appears in a CSS comment
      expect(result).not.toContain(`href="${FONT_CDN_URL}"`);
      expect(result).toContain("AdobeFont");
      expect(result).toContain("_remote_media/");
      expect(remoteMediaAssets.size).toBe(1);
    } finally {
      globalThis.fetch = orig;
    }
  });
});

describe("discoverAudioVolumeAutomationFromTimeline", () => {
  it("samples video-derived audio volume without firing GSAP callbacks", async () => {
    class TestAudioElement {}
    class TestVideoElement {
      id = "bg-video";
      dataset = { start: "0", duration: "1", volume: "0" };
      volume = 0;
    }

    const video = new TestVideoElement();
    const seekCalls: { time: number; suppressEvents: boolean | undefined }[] = [];
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const previousAudioElement = globalThis.HTMLAudioElement;
    const previousVideoElement = globalThis.HTMLVideoElement;

    globalThis.window = {
      __timelines: {
        root: {
          totalTime: (time: number, suppressEvents?: boolean) => {
            seekCalls.push({ time, suppressEvents });
            video.volume = Math.min(1, Math.max(0, time));
          },
        },
      },
    } as any;
    globalThis.document = {
      querySelector: (selector: string) =>
        selector === "[data-composition-id]"
          ? { getAttribute: (name: string) => (name === "data-composition-id" ? "root" : null) }
          : null,
      getElementById: (id: string) => (id === "bg-video" ? video : null),
    } as any;
    globalThis.HTMLAudioElement = TestAudioElement as any;
    globalThis.HTMLVideoElement = TestVideoElement as any;

    try {
      const page = {
        evaluate: async (fn: (arg: unknown) => unknown, arg: unknown) => fn(arg),
      } as any;

      const result = await discoverAudioVolumeAutomationFromTimeline(
        page,
        ["bg-video-audio"],
        1,
        2,
      );

      expect(result).toEqual([
        {
          id: "bg-video-audio",
          keyframes: [
            { time: 0, volume: 0 },
            { time: 0.5, volume: 0.5 },
            { time: 1, volume: 1 },
          ],
        },
      ]);
      expect(seekCalls.length).toBeGreaterThan(0);
      expect(seekCalls.every((call) => call.suppressEvents === true)).toBe(true);
    } finally {
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
      globalThis.HTMLAudioElement = previousAudioElement;
      globalThis.HTMLVideoElement = previousVideoElement;
    }
  });
});
