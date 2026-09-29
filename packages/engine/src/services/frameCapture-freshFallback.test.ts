import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  captureFrameToBuffer,
  captureFrameToBufferPipelined,
  captureFramesBatchPipelined,
  createCaptureSession,
} from "./frameCapture.js";
import {
  captureDrawElementFrame,
  produceDrawElementFrame,
  produceDrawElementFrameBatch,
  DE_CANVAS_NOT_INITIALIZED_CODE,
} from "./drawElementService.js";
import { pageScreenshotCapture } from "./screenshotService.js";
import { DrawElementCaptureError, isDrawElementCaptureError } from "./drawElementCaptureError.js";

vi.mock("./browserManager.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./browserManager.js")>()),
  resolveBrowserGpuMode: async () => "hardware",
  acquireBrowser: async () => ({
    captureMode: "screenshot",
    browser: {
      version: async () => "Chrome/150.0.0.0",
      newPage: async () => ({
        evaluateOnNewDocument: async () => {},
        setViewport: async () => {},
        evaluate: async () => undefined,
        screenshot: async () => {
          throw new Error("diagnostic screenshot unavailable");
        },
      }),
    },
  }),
}));
vi.mock("./drawElementService.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./drawElementService.js")>()),
  captureDrawElementFrame: vi.fn(),
  produceDrawElementFrame: vi.fn(),
  produceDrawElementFrameBatch: vi.fn(),
}));
vi.mock("./screenshotService.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./screenshotService.js")>()),
  pageScreenshotCapture: vi.fn(),
}));

const dirs: string[] = [];
async function session() {
  const dir = mkdtempSync(join(tmpdir(), "hf-fresh-fallback-"));
  dirs.push(dir);
  const result = await createCaptureSession(
    "http://localhost:0",
    dir,
    {
      width: 1920,
      height: 1080,
      fps: { num: 30, den: 1 },
      format: "jpeg",
    },
    null,
    { forceScreenshot: true },
  );
  result.isInitialized = true;
  result.captureMode = "drawelement";
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("HF_FORCE_DRAWELEMENT", "0");
  vi.stubEnv("HF_FAST_CAPTURE_BOUNDARY_SS", "false");
});
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("fresh screenshot fallback", () => {
  for (const [name, capture, produce] of [
    ["serial", captureFrameToBuffer, captureDrawElementFrame],
    ["pipelined", captureFrameToBufferPipelined, produceDrawElementFrame],
  ] as const) {
    it.each(["No cached paint record for element", DE_CANVAS_NOT_INITIALIZED_CODE])(
      `${name} rejects untrusted capture instead of returning the injected canvas`,
      async (message) => {
        vi.mocked(produce).mockRejectedValueOnce(new Error(message));
        const s = await session();
        await expect(capture(s, 7, 7 / 30)).rejects.toBeInstanceOf(DrawElementCaptureError);
        expect(pageScreenshotCapture).not.toHaveBeenCalled();
        expect(s.deNcprFallbacks).toBe(1);
      },
    );
    it(`${name} routes explicit boundary screenshots through a fresh page`, async () => {
      vi.stubEnv("HF_FAST_CAPTURE_BOUNDARY_SS", "true");
      const s = await session();
      s.clipBoundaryFrames = new Set([7]);
      await expect(capture(s, 7, 7 / 30)).rejects.toThrow("boundary screenshot requested");
      expect(pageScreenshotCapture).not.toHaveBeenCalled();
      expect(produce).not.toHaveBeenCalled();
    });
  }

  // The recoverable-error wrapper used to throw before the diagnostics call,
  // so exactly the NCPR/canvas failures worth debugging produced no bundle.
  it("still writes per-frame diagnostics when a recoverable pipelined failure aborts the attempt", async () => {
    vi.mocked(produceDrawElementFrame).mockRejectedValueOnce(
      new Error("No cached paint record for element"),
    );
    const s = await session();
    // The shared mock page fails its diagnostic screenshot; give this one a
    // working page so the bundle can actually land on disk.
    Object.assign(s.page, {
      screenshot: async () => Buffer.alloc(0),
      content: async () => "<html></html>",
    });

    await expect(captureFrameToBufferPipelined(s, 7, 7 / 30)).rejects.toBeInstanceOf(
      DrawElementCaptureError,
    );
    expect(existsSync(join(s.outputDir, "diagnostics", "frame-error-7.json"))).toBe(true);
  });

  it("rejects a suspect tiny frame without substituting a stale screenshot", async () => {
    vi.mocked(captureDrawElementFrame).mockResolvedValueOnce(Buffer.alloc(100));
    await expect(captureFrameToBuffer(await session(), 7, 7 / 30)).rejects.toThrow(
      "suspect small frame",
    );
    expect(pageScreenshotCapture).not.toHaveBeenCalled();
  });

  it("returns a normal drawElement frame unchanged", async () => {
    const buffer = Buffer.alloc(30_000);
    vi.mocked(captureDrawElementFrame).mockResolvedValueOnce(buffer);
    expect((await captureFrameToBuffer(await session(), 7, 7 / 30)).buffer).toBe(buffer);
    expect(pageScreenshotCapture).not.toHaveBeenCalled();
  });

  it.each(["No cached paint record for element", DE_CANVAS_NOT_INITIALIZED_CODE])(
    "rejects a failed batch and safely abandons pending prefix encodes",
    async (error) => {
      let rejectPrefix: (error: Error) => void = () => {};
      const prefix = new Promise<Buffer>((_, reject) => {
        rejectPrefix = reject;
      });
      vi.mocked(produceDrawElementFrameBatch).mockResolvedValueOnce({
        encodeResults: [prefix],
        failedAt: 1,
        error,
      });
      await expect(
        captureFramesBatchPipelined(await session(), [6, 7], [6 / 30, 7 / 30]),
      ).rejects.toThrow("frame 7");
      rejectPrefix(new Error("worker closed during fallback"));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(pageScreenshotCapture).not.toHaveBeenCalled();
      expect(produceDrawElementFrame).not.toHaveBeenCalled();
    },
  );

  it("recognizes wrapped structural errors without misclassifying generic failures", () => {
    expect(isDrawElementCaptureError({ cause: { cause: { deCaptureFailure: true } } })).toBe(true);
    expect(isDrawElementCaptureError(new Error("No cached paint record for element"))).toBe(false);
    const cycle: { cause?: unknown } = {};
    cycle.cause = cycle;
    expect(isDrawElementCaptureError(cycle)).toBe(false);
  });
});
