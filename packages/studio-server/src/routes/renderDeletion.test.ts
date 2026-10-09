import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerRenderRoutes } from "./render";
import type { StudioApiAdapter } from "../types";

describe("DELETE /render/:jobId", () => {
  const roots: string[] = [];

  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    roots.length = 0;
  });

  function fixture() {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-render-delete-"));
    roots.push(projectDir);
    const project = { id: "project_with_underscores", dir: projectDir };
    const rendersDir = join(projectDir, "renders");
    mkdirSync(rendersDir);
    const listProjects = vi.fn(async () => [project]);
    const adapter: StudioApiAdapter = {
      listProjects,
      resolveProject: (id) => (id === project.id ? project : null),
      bundle: async () => null,
      lint: () => ({ findings: [] }),
      runtimeUrl: "/api/runtime.js",
      rendersDir: (resolved) => join(resolved.dir, "renders"),
      startRender: (opts) => {
        writeFileSync(opts.outputPath, "render-bytes");
        writeFileSync(join(rendersDir, `${opts.jobId}.meta.json`), '{"status":"complete"}');
        return {
          id: opts.jobId,
          status: "complete",
          progress: 100,
          outputPath: opts.outputPath,
        };
      },
    };
    const app = new Hono();
    registerRenderRoutes(app, adapter);
    return { app, listProjects, project, rendersDir };
  }

  async function startRender(app: Hono): Promise<string> {
    const response = await app.request("/projects/project_with_underscores/render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ format: "mp4" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    if (typeof body.jobId !== "string") throw new Error("Render did not return a job ID");
    return body.jobId;
  }

  async function deleteRender(app: Hono, jobId: string) {
    return app.request(`/render/${encodeURIComponent(jobId)}`, { method: "DELETE" });
  }

  it("deletes a cached render and its metadata even when the project is no longer listed", async () => {
    const { app, rendersDir, listProjects } = fixture();
    const jobId = await startRender(app);
    listProjects.mockResolvedValue([]);

    expect((await deleteRender(app, jobId)).status).toBe(200);
    expect(existsSync(join(rendersDir, `${jobId}.mp4`))).toBe(false);
    expect(existsSync(join(rendersDir, `${jobId}.meta.json`))).toBe(false);
    expect((await app.request(`/render/${jobId}/progress`)).status).toBe(404);
  });

  it("deletes expired artifacts permanently while preserving other renders on reload", async () => {
    const { app, rendersDir } = fixture();
    const jobId = await startRender(app);
    for (const ext of ["webm", "mov"]) {
      writeFileSync(join(rendersDir, `${jobId}.${ext}`), "another-format");
    }
    writeFileSync(join(rendersDir, "keep.mp4"), "other-render");

    vi.advanceTimersByTime(360_000);
    expect((await app.request(`/render/${jobId}/progress`)).status).toBe(404);
    expect(existsSync(join(rendersDir, `${jobId}.mp4`))).toBe(true);

    expect((await deleteRender(app, jobId)).status).toBe(200);
    for (const ext of ["mp4", "webm", "mov", "meta.json"]) {
      expect(existsSync(join(rendersDir, `${jobId}.${ext}`))).toBe(false);
    }
    expect(readFileSync(join(rendersDir, "keep.mp4"), "utf-8")).toBe("other-render");
    const history = await app.request("/projects/project_with_underscores/renders");
    expect(history.status).toBe(200);
    expect((await history.json()).renders).toEqual([expect.objectContaining({ id: "keep" })]);
    expect((await deleteRender(app, jobId)).status).toBe(200);
  });

  it("returns success without recreating a missing render directory", async () => {
    const { app, rendersDir } = fixture();
    rmSync(rendersDir, { recursive: true });
    expect((await deleteRender(app, "unknown")).status).toBe(200);
    expect(existsSync(rendersDir)).toBe(false);
  });

  it("cannot use a job ID to delete an arbitrary nested file within the render directory", async () => {
    const { app, rendersDir } = fixture();
    mkdirSync(join(rendersDir, "nested"));
    const nestedFile = join(rendersDir, "nested", "keep.mp4");
    writeFileSync(nestedFile, "preserve");

    expect((await deleteRender(app, "nested/keep")).status).toBe(403);
    expect(readFileSync(nestedFile, "utf-8")).toBe("preserve");
  });

  it("rejects escaping artifact symlinks before deleting anything", async (context) => {
    const { app, project, rendersDir } = fixture();
    const jobId = "disk-only";
    writeFileSync(join(rendersDir, `${jobId}.mp4`), "render-bytes");
    const outside = join(project.dir, "outside.json");
    writeFileSync(outside, "preserve");
    const metaPath = join(rendersDir, `${jobId}.meta.json`);
    try {
      symlinkSync(outside, metaPath, "file");
    } catch {
      // Windows runners may not have permission to create symlinks.
      context.skip();
      return;
    }

    expect((await deleteRender(app, jobId)).status).toBe(403);
    expect(readFileSync(outside, "utf-8")).toBe("preserve");
    expect(readFileSync(join(rendersDir, `${jobId}.mp4`), "utf-8")).toBe("render-bytes");
    expect(existsSync(metaPath)).toBe(true);
  });
});
