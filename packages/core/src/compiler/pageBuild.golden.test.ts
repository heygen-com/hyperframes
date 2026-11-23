// @vitest-environment node
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { BundleOptions } from "./htmlBundler";

// A project shaped like a heavy film: scenes mounted many times with their own variables, a
// nested scene, a <template> scene, url()s through a symlink and to a missing file, and a
// Google font. The goldens are the pages this project built before a build reused anything
// across mounts; any change that is meant to alter the page updates them (vitest -u).
const goldens = join(dirname(fileURLToPath(import.meta.url)), "__goldens__");

const CARD = `<!doctype html>
<html data-composition-variables='[{"id":"accent","type":"color","default":"#ff3366"},{"id":"title","type":"string","default":"Card"},{"id":"size","type":"number","default":48}]'>
<head>
<style>
html, body { margin: 0; }
#card-root { position: relative; background: url(../assets/tile.png); }
#card-root .title { color: var(--accent); font-size: calc(var(--size) * 1px); font-family: "Fixture Slab", serif; }
.row .cell { background-image: url(grain.png), url("../assets/linked.png"); }
.row .gap { cursor: url(../assets/missing.png), auto; }
[data-composition-id="card"][data-start="0"] .intro { opacity: 0; }
[data-composition-id="card"] .frame:hover, .frame > .cell::before { content: "→"; }
.a /* a comment */ .b { color: blue; }
@keyframes card-pulse { from { opacity: 0.2; } to { opacity: 1; } }
@media (min-width: 100px) { .frame .wide { display: block; } }
@font-face { font-family: "Card Local"; src: url(../assets/tile.png); }
</style>
</head>
<body>
<div id="card-root" data-composition-id="card" data-width="320" data-height="180" class="frame">
  <h1 class="title intro">Title</h1>
  <img src="../assets/linked.png" alt="">
  <svg width="10" height="10"><clipPath id="clip"><rect width="5" height="5"/></clipPath><rect clip-path="url(#clip)" width="10" height="10"/></svg>
  <div class="row" style="background: url(../assets/linked.png) no-repeat"><span class="cell">Cell</span><span class="gap"></span></div>
  <div class="nested" data-composition-id="badge" data-composition-src="compositions/badge.html" data-start="0" data-duration="1"></div>
</div>
<script>
  (function () {
    var root = document.querySelector('[data-composition-id="card"]');
    window.__timelines = window.__timelines || {};
    window.__timelines.card = gsap.timeline({ paused: true }).from(root.querySelector(".title"), { opacity: 0 });
  })();
</script>
</body>
</html>`;

const BADGE = `<template id="badge-template">
  <div data-composition-id="badge" data-width="80" data-height="40">
    <span class="label">New</span>
    <style>.label { color: var(--tone, gold); background: url(../assets/tile.png); }</style>
  </div>
</template>`;

const SOLO = `<!doctype html><html><head><style>
.solo { color: teal; background: url(grain.png); }
</style></head><body>
<div data-composition-id="solo" data-width="320" data-height="180"><p class="solo">Solo</p></div>
</body></html>`;

function writeProject(dir: string): void {
  mkdirSync(join(dir, "compositions"), { recursive: true });
  mkdirSync(join(dir, "assets", "real"), { recursive: true });
  writeFileSync(join(dir, "assets", "tile.png"), "tile-png");
  writeFileSync(join(dir, "assets", "real", "linked.png"), "linked-png");
  // Windows needs a privilege to create symlinks; a copy builds the same page.
  const link = join(dir, "assets", "linked.png");
  if (process.platform === "win32") copyFileSync(join(dir, "assets", "real", "linked.png"), link);
  else symlinkSync(join("real", "linked.png"), link);
  writeFileSync(join(dir, "compositions", "grain.png"), "grain-png");
  writeFileSync(join(dir, "compositions", "card.html"), CARD);
  writeFileSync(join(dir, "compositions", "badge.html"), BADGE);
  writeFileSync(join(dir, "compositions", "solo.html"), SOLO);
  const cards = [1, 2, 3].map(
    (n) =>
      `<div class="clip" data-composition-id="card" data-composition-src="compositions/card.html" data-start="${n * 2}" data-duration="2" data-track-index="${n % 2}" data-variable-values='{"accent":"#00000${n}","title":"Card ${n}","size":${40 + n}}'></div>`,
  );
  writeFileSync(
    join(dir, "index.html"),
    `<!doctype html>
<html lang="en">
<head>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fixture+Slab:wght@400;700&display=swap">
<style>body { margin: 0; font-family: "Fixture Slab", serif; }</style>
</head>
<body>
<div id="main" data-composition-id="main" data-width="320" data-height="180" data-start="0" data-duration="12">
${cards.join("\n")}
<div class="clip" data-composition-id="solo" data-composition-src="compositions/solo.html" data-start="10" data-duration="2"></div>
<div class="clip" data-composition-id="badge" data-composition-src="compositions/badge.html" data-start="0" data-duration="1" data-variable-values='{"tone":"silver"}'></div>
</div>
<script>window.__timelines = window.__timelines || {}; window.__timelines.main = gsap.timeline({ paused: true });</script>
</body>
</html>`,
  );
}

