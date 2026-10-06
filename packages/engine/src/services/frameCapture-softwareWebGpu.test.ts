import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCaptureSession, initializeSession } from "./frameCapture.js";
import { assertWebGpuAdapterAvailable } from "./browserManager.js";

const launches: string[][] = [];
let resolvedMode: "software" | "hardware" = "software";

vi.mock("./browserManager.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./browserManager.js")>()),
  resolveBrowserGpuMode: async () => resolvedMode,
  assertWebGpuAdapterAvailable: vi.fn(async () => {
    throw new Error("adapter checked");
  }),
  acquireBrowser: async (args: string[]) => {
    launches.push(args);
    return {
      captureMode: "screenshot",
      browser: {
        version: async () => "Chrome/150.0.0.0",
        newPage: async () => ({
          on: () => {},
          goto: async () => null,
          createCDPSession: async () => ({ on: () => {}, send: async () => ({}) }),
          evaluateOnNewDocument: async () => {},
          setViewport: async () => {},
          evaluate: async () => undefined,
        }),
      },
    };
  },
}));

const dirs: string[] = [];
afterEach(() => {
  launches.length = 0;
  vi.mocked(assertWebGpuAdapterAvailable).mockClear();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** What a WebGPU capture session launches with and hands the adapter check. */
async function webGpuSession(allowSoftwareWebGpu: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "hf-software-webgpu-"));
  dirs.push(dir);
  const session = await createCaptureSession(
    "http://localhost:0",
    dir,
    { width: 1920, height: 1080, fps: { num: 30, den: 1 }, format: "jpeg", requiresWebGpu: true },
    null,
    { forceScreenshot: true, browserGpuMode: "auto", allowSoftwareWebGpu },
  );
  await expect(initializeSession(session)).rejects.toThrow("adapter checked");
  return {
    args: launches.at(-1) ?? [],
    checked: vi.mocked(assertWebGpuAdapterAvailable).mock.calls.at(-1),
  };
}

describe("software WebGPU in a capture session", () => {
  it("launches on SwiftShader's Vulkan and accepts its adapter when opted in on a software host", async () => {
    resolvedMode = "software";
    const { args, checked } = await webGpuSession(true);
    expect(args).toContain("--use-vulkan=swiftshader");
    expect(checked?.slice(1)).toEqual([true, true]);
  });

  it.each([
    ["without the opt-in", false, "software"],
    ["on a GPU", true, "hardware"],
  ] as const)("refuses a fallback adapter %s", async (_, allowSoftwareWebGpu, mode) => {
    resolvedMode = mode;
    const { args, checked } = await webGpuSession(allowSoftwareWebGpu);
    expect(args).not.toContain("--use-vulkan=swiftshader");
    expect(checked?.slice(1)).toEqual([true, false]);
  });
});
