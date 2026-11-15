import { expect, it, vi } from "vitest";
import { resolveConfig } from "@hyperframes/engine";
import { runCaptureCalibration } from "./captureCost.js";

const { state } = vi.hoisted(() => ({ state: { message: "" } }));
vi.mock("@hyperframes/engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hyperframes/engine")>()),
  createCaptureSession: async () => {
    throw new Error(state.message);
  },
  closeCaptureSession: async () => {},
}));

function calibrate() {
  return runCaptureCalibration({
    cfg: resolveConfig({ forceScreenshot: true }),
    fileServer: { url: "http://127.0.0.1:1" } as never,
    workDir: "/tmp/unused",
    log: { info() {}, warn() {}, error() {}, debug() {} },
    job: { config: { fps: 30 } } as never,
    totalFrames: 10,
    forceScreenshot: true,
    probeSession: null,
    buildCaptureOptions: () => ({}) as never,
    createRenderVideoFrameInjector: () => null,
    assertNotAborted: () => {},
  });
}

it("reports an evaluate timeout during calibration", async () => {
  state.message = "Runtime.evaluate timed out. Increase the 'protocolTimeout' setting";
  expect((await calibrate()).calibrationEvaluateTimedOut).toBe(true);
});

it("does not report other calibration failures as an evaluate timeout", async () => {
  state.message = "Navigation timeout of 60000 ms exceeded";
  expect((await calibrate()).calibrationEvaluateTimedOut).toBe(false);
});
