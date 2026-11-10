import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfig, resolveHeadlessShellPath } from "@hyperframes/engine";
import { assemble } from "./assemble.js";
import { plan } from "./plan.js";
import { createPlanV2FromV1, readPlanV2Manifest } from "./planV2.js";
import { createRenderJob, executeRenderJob } from "../renderOrchestrator.js";

const root = mkdtempSync(join(tmpdir(), "hf-reference-plan-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const config = resolveConfig({
  enableBrowserPool: false,
  useDrawElement: false,
  browserGpuMode: "software",
  forceScreenshot: true,
  staticFrameDedup: false,
});
const hasBrowser = resolveHeadlessShellPath(config) !== undefined;

describe("frozen reference background assembly", () => {
  it.each([
    { kind: "solid", rgb: [10, 46, 138] },
    { kind: "none" },
    { kind: "unsupported_non_solid" },
    { kind: "unknown" },
  ])("preserves $kind without reading a chunk's background", async (background) => {
    const planDir = mkdtempSync(join(root, "assembly-"));
    mkdirSync(join(planDir, "meta"));
    mkdirSync(join(planDir, "chunk"));
    writeFileSync(join(planDir, "chunk", "frame_000000.png"), "png fixture");
    writeFileSync(
      join(planDir, "meta", "chunks.json"),
      JSON.stringify([{ index: 0, startFrame: 0, endFrame: 1 }]),
    );
    writeFileSync(
      join(planDir, "plan.json"),
      JSON.stringify({
        planHash: "fixture",
        totalFrames: 1,
        hasAudio: false,
        reference_background: background,
        dimensions: { fpsNum: 30, fpsDen: 1, width: 320, height: 240, format: "png-sequence" },
      }),
    );
    const result = await assemble(planDir, [join(planDir, "chunk")], null, join(planDir, "output"));
    expect(result.reference_background).toEqual(background);
  });
});

describe("optional static plan inspection", () => {
  it("still plans without a usable browser and freezes unknown", async () => {
    const project = join(root, "no-browser-project");
    mkdirSync(project);
    writeFileSync(
      join(project, "index.html"),
      '<html><head><style>body{background:rgb(10 46 138)}</style></head><body><div data-composition-id="film" data-width="320" data-height="240" data-duration="0.1"></div></body></html>',
    );
    const planned = await plan(
      project,
      {
        fps: 30,
        width: 320,
        height: 240,
        format: "mp4",
        producerConfig: { ...config, chromePath: join(root, "absent-chrome") },
        rejectOnSystemFonts: false,
        failClosedFontFetch: false,
      },
      join(root, "no-browser-plan"),
    );
    expect(planned.totalFrames).toBe(3);
    expect(planned.reference_background).toEqual({ kind: "unknown" });
  });
});

describe.skipIf(!hasBrowser)("film-wide reference background integration", () => {
  it("does not require a WebGPU device to plan a static WebGPU composition", async () => {
    const project = join(root, "gpu-project");
    mkdirSync(project);
    writeFileSync(
      join(project, "index.html"),
      '<html><head><style>body{background:rgb(10 46 138)}</style></head><body><div data-composition-id="film" data-requires-webgpu data-width="320" data-height="240" data-duration="0.1"></div></body></html>',
    );
    const planned = await plan(
      project,
      {
        fps: 30,
        width: 320,
        height: 240,
        format: "mp4",
        producerConfig: config,
        rejectOnSystemFonts: false,
        failClosedFontFetch: false,
      },
      join(root, "gpu-plan"),
    );
    expect(planned.totalFrames).toBe(3);
    expect(planned.reference_background).toEqual({ kind: "solid", rgb: [10, 46, 138] });
  });

  it("gives a static composition the same local, plan, metadata and v2 receipt", async () => {
    const projectDir = join(root, "project");
    mkdirSync(projectDir);
    writeFileSync(
      join(projectDir, "index.html"),
      `<!doctype html><html><head><style>html,body{margin:0;width:100%;height:100%;background:rgb(10 46 138)}</style></head><body><div data-composition-id="root" data-width="320" data-height="240" data-duration="0.1" style="width:320px;height:240px"></div></body></html>`,
    );
    const planned = await plan(
      projectDir,
      {
        fps: 30,
        width: 320,
        height: 240,
        format: "mp4",
        quality: "standard",
        chunkSize: 10,
        producerConfig: config,
        rejectOnSystemFonts: false,
        failClosedFontFetch: false,
      },
      join(root, "plan"),
    );
    const expected = { kind: "solid", rgb: [10, 46, 138] };
    expect(planned.reference_background).toEqual(expected);
    const manifest = JSON.parse(readFileSync(join(root, "plan", "plan.json"), "utf8"));
    const composition = JSON.parse(
      readFileSync(join(root, "plan", "meta", "composition.json"), "utf8"),
    );
    expect(manifest.reference_background).toEqual(expected);
    expect(composition.reference_background).toEqual(expected);
    const v2 = createPlanV2FromV1(join(root, "plan"), join(root, "v2"));
    expect(v2.reference_background).toEqual(expected);
    expect(Object.hasOwn(readPlanV2Manifest(join(root, "v2")), "reference_background")).toBe(false);
    const job = createRenderJob({
      fps: 30,
      quality: "standard",
      format: "mp4",
      workers: 1,
      producerConfig: config,
    });
    await executeRenderJob(job, projectDir, join(root, "local.mp4"));
    expect(job.reference_background).toEqual(expected);
  }, 90_000);
});
