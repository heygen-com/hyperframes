import {
  waitForRenderCancellation,
  cancelAndVerifyArtifacts,
} from "../../test-utils/renderCancellation";
import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type ViteDevServer } from "vite";
import { createProjectSignatureCache, createViteAdapter } from "./vite.adapter";
import { createStudioApi } from "@hyperframes/studio-server";

const producer = vi.hoisted(() => ({
  createRenderJob: vi.fn((config: Record<string, unknown>) => ({ config })),
  executeRenderJob: vi.fn(),
}));
vi.mock("@hyperframes/producer", () => producer);
vi.mock("./vite.producer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./vite.producer")>()),
  ensureProducerDist: () => ({ built: false }),
}));

const dirs: string[] = [];
let server: ViteDevServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
  vi.clearAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const RECEIVED_RENDER = fileURLToPath(
  new URL("../cli/src/utils/receivedRender.ts", import.meta.url),
);

type RenderOptions = Parameters<ReturnType<typeof createViteAdapter>["startRender"]>[0];

async function fixture(extra: Partial<RenderOptions> = {}, setup?: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "hf-vite-gif-"));
  dirs.push(dir);
  setup?.(dir);
  server = await createServer({
    configFile: false,
    // Without this, Vite scans the cwd for entry points in the background, and
    // that scan races the close() in afterEach and logs "Failed to scan for
    // dependencies" errors.
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, watch: null, ws: false },
  });
  // Loads the received-project rule before the render starts, so a cold load on CI isn't timed by the waits below.
  await server.ssrLoadModule(RECEIVED_RENDER);
  const adapter = createViteAdapter(
    dir,
    server,
    createProjectSignatureCache({ compute: () => "test" }),
  );
  const format = extra.format ?? "gif";
  const jobId = extra.jobId ?? "gif-job";
  // A directory format renders to an extensionless path, like the route builds it.
  const outputPath = join(dir, format === "png-sequence" ? jobId : `out.${format}`);
  const state = adapter.startRender({
    project: { id: "demo", dir },
    outputPath,
    format: "gif",
    gifLoop: 3,
    fps: { num: 30, den: 1 },
    quality: "draft",
    jobId,
    ...extra,
  });
  return { dir, state, outputPath, metaPath: join(dir, `${jobId}.meta.json`) };
}

function writeSequence(directory: string, frames: number): void {
  mkdirSync(directory, { recursive: true });
  for (let index = 1; index <= frames; index += 1) {
    writeFileSync(join(directory, `frame_${String(index).padStart(6, "0")}.png`), "png-bytes");
  }
  writeFileSync(join(directory, "audio.m4a"), "aac");
}

describe("Vite GIF rendering", { timeout: 30_000 }, () => {
  it("starts, lists, downloads, and deletes outputs in Vite's shared render root through the routes", async () => {
    producer.executeRenderJob.mockImplementation(async (_job, _dir, output: string) => {
      writeSequence(output, 2);
    });
    const { dir, state } = await fixture({ format: "png-sequence" });
    await vi.waitFor(() => expect(state.status).toBe("complete"));
    const dataDir = join(dir, "projects");
    mkdirSync(join(dataDir, "demo"), { recursive: true });
    writeFileSync(join(dataDir, "demo", "index.html"), "<html></html>");
    if (!server) throw new Error("Vite fixture did not start");
    const adapter = createViteAdapter(dataDir, server, createProjectSignatureCache());
    const app = createStudioApi(adapter);
    const response = await app.request("/projects/demo/render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"format":"png-sequence"}',
    });
    expect(response.status).toBe(200);
    const { jobId, filename } = await response.json();
    await vi.waitFor(() =>
      expect(existsSync(join(dir, "renders", filename, "frame_000001.png"))).toBe(true),
    );
    const history = await app.request("/projects/demo/renders");
    expect(history.status).toBe(200);
    expect((await history.json()).renders).toEqual([
      expect.objectContaining({ id: jobId, filename, frameCount: 2 }),
    ]);
    const download = await app.request(`/render/${jobId}/download`);
    expect(download.status).toBe(200);
    await download.arrayBuffer();
    expect((await app.request(`/render/${jobId}`, { method: "DELETE" })).status).toBe(200);
    expect(existsSync(join(dir, "renders", filename))).toBe(false);
  });

  it("forwards loop count and writes a sidecar without overwriting the GIF", async () => {
    producer.executeRenderJob.mockImplementation(async (_job, _dir, outputPath: string) => {
      writeFileSync(outputPath, "GIF89a");
    });
    const { state, outputPath, metaPath } = await fixture();
    await vi.waitFor(() => expect(state.status, state.error).toBe("complete"));
    expect(producer.createRenderJob).toHaveBeenCalledWith(
      expect.objectContaining({ format: "gif", gifLoop: 3 }),
    );
    expect(readFileSync(outputPath, "utf8")).toBe("GIF89a");
    expect(JSON.parse(readFileSync(metaPath, "utf8"))).toMatchObject({ status: "complete" });
  });

  it.each([false, true])(
    "cleans up cancelled GIF output and metadata (late completion: %s)",
    async (lateCompletion) => {
      producer.executeRenderJob.mockImplementation(
        async (_job, _dir, outputPath: string, _progress, signal: AbortSignal) => {
          writeFileSync(outputPath, "partial-gif");
          writeFileSync(join(dirname(outputPath), "gif-job.meta.json"), "{}");
          await waitForRenderCancellation(signal, lateCompletion);
        },
      );
      const { state, outputPath, metaPath } = await fixture();
      await cancelAndVerifyArtifacts(state, outputPath, metaPath);
    },
  );
});

