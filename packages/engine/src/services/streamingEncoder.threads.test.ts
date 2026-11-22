import { describe, expect, it } from "vitest";
import { buildStreamingArgs } from "./streamingEncoder.js";
import { cpuBudget } from "./systemMemory.js";

const base = {
  fps: { num: 30, den: 1 },
  width: 64,
  height: 64,
  codec: "h264" as const,
  preset: "medium",
  quality: 16,
  pixelFormat: "yuv420p",
};

describe("streaming encoder threads during a capture overlap", () => {
  it("keeps the full CPU budget, so an overlapped encode matches one after capture", () => {
    const args = buildStreamingArgs({ ...base, belowNormalPriority: true }, "out.mp4");
    const at = args.indexOf("-threads");
    expect(at).toBeGreaterThan(-1);
    expect(args[at + 1]).toBe(String(Math.max(1, Math.floor(cpuBudget()))));
  });
});
