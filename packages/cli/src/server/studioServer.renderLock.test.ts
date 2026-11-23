import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioServer, type StudioServer } from "./studioServer.js";

const mocks = vi.hoisted(() => ({
  resolveRenderBrowser: vi.fn(async () => ({ executablePath: "/opt/chrome", source: "cache" })),
  createRenderJob: vi.fn(() => ({ id: "job", perfSummary: undefined })),
  executeRenderJob: vi.fn(async (..._args: unknown[]) => {}),
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

beforeEach(() => {
  // Its own account slot, so these renders never wait behind another test file's.
  vi.stubEnv("HYPERFRAMES_CACHE_DIR", mkdtempSync(join(tmpdir(), "hf-studio-lock-cache-")));
});

afterEach(() => {
  server?.watcher.close();
  server = undefined;
  vi.unstubAllEnvs();
  delete process.env.PRODUCER_HEADLESS_SHELL_PATH;
  vi.clearAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A render that ends when `end()` is called. */
function holdRender() {
  let end!: () => void;
  const ended = new Promise<void>((resolve) => (end = resolve));
  mocks.executeRenderJob.mockImplementationOnce(() => ended);
  return end;
}

function startStudioRender(jobId: string) {
  const dir = mkdtempSync(join(tmpdir(), "hf-studio-render-lock-"));
  dirs.push(dir);
  server ??= createStudioServer({ projectDir: dir });
  return server.adapter.startRender({
    project: { dir, id: "p", title: "p" },
    outputPath: join(dir, "out.mp4"),
    format: "mp4",
    fps: { num: 30, den: 1 },
    quality: "draft",
    jobId,
  } as never);
}

const WAITING = "Waiting for another render";
const slow = { timeout: 10_000 };

describe("Studio render slot", () => {
  it("makes a second render wait, and say so, until the first ends", async () => {
    const endFirst = holdRender();
    const first = startStudioRender("first");
    await vi.waitFor(() => expect(mocks.executeRenderJob).toHaveBeenCalledTimes(1));

    const second = startStudioRender("second");
    await vi.waitFor(() => expect(second.stage).toContain(WAITING), slow);
    expect(mocks.executeRenderJob).toHaveBeenCalledTimes(1);
    expect(second.status).toBe("rendering");

    endFirst();
    await vi.waitFor(() => expect(first.status).toBe("complete"));
    await vi.waitFor(() => expect(second.status, second.error).toBe("complete"), slow);
    // The wait words go once the slot is taken, not only when the producer reports a stage.
    expect(second.stage ?? "").not.toContain(WAITING);
    expect(mocks.executeRenderJob).toHaveBeenCalledTimes(2);
  });

  it("lets Cancel end a wait without freeing the slot the first render holds", async () => {
    const endFirst = holdRender();
    startStudioRender("first");
    await vi.waitFor(() => expect(mocks.executeRenderJob).toHaveBeenCalledTimes(1));

    const second = startStudioRender("second");
    await vi.waitFor(() => expect(second.stage).toContain(WAITING), slow);
    second.cancel?.();
    await vi.waitFor(() => expect(second.status).toBe("cancelled"));

    const third = startStudioRender("third");
    await vi.waitFor(() => expect(third.stage).toContain(WAITING), slow);
    expect(mocks.executeRenderJob).toHaveBeenCalledTimes(1);

    endFirst();
    await vi.waitFor(() => expect(third.status, third.error).toBe("complete"), slow);
  });

  it("frees the slot when a render fails", async () => {
    mocks.executeRenderJob.mockImplementationOnce(async () => {
      throw new Error("boom");
    });
    const failed = startStudioRender("failed");
    await vi.waitFor(() => expect(failed.status).toBe("failed"));

    const next = startStudioRender("next");
    await vi.waitFor(() => expect(next.status, next.error).toBe("complete"), slow);
  });

  it("runs renders side by side under HYPERFRAMES_RENDER_LOCK=off", async () => {
    vi.stubEnv("HYPERFRAMES_RENDER_LOCK", "off");
    const endFirst = holdRender();
    const endSecond = holdRender();
    startStudioRender("first");
    await vi.waitFor(() => expect(mocks.executeRenderJob).toHaveBeenCalledTimes(1));
    const second = startStudioRender("second");
    await vi.waitFor(() => expect(mocks.executeRenderJob).toHaveBeenCalledTimes(2), slow);
    expect(second.stage ?? "").not.toContain(WAITING);
    endFirst();
    endSecond();
  });
});
