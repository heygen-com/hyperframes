import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfig } from "@hyperframes/engine";
import { createRenderJob, executeRenderJob } from "./renderOrchestrator.js";

// Entry: executeRenderJob. The compile stage stands in for remote downloads that never answer: it settles only
// when the signal it was given aborts.
const compile = vi.hoisted(() => ({ signals: [] as Array<AbortSignal | undefined> }));
vi.mock("./render/stages/compileStage.js", () => ({
  runCompileStage: ({ abortSignal }: { abortSignal?: AbortSignal }) => {
    compile.signals.push(abortSignal);
    return new Promise((_, reject) =>
      abortSignal?.addEventListener("abort", () => reject(abortSignal.reason), { once: true }),
    );
  },
}));
vi.mock("./render/shared.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./render/shared.js")>()),
  createMemorySampler: () => ({
    peakRssBytes: () => 0,
    peakHeapUsedBytes: () => 0,
    stop: () => {},
  }),
}));

const dirs: string[] = [];
afterEach(() => {
  compile.signals.length = 0;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// fails without the fix: the compile stage got no signal, so a cancelled render waited out its downloads.
it("cancelling a render during compile stops the compile and settles the render", async () => {
  const root = mkdtempSync(join(tmpdir(), "hf-compile-cancel-"));
  dirs.push(root);
  writeFileSync(join(root, "index.html"), "<div></div>");
  const job = createRenderJob({
    fps: 30,
    quality: "draft",
    format: "mp4",
    hdrMode: "force-sdr",
    producerConfig: resolveConfig({ enablePageSideCompositing: false }),
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });
  const cancel = new AbortController();
  const render = executeRenderJob(job, root, join(root, "out.mp4"), undefined, cancel.signal);

  await vi.waitFor(() => expect(compile.signals).toHaveLength(1));
  expect(compile.signals[0]).toBeInstanceOf(AbortSignal);
  cancel.abort();
  await expect(render).rejects.toThrow();
  expect(compile.signals[0]?.aborted).toBe(true);
});