const FACE_URL = "https://fonts.gstatic.com/s/fixtureslab/v1/latin.woff2";
const fontsFromGoogle = (async (input: unknown) => {
  const url = String(input);
  if (url.includes("css2"))
    return new Response(
      `@font-face { font-family: 'Fixture Slab'; font-style: normal; font-weight: 400; src: url(${FACE_URL}) format('woff2'); unicode-range: U+0000-00FF; }`,
      { status: 200 },
    );
  if (url === FACE_URL) return new Response("FIXTURE_SLAB", { status: 200 });
  return new Response("", { status: 404 });
}) as unknown as typeof fetch;
const offline = vi.fn(async (input: unknown): Promise<Response> => {
  throw new TypeError(`fetch failed: ${String(input)}`);
});

const PREVIEW: BundleOptions = {
  runtime: "placeholder",
  inlineAssets: false,
  staticGuard: false,
  sceneParts: true,
  stampHfIds: true,
  onRead: () => {},
};
const RENDER: BundleOptions = { runtime: "placeholder", staticGuard: false };

let project: string;
let fontCache: string;
let previousFontCache: string | undefined;

beforeAll(() => {
  project = mkdtempSync(join(tmpdir(), "hf-page-build-golden-"));
  fontCache = mkdtempSync(join(tmpdir(), "hf-page-build-fonts-"));
  previousFontCache = process.env.HYPERFRAMES_FONT_CACHE_DIR;
  process.env.HYPERFRAMES_FONT_CACHE_DIR = fontCache;
  writeProject(project);
});

afterAll(() => {
  if (previousFontCache === undefined) delete process.env.HYPERFRAMES_FONT_CACHE_DIR;
  else process.env.HYPERFRAMES_FONT_CACHE_DIR = previousFontCache;
  rmSync(project, { recursive: true, force: true });
  rmSync(fontCache, { recursive: true, force: true });
});

// A fresh copy of the modules is a new process: nothing held in memory, the font cache on disk kept.
async function buildPage(options: BundleOptions, fetchImpl: typeof fetch): Promise<string> {
  vi.resetModules();
  const { bundleToSingleHtml } = await import("./htmlBundler");
  const { injectDeterministicFontFaces } = await import("../fonts/deterministicFonts");
  const quiet = { warn: () => {}, info: () => {} };
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const bundled = await bundleToSingleHtml(project, options);
    return await injectDeterministicFontFaces(bundled, { fetchImpl, logger: quiet });
  } finally {
    warn.mockRestore();
  }
}

describe.each([
  { name: "preview", options: PREVIEW },
  { name: "render", options: RENDER },
])("the $name page of a project with repeated scenes", ({ name, options }) => {
  it("is the page the build made before it reused work across mounts", async () => {
    await expect(await buildPage(options, fontsFromGoogle)).toMatchFileSnapshot(
      join(goldens, `pageBuild.${name}.html`),
    );
  });

  it("is the same page from a new process offline, once the font cache is warm", async () => {
    const online = await buildPage(options, fontsFromGoogle);
    offline.mockClear();
    const again = await buildPage(options, offline as unknown as typeof fetch);
    expect(offline).not.toHaveBeenCalled();
    expect(again).toBe(online);
  });
});
