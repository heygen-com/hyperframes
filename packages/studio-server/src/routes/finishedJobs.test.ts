import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerMediaRoutes } from "./media";
import { registerRenderRoutes } from "./render";
import type { MediaProcessingJobState, RenderJobState, StudioApiAdapter } from "../types";

const MINUTE = 60_000;
const dirs: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function adapterFor(project: string, extra: Partial<StudioApiAdapter>): StudioApiAdapter {
  return {
    listProjects: () => [],
    resolveProject: async (id: string) => ({ id, dir: project }),
    bundle: async () => null,
    lint: async () => ({ findings: [] }),
    runtimeUrl: "/api/runtime.js",
    rendersDir: () => join(project, "renders"),
    startRender: (opts) => ({
      id: opts.jobId,
      status: "rendering",
      progress: 0,
      outputPath: opts.outputPath,
    }),
    ...extra,
  };
}

/** The progress route's status for a job: 200 while the server still has it, 404 once it is forgotten. */
async function progressStatus(app: Hono, path: string): Promise<number> {
  const response = await app.request(`http://localhost${path}`);
  await response.body?.cancel();
  return response.status;
}

const project = () => {
  const dir = mkdtempSync(join(tmpdir(), "hf-finished-jobs-"));
  dirs.push(dir);
  return dir;
};

describe("a finished job stays readable after it finishes, however long it ran", () => {
  it("keeps a render that ran 6 minutes for the sweep after it finished, then forgets it", async () => {
    vi.useFakeTimers();
    const app = new Hono();
    let job: RenderJobState | undefined;
    registerRenderRoutes(
      app,
      adapterFor(project(), {
        startRender: (opts) =>
          (job = { id: opts.jobId, status: "rendering", progress: 0, outputPath: opts.outputPath }),
      }),
    );
    const started = await app.request("http://localhost/projects/demo/render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fps: 30, quality: "standard", format: "mp4" }),
    });
    const { jobId } = (await started.json()) as { jobId: string };
    const progress = `/render/${jobId}/progress`;

    await vi.advanceTimersByTimeAsync(6 * MINUTE);
    Object.assign(job!, { status: "complete", progress: 100 });
    await vi.advanceTimersByTimeAsync(MINUTE + 1_000);
    expect(await progressStatus(app, progress)).toBe(200);

    await vi.advanceTimersByTimeAsync(6 * MINUTE);
    expect(await progressStatus(app, progress)).toBe(404);
  });

  it("keeps a background removal that ran 6 minutes for the TTL after it finished", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const dir = project();
    mkdirSync(join(dir, "assets"), { recursive: true });
    writeFileSync(join(dir, "assets", "clip.mp4"), "video");
    let job: MediaProcessingJobState | undefined;
    const app = new Hono();
    registerMediaRoutes(
      app,
      adapterFor(dir, {
        startBackgroundRemoval: (opts) =>
          (job = {
            id: opts.jobId,
            status: "processing",
            progress: 0,
            inputAssetPath: opts.inputAssetPath,
            outputAssetPath: opts.outputAssetPath,
            outputPath: opts.outputPath,
          }),
      }),
    );
    const started = await app.request("http://localhost/projects/demo/media/remove-background", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inputPath: "assets/clip.mp4" }),
    });
    const { jobId } = (await started.json()) as { jobId: string };
    const progress = `/media-jobs/${jobId}/progress`;

    vi.setSystemTime(Date.now() + 6 * MINUTE);
    Object.assign(job!, { status: "complete", progress: 100 });
    expect(await progressStatus(app, progress)).toBe(200);
    vi.setSystemTime(Date.now() + MINUTE);
    expect(await progressStatus(app, progress)).toBe(200);

    vi.setSystemTime(Date.now() + 5 * MINUTE);
    expect(await progressStatus(app, progress)).toBe(404);
  });
});
