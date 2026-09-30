import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerPeakRoutes } from "./peaks";
import type { StudioApiAdapter } from "../types";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup(decode: (path: string) => Promise<number[]>) {
  const dir = mkdtempSync(join(tmpdir(), "hf-peaks-route-"));
  dirs.push(dir);
  writeFileSync(join(dir, "talk.mp4"), "video");
  const adapter: StudioApiAdapter = {
    listProjects: () => [],
    resolveProject: async (id: string) => ({ id, dir }),
    bundle: async () => null,
    lint: async () => ({ findings: [] }),
    runtimeUrl: "/api/runtime.js",
    rendersDir: () => "/tmp/renders",
    startRender: () => ({ id: "j", status: "rendering", progress: 0, outputPath: "/tmp/o.mp4" }),
  };
  const app = new Hono();
  registerPeakRoutes(app, adapter, decode);
  return app;
}

describe("GET /projects/:id/peaks/*", () => {
  it("answers absolute bins once per file and serves the cache after", async () => {
    const decode = vi.fn(async () => [0.2, 0.99]);
    const app = setup(decode);
    for (let i = 0; i < 2; i++) {
      const res = await app.request("http://localhost/projects/p/peaks/talk.mp4");
      expect(await res.json()).toEqual({ binSeconds: 0.05, bins: [0.2, 0.99] });
    }
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it("404s a missing file and a path outside the project", async () => {
    const app = setup(async () => []);
    expect((await app.request("http://localhost/projects/p/peaks/nope.mp4")).status).toBe(404);
    expect(
      (await app.request("http://localhost/projects/p/peaks/..%2F..%2Fetc%2Fpasswd")).status,
    ).toBe(404);
  });
});
