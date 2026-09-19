import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
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

vi.mock("@hyperframes/producer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hyperframes/producer")>()),
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

function startStudioRender() {
  const dir = mkdtempSync(join(tmpdir(), "hf-studio-render-browser-"));
  dirs.push(dir);
  server = createStudioServer({ projectDir: dir });
  return server.adapter.startRender({
    project: { dir, id: "p", title: "p" },
    outputPath: join(dir, "out.mp4"),
    format: "mp4",
    fps: { num: 30, den: 1 },
    quality: "draft",
    jobId: "job",
  } as never);
}

describe("Studio render browser resolution", () => {
  it("refuses the render with the resolver's message instead of continuing without a browser", async () => {
    mocks.resolveRenderBrowser.mockRejectedValue(
      new Error("Chrome not found Chrome Headless Shell is required for local rendering."),
    );

    const state = startStudioRender();
    await vi.waitFor(() => expect(state.status).toBe("failed"));

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
    await vi.waitFor(() => expect(mocks.createRenderJob).toHaveBeenCalledTimes(1));

    expect(process.env.PRODUCER_HEADLESS_SHELL_PATH).toBe("/opt/chrome");
  });
});
