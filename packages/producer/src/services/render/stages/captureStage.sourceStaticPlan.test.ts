import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CaptureSession } from "@hyperframes/engine";
import {
  captureFrame,
  closeCaptureSession,
  initializeSession,
  createCaptureSession,
  resolveConfig,
} from "@hyperframes/engine";
import { createRenderJob } from "../../renderOrchestrator.js";
import { createCapturePlan } from "../capturePlan.js";
import { fixture } from "../__test_utils__/sourceStaticPlanFixture.js";
import { runCaptureStage, type CaptureStageInput } from "./captureStage.js";

vi.mock("@hyperframes/engine", async (original) => ({
  ...(await original<typeof import("@hyperframes/engine")>()),
  captureFrame: vi.fn(),
  closeCaptureSession: vi.fn(),
  initializeSession: vi.fn(),
  createCaptureSession: vi.fn(() => {
    throw new Error("unexpected browser creation");
  }),
  prepareCaptureSessionForReuse: vi.fn(),
  verifyDiskDrawElementSamples: vi.fn(),
  getCapturePerfSummary: vi.fn(() => ({})),
}));
const scratch: string[] = [];
afterEach(async () => {
  await Promise.all(scratch.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
beforeEach(() => {
  vi.clearAllMocks();
});
async function input(enabled?: boolean) {
  const { root } = await fixture(scratch);
  const framesDir = join(root, "frames");
  await mkdir(framesDir);
  // The engine's browser-bearing session is replaced at its IO boundary only.
  const session = {
    options: { captureBeyondViewport: false },
    browserConsoleBuffer: ["browser diagnostic"],
    isInitialized: false,
    captureMode: "beginframe",
    staticDedupEnabled: false,
    staticFrames: new Set<number>(),
    workerEncodeEnabled: false,
  } as unknown as CaptureSession;
  vi.mocked(initializeSession).mockImplementation(async () => {
    session.isInitialized = true;
  });
  vi.mocked(captureFrame).mockImplementation(async (_session, index, time) => {
    const path = join(framesDir, `frame_${String(index).padStart(6, "0")}.jpg`);
    await writeFile(path, `frame-${index}`);
    return { path, frameIndex: index, time, captureTimeMs: 0 };
  });
  const plan = createCapturePlan({
    workerCount: 1,
    forceScreenshot: false,
    forceParallelStream: false,
    useStreamingEncode: false,
    useLayeredComposite: false,
    usePageSideCompositing: false,
    hasHdrContent: false,
    needsAlpha: false,
    routing: { kind: "default" },
  });
  if (plan.kind !== "sdr_disk") throw new Error("fixture route");
  const value: CaptureStageInput = {
    sourceProjectDir: root,
    initialDirectSdrDiskEligible: true,
    sourceStaticPlanEnabled: enabled,
    fileServer: { url: "http://unused.invalid" } as CaptureStageInput["fileServer"],
    workDir: root,
    framesDir,
    job: createRenderJob({ fps: 30, quality: "standard" }),
    totalFrames: 300,
    cfg: resolveConfig(),
    plan,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    probeSession: session,
    captureAttempts: [],
    dedupPerfs: [],
    // Current upstream checks disk headroom even when reusing a probe session.
    buildCaptureOptions: () => ({ width: 64, height: 36, fps: { num: 30, den: 1 } }),
    createRenderVideoFrameInjector: () => null,
    abortSignal: undefined,
    assertNotAborted() {},
  };
  return { value, session, root, framesDir };
}
describe("native capture stage source-static-plan integration", () => {
  it.each([undefined, false])(
    "default/OFF %s does not read carrier or scan the directory",
    async (enabled) => {
      const { value, framesDir } = await input(enabled);
      value.sourceProjectDir = "/missing";
      await writeFile(join(framesDir, "sentinel"), "OFF must not run optimized dense scan");
      await runCaptureStage(value);
      expect(captureFrame).toHaveBeenCalledTimes(300);
      expect(value.log.info).not.toHaveBeenCalled();
      expect(closeCaptureSession).toHaveBeenCalledTimes(1);
      expect(createCaptureSession).not.toHaveBeenCalled();
    },
  );
  it("captures anchors at absolute times, materializes exact dense files, and reports every logical frame", async () => {
    const { value, session, framesDir } = await input(true);
    const progress: number[] = [];
    value.onProgress = (job) => {
      progress.push(job.framesRendered ?? 0);
    };
    await runCaptureStage(value);
    expect(initializeSession).toHaveBeenCalledBefore(vi.mocked(captureFrame));
    expect(captureFrame).toHaveBeenCalledTimes(271);
    expect(captureFrame).toHaveBeenCalledWith(session, 30, 1);
    expect(captureFrame).toHaveBeenCalledWith(session, 60, 2);
    expect(vi.mocked(captureFrame).mock.calls.some(([, i]) => i > 30 && i < 60)).toBe(false);
    expect(progress).toEqual(Array.from({ length: 300 }, (_, i) => i + 1));
    expect(await readFile(join(framesDir, "frame_000059.jpg"), "utf8")).toBe("frame-30");
    expect(await readdir(framesDir)).toHaveLength(300);
    expect(closeCaptureSession).toHaveBeenCalledTimes(1);
  });
  it.each(["provenance", "dedup-enabled", "dedup-armed", "carrier", "screenshot", "frame-range"])(
    "%s rejects before writes and uses original loop without extra scan",
    async (reason) => {
      const { value, session, framesDir, root } = await input(true);
      if (reason === "provenance") value.initialDirectSdrDiskEligible = false;
      if (reason === "dedup-enabled") session.staticDedupEnabled = true;
      if (reason === "dedup-armed") session.staticFrames = new Set([0]);
      if (reason === "carrier")
        await writeFile(join(root, "openmaic-source-static-plan.json"), "{}");
      if (reason === "screenshot") session.captureMode = "screenshot";
      if (reason === "frame-range") value.frameRange = { startFrame: 100, endFrame: 400 };
      await writeFile(join(framesDir, "sentinel"), "no new dense scan on fallback");
      await runCaptureStage(value);
      expect(captureFrame).toHaveBeenCalledTimes(300);
      if (reason === "frame-range")
        expect(captureFrame).toHaveBeenNthCalledWith(1, session, 0, 100 / 30);
      expect(closeCaptureSession).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["capture-error", "mode-drift", "destination-exists", "cancel", "dense-inventory"])(
    "%s after optimized writes fails and closes, without baseline replay",
    async (reason) => {
      const { value, session, framesDir } = await input(true);
      if (reason === "destination-exists")
        await writeFile(join(framesDir, "frame_000031.jpg"), "existing");
      if (reason === "dense-inventory") await writeFile(join(framesDir, "extra"), "extra");
      const actual = vi.mocked(captureFrame).getMockImplementation()!;
      vi.mocked(captureFrame).mockImplementation(async (...args) => {
        const path = await actual(...args);
        if (args[1] === 30) {
          if (reason === "capture-error") throw new Error("injected capture IO failure");
          if (reason === "mode-drift") session.captureMode = "screenshot";
          if (reason === "cancel")
            value.assertNotAborted = () => {
              throw new Error("cancelled");
            };
        }
        return path;
      });
      // Capture stage destructures assertNotAborted at entry, so read a shared flag at that real seam.
      let cancelled = false;
      if (reason === "cancel") {
        value.onProgress = (job) => {
          if (job.framesRendered === 31) cancelled = true;
        };
        value.assertNotAborted = () => {
          if (cancelled) throw new Error("cancelled");
        };
      }
      await expect(runCaptureStage(value)).rejects.toThrow();
      expect(captureFrame).toHaveBeenCalledTimes(reason === "dense-inventory" ? 271 : 31);
      expect(closeCaptureSession).toHaveBeenCalledTimes(1);
    },
  );
});
