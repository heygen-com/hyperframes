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
import type { RenderJobState, StudioApiAdapter } from "../types";

type StartOpts = Parameters<StudioApiAdapter["startRender"]>[0];

describe("directory (PNG-sequence) renders", () => {
  const roots: string[] = [];

  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function writeSequence(dir: string, frames = 2, audio = true): void {
    mkdirSync(dir, { recursive: true });
    for (let index = 0; index < frames; index += 1) {
      writeFileSync(join(dir, `frame_${String(index).padStart(6, "0")}.png`), "png");
    }
    if (audio) writeFileSync(join(dir, "audio.m4a"), "aac");
  }

  function fixture(start?: (opts: StartOpts) => RenderJobState) {
    const projectDir = mkdtempSync(join(tmpdir(), "hf-render-dir-"));
    roots.push(projectDir);
    const project = { id: "proj", dir: projectDir };
    const rendersDir = join(projectDir, "renders");
    mkdirSync(rendersDir);
    const calls: StartOpts[] = [];
    const adapter: StudioApiAdapter = {
      listProjects: async () => [project],
      resolveProject: (id) => (id === project.id ? project : null),
      bundle: async () => null,
      lint: () => ({ findings: [] }),
      runtimeUrl: "/api/runtime.js",
      rendersDir: (resolved) => join(resolved.dir, "renders"),
      startRender: (opts) => {
        calls.push(opts);
        if (start) return start(opts);
        writeSequence(opts.outputPath);
        return { id: opts.jobId, status: "complete", progress: 100, outputPath: opts.outputPath };
      },
    };
    const app = new Hono();
    registerRenderRoutes(app, adapter);
    return { app, calls, project, rendersDir };
  }

  async function post(app: Hono, body: Record<string, unknown>) {
    return app.request("/projects/proj/render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function listRenders(app: Hono) {
    const response = await app.request("/projects/proj/renders");
    expect(response.status).toBe(200);
    return (await response.json()).renders as Array<Record<string, unknown>>;
  }

  it('accepts "png-sequence" and hands the adapter an extensionless directory outputPath', async () => {
    const { app, calls, rendersDir } = fixture();
    const response = await post(app, { format: "png-sequence", gpu: true });
    expect(response.status).toBe(200);
    const { jobId } = await response.json();
    expect(calls[0]?.format).toBe("png-sequence");
    expect(calls[0]?.outputPath).toBe(join(rendersDir, jobId));
    expect(calls[0]?.useGpu).toBe(false);
  });

  it("still falls back to mp4 for an unknown format", async () => {
    const { app, calls, rendersDir } = fixture((opts) => ({
      id: opts.jobId,
      status: "complete",
      progress: 100,
      outputPath: opts.outputPath,
    }));
    const { jobId } = await (await post(app, { format: "gif" })).json();
    expect(calls[0]?.format).toBe("mp4");
    expect(calls[0]?.outputPath).toBe(join(rendersDir, `${jobId}.mp4`));
  });

  it("rejects an out-of-project composition for png-sequence like any other format", async () => {
    const { app, calls } = fixture();
    const response = await post(app, { format: "png-sequence", composition: "../escape.html" });
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("lists a directory with kind, frameCount, size, and audioSidecar from the sidecar", async () => {
    const { app, rendersDir } = fixture();
    writeSequence(join(rendersDir, "seq"), 1, false);
    writeFileSync(
      join(rendersDir, "seq.meta.json"),
      JSON.stringify({ status: "complete", frameCount: 42, size: 1234, audioSidecar: true }),
    );
    writeFileSync(join(rendersDir, "clip.mp4"), "mp4-bytes");

    const renders = await listRenders(app);
    expect(renders.find((r) => r.id === "seq")).toMatchObject({
      kind: "directory",
      filename: "seq",
      frameCount: 42,
      size: 1234,
      audioSidecar: true,
    });
    const file = renders.find((r) => r.id === "clip");
    expect(file).toMatchObject({ filename: "clip.mp4", size: 9 });
    expect(file).not.toHaveProperty("kind");
    expect(file).not.toHaveProperty("frameCount");
  });

  it("falls back to a directory scan when the sidecar is missing or lacks frameCount", async () => {
    const { app, rendersDir } = fixture();
    writeSequence(join(rendersDir, "no-meta"), 3, true);
    writeSequence(join(rendersDir, "old-meta"), 2, false);
    writeFileSync(join(rendersDir, "old-meta.meta.json"), JSON.stringify({ status: "complete" }));

    const renders = await listRenders(app);
    expect(renders.find((r) => r.id === "no-meta")).toMatchObject({
      kind: "directory",
      frameCount: 3,
      size: 12,
      audioSidecar: true,
    });
    expect(renders.find((r) => r.id === "old-meta")).toMatchObject({
      frameCount: 2,
      size: 6,
      audioSidecar: false,
    });
  });

  it("ignores dot-prefixed staging dirs, unrelated folders, and symlinked directories", async (context) => {
    const { app, project, rendersDir } = fixture();
    writeSequence(join(rendersDir, ".seq.staging-1"));
    mkdirSync(join(rendersDir, "scratch"));
    writeFileSync(join(rendersDir, "scratch", "notes.txt"), "x");
    const outside = join(project.dir, "elsewhere");
    writeSequence(outside);
    let linked = true;
    try {
      symlinkSync(outside, join(rendersDir, "linked"), "dir");
    } catch {
      linked = false;
    }

    const ids = (await listRenders(app)).map((r) => r.id);
    expect(ids).not.toContain(".seq.staging-1");
    expect(ids).not.toContain("scratch");
    if (!linked) return context.skip();
    expect(ids).not.toContain("linked");
  });

  it("returns 404 from /view and streams a ZIP from /download", async () => {
    const { app } = fixture();
    const { jobId } = await (await post(app, { format: "png-sequence" })).json();

    expect((await app.request(`/render/${jobId}/view`)).status).toBe(404);
    const download = await app.request(`/render/${jobId}/download`);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("application/zip");
    expect(download.headers.get("content-disposition")).toContain(`${jobId}.zip`);
    const body = Buffer.from(await download.arrayBuffer());
    expect(body.length).toBe(Number(download.headers.get("content-length")));
    expect(body.readUInt32LE(0)).toBe(0x04034b50);
  });

  it("keeps a listed directory downloadable after a restart", async () => {
    const { app, rendersDir } = fixture();
    writeSequence(join(rendersDir, "restored"));
    await listRenders(app);
    const download = await app.request("/render/restored/download");
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("application/zip");
  });

  it("serves individual frames as image/png", async () => {
    const { app, rendersDir } = fixture();
    writeSequence(join(rendersDir, "seq"));
    const response = await app.request("/projects/proj/renders/file/seq/frame_000000.png");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect((await app.request("/projects/proj/renders/file/seq")).status).toBe(404);
  });

  describe("DELETE", () => {
    it("removes the directory, its sidecar, and the job entry", async () => {
      const { app, rendersDir } = fixture();
      const { jobId } = await (await post(app, { format: "png-sequence" })).json();
      mkdirSync(join(rendersDir, jobId, "nested"));
      writeFileSync(join(rendersDir, jobId, "nested", "x.png"), "x");
      writeFileSync(join(rendersDir, `${jobId}.meta.json`), '{"status":"complete"}');
      mkdirSync(join(rendersDir, "other", "nested"), { recursive: true });

      expect((await app.request(`/render/${jobId}`, { method: "DELETE" })).status).toBe(200);
      expect(existsSync(join(rendersDir, jobId))).toBe(false);
      expect(existsSync(join(rendersDir, `${jobId}.meta.json`))).toBe(false);
      expect(existsSync(join(rendersDir, "other", "nested"))).toBe(true);
      expect((await app.request(`/render/${jobId}/progress`)).status).toBe(404);
    });

    it("rejects an escaping symlinked directory before deleting anything", async (context) => {
      const { app, rendersDir } = fixture();
      const outside = mkdtempSync(join(tmpdir(), "hf-render-outside-"));
      roots.push(outside);
      writeFileSync(join(outside, "keep.txt"), "keep");
      writeFileSync(join(rendersDir, "evil.meta.json"), "{}");
      try {
        symlinkSync(outside, join(rendersDir, "evil"), "dir");
      } catch {
        context.skip();
        return;
      }

      expect((await app.request("/render/evil", { method: "DELETE" })).status).toBe(403);
      expect(readFileSync(join(outside, "keep.txt"), "utf-8")).toBe("keep");
      expect(existsSync(join(rendersDir, "evil.meta.json"))).toBe(true);
    });

    it("does not follow an in-project symlinked directory into a recursive delete", async (context) => {
      const { app, rendersDir } = fixture();
      const target = join(rendersDir, "real");
      writeSequence(target);
      try {
        symlinkSync(target, join(rendersDir, "alias"), "dir");
      } catch {
        context.skip();
        return;
      }
      expect((await app.request("/render/alias", { method: "DELETE" })).status).toBe(200);
      expect(existsSync(join(target, "frame_000000.png"))).toBe(true);
    });

    it("returns 409 while the render is in flight, so it cannot commit and reappear", async () => {
      let state: RenderJobState | undefined;
      const { app, rendersDir } = fixture((opts) => {
        state = { id: opts.jobId, status: "rendering", progress: 10, outputPath: opts.outputPath };
        return state;
      });
      const { jobId } = await (await post(app, { format: "png-sequence" })).json();

      expect((await app.request(`/render/${jobId}`, { method: "DELETE" })).status).toBe(409);

      // The producer commits after the refused delete; the render is still listed.
      writeSequence(join(rendersDir, jobId));
      if (state) state.status = "complete";
      expect((await listRenders(app)).map((r) => r.id)).toContain(jobId);
      expect((await app.request(`/render/${jobId}`, { method: "DELETE" })).status).toBe(200);
      expect(existsSync(join(rendersDir, jobId))).toBe(false);
    });

    it("returns 200 when the renders directory is missing", async () => {
      const { app, rendersDir } = fixture();
      rmSync(rendersDir, { recursive: true });
      expect((await app.request("/render/unknown", { method: "DELETE" })).status).toBe(200);
      expect(existsSync(rendersDir)).toBe(false);
    });
  });
});
