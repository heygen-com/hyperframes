import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioServer, type StudioServer } from "./studioServer.js";

const mocks = vi.hoisted(() => ({
  resolveRenderBrowser: vi.fn(),
  createRenderJob: vi.fn(() => ({ id: "job", perfSummary: undefined })),
  executeRenderJob: vi.fn(async () => {}),
}));

vi.mock("../browser/preflight.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../browser/preflight.js")>()),
  resolveRenderBrowser: mocks.resolveRenderBrowser,
}));

// Under vitest the module is a .ts file, which would take the dev-mode producer load.
vi.mock("../utils/env.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/env.js")>()),
  isDevMode: () => false,
}));

// Not importOriginal: loading the real producer takes longer than a wait timeout on a cold Windows runner.
vi.mock("@hyperframes/producer", () => ({
  createRenderJob: mocks.createRenderJob,
  executeRenderJob: mocks.executeRenderJob,
}));

vi.mock("./studioRenderTelemetry.js", () => ({
  emitStudioRenderComplete: vi.fn(),
  emitStudioRenderError: vi.fn(),
}));

const dirs: string[] = [];
let server: StudioServer | undefined;

afterEach(() => {
  server?.watcher.close();
  server = undefined;
  delete process.env.PRODUCER_HEADLESS_SHELL_PATH;
  vi.clearAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function startStudioRender(extra: Record<string, unknown> = {}, receivedFiles?: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "hf-studio-render-browser-"));
  dirs.push(dir);
  if (receivedFiles) {
    mkdirSync(join(dir, ".hyperframes"));
    writeFileSync(
      join(dir, ".hyperframes", "received-files.json"),
      JSON.stringify({ files: receivedFiles }),
    );
  }
  server = createStudioServer({ projectDir: dir });
  return server.adapter.startRender({
    project: { dir, id: "p", title: "p" },
    outputPath: join(dir, "out.mp4"),
    format: "mp4",
    fps: { num: 30, den: 1 },
    quality: "draft",
    jobId: "job",
    ...extra,
  } as never);
}

describe("Studio render browser resolution", () => {
  it("refuses the render with the resolver's message instead of continuing without a browser", async () => {
    mocks.resolveRenderBrowser.mockRejectedValue(
      new Error("Chrome not found Chrome Headless Shell is required for local rendering."),
    );

    const state = startStudioRender();
    await vi.waitFor(() => expect(state.status).toBe("failed"), { timeout: 10_000 });

    expect(state.error).toBe(
      "Chrome not found Chrome Headless Shell is required for local rendering.",
    );
    expect(mocks.createRenderJob).not.toHaveBeenCalled();
  });

  it("hands the resolved browser to the producer before the job is created", async () => {
    mocks.resolveRenderBrowser.mockResolvedValue({
      executablePath: "/opt/chrome",
      source: "cache",
    });

    startStudioRender();
    await vi.waitFor(() => expect(mocks.createRenderJob).toHaveBeenCalledTimes(1), {
      timeout: 10_000,
    });

    expect(process.env.PRODUCER_HEADLESS_SHELL_PATH).toBe("/opt/chrome");
  });
});

describe("Studio render GPU encoding", () => {
  it("creates the job with useGpu when the request asks for GPU encoding", async () => {
    mocks.resolveRenderBrowser.mockResolvedValue({
      executablePath: "/opt/chrome",
      source: "cache",
    });

    startStudioRender({ useGpu: true });
    await vi.waitFor(() => expect(mocks.createRenderJob).toHaveBeenCalledTimes(1), {
      timeout: 10_000,
    });

    expect(mocks.createRenderJob).toHaveBeenCalledWith(expect.objectContaining({ useGpu: true }));
  });
});

describe("Studio render motion blur", () => {
  it("hands the route's pageMotionBlur to the job", async () => {
    mocks.resolveRenderBrowser.mockResolvedValue({
      executablePath: "/opt/chrome",
      source: "cache",
    });

    startStudioRender({ pageMotionBlur: "off" });
    await vi.waitFor(() => expect(mocks.createRenderJob).toHaveBeenCalledTimes(1), {
      timeout: 10_000,
    });

    expect(mocks.createRenderJob).toHaveBeenCalledWith(
      expect.objectContaining({ pageMotionBlur: "off" }),
    );
  });

  it("sends none when the route sent none", async () => {
    mocks.resolveRenderBrowser.mockResolvedValue({
      executablePath: "/opt/chrome",
      source: "cache",
    });

    startStudioRender();
    await vi.waitFor(() => expect(mocks.createRenderJob).toHaveBeenCalledTimes(1), {
      timeout: 10_000,
    });

    expect(mocks.createRenderJob).not.toHaveBeenCalledWith(
      expect.objectContaining({ pageMotionBlur: expect.anything() }),
    );
  });
});

describe("Studio render of a received composition", () => {
  it.each([
    { name: "a received entry", extra: {}, files: ["index.html"], allowed: false },
    {
      name: "a received composition picked to render",
      extra: { composition: "scene.html" },
      files: ["scene.html"],
      allowed: false,
    },
    { name: "the person's own entry", extra: {}, files: ["other.html"], allowed: true },
    { name: "no received-files record", extra: {}, files: undefined, allowed: true },
  ])("brings in outside files for $name: $allowed", async ({ extra, files, allowed }) => {
    mocks.resolveRenderBrowser.mockResolvedValue({
      executablePath: "/opt/chrome",
      source: "cache",
    });

    startStudioRender(extra, files);
    await vi.waitFor(() => expect(mocks.createRenderJob).toHaveBeenCalledTimes(1), {
      timeout: 10_000,
    });

    expect(mocks.createRenderJob).toHaveBeenCalledWith(
      expect.objectContaining({ allowOutsideProjectAssets: allowed }),
    );
  });
});
