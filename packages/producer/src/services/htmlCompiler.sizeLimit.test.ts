import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertCompositionFileSize, MAX_COMPOSITION_HTML_BYTES } from "./compositionSizeLimit.js";
import { compileForRender } from "./htmlCompiler.js";
import { extractSafeRenderErrorCode } from "./safeRenderErrorCode.js";

const ROOT = `<!doctype html>
<html><body>
  <div data-composition-id="root" data-width="1920" data-height="1080" data-duration="2">
    <div data-composition-id="scene" data-composition-src="scene.html" data-start="0" data-duration="2"></div>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines.root = { duration: function() { return 2; } };
    </script>
  </div>
</body></html>`;
const SCENE = `<template><div data-composition-id="scene"><h1>Scene</h1></div></template>`;

/** `html` followed by a comment that brings the file to exactly `bytes`. */
const paddedTo = (html: string, bytes: number) =>
  `${html}<!--${"x".repeat(bytes - Buffer.byteLength(html) - 7)}-->`;

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-compiler-size-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

async function compileError(dir: string): Promise<unknown> {
  return compileForRender(dir, join(dir, "index.html"), dir).then(
    () => undefined,
    (error: unknown) => error,
  );
}

describe("composition HTML size limit", () => {
  it("refuses an entry file over the limit before compiling it", async () => {
    const dir = project({
      "index.html": paddedTo(ROOT, MAX_COMPOSITION_HTML_BYTES + 1),
      "scene.html": SCENE,
    });
    const started = performance.now();
    const error = await compileError(dir);
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(extractSafeRenderErrorCode(error)).toBe("COMPOSITION_TOO_LARGE");
    expect(String(error)).toContain('"index.html"');
    expect(String(error)).toContain("8.0 MB limit");
  });

  it("refuses a sub-composition file over the limit", async () => {
    const dir = project({
      "index.html": ROOT,
      "scene.html": paddedTo(SCENE, MAX_COMPOSITION_HTML_BYTES + 1),
    });
    const error = await compileError(dir);
    expect(extractSafeRenderErrorCode(error)).toBe("COMPOSITION_TOO_LARGE");
    expect(String(error)).toContain('"scene.html"');
  });

  it("compiles files at the limit", async () => {
    const dir = project({
      "index.html": paddedTo(ROOT, MAX_COMPOSITION_HTML_BYTES),
      "scene.html": SCENE,
    });
    const compiled = await compileForRender(dir, join(dir, "index.html"), dir);
    expect(compiled.html).toContain("<h1>Scene</h1>");
  });

  it("leaves missing paths and folders to the caller's own read", () => {
    const dir = project({});
    expect(() =>
      assertCompositionFileSize(join(dir, "missing.html"), "missing.html"),
    ).not.toThrow();
    expect(() => assertCompositionFileSize(dir, "folder")).not.toThrow();
  });
});
