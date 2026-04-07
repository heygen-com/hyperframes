import { describe, it, expect } from "vitest";
import { ENCODER_PRESETS, getEncoderPreset, buildEncoderArgs } from "./chunkEncoder.js";

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

describe("getEncoderPreset", () => {
  it("returns h264 with yuv420p for mp4 format", () => {
    const preset = getEncoderPreset("standard", "mp4");
    expect(preset.codec).toBe("h264");
    expect(preset.pixelFormat).toBe("yuv420p");
  });

  it("returns vp9 with yuva420p for webm format", () => {
    const preset = getEncoderPreset("standard", "webm");
    expect(preset.codec).toBe("vp9");
    expect(preset.pixelFormat).toBe("yuva420p");
  });

  it("maps draft ultrafast to vp9 realtime deadline", () => {
    const preset = getEncoderPreset("draft", "webm");
    expect(preset.preset).toBe("realtime");
    expect(preset.codec).toBe("vp9");
  });

  it("maps standard/high to vp9 good deadline", () => {
    expect(getEncoderPreset("standard", "webm").preset).toBe("good");
    expect(getEncoderPreset("high", "webm").preset).toBe("good");
  });

  it("preserves quality values across formats", () => {
    for (const q of ["draft", "standard", "high"] as const) {
      expect(getEncoderPreset(q, "webm").quality).toBe(ENCODER_PRESETS[q].quality);
    }
  });

  it("defaults to mp4 when format is omitted", () => {
    const preset = getEncoderPreset("standard");
    expect(preset.codec).toBe("h264");
    expect(preset.pixelFormat).toBe("yuv420p");
  });
});

describe("buildEncoderArgs anti-banding", () => {
  const baseOptions = { fps: 30, width: 1920, height: 1080 };

  it("adds aq-mode=3 x264-params for h264 CPU encoding", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h264", preset: "medium", quality: 23 },
      ["-framerate", "30", "-i", "frames/%04d.png"],
      "out.mp4",
    );
    const paramIdx = args.indexOf("-x264-params");
    expect(paramIdx).toBeGreaterThan(-1);
    expect(args[paramIdx + 1]).toContain("aq-mode=3");
  });

  it("adds aq-mode=3 x265-params for h265 CPU encoding", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h265", preset: "medium", quality: 23 },
      ["-framerate", "30", "-i", "frames/%04d.png"],
      "out.mp4",
    );
    const paramIdx = args.indexOf("-x265-params");
    expect(paramIdx).toBeGreaterThan(-1);
    expect(args[paramIdx + 1]).toContain("aq-mode=3");
  });

  it("includes deblock for non-ultrafast presets", () => {
    for (const preset of ["medium", "slow"]) {
      const args = buildEncoderArgs(
        { ...baseOptions, codec: "h264", preset, quality: 23 },
        ["-framerate", "30", "-i", "frames/%04d.png"],
        "out.mp4",
      );
      const paramIdx = args.indexOf("-x264-params");
      expect(args[paramIdx + 1]).toContain("deblock=1,1");
    }
  });

  it("omits deblock for ultrafast (draft) preset", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h264", preset: "ultrafast", quality: 28 },
      ["-framerate", "30", "-i", "frames/%04d.png"],
      "out.mp4",
    );
    const paramIdx = args.indexOf("-x264-params");
    expect(paramIdx).toBeGreaterThan(-1);
    expect(args[paramIdx + 1]).toBe("aq-mode=3");
    expect(args[paramIdx + 1]).not.toContain("deblock");
  });

  it("does not add x264-params for GPU encoding", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h264", preset: "medium", quality: 23, useGpu: true },
      ["-framerate", "30", "-i", "frames/%04d.png"],
      "out.mp4",
      "nvenc",
    );
    expect(args.indexOf("-x264-params")).toBe(-1);
  });

  it("does not add x264-params for VP9 encoding", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "vp9", preset: "good", quality: 23 },
      ["-framerate", "30", "-i", "frames/%04d.png"],
      "out.webm",
    );
    expect(args.indexOf("-x264-params")).toBe(-1);
    expect(args.indexOf("-x265-params")).toBe(-1);
  });
});
