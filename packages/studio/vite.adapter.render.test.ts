import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ViteDevServer } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProjectSignatureCache, createViteAdapter } from "./vite.adapter";

const mocks = vi.hoisted(() => ({
  createRenderJob: vi.fn(() => ({ id: "job", perfSummary: undefined })),
  executeRenderJob: vi.fn(async () => {}),
}));

vi.mock("@hyperframes/producer", () => mocks);

const roots: string[] = [];
afterEach(() => {
  vi.clearAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function startRender(extra: Record<string, unknown>) {
  const root = mkdtempSync(join(tmpdir(), "hf-vite-render-"));
  roots.push(root);
  const adapter = createViteAdapter(
    root,
    {} as ViteDevServer,
    createProjectSignatureCache({ compute: () => "test" }),
    { historyRoot: join(root, "history") },
  );
  adapter.startRender({
    project: { dir: root, id: "p", title: "p" },
    outputPath: join(root, "out.mp4"),
    format: "mp4",
    fps: { num: 30, den: 1 },
    quality: "draft",
    jobId: "job",
    ...extra,
  } as never);
  return vi.waitFor(() => expect(mocks.createRenderJob).toHaveBeenCalledTimes(1), {
    timeout: 10_000,
  });
}

describe("Studio dev server render jobs", { timeout: 30_000 }, () => {
  it("hands the route's pageMotionBlur to the job, so a preview that could not blur renders unblurred", async () => {
    await startRender({ pageMotionBlur: "off" });
    expect(mocks.createRenderJob).toHaveBeenCalledWith(
      expect.objectContaining({ pageMotionBlur: "off" }),
    );
  });

  it("leaves the job's blur to the composition when the route sends none", async () => {
    await startRender({});
    expect(mocks.createRenderJob.mock.calls[0]?.[0]).not.toHaveProperty("pageMotionBlur");
  });
});
