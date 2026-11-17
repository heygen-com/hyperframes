import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCaptureSession } from "./frameCapture.js";
import { buildChromeArgs } from "./browserManager.js";

vi.mock("./browserManager.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./browserManager.js")>();
  return {
    ...actual,
    buildChromeArgs: vi.fn(actual.buildChromeArgs),
    resolveBrowserGpuMode: async () => "hardware",
    acquireBrowser: async () => ({
      captureMode: "screenshot",
      browser: { version: async () => "Chrome/150.0.0.0", newPage: async () => ({}) },
    }),
  };
});

const dirs: string[] = [];
afterEach(() => {
  vi.mocked(buildChromeArgs).mockClear();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("a capture session's launch", () => {
  it.each([true, false, undefined])(
    "hands the render's injectsVideoFrames (%s) to the launch flags",
    async (injectsVideoFrames) => {
      const dir = mkdtempSync(join(tmpdir(), "hf-frame-rate-limit-"));
      dirs.push(dir);
      await createCaptureSession(
        "http://localhost:0",
        dir,
        {
          width: 1920,
          height: 1080,
          fps: { num: 30, den: 1 },
          format: "jpeg",
          requiresWebGpu: false,
          injectsVideoFrames,
        },
        null,
        { forceScreenshot: true },
      ).catch(() => undefined);
      expect(vi.mocked(buildChromeArgs).mock.calls[0]?.[0]).toMatchObject({ injectsVideoFrames });
    },
  );
});
