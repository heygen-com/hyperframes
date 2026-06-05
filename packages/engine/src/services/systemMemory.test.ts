import { describe, it, expect } from "vitest";
import { isLowMemorySystem, LOW_MEMORY_TOTAL_MB_THRESHOLD } from "./systemMemory.js";

describe("isLowMemorySystem", () => {
  it("treats sub-threshold RAM as low-memory", () => {
    expect(isLowMemorySystem(4096)).toBe(true);
    expect(isLowMemorySystem(6000)).toBe(true);
    expect(isLowMemorySystem(7600)).toBe(true);
  });

  it("includes machines reporting exactly the threshold (8 GB boundary)", () => {
    // Real "8 GB" hosts report at/just under 8192 MiB after firmware/iGPU
    // reservations — the inclusive bound is the whole point (issue #1219).
    expect(isLowMemorySystem(LOW_MEMORY_TOTAL_MB_THRESHOLD)).toBe(true);
    expect(isLowMemorySystem(8192)).toBe(true);
  });

  it("treats above-threshold RAM as normal", () => {
    expect(isLowMemorySystem(8193)).toBe(false);
    expect(isLowMemorySystem(16384)).toBe(false);
    expect(isLowMemorySystem(65536)).toBe(false);
  });
});
