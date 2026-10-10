import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRenderJob, executeRenderJob } from "./renderOrchestrator.js";

const MASTER_CHAIN = '{"version":1,"nodes":[]}';
const seen = vi.hoisted((): { audioInput?: { masterFxChain?: string } } => ({}));

vi.mock("@hyperframes/engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hyperframes/engine")>()),
  assertConfiguredFfmpegBinariesExist: () => {},
}));
vi.mock("./render/stages/compileStage.js", () => ({
  runCompileStage: async () => ({
    compiled: { html: "<div></div>" },
    composition: {
      width: 320,
      height: 180,
      duration: 1,
      videos: [],
      images: [],
      audios: [],
      masterFxChain: '{"version":1,"nodes":[]}',
    },
    deviceScaleFactor: 1,
    outputWidth: 320,
    outputHeight: 180,
    compileOnlyMs: 0,
    forceScreenshot: true,
  }),
}));
vi.mock("./render/stages/probeStage.js", () => ({
  runProbeStage: async ({ compiled }: { compiled: object }) => ({
    compiled,
    fileServer: null,
    probeSession: null,
    lastBrowserConsole: [],
    duration: 1,
    totalFrames: 30,
    browserProbeMs: 0,
  }),
}));
vi.mock("./render/stages/extractVideosStage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./render/stages/extractVideosStage.js")>()),
  runExtractVideosStage: async () => ({
    extractionResult: null,
    frameLookup: null,
    videoReadinessSkipIds: new Set<string>(),
    videoMetadataHints: new Map(),
    nativeHdrVideoIds: new Set<string>(),
    videoTransfers: new Map(),
    nativeHdrImageIds: new Set<string>(),
    imageTransfers: new Map(),
    hdrImageSrcPaths: new Map(),
    imageColorSpaces: [],
    videoExtractMs: 0,
    failureToEnforce: undefined,
  }),
}));
vi.mock("./render/stages/audioStage.js", () => ({
  runAudioStage: async (input: { masterFxChain?: string }) => {
    seen.audioInput = input;
    throw new Error("audio stage reached");
  },
}));

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it("the local renderer gives the audio stage the composition's master chain", async () => {
  const root = mkdtempSync(join(tmpdir(), "hf-master-bus-orchestrator-"));
  dirs.push(root);
  writeFileSync(join(root, "index.html"), "<div></div>");
  const job = createRenderJob({
    fps: 30,
    quality: "standard",
    hdrMode: "force-sdr",
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });
  await expect(executeRenderJob(job, root, join(root, "output.mp4"))).rejects.toThrow(
    "audio stage reached",
  );
  expect(seen.audioInput?.masterFxChain).toBe(MASTER_CHAIN);
});
