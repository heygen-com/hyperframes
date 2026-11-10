import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../../../../engine/src/config.js";
import { referenceBackgroundResult } from "../../../../engine/src/services/referenceBackground.js";

const state = vi.hoisted(() => ({
  goto: vi.fn(),
  evaluate: vi.fn(),
  waitForFunction: vi.fn(),
  close: vi.fn(),
  closeServer: vi.fn(),
  create: vi.fn(),
  read: vi.fn(),
}));
vi.mock("@hyperframes/engine", () => ({
  createCaptureSession: state.create,
  closeCaptureSession: state.close,
  readReferenceBackground: state.read,
  referenceBackgroundResult,
}));
vi.mock("../fileServer.js", () => ({
  createFileServer: async () => ({ url: "http://127.0.0.1:3000" }),
  closeFileServerSafely: state.closeServer,
  VIRTUAL_TIME_SHIM: "",
}));
import { readPlanReferenceBackground } from "./planReferenceBackground.js";

const input = () => ({
  projectDir: "/project",
  workDir: "/work",
  cfg: resolveConfig(),
  options: { width: 320, height: 240, fps: { num: 30, den: 1 } },
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
});

beforeEach(() => {
  vi.clearAllMocks();
  state.goto.mockResolvedValue(undefined);
  state.evaluate.mockResolvedValue(undefined);
  state.waitForFunction.mockResolvedValue(undefined);
  state.create.mockResolvedValue({
    page: { goto: state.goto, evaluate: state.evaluate, waitForFunction: state.waitForFunction },
  });
  state.close.mockResolvedValue(undefined);
  state.read.mockResolvedValue({ kind: "solid", rgb: [10, 46, 138] });
});

describe("optional plan reference read", () => {
  it("reads a page without WebGPU, BeginFrame, capture initialization or media reconciliation", async () => {
    const request = input();
    const result = await readPlanReferenceBackground(request);
    expect(result).toEqual({ reference_background: { kind: "solid", rgb: [10, 46, 138] } });
    expect(state.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ requiresWebGpu: false }),
      null,
      expect.objectContaining({ forceScreenshot: true, useDrawElement: false }),
    );
    expect(state.read).toHaveBeenCalledTimes(1);
    expect(state.close).toHaveBeenCalledTimes(1);
    expect(state.closeServer).toHaveBeenCalledTimes(1);
  });
  it("keeps an unavailable browser indeterminate rather than rejecting the plan", async () => {
    state.create.mockRejectedValueOnce(new Error("browser unavailable"));
    expect(await readPlanReferenceBackground(input())).toEqual({
      reference_background: { kind: "unknown" },
    });
    expect(state.closeServer).toHaveBeenCalledTimes(1);
  });
  it("keeps failed navigation indeterminate and closes the page", async () => {
    state.goto.mockRejectedValueOnce(new Error("navigation failed"));
    expect(await readPlanReferenceBackground(input())).toEqual({
      reference_background: { kind: "unknown" },
    });
    expect(state.close).toHaveBeenCalledTimes(1);
    expect(state.closeServer).toHaveBeenCalledTimes(1);
  });
});
