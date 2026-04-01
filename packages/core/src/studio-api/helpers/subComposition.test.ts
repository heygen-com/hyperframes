// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSubCompositionHtml } from "./subComposition";

function makeTempProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-subcomp-preview-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content, "utf-8");
  }
  return dir;
}

describe("buildSubCompositionHtml", () => {
  it("rewrites sub-composition asset paths against the project root preview base", () => {
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html><head><title>Test</title></head><body></body></html>`,
      "compositions/hero.html": `<template id="hero-template">
  <div data-composition-id="hero" data-width="1920" data-height="1080">
    <img src="../logo.png" alt="Logo" />
    <style>
      @font-face {
        font-family: "Brand Sans";
        src: url("../fonts/brand.woff2") format("woff2");
      }
    </style>
  </div>
</template>`,
    });

    const html = buildSubCompositionHtml(
      dir,
      "compositions/hero.html",
      "/api/runtime.js",
      "/api/projects/demo/preview/",
    );

    expect(html).toContain('<base href="/api/projects/demo/preview/">');
    expect(html).toContain('src="logo.png"');
    expect(html).toContain('url("fonts/brand.woff2")');
    expect(html).not.toContain('src="../logo.png"');
    expect(html).not.toContain('url("../fonts/brand.woff2")');
  });
});
