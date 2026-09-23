import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { createStudioServer, type StudioServer } from "./studioServer.js";
import { cleanupStudioServerRoot, makeStudioServerRoot } from "./studioServerTestFixture.js";

const COMPOSITION = `<!doctype html>
<html><head><style>@font-face{font-family:Brand;src:url(assets/brand.ttf)}</style></head>
<body><div id="root" data-composition-id="main" data-width="320" data-height="180">
<img id="pic" src="assets/pic.png" data-start="0" data-duration="1">
<img id="again" src="assets/pic.png" data-start="1" data-duration="1">
<img id="responsive" src="assets/pic.png" srcset="assets/pic.png 1x, assets/pic@2x.png 2x" data-start="0" data-duration="1">
<video id="clip" src="assets/clip.mp4" poster="assets/pic.png" muted data-start="0" data-duration="1"></video>
<div id="scene-host" data-composition-id="scene" data-composition-src="compositions/scene.html" data-start="0" data-duration="1"></div>
</div></body></html>`;

const SCENE = `<template id="scene-template">
  <div data-composition-id="scene" data-width="320" data-height="180">
    <img id="nested" src="../assets/pic@2x.png">
  </div>
</template>`;

const PIC = Buffer.alloc(4096, 7);
const PIC_2X = Buffer.alloc(8192, 9);

let root: string;
let projectDir: string;
let server: StudioServer;

beforeEach(() => {
  ({ root, projectDir } = makeStudioServerRoot("hf-preview-assets-"));
  fs.mkdirSync(path.join(projectDir, "assets"));
  fs.mkdirSync(path.join(projectDir, "compositions"));
  fs.writeFileSync(path.join(projectDir, "index.html"), COMPOSITION);
  fs.writeFileSync(path.join(projectDir, "compositions", "scene.html"), SCENE);
  fs.writeFileSync(path.join(projectDir, "assets", "pic.png"), PIC);
  fs.writeFileSync(path.join(projectDir, "assets", "pic@2x.png"), PIC_2X);
  fs.writeFileSync(path.join(projectDir, "assets", "brand.ttf"), Buffer.alloc(1024, 3));
  fs.writeFileSync(path.join(projectDir, "assets", "clip.mp4"), Buffer.alloc(1024, 5));
  server = createStudioServer({ projectDir, projectName: "film" });
});

afterEach(() => {
  cleanupStudioServerRoot(server, root);
});

async function fetchAsset(url: string): Promise<Buffer> {
  const response = await server.app.request(`/api/projects/film/preview/${url}`);
  expect(response.status).toBe(200);
  return Buffer.from(await response.arrayBuffer());
}

describe("studio preview document", () => {
  it("keeps every asset URL instead of inlining it as base64", async () => {
    const response = await server.app.request("/api/projects/film/preview");
    const html = await response.text();

    expect(response.status).toBe(200);
    // Served by the bundler, not the raw-HTML fallback, so the assertions below mean something.
    expect(html).toContain('data-hyperframes-preview-runtime="1" src="/api/runtime.js"');
    expect(html).not.toContain("base64,");
    expect(html.match(/src="assets\/pic\.png"/g)?.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain("url(assets/brand.ttf)");
    expect(html).toContain('poster="assets/pic.png"');
    expect(html).toContain('srcset="assets/pic.png 1x, assets/pic@2x.png 2x"');
    // Kept URLs resolve against the preview's <base href> through the asset route.
    expect(html).toContain('<base href="/api/projects/film/preview/">');
    expect(await fetchAsset("assets/pic.png")).toEqual(PIC);
    // Scenes stay separate files the runtime fetches, so the first scene can play before the rest.
    expect(html).toContain('data-composition-src="compositions/scene.html"');
    expect(html).not.toContain('id="nested"');
    const scene = (await fetchAsset("compositions/scene.html")).toString("utf-8");
    expect(scene.match(/<img [^>]*id="nested" src="([^"]+)"/)?.[1]).toBe("../assets/pic@2x.png");
    expect(await fetchAsset("assets/pic@2x.png")).toEqual(PIC_2X);
  });

  it("tags no asset a copy tool just rewrote with its old mtime", async () => {
    const clip = path.join(projectDir, "assets", "clip.mp4");
    fs.writeFileSync(clip, Buffer.alloc(1024, 6));
    const copied = new Date("2026-01-01T00:00:00Z");
    fs.utimesSync(clip, copied, copied);

    const response = await server.app.request("/api/projects/film/preview/assets/clip.mp4");

    expect(response.status).toBe(200);
    expect(response.headers.get("ETag")).toBeNull();
  });
});
