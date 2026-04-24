import { describe, it, expect, vi, afterEach } from "vitest";
import { buildChromeArgs } from "./browserManager.js";

describe("buildChromeArgs", () => {
  const platformSpy = vi.spyOn(process, "platform", "get");

  afterEach(() => {
    platformSpy.mockReset();
  });

  it("defaults to SwiftShader software GL when gpuCapture is off", () => {
    platformSpy.mockReturnValue("win32");
    const args = buildChromeArgs({ width: 1920, height: 1080 });
    expect(args).toContain("--use-angle=swiftshader");
    expect(args).not.toContain("--use-angle=d3d11");
    expect(args).not.toContain("--use-angle=metal");
    expect(args).not.toContain("--use-angle=opengl");
  });

  it("selects D3D11 ANGLE backend on win32 when gpuCapture is on", () => {
    platformSpy.mockReturnValue("win32");
    const args = buildChromeArgs({ width: 1920, height: 1080 }, { gpuCapture: true });
    expect(args).toContain("--use-angle=d3d11");
    expect(args).not.toContain("--use-angle=swiftshader");
  });

  it("selects Metal ANGLE backend on darwin when gpuCapture is on", () => {
    platformSpy.mockReturnValue("darwin");
    const args = buildChromeArgs({ width: 1920, height: 1080 }, { gpuCapture: true });
    expect(args).toContain("--use-angle=metal");
    expect(args).not.toContain("--use-angle=swiftshader");
  });

  it("selects OpenGL ANGLE backend on linux when gpuCapture is on", () => {
    platformSpy.mockReturnValue("linux");
    const args = buildChromeArgs({ width: 1920, height: 1080 }, { gpuCapture: true });
    expect(args).toContain("--use-angle=opengl");
    expect(args).not.toContain("--use-angle=swiftshader");
  });

  it("preserves --use-gl=angle regardless of gpuCapture setting", () => {
    platformSpy.mockReturnValue("win32");
    const argsOff = buildChromeArgs({ width: 1920, height: 1080 });
    const argsOn = buildChromeArgs({ width: 1920, height: 1080 }, { gpuCapture: true });
    expect(argsOff).toContain("--use-gl=angle");
    expect(argsOn).toContain("--use-gl=angle");
  });

  it("appends --disable-gpu only when disableGpu is set", () => {
    platformSpy.mockReturnValue("linux");
    const argsDefault = buildChromeArgs({ width: 1280, height: 720 });
    const argsDisabled = buildChromeArgs({ width: 1280, height: 720 }, { disableGpu: true });
    expect(argsDefault).not.toContain("--disable-gpu");
    expect(argsDisabled).toContain("--disable-gpu");
  });

  it("gpuCapture and disableGpu compose correctly", () => {
    // Odd combo but should not throw: --use-angle=d3d11 + --disable-gpu.
    // Chrome resolves this at launch; build function stays pure.
    platformSpy.mockReturnValue("win32");
    const args = buildChromeArgs(
      { width: 1920, height: 1080 },
      { gpuCapture: true, disableGpu: true },
    );
    expect(args).toContain("--use-angle=d3d11");
    expect(args).toContain("--disable-gpu");
  });
});
