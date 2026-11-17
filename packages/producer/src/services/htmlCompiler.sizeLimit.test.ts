import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertCompositionFileSize,
  MAX_COMPOSITION_HTML_BYTES,
  MAX_EXPANDED_COMPOSITION_BYTES,
} from "./compositionSizeLimit.js";
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
    expect(String(error)).toContain("16.0 MB limit");
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

/** A root that mounts `src` `count` times. */
const rootMounting = (src: string, count: number) =>
  ROOT.replace(
    /<div data-composition-id="scene"[^>]*><\/div>/,
    `<div data-composition-id="scene" data-composition-src="${src}" data-start="0" data-duration="2"></div>`.repeat(
      count,
    ),
  );

/** A sub-composition that mounts `src` `count` times, as a bare fragment or inside a `<template>`. */
const sceneMounting = (id: string, src: string, count: number, template = true) => {
  const root = `<div data-composition-id="${id}">${`<div data-composition-src="${src}"></div>`.repeat(count)}</div>`;
  return template ? `<template>${root}</template>` : root;
};

/** Seven files, each mounting the next one ten times. */
function fanOut(template: boolean): Record<string, string> {
  const files: Record<string, string> = { "index.html": rootMounting("level-0.html", 10) };
  for (let level = 0; level < 6; level += 1) {
    files[`level-${level}.html`] = sceneMounting(
      `level-${level}`,
      `level-${level + 1}.html`,
      10,
      template,
    );
  }
  files["level-6.html"] = SCENE;
  return files;
}

describe("composition expansion budget", () => {
  it.each([
    ["bare fragments", false],
    ["templates", true],
  ])(
    "refuses small files that mount each other many times, as %s, before compiling",
    async (_, template) => {
      const error = await compileError(project(fanOut(template)));
      expect(extractSafeRenderErrorCode(error)).toBe("COMPOSITION_TOO_LARGE");
      expect(String(error)).toContain("10001 mounts");
      expect(error).toMatchObject({ publicMetadata: { mounts: 10_001, exceeded: "mounts" } });
    },
  );

  it("refuses one large file mounted many times", async () => {
    const big = Math.ceil(MAX_EXPANDED_COMPOSITION_BYTES / 4) + 1;
    const dir = project({
      "index.html": rootMounting("scene.html", 4),
      "scene.html": paddedTo(SCENE, big),
    });
    const error = await compileError(dir);
    expect(extractSafeRenderErrorCode(error)).toBe("COMPOSITION_TOO_LARGE");
    expect(String(error)).toContain('"scene.html"');
  });

  it("leaves a missing mount inside a template to the inliner's warning, as before", async () => {
    const dir = project({
      "index.html": rootMounting("wrapper.html", 1),
      "wrapper.html": `<template><div data-composition-id="wrapper"><h1>Kept</h1><div data-composition-src="missing.html"></div></div></template>`,
    });
    const compiled = await compileForRender(dir, join(dir, "index.html"), dir);
    expect(compiled.html).toContain("<h1>Kept</h1>");
  });

  it("still compiles a scene mounted a few times, once per mount", async () => {
    const dir = project({
      "index.html": rootMounting("wrapper.html", 3),
      "wrapper.html": sceneMounting("wrapper", "scene.html", 2),
      "scene.html": SCENE,
    });
    const compiled = await compileForRender(dir, join(dir, "index.html"), dir);
    expect(compiled.html.split("<h1>Scene</h1>").length - 1).toBe(6);
  });

  it("refuses a mount whose tiny scripts would each be wrapped in kilobytes of scoping code", async () => {
    const scripts = `<script>window.n = (window.n || 0) + 1;</script>`.repeat(3_000);
    const dir = project({
      "index.html": rootMounting("scene.html", 1),
      "scene.html": SCENE.replace("<h1>Scene</h1>", `<h1>Scene</h1>${scripts}`),
    });
    const error = await compileError(dir);
    expect(extractSafeRenderErrorCode(error)).toBe("COMPOSITION_TOO_LARGE");
    expect(error).toMatchObject({ publicMetadata: { exceeded: "generated" } });
    // Charged as each wrapper is built, so building stops one wrapper past the limit.
    const { bytes } = (error as { publicMetadata: { bytes: number } }).publicMetadata;
    expect(bytes - MAX_EXPANDED_COMPOSITION_BYTES).toBeLessThan(64 * 1024);
  });

  it("refuses a long host id over many style rules before building the scoped sheet", async () => {
    const id = `s${"x".repeat(20_000)}`;
    const rules = Array.from({ length: 2_000 }, (_, i) => `.r${i}{color:red}`).join("");
    const dir = project({
      "index.html": ROOT.replace("<html>", "<html><head></head>").replace(
        'data-composition-id="scene"',
        `data-composition-id="${id}"`,
      ),
      "scene.html": SCENE.replace("<h1>Scene</h1>", `<style>${rules}</style><h1>Scene</h1>`),
    });
    const error = await compileError(dir);
    expect(extractSafeRenderErrorCode(error)).toBe("COMPOSITION_TOO_LARGE");
    expect(error).toMatchObject({ publicMetadata: { exceeded: "generated" } });
    // Each rule reserves its upper bound first, so no rule is scoped past the limit.
    const { bytes } = (error as { publicMetadata: { bytes: number } }).publicMetadata;
    expect(bytes - MAX_EXPANDED_COMPOSITION_BYTES).toBeLessThan(10 * id.length);
  });

  it("reserves the separator a scoped selector list is re-joined with", async () => {
    const selectors = Array.from({ length: 2_000 }, (_, i) => `.r${i}`).join(",");
    const sheet = `.first,${" ".repeat(20_000)}${selectors}{color:red}`;
    const dir = project({
      "index.html": ROOT.replace("<html>", "<html><head></head>"),
      "scene.html": SCENE.replace("<h1>Scene</h1>", `<style>${sheet}</style><h1>Scene</h1>`),
    });
    const error = await compileError(dir);
    expect(extractSafeRenderErrorCode(error)).toBe("COMPOSITION_TOO_LARGE");
    expect(error).toMatchObject({ publicMetadata: { exceeded: "generated" } });
  });

  it("compiles scenes with ordinary scripts and styles", async () => {
    const scene = SCENE.replace(
      "<h1>Scene</h1>",
      `<style>h1{color:red}.a,.b{margin:0}</style><h1>Scene</h1><script>window.ready = true;</script>`,
    );
    const dir = project({
      "index.html": rootMounting("wrapper.html", 3),
      "wrapper.html": sceneMounting("wrapper", "scene.html", 20),
      "scene.html": scene,
    });
    const compiled = await compileForRender(dir, join(dir, "index.html"), dir);
    expect(compiled.html.split("<h1>Scene</h1>").length - 1).toBe(60);
  });
});
