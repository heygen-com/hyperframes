import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerThumbnailRoutes } from "./thumbnail";
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
});
