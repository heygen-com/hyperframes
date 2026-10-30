import {
  waitForRenderCancellation,
  cancelAndVerifyArtifacts,
} from "../../test-utils/renderCancellation";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { createProjectSignatureCache, createViteAdapter } from "./vite.adapter";

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

type RenderOptions = Parameters<ReturnType<typeof createViteAdapter>["startRender"]>[0];

async function fixture(extra: Partial<RenderOptions> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "hf-vite-gif-"));
  dirs.push(dir);
  server = await createServer({
    configFile: false,
    server: { middlewareMode: true, watch: null, ws: false },
  });
  const adapter = createViteAdapter(
    dir,
    server,
    createProjectSignatureCache({ compute: () => "test" }),
  );
  const outputPath = join(dir, `out.${extra.format ?? "gif"}`);
  const state = adapter.startRender({
    project: { id: "demo", dir },
    outputPath,
    format: "gif",
    gifLoop: 3,
    fps: { num: 30, den: 1 },
    quality: "draft",
    jobId: "gif-job",
    ...extra,
  });
  return { dir, state, outputPath, metaPath: join(dir, "out.meta.json") };
}

describe("Vite GIF rendering", () => {
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
          writeFileSync(outputPath.replace(/\.gif$/, ".meta.json"), "{}");
          await waitForRenderCancellation(signal, lateCompletion);
        },
      );
      const { state, outputPath, metaPath } = await fixture();
      await cancelAndVerifyArtifacts(state, outputPath, metaPath);
    },
  );
});

describe("Studio dev server render jobs", { timeout: 30_000 }, () => {
  it("hands the route's pageMotionBlur to the job, so a preview that could not blur renders unblurred", async () => {
    producer.executeRenderJob.mockResolvedValue(undefined);
    const { state } = await fixture({ format: "mp4", pageMotionBlur: "off" });
    await vi.waitFor(() => expect(state.status, state.error).toBe("complete"));
    expect(producer.createRenderJob).toHaveBeenCalledWith(
      expect.objectContaining({ pageMotionBlur: "off" }),
    );
  });

  it("leaves the job's blur to the composition when the route sends none", async () => {
    producer.executeRenderJob.mockResolvedValue(undefined);
    const { state } = await fixture({ format: "mp4" });
    await vi.waitFor(() => expect(state.status, state.error).toBe("complete"));
    expect(producer.createRenderJob.mock.calls[0]?.[0]).not.toHaveProperty("pageMotionBlur");
  });
});
