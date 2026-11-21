import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, realpathSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RenderExecutionDependencies } from "../commands/render/execute.js";
import type { RenderOptions } from "../commands/render.js";
const mocks = vi.hoisted(() => ({ render: vi.fn(), plan: vi.fn(), execute: vi.fn() }));
vi.mock("@hyperframes/share", () => ({
  projectFingerprint: async () => "unchanged",
  shareSourceFingerprint: async () => "unchanged-content",
}));
vi.mock("../commands/render/plan.js", () => ({ createRenderPlan: mocks.plan }));
vi.mock("../commands/render/execute.js", () => ({ executeRenderPlan: mocks.execute }));
vi.mock("../commands/render.js", () => ({
  renderLocal: mocks.render,
  checkRenderResolutionPreflight: vi.fn(),
}));
import { latestShareRender, prepareShareRender } from "./render.js";
let project: string;
const options: RenderOptions = {
  fps: { num: 30, den: 1 },
  quality: "standard",
  format: "mp4",
  gpu: false,
  browserGpuMode: "software",
  hdrMode: "auto",
  quiet: true,
  exitAfterComplete: true,
};
beforeEach(() => {
  vi.resetAllMocks();
  project = realpathSync(mkdtempSync(join(tmpdir(), "hf-share-render-lifecycle-")));
  mocks.plan.mockImplementation((plan) => plan);
  mocks.execute.mockImplementation(
    async (plan: { output: string }, dependencies: RenderExecutionDependencies) => {
      await dependencies.renderLocal(project, plan.output, options);
    },
  );
  mocks.render.mockImplementation(async (_dir: string, output: string) => {
    writeFileSync(output, "rendered-video");
  });
});
afterEach(() => rmSync(project, { recursive: true, force: true }));
it("keeps rendering embedded even when the command plan asks to exit", async () => {
  await prepareShareRender(project);
  expect(mocks.render).toHaveBeenCalledWith(
    project,
    expect.any(String),
    expect.objectContaining({ embedded: true, exitAfterComplete: false }),
    undefined,
  );
  expect(options.exitAfterComplete).toBe(true);
  expect(latestShareRender(project)?.fingerprint).toBe("unchanged");
});
it("propagates render failures without publishing a successful artifact record", async () => {
  const error = new Error("render failed");
  mocks.render.mockImplementation(async (_dir: string, output: string) => {
    writeFileSync(output, "partial-video");
    throw error;
  });
  await expect(prepareShareRender(project)).rejects.toBe(error);
  expect(existsSync(join(project, ".hyperframes", "share-render.json"))).toBe(false);
  expect(readdirSync(join(project, ".hyperframes", "share-renders"))).toEqual([]);
});
