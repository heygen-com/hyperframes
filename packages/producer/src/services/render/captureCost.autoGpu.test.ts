import { describe, expect, it } from "vitest";
import {
  estimateMeasuredCaptureCostMultiplier,
  pickAutoGpuModeFromCalibration,
  settleAutoGpuChoice,
  shouldCalibrateSoftwareGpu,
} from "./captureCost.js";

const measured = (...ms: number[]) =>
  estimateMeasuredCaptureCostMultiplier(
    ms.map((captureTimeMs, frameIndex) => ({ frameIndex, captureTimeMs })),
  );

describe("shouldCalibrateSoftwareGpu", () => {
  const slowHardware = measured(1400, 1500, 1550, 1600, 1678);

  it("measures software when auto mode picked a hardware GPU that calibrated slow", () => {
    expect(shouldCalibrateSoftwareGpu("auto", "hardware", slowHardware)).toBe(true);
  });

  it("leaves an explicit GPU choice alone", () => {
    expect(shouldCalibrateSoftwareGpu("hardware", "hardware", slowHardware)).toBe(false);
  });

  it("does nothing when auto already picked software", () => {
    expect(shouldCalibrateSoftwareGpu("auto", "software", slowHardware)).toBe(false);
  });

  it("does nothing when the hardware path calibrated at baseline cost", () => {
    expect(shouldCalibrateSoftwareGpu("auto", "hardware", measured(200, 220, 250, 300, 310))).toBe(
      false,
    );
  });

  it("does nothing when calibration failed and measured no frames", () => {
    expect(
      shouldCalibrateSoftwareGpu("auto", "hardware", {
        multiplier: 8,
        reasons: ["calibration-failed"],
      }),
    ).toBe(false);
  });
});

describe("pickAutoGpuModeFromCalibration", () => {
  it("picks software when it captures faster than the hardware GPU (AMD Radeon 840M, D3D11)", () => {
    expect(
      pickAutoGpuModeFromCalibration(
        measured(1400, 1500, 1550, 1600, 1678),
        measured(150, 160, 170, 180, 190),
      ),
    ).toBe("software");
  });

  it("keeps hardware when it captures faster than software", () => {
    expect(
      pickAutoGpuModeFromCalibration(
        measured(700, 720, 750, 760, 800),
        measured(2000, 2100, 2200, 2300, 2400),
      ),
    ).toBe("hardware");
  });

  it("keeps hardware on a tie", () => {
    expect(
      pickAutoGpuModeFromCalibration(
        measured(900, 900, 900, 900, 900),
        measured(900, 900, 900, 900, 900),
      ),
    ).toBe("hardware");
  });

  it("keeps hardware when software calibration failed or did not run", () => {
    const hardware = measured(1400, 1500, 1550, 1600, 1678);
    expect(
      pickAutoGpuModeFromCalibration(hardware, { multiplier: 8, reasons: ["calibration-failed"] }),
    ).toBe("hardware");
    expect(pickAutoGpuModeFromCalibration(hardware, undefined)).toBe("hardware");
  });
});

describe("settleAutoGpuChoice", () => {
  const failed = { multiplier: 8, reasons: ["calibration-failed"] };

  it("settles hardware without timing software when the GPU path is not slow", () => {
    expect(settleAutoGpuChoice(measured(200, 220, 250, 300, 310), undefined)).toBe("hardware");
  });

  it("settles whichever measured faster when the GPU path is slow", () => {
    const slow = measured(1400, 1500, 1550, 1600, 1678);
    expect(settleAutoGpuChoice(slow, measured(150, 160, 170, 180, 190))).toBe("software");
    expect(settleAutoGpuChoice(slow, measured(2000, 2100, 2200, 2300, 2400))).toBe("hardware");
  });

  it("settles nothing when a calibration it needs measured nothing", () => {
    expect(settleAutoGpuChoice(undefined, undefined)).toBeUndefined();
    expect(settleAutoGpuChoice(failed, undefined)).toBeUndefined();
    expect(settleAutoGpuChoice(measured(1400, 1500, 1550, 1600, 1678), failed)).toBeUndefined();
    expect(settleAutoGpuChoice(measured(1400, 1500, 1550, 1600, 1678), undefined)).toBeUndefined();
  });
});
