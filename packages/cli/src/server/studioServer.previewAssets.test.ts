import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { createStudioServer, type StudioServer } from "./studioServer.js";

const COMPOSITION = `<!doctype html>
<html><head><style>@font-face{font-family:Brand;src:url(assets/brand.ttf)}</style></head>
<body><div id="root" data-composition-id="main" data-width="320" data-height="180">
<img id="pic" src="assets/pic.png" data-start="0" data-duration="1">
<img id="again" src="assets/pic.png" data-start="1" data-duration="1">
</div></body></html>`;

let root: string;
let server: StudioServer;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(tmpdir(), "hf-preview-assets-"));
  fs.mkdirSync(path.join(root, "assets"));
  fs.writeFileSync(path.join(root, "index.html"), COMPOSITION);
  fs.writeFileSync(path.join(root, "assets", "pic.png"), Buffer.alloc(4096, 7));
  fs.writeFileSync(path.join(root, "assets", "brand.ttf"), Buffer.alloc(1024, 3));
  server = createStudioServer({ projectDir: root, projectName: "film" });
});

afterEach(() => {
  server.watcher.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("studio preview document", () => {
  it("keeps image and font URLs instead of inlining them as base64", async () => {
    const response = await server.app.request("/api/projects/film/preview");
    const html = await response.text();

    expect(response.status).toBe(200);
    // Served by the bundler, not the raw-HTML fallback, so the assertions below mean something.
    expect(html).toContain('data-hyperframes-preview-runtime="1" src="/api/runtime.js"');
    expect(html).not.toContain("base64,");
    expect(html.match(/src="assets\/pic\.png"/g)).toHaveLength(2);
    expect(html).toContain("url(assets/brand.ttf)");
    // The kept URL resolves against the preview's <base href> through the asset route.
    expect(html).toContain('<base href="/api/projects/film/preview/">');
    const asset = await server.app.request("/api/projects/film/preview/assets/pic.png");
    expect(asset.status).toBe(200);
    expect(asset.headers.get("Content-Type")).toBe("image/png");
    expect(Buffer.from(await asset.arrayBuffer())).toEqual(Buffer.alloc(4096, 7));
  });
});
