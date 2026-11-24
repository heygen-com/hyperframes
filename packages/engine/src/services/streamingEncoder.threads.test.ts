import { describe, expect, it } from "vitest";
import { buildStreamingArgs } from "./streamingEncoder.js";

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
  it("caps the software encoder to the cores the overlap reserves", () => {
    const args = buildStreamingArgs({ ...base, softwareEncoderThreads: 2 }, "out.mp4");
    const at = args.indexOf("-threads");
    expect(at).toBeGreaterThan(-1);
    expect(args[at + 1]).toBe("2");
  });
});