// vi.waitFor gives up after 1 s by default; a loaded Windows runner took longer to finish a mocked render.
const RENDER_DONE = { timeout: 20_000 };

describe("Vite PNG-sequence rendering", () => {
  it("marks the job a directory render and caches the frame facts in a sidecar beside it", async () => {
    producer.executeRenderJob.mockImplementation(async (_job, _dir, outputPath: string) => {
      writeSequence(outputPath, 3);
    });
    const { dir, state, outputPath, metaPath } = await fixture({
      format: "png-sequence",
      jobId: "seq-job",
    });
    expect(state.kind).toBe("directory");
    await vi.waitFor(() => expect(state.status, state.error).toBe("complete"), RENDER_DONE);
    expect(producer.createRenderJob).toHaveBeenCalledWith(
      expect.objectContaining({ format: "png-sequence" }),
    );
    expect(metaPath).toBe(join(dir, "seq-job.meta.json"));
    expect(existsSync(join(outputPath, "seq-job.meta.json"))).toBe(false);
    expect(JSON.parse(readFileSync(metaPath, "utf8"))).toMatchObject({
      status: "complete",
      kind: "directory",
      outputName: "seq-job",
      frameCount: 3,
      size: 3 * "png-bytes".length + "aac".length,
      audioSidecar: true,
    });
  });

  it("writes explicit directory identity when PNG rendering fails before publishing output", async () => {
    producer.executeRenderJob.mockRejectedValue(new Error("PNG failed"));
    const { state, outputPath, metaPath } = await fixture({
      format: "png-sequence",
      jobId: "failed-seq",
    });
    await vi.waitFor(() => expect(state.status).toBe("failed"), RENDER_DONE);
    expect(JSON.parse(readFileSync(metaPath, "utf8"))).toMatchObject({
      status: "failed",
      kind: "directory",
      outputName: "failed-seq",
    });
    expect(existsSync(outputPath)).toBe(false);
  });

  it.each([false, true])(
    "removes a cancelled frames directory and its sidecar (late completion: %s)",
    async (lateCompletion) => {
      producer.executeRenderJob.mockImplementation(
        async (_job, dir: string, outputPath: string, _progress, signal: AbortSignal) => {
          writeSequence(outputPath, 2);
          writeFileSync(join(dir, "seq-job.meta.json"), "{}");
          await waitForRenderCancellation(signal, lateCompletion);
        },
      );
      const { state, outputPath, metaPath } = await fixture({
        format: "png-sequence",
        jobId: "seq-job",
      });
      await cancelAndVerifyArtifacts(state, outputPath, metaPath);
    },
  );
});

describe("Studio dev server render jobs", { timeout: 30_000 }, () => {
  it("hands the route's pageMotionBlur to the job, so a preview that could not blur renders unblurred", async () => {
    producer.executeRenderJob.mockResolvedValue(undefined);
    const { state } = await fixture({ format: "mp4", pageMotionBlur: "off" });
    await vi.waitFor(() => expect(state.status, state.error).toBe("complete"), RENDER_DONE);
    expect(producer.createRenderJob).toHaveBeenCalledWith(
      expect.objectContaining({ pageMotionBlur: "off" }),
    );
  });

  it("leaves the job's blur to the composition when the route sends none", async () => {
    producer.executeRenderJob.mockResolvedValue(undefined);
    const { state } = await fixture({ format: "mp4" });
    await vi.waitFor(() => expect(state.status, state.error).toBe("complete"), RENDER_DONE);
    expect(producer.createRenderJob.mock.calls[0]?.[0]).not.toHaveProperty("pageMotionBlur");
  });

  it.each([
    ["allows", "a project of your own", [] as string[], true],
    ["refuses", "a project whose received files include HTML", ["index.html"], false],
  ])("%s files outside the project for %s", async (_verb, _name, received, allowed) => {
    producer.executeRenderJob.mockResolvedValue(undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { state } = await fixture({ format: "mp4" }, (dir) => {
      writeFileSync(join(dir, "index.html"), '<img src="../outside.png">');
      if (received.length === 0) return;
      mkdirSync(join(dir, ".hyperframes"));
      writeFileSync(
        join(dir, ".hyperframes", "received-files.json"),
        JSON.stringify({ files: received }),
      );
    });
    await vi.waitFor(() => expect(state.status, state.error).toBe("complete"), RENDER_DONE);
    expect(producer.createRenderJob).toHaveBeenCalledWith(
      expect.objectContaining({ allowOutsideProjectAssets: allowed }),
    );
    warn.mockRestore();
  });
});
