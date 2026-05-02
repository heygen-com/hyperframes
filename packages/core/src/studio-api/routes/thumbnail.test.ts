import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, rmSync } from "node:fs";
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
        format: "jpeg",
      }),
    );
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
      }),
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
});
