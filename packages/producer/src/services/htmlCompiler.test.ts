import { describe, expect, it, mock, beforeAll } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectExternalAssets,
  detectRenderModeHints,
  inlineExternalScripts,
} from "./htmlCompiler.js";

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
});
