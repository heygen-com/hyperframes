// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { MAX_COMPOSITION_HTML_BYTES, MAX_EXPANDED_COMPOSITION_BYTES } from "./compositionSizeLimit";
import { bundleToSingleHtml } from "./htmlBundler";

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-bundle-budget-"));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

const mounts = (src: string, count: number) =>
  `<div data-composition-id="scene" data-composition-src="${src}" data-start="0" data-duration="2"></div>`.repeat(
    count,
  );

const root = (body: string) => `<!doctype html><html><body>
<div data-composition-id="main" data-width="320" data-height="180" data-start="0" data-duration="2">
${body}
</div>
<script>window.__timelines = {};</script>
</body></html>`;

const scene = (body: string) =>
  `<template><div data-composition-id="scene" data-width="320" data-height="180">${body}</div></template>`;

const bundleError = (dir: string, onRead?: (path: string) => void) =>
  bundleToSingleHtml(dir, { inlineAssets: false, onRead }).then(
    () => undefined,
    (error: unknown) => error,
  );

describe("preview bundle expansion budget", () => {
  it("refuses small files that mount each other past the mount limit, reading each file once", async () => {
    // Four levels of ten: 11,110 mounts from five small files.
    const files: Record<string, string> = { "index.html": root(mounts("level-0.html", 10)) };
    for (let level = 0; level < 3; level += 1) {
      files[`level-${level}.html`] = scene(mounts(`level-${level + 1}.html`, 10));
    }
    files["level-3.html"] = scene("<h1>Leaf</h1>");
    const dir = project(files);
    const reads: string[] = [];

    const error = await bundleError(dir, (path) => reads.push(path));

    expect(error).toMatchObject({
      code: "COMPOSITION_TOO_LARGE",
      publicMetadata: { exceeded: "mounts" },
    });
    expect(String(error)).toContain("Mount large or repeated scenes fewer times");
    expect(reads.filter((path) => path.endsWith(".html")).length).toBe(5);
  }, 30_000);

  it("refuses one large file mounted past the byte limit", async () => {
    const big = scene(`<p>${"x".repeat(Math.ceil(MAX_EXPANDED_COMPOSITION_BYTES / 5))}</p>`);
    const dir = project({ "index.html": root(mounts("big.html", 6)), "big.html": big });

    const error = await bundleError(dir);

    expect(error).toMatchObject({
      code: "COMPOSITION_TOO_LARGE",
      publicMetadata: { exceeded: "bytes" },
    });
  });

  it("refuses mounts that copy more elements than the limit", async () => {
    const dir = project({
      "index.html": root(mounts("scene.html", 60)),
      "scene.html": scene("<i></i>".repeat(2_000)),
    });

    const error = await bundleError(dir);

    expect(error).toMatchObject({
      code: "COMPOSITION_TOO_LARGE",
      publicMetadata: { exceeded: "elements" },
    });
  });

  it("refuses scripts and styles generated for mounts past the limit", async () => {
    const scripts = `<script>window.n = (window.n || 0) + 1;</script>`.repeat(
      Math.ceil(MAX_EXPANDED_COMPOSITION_BYTES / 10_000),
    );
    const dir = project({
      "index.html": root(mounts("scene.html", 1)),
      "scene.html": scene(scripts),
    });

    const error = await bundleError(dir);

    expect(error).toMatchObject({
      code: "COMPOSITION_TOO_LARGE",
      publicMetadata: { exceeded: "generated" },
    });
  });

  it("refuses a sub-composition file over the per-file limit before reading it", async () => {
    const dir = project({
      "index.html": root(mounts("huge.html", 1)),
      "huge.html": "x".repeat(MAX_COMPOSITION_HTML_BYTES + 1),
    });

    const error = await bundleError(dir);

    expect(error).toMatchObject({ code: "COMPOSITION_TOO_LARGE" });
    expect(String(error)).toContain('Composition file "huge.html"');
  });

  it("still bundles a scene mounted a few times, once per mount", async () => {
    const dir = project({
      "index.html": root(mounts("wrapper.html", 3)),
      "wrapper.html": scene(mounts("scene.html", 2)),
      "scene.html": scene("<h1>Scene</h1>"),
    });

    const html = await bundleToSingleHtml(dir, { inlineAssets: false });

    expect(html.split("<h1>Scene</h1>").length - 1).toBe(6);
  });
});
