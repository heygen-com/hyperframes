import { describe, it, expect } from "vitest";
import { ENCODER_PRESETS } from "./chunkEncoder.js";

describe("ENCODER_PRESETS", () => {
  it("has draft, standard, and high presets", () => {
    expect(ENCODER_PRESETS).toHaveProperty("draft");
    expect(ENCODER_PRESETS).toHaveProperty("standard");
    expect(ENCODER_PRESETS).toHaveProperty("high");
  });

  it("draft uses ultrafast preset with high CRF", () => {
    expect(ENCODER_PRESETS.draft.preset).toBe("ultrafast");
    expect(ENCODER_PRESETS.draft.quality).toBeGreaterThan(ENCODER_PRESETS.standard.quality);
    expect(ENCODER_PRESETS.draft.codec).toBe("h264");
  });

  it("high uses slow preset with low CRF for better quality", () => {
    expect(ENCODER_PRESETS.high.preset).toBe("slow");
    expect(ENCODER_PRESETS.high.quality).toBeLessThan(ENCODER_PRESETS.standard.quality);
    expect(ENCODER_PRESETS.high.codec).toBe("h264");
  });

  it("standard sits between draft and high in quality", () => {
    expect(ENCODER_PRESETS.standard.quality).toBeGreaterThan(ENCODER_PRESETS.high.quality);
    expect(ENCODER_PRESETS.standard.quality).toBeLessThan(ENCODER_PRESETS.draft.quality);
  });
});
