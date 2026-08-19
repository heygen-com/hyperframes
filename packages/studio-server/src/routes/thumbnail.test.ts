import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pruneThumbnailCache, registerThumbnailRoutes } from "./thumbnail";
import type { StudioApiAdapter } from "../types";

const tempProjectDirs: string[] = [];

afterEach(() => {
  for (const dir of tempProjectDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createAdapter(): StudioApiAdapter {
  const projectDir = mkdtempSync(join(tmpdir(), "hf-thumbnail-test-"));
  tempProjectDirs.push(projectDir);

  return {
    listProjects: () => [],
    resolveProject: async (id: string) => ({ id, dir: projectDir }),
    bundle: async () => null,
    lint: async () => ({ findings: [] }),
    runtimeUrl: "/api/runtime.js",
    rendersDir: () => "/tmp/renders",
    startRender: () => ({
      id: "job-1",
      status: "rendering",
      progress: 0,
      outputPath: "/tmp/out.mp4",
    }),
    generateThumbnail: vi.fn(async () => Buffer.from("thumb")),
  };
}

describe("registerThumbnailRoutes", () => {
  it("forwards selector queries to thumbnail generation", async () => {
    const adapter = createAdapter();
    const app = new Hono();
    registerThumbnailRoutes(app, adapter);

    const response = await app.request(
      "http://localhost/projects/demo/thumbnail/index.html?t=1.2&selector=%23title-card",
    );

    expect(response.status).toBe(200);
    expect(adapter.generateThumbnail).toHaveBeenCalledWith(
      expect.objectContaining({
        compPath: "index.html",
        seekTime: 1.2,
        selector: "#title-card",
        format: "jpeg",
        outputWidth: 240,
        outputHeight: 135,
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("deduplicates concurrent generation and writes one complete cache entry", async () => {
    const adapter = createAdapter();
    const project = await adapter.resolveProject("demo");
    if (!project) throw new Error("missing project");
    let resolve!: (buffer: Buffer) => void;
    const generated = new Promise<Buffer>((done) => (resolve = done));
    adapter.generateThumbnail = vi.fn(async () => generated);
    const app = new Hono();
    registerThumbnailRoutes(app, adapter);

    const url = "http://localhost/projects/demo/thumbnail/index.html?t=3";
    const first = app.request(url);
    const second = app.request(url);
    await vi.waitFor(() => expect(adapter.generateThumbnail).toHaveBeenCalledTimes(1));
    resolve(Buffer.from("shared"));

    expect(await (await first).text()).toBe("shared");
    expect(await (await second).text()).toBe("shared");
    expect(adapter.generateThumbnail).toHaveBeenCalledTimes(1);
    const cached = readdirSync(join(project.dir, ".thumbnails"));
    expect(cached).toHaveLength(1);
    expect(cached[0]).not.toContain(".tmp");
  });

  it("forwards png capture requests and returns a png content type", async () => {
    const adapter = createAdapter();
    const app = new Hono();
    registerThumbnailRoutes(app, adapter);

    const response = await app.request(
      "http://localhost/projects/demo/thumbnail/compositions%2Fintro.html?t=2&format=png",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(adapter.generateThumbnail).toHaveBeenCalledWith(
      expect.objectContaining({
        compPath: "compositions/intro.html",
        seekTime: 2,
        format: "png",
        outputWidth: 1920,
        outputHeight: 1080,
      }),
    );
  });

  it("allows png callers to opt into bounded preview output", async () => {
    const adapter = createAdapter();
    const app = new Hono();
    registerThumbnailRoutes(app, adapter);

    const response = await app.request(
      "http://localhost/projects/demo/thumbnail/index.html?format=png&output=preview",
    );

    expect(response.status).toBe(200);
    expect(adapter.generateThumbnail).toHaveBeenCalledWith(
      expect.objectContaining({ outputWidth: 240, outputHeight: 135 }),
    );
  });

  it("preserves an explicit zero seek time", async () => {
    const adapter = createAdapter();
    const app = new Hono();
    registerThumbnailRoutes(app, adapter);

    const response = await app.request(
      "http://localhost/projects/demo/thumbnail/index.html?t=0&format=png",
    );

    expect(response.status).toBe(200);
    expect(adapter.generateThumbnail).toHaveBeenCalledWith(
      expect.objectContaining({
        compPath: "index.html",
        seekTime: 0,
        format: "png",
      }),
    );
  });

  it("forwards selector occurrence indexes to thumbnail generation", async () => {
    const adapter = createAdapter();
    const app = new Hono();
    registerThumbnailRoutes(app, adapter);

    const response = await app.request(
      "http://localhost/projects/demo/thumbnail/index.html?t=1.2&selector=.card&selectorIndex=2",
    );

    expect(response.status).toBe(200);
    expect(adapter.generateThumbnail).toHaveBeenCalledWith(
      expect.objectContaining({
        selector: ".card",
        selectorIndex: 2,
      }),
    );
  });

  it("keeps url thumbnail versions separated in the disk cache", async () => {
    const adapter = createAdapter();
    const app = new Hono();
    registerThumbnailRoutes(app, adapter);

    await app.request("http://localhost/projects/demo/thumbnail/index.html?t=2&v=old");
    await app.request("http://localhost/projects/demo/thumbnail/index.html?t=2&v=old");
    await app.request("http://localhost/projects/demo/thumbnail/index.html?t=2&v=new");

    expect(adapter.generateThumbnail).toHaveBeenCalledTimes(2);
  });

  it("keeps changed composition dimensions separated in the disk cache", async () => {
    const adapter = createAdapter();
    const project = await adapter.resolveProject("demo");
    if (!project) throw new Error("missing project");
    const app = new Hono();
    registerThumbnailRoutes(app, adapter);

    const indexPath = join(project.dir, "index.html");
    writeFileSync(indexPath, `<div data-composition-id="main" data-width="640" data-height="360">`);
    await app.request("http://localhost/projects/demo/thumbnail/index.html?t=2&v=test");

    writeFileSync(
      indexPath,
      `<div data-composition-id="main" data-width="1280" data-height="720">`,
    );
    await app.request("http://localhost/projects/demo/thumbnail/index.html?t=2&v=test");

    expect(adapter.generateThumbnail).toHaveBeenCalledTimes(2);
    expect(adapter.generateThumbnail).toHaveBeenLastCalledWith(
      expect.objectContaining({
        width: 1280,
        height: 720,
      }),
    );
  });

  it("keeps changed studio manual edits separated in the disk cache", async () => {
    const adapter = createAdapter();
    const project = await adapter.resolveProject("demo");
    if (!project) throw new Error("missing project");
    const app = new Hono();
    registerThumbnailRoutes(app, adapter);

    const indexPath = join(project.dir, "index.html");
    writeFileSync(indexPath, `<div data-composition-id="main" data-width="640" data-height="360">`);
    const manualEditsDir = join(project.dir, ".hyperframes");
    mkdirSync(manualEditsDir, { recursive: true });
    const manualEditsPath = join(manualEditsDir, "studio-manual-edits.json");
    writeFileSync(manualEditsPath, `{"version":1,"edits":[]}`);

    await app.request("http://localhost/projects/demo/thumbnail/index.html?t=2&v=test");
    writeFileSync(
      manualEditsPath,
      `{"version":1,"edits":[{"kind":"rotation","target":{"sourceFile":"index.html","id":"card"},"angle":30}]}`,
    );
    await app.request("http://localhost/projects/demo/thumbnail/index.html?t=2&v=test");

    expect(adapter.generateThumbnail).toHaveBeenCalledTimes(2);
  });

  it("regenerates when the composition HTML changes even with explicit w/h", async () => {
    // Repro: the Studio requests thumbnails WITH explicit dimensions. The old
    // code only read (and keyed on) the composition file when no w/h was given,
    // so editing the HTML left the disk-cache key unchanged and served a stale
    // thumbnail — even after a hard reload. The content hash must always be keyed.
    const adapter = createAdapter();
    const project = await adapter.resolveProject("demo");
    if (!project) throw new Error("missing project");
    const app = new Hono();
    registerThumbnailRoutes(app, adapter);

    const indexPath = join(project.dir, "index.html");
    const url = "http://localhost/projects/demo/thumbnail/index.html?t=2&w=640&h=360&v=test";

    writeFileSync(indexPath, `<div id="box">before</div>`);
    await app.request(url);
    writeFileSync(indexPath, `<div id="box">after</div>`);
    await app.request(url);

    expect(adapter.generateThumbnail).toHaveBeenCalledTimes(2);
  });

  it("keeps changed studio motion separated in the disk cache", async () => {
    const adapter = createAdapter();
    const project = await adapter.resolveProject("demo");
    if (!project) throw new Error("missing project");
    const app = new Hono();
    registerThumbnailRoutes(app, adapter);

    const indexPath = join(project.dir, "index.html");
    writeFileSync(indexPath, `<div data-composition-id="main" data-width="640" data-height="360">`);
    const motionDir = join(project.dir, ".hyperframes");
    mkdirSync(motionDir, { recursive: true });
    const motionPath = join(motionDir, "studio-motion.json");
    writeFileSync(motionPath, `{"version":1,"motions":[]}`);

    await app.request("http://localhost/projects/demo/thumbnail/index.html?t=2&v=test");
    writeFileSync(
      motionPath,
      `{"version":1,"motions":[{"kind":"gsap-motion","target":{"sourceFile":"index.html","id":"card"},"start":0,"duration":1,"ease":"power2.out","from":{"y":32},"to":{"y":0}}]}`,
    );
    await app.request("http://localhost/projects/demo/thumbnail/index.html?t=2&v=test");

    expect(adapter.generateThumbnail).toHaveBeenCalledTimes(2);
  });

  it("prunes expired and over-budget files without touching protected work", () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "hf-thumbnail-cache-test-"));
    tempProjectDirs.push(cacheDir);
    const expiredPath = join(cacheDir, "expired.jpg");
    const protectedPath = join(cacheDir, "protected.jpg");
    const overflowPath = join(cacheDir, "overflow.jpg");
    writeFileSync(expiredPath, "expired");
    writeFileSync(protectedPath, "protected");
    writeFileSync(overflowPath, "overflow");
    const now = Date.now();
    const expiredSeconds = (now - 15 * 24 * 60 * 60 * 1000) / 1000;
    utimesSync(expiredPath, expiredSeconds, expiredSeconds);
    truncateSync(protectedPath, 400 * 1024 * 1024);
    truncateSync(overflowPath, 200 * 1024 * 1024);

    pruneThumbnailCache(cacheDir, new Set([protectedPath]), now);

    expect(existsSync(expiredPath)).toBe(false);
    expect(existsSync(protectedPath)).toBe(true);
    expect(existsSync(overflowPath)).toBe(false);
  });
});
