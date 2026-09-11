import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureBrowser: vi.fn(),
  resolveBrowserGpuMode: vi.fn(async (): Promise<"hardware" | "software"> => "hardware"),
}));

vi.mock("./manager.js", () => ({
  ensureBrowser: mocks.ensureBrowser,
}));

vi.mock("@hyperframes/engine", () => ({
  resolveBrowserGpuMode: mocks.resolveBrowserGpuMode,
}));

import { detectColorGradingGpuStallRisk } from "./gpuPolicy.js";

const GRADED_HTML =
  '<div data-composition-id="main"><img data-color-grading=\'{"adjust":{"saturation":-1}}\' src="a.jpg" /></div>';
const UNGRADED_HTML = '<div data-composition-id="main"><img src="a.jpg" /></div>';

describe("detectColorGradingGpuStallRisk", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.ensureBrowser.mockResolvedValue({ executablePath: "/chrome", source: "cache" });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("warns when the composition uses color grading and no hardware GPU is found", async () => {
    mocks.resolveBrowserGpuMode.mockResolvedValue("software");
    const warning = await detectColorGradingGpuStallRisk(GRADED_HTML, "auto");
    expect(warning).toContain("data-color-grading");
    expect(warning).toContain("SwiftShader");
    expect(warning).toContain("--timeout");
  });

  it("stays silent when a real hardware GPU is found", async () => {
    mocks.resolveBrowserGpuMode.mockResolvedValue("hardware");
    const warning = await detectColorGradingGpuStallRisk(GRADED_HTML, "auto");
    expect(warning).toBeNull();
  });

  it("stays silent (and never probes) when the composition has no color grading", async () => {
    const warning = await detectColorGradingGpuStallRisk(UNGRADED_HTML, "auto");
    expect(warning).toBeNull();
    expect(mocks.ensureBrowser).not.toHaveBeenCalled();
    expect(mocks.resolveBrowserGpuMode).not.toHaveBeenCalled();
  });

  it("stays silent (and never probes) when software mode was explicitly requested", async () => {
    const warning = await detectColorGradingGpuStallRisk(GRADED_HTML, "software");
    expect(warning).toBeNull();
    expect(mocks.ensureBrowser).not.toHaveBeenCalled();
    expect(mocks.resolveBrowserGpuMode).not.toHaveBeenCalled();
  });

  it("forces an 'auto' probe even for an explicit --browser-gpu request, to get the ground truth", async () => {
    mocks.resolveBrowserGpuMode.mockResolvedValue("software");
    await detectColorGradingGpuStallRisk(GRADED_HTML, "hardware");
    expect(mocks.resolveBrowserGpuMode).toHaveBeenCalledWith("auto", { chromePath: "/chrome" });
  });

  it("treats a probe failure as nothing to warn about", async () => {
    mocks.resolveBrowserGpuMode.mockRejectedValue(new Error("probe boom"));
    const warning = await detectColorGradingGpuStallRisk(GRADED_HTML, "auto");
    expect(warning).toBeNull();
  });
});
