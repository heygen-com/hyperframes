import { describe, it, expect, vi } from "vitest";
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

  it("returns prores 4444 with yuva444p10le for mov format", () => {
    const preset = getEncoderPreset("standard", "mov");
    expect(preset.codec).toBe("prores");
    expect(preset.preset).toBe("4444");
    expect(preset.pixelFormat).toBe("yuva444p10le");
  });

  it("uses prores 4444 for all mov quality levels", () => {
    for (const q of ["draft", "standard", "high"] as const) {
      const preset = getEncoderPreset(q, "mov");
      expect(preset.codec).toBe("prores");
      expect(preset.preset).toBe("4444");
    }
  });

  it("defaults to mp4 when format is omitted", () => {
    const preset = getEncoderPreset("standard");
    expect(preset.codec).toBe("h264");
    expect(preset.pixelFormat).toBe("yuv420p");
  });
});

describe("buildEncoderArgs anti-banding", () => {
  const baseOptions = { fps: { num: 30, den: 1 }, width: 1920, height: 1080 };

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
    expect(args[paramIdx + 1]).toContain("aq-mode=3");
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

describe("buildEncoderArgs fps rational forwarding", () => {
  // Regression for the fps fraction-syntax feature: rational fps must reach
  // ffmpeg's `-r` flag verbatim (e.g. "30000/1001") so NTSC stays exact end-
  // to-end rather than being rounded to 29.97 decimal at the encoder boundary.
  it("emits integer -r for { num: 30, den: 1 }", () => {
    const args = buildEncoderArgs(
      { fps: { num: 30, den: 1 }, width: 1920, height: 1080, codec: "h264" },
      ["-framerate", "30", "-i", "frames/%04d.png"],
      "out.mp4",
    );
    const rIdx = args.indexOf("-r");
    expect(rIdx).toBeGreaterThan(-1);
    expect(args[rIdx + 1]).toBe("30");
  });

  it("emits rational -r for NTSC { num: 30000, den: 1001 }", () => {
    const args = buildEncoderArgs(
      { fps: { num: 30000, den: 1001 }, width: 1920, height: 1080, codec: "h264" },
      ["-framerate", "30000/1001", "-i", "frames/%04d.png"],
      "out.mp4",
    );
    const rIdx = args.indexOf("-r");
    expect(rIdx).toBeGreaterThan(-1);
    expect(args[rIdx + 1]).toBe("30000/1001");
  });
});

describe("buildEncoderArgs GPU preset mapping", () => {
  const baseOptions = { fps: { num: 30, den: 1 }, width: 1920, height: 1080 };
  const inputArgs = ["-framerate", "30", "-i", "frames/%04d.png"];

  function presetArg(args: string[]): string | undefined {
    const idx = args.indexOf("-preset");
    return idx === -1 ? undefined : args[idx + 1];
  }

  // Regression for the "draft quality + --gpu fails with code -22" bug:
  // NVENC rejects the libx264 preset name `ultrafast` with AVERROR(EINVAL),
  // so the `draft` quality tier must not forward that value to h264_nvenc.
  it("translates the draft ultrafast preset to NVENC p1", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h264", preset: "ultrafast", quality: 28, useGpu: true },
      inputArgs,
      "out.mp4",
      "nvenc",
    );
    expect(presetArg(args)).toBe("p1");
  });

  it("translates the standard medium preset to NVENC p4", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h264", preset: "medium", quality: 18, useGpu: true },
      inputArgs,
      "out.mp4",
      "nvenc",
    );
    expect(presetArg(args)).toBe("p4");
  });

  it("translates the high slow preset to NVENC p5", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h264", preset: "slow", quality: 15, useGpu: true },
      inputArgs,
      "out.mp4",
      "nvenc",
    );
    expect(presetArg(args)).toBe("p5");
  });

  // hevc_nvenc uses the same p1..p7 preset vocabulary as h264_nvenc, so the
  // mapping must apply to both codecs. Locks in "H.264 and H.265 NVENC share
  // the preset mapping" against a future refactor that might split the path.
  it("translates libx264 preset names to NVENC p1..p7 for h265 as well", () => {
    for (const [libx264, nvencPreset] of [
      ["ultrafast", "p1"],
      ["medium", "p4"],
      ["veryslow", "p7"],
    ] as const) {
      const args = buildEncoderArgs(
        { ...baseOptions, codec: "h265", preset: libx264, quality: 23, useGpu: true },
        inputArgs,
        "out.mp4",
        "nvenc",
      );
      expect(args[args.indexOf("-c:v") + 1]).toBe("hevc_nvenc");
      expect(presetArg(args)).toBe(nvencPreset);
    }
  });

  it("rewrites QSV's unsupported ultrafast preset to veryfast", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h264", preset: "ultrafast", quality: 28, useGpu: true },
      inputArgs,
      "out.mp4",
      "qsv",
    );
    expect(presetArg(args)).toBe("veryfast");
  });

  it("passes QSV-supported preset names through unchanged", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h264", preset: "medium", quality: 23, useGpu: true },
      inputArgs,
      "out.mp4",
      "qsv",
    );
    expect(presetArg(args)).toBe("medium");
  });
});

describe("buildEncoderArgs color space", () => {
  const baseOptions = { fps: { num: 30, den: 1 }, width: 1920, height: 1080 };
  const inputArgs = ["-framerate", "30", "-i", "frames/%04d.png"];

  it("adds bt709 color space metadata for h264 CPU encoding", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h264", preset: "medium", quality: 23 },
      inputArgs,
      "out.mp4",
    );
    // FFmpeg-level metadata tags
    expect(args).toContain("-colorspace:v");
    expect(args[args.indexOf("-colorspace:v") + 1]).toBe("bt709");
    expect(args[args.indexOf("-color_primaries:v") + 1]).toBe("bt709");
    expect(args[args.indexOf("-color_trc:v") + 1]).toBe("bt709");
    expect(args[args.indexOf("-color_range") + 1]).toBe("tv");
    // x264-params VUI embedding
    const paramIdx = args.indexOf("-x264-params");
    expect(args[paramIdx + 1]).toContain("colorprim=bt709");
    expect(args[paramIdx + 1]).toContain("transfer=bt709");
    expect(args[paramIdx + 1]).toContain("colormatrix=bt709");
  });

  it("adds bt709 color space metadata for h265 CPU encoding", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h265", preset: "medium", quality: 23 },
      inputArgs,
      "out.mp4",
    );
    expect(args).toContain("-colorspace:v");
    expect(args[args.indexOf("-colorspace:v") + 1]).toBe("bt709");
    // x265-params VUI embedding
    const paramIdx = args.indexOf("-x265-params");
    expect(args[paramIdx + 1]).toContain("colorprim=bt709");
  });

  it("adds range conversion filter for CPU h264 encoding", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h264", preset: "medium", quality: 23 },
      inputArgs,
      "out.mp4",
    );
    const vfIdx = args.indexOf("-vf");
    expect(vfIdx).toBeGreaterThan(-1);
    expect(args[vfIdx + 1]).toContain("scale=in_range=pc:out_range=tv");
  });

  it("prepends range conversion to VAAPI filter chain", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h264", preset: "medium", quality: 23, useGpu: true },
      inputArgs,
      "out.mp4",
      "vaapi",
    );
    const vfIdx = args.indexOf("-vf");
    expect(vfIdx).toBeGreaterThan(-1);
    expect(args[vfIdx + 1]).toBe("scale=in_range=pc:out_range=tv,format=nv12,hwupload");
  });

  it("skips range conversion filter for non-VAAPI GPU encoding", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h264", preset: "medium", quality: 23, useGpu: true },
      inputArgs,
      "out.mp4",
      "nvenc",
    );
    expect(args.indexOf("-vf")).toBe(-1);
    // but still has color metadata
    expect(args).toContain("-colorspace:v");
  });

  it("does not add color metadata for VP9", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "vp9", preset: "good", quality: 23 },
      inputArgs,
      "out.webm",
    );
    expect(args).not.toContain("-colorspace:v");
  });

  it("adds video_track_timescale for h264", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h264", preset: "medium", quality: 23 },
      inputArgs,
      "out.mp4",
    );
    expect(args).toContain("-video_track_timescale");
    expect(args[args.indexOf("-video_track_timescale") + 1]).toBe("90000");
  });

  it("does not add timescale for VP9", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "vp9", preset: "good", quality: 23 },
      inputArgs,
      "out.webm",
    );
    expect(args).not.toContain("-video_track_timescale");
  });
});

describe("getEncoderPreset HDR", () => {
  it("returns h265 with 10-bit for HDR HLG", () => {
    const preset = getEncoderPreset("standard", "mp4", { transfer: "hlg" });
    expect(preset.codec).toBe("h265");
    expect(preset.pixelFormat).toBe("yuv420p10le");
    expect(preset.hdr).toEqual({ transfer: "hlg" });
  });

  it("returns h265 with 10-bit for HDR PQ", () => {
    const preset = getEncoderPreset("high", "mp4", { transfer: "pq" });
    expect(preset.codec).toBe("h265");
    expect(preset.pixelFormat).toBe("yuv420p10le");
    expect(preset.hdr).toEqual({ transfer: "pq" });
  });

  it("avoids ultrafast preset for HDR (upgrades to fast)", () => {
    const preset = getEncoderPreset("draft", "mp4", { transfer: "hlg" });
    expect(preset.preset).toBe("fast");
  });

  it("ignores HDR for webm format", () => {
    const preset = getEncoderPreset("standard", "webm", { transfer: "hlg" });
    expect(preset.codec).toBe("vp9");
    expect(preset.hdr).toBeUndefined();
  });

  it("ignores HDR for mov format", () => {
    const preset = getEncoderPreset("standard", "mov", { transfer: "pq" });
    expect(preset.codec).toBe("prores");
    expect(preset.hdr).toBeUndefined();
  });
});

describe("buildEncoderArgs lockGopForChunkConcat", () => {
  const baseOptions = { fps: { num: 30, den: 1 }, width: 1920, height: 1080 };
  const inputArgs = ["-framerate", "30", "-i", "frames/%04d.png"];

  // Default path must emit zero closed-GOP args — in-process renders rely on
  // libx264/libx265 defaults to stay byte-identical with their PSNR baselines.
  it("default (false) omits closed-GOP args for libx264", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h264", preset: "medium", quality: 23 },
      inputArgs,
      "out.mp4",
    );
    expect(args).not.toContain("-g");
    expect(args).not.toContain("-keyint_min");
    expect(args).not.toContain("-force_key_frames");
    expect(args).not.toContain("-sc_threshold");
    const paramIdx = args.indexOf("-x264-params");
    expect(args[paramIdx + 1]).not.toContain("scenecut=0");
    expect(args[paramIdx + 1]).not.toContain("open-gop=0");
    expect(args[paramIdx + 1]).not.toContain("repeat-headers=1");
  });

  it("default (false) omits closed-GOP args for libx265", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h265", preset: "medium", quality: 23 },
      inputArgs,
      "out.mp4",
    );
    expect(args).not.toContain("-g");
    expect(args).not.toContain("-keyint_min");
    expect(args).not.toContain("-force_key_frames");
    expect(args).not.toContain("-sc_threshold");
    const paramIdx = args.indexOf("-x265-params");
    expect(args[paramIdx + 1]).not.toContain("scenecut=0");
    expect(args[paramIdx + 1]).not.toContain("keyint=");
    expect(args[paramIdx + 1]).not.toContain("open-gop=0");
    expect(args[paramIdx + 1]).not.toContain("repeat-headers=1");
  });

  it("true appends closed-GOP ffmpeg flags and x264-params for libx264", () => {
    const args = buildEncoderArgs(
      {
        ...baseOptions,
        codec: "h264",
        preset: "medium",
        quality: 23,
        lockGopForChunkConcat: true,
        gopSize: 240,
      },
      inputArgs,
      "out.mp4",
    );
    expect(args[args.indexOf("-g") + 1]).toBe("240");
    expect(args[args.indexOf("-keyint_min") + 1]).toBe("240");
    expect(args[args.indexOf("-sc_threshold") + 1]).toBe("0");
    expect(args[args.indexOf("-force_key_frames") + 1]).toBe("expr:eq(mod(n,240),0)");
    const paramIdx = args.indexOf("-x264-params");
    expect(args[paramIdx + 1]).toContain("scenecut=0");
    expect(args[paramIdx + 1]).toContain("open-gop=0");
    expect(args[paramIdx + 1]).toContain("repeat-headers=1");
    // -bf 0 was already present for h264; closed-GOP doesn't change that.
    expect(args).toContain("-bf");
    expect(args[args.indexOf("-bf") + 1]).toBe("0");
    // 90000 timescale is required for clean concat-copy — already enforced for h264/h265.
    expect(args[args.indexOf("-video_track_timescale") + 1]).toBe("90000");
  });

  it("true appends closed-GOP x265-params keyint controls for libx265", () => {
    const args = buildEncoderArgs(
      {
        ...baseOptions,
        codec: "h265",
        preset: "medium",
        quality: 23,
        lockGopForChunkConcat: true,
        gopSize: 360,
      },
      inputArgs,
      "out.mp4",
    );
    expect(args[args.indexOf("-g") + 1]).toBe("360");
    expect(args[args.indexOf("-keyint_min") + 1]).toBe("360");
    expect(args[args.indexOf("-sc_threshold") + 1]).toBe("0");
    expect(args[args.indexOf("-force_key_frames") + 1]).toBe("expr:eq(mod(n,360),0)");
    const paramIdx = args.indexOf("-x265-params");
    expect(args[paramIdx + 1]).toContain("keyint=360");
    expect(args[paramIdx + 1]).toContain("min-keyint=360");
    expect(args[paramIdx + 1]).toContain("scenecut=0");
    expect(args[paramIdx + 1]).toContain("open-gop=0");
    expect(args[paramIdx + 1]).toContain("repeat-headers=1");
    // h265 normally tolerates B-frames; closed-GOP concat-copy doesn't.
    expect(args[args.indexOf("-bf") + 1]).toBe("0");
  });

  it("true preserves the x264-params anti-banding controls", () => {
    // The closed-GOP params join onto the existing aq-mode/deblock string —
    // make sure we didn't accidentally drop the anti-banding tuning.
    const args = buildEncoderArgs(
      {
        ...baseOptions,
        codec: "h264",
        preset: "medium",
        quality: 23,
        lockGopForChunkConcat: true,
        gopSize: 240,
      },
      inputArgs,
      "out.mp4",
    );
    const paramIdx = args.indexOf("-x264-params");
    expect(args[paramIdx + 1]).toContain("aq-mode=3");
    expect(args[paramIdx + 1]).toContain("aq-strength=0.8");
    expect(args[paramIdx + 1]).toContain("deblock=1,1");
    expect(args[paramIdx + 1]).toContain("colorprim=bt709");
  });

  it("true with ultrafast preset still emits closed-GOP params and skips deblock", () => {
    const args = buildEncoderArgs(
      {
        ...baseOptions,
        codec: "h264",
        preset: "ultrafast",
        quality: 28,
        lockGopForChunkConcat: true,
        gopSize: 240,
      },
      inputArgs,
      "out.mp4",
    );
    expect(args[args.indexOf("-g") + 1]).toBe("240");
    const paramIdx = args.indexOf("-x264-params");
    expect(args[paramIdx + 1]).toContain("aq-mode=3");
    expect(args[paramIdx + 1]).toContain("scenecut=0");
    expect(args[paramIdx + 1]).not.toContain("deblock");
  });

  it("true is a no-op on GPU encoders", () => {
    // GPU encoders take a separate code path; lockGopForChunkConcat does not
    // wire `-g` / `-keyint_min` into nvenc/qsv/vaapi.
    const args = buildEncoderArgs(
      {
        ...baseOptions,
        codec: "h264",
        preset: "medium",
        quality: 23,
        useGpu: true,
        lockGopForChunkConcat: true,
        gopSize: 240,
      },
      inputArgs,
      "out.mp4",
      "nvenc",
    );
    expect(args).not.toContain("-g");
    expect(args).not.toContain("-keyint_min");
    expect(args).not.toContain("-force_key_frames");
    expect(args).not.toContain("-sc_threshold");
    expect(args.indexOf("-x264-params")).toBe(-1);
  });

  it("true appends closed-GOP args for libvpx-vp9", () => {
    const args = buildEncoderArgs(
      {
        ...baseOptions,
        codec: "vp9",
        preset: "good",
        quality: 23,
        lockGopForChunkConcat: true,
        gopSize: 240,
      },
      inputArgs,
      "out.webm",
    );
    expect(args[args.indexOf("-g") + 1]).toBe("240");
    expect(args[args.indexOf("-keyint_min") + 1]).toBe("240");
    expect(args[args.indexOf("-auto-alt-ref") + 1]).toBe("0");
    expect(args[args.indexOf("-cpu-used") + 1]).toBe("2");
    expect(args[args.indexOf("-deadline") + 1]).toBe("good");
    expect(args.indexOf("-x264-params")).toBe(-1);
    expect(args.indexOf("-x265-params")).toBe(-1);
    expect(args.indexOf("-sc_threshold")).toBe(-1);
    expect(args.indexOf("-force_key_frames")).toBe(-1);
  });

  it("default (false) omits closed-GOP args for libvpx-vp9", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "vp9", preset: "good", quality: 23 },
      inputArgs,
      "out.webm",
    );
    expect(args).not.toContain("-g");
    expect(args).not.toContain("-keyint_min");
    expect(args).not.toContain("-cpu-used");
    // The non-locked, non-alpha VP9 path leaves `-auto-alt-ref` at the
    // libvpx default. Alpha branches still emit `-auto-alt-ref 0` for an
    // unrelated reason (alpha + alt-ref is unsupported), but that's a
    // separate test below.
    expect(args).not.toContain("-auto-alt-ref");
  });

  it("true with alpha pixel format keeps alpha metadata and emits -auto-alt-ref once", () => {
    // Regression: alpha + closed-GOP must NOT double-push `-auto-alt-ref 0`.
    // Both paths want it disabled; the encoder branch emits it exactly once.
    const args = buildEncoderArgs(
      {
        ...baseOptions,
        codec: "vp9",
        preset: "good",
        quality: 23,
        pixelFormat: "yuva420p",
        lockGopForChunkConcat: true,
        gopSize: 240,
      },
      inputArgs,
      "out.webm",
    );
    const autoAltRefIndices = args.reduce<number[]>((acc, a, i) => {
      if (a === "-auto-alt-ref") acc.push(i);
      return acc;
    }, []);
    expect(autoAltRefIndices.length).toBe(1);
    expect(args[autoAltRefIndices[0] + 1]).toBe("0");
    expect(args[args.indexOf("-metadata:s:v:0") + 1]).toBe("alpha_mode=1");
    expect(args[args.indexOf("-g") + 1]).toBe("240");
  });

  it("vp9 + lockGopForChunkConcat=true throws on missing gopSize", () => {
    // Mirrors the libx264/libx265 branch: closed-GOP without a GOP size
    // makes no sense — surface the caller error eagerly.
    expect(() =>
      buildEncoderArgs(
        {
          ...baseOptions,
          codec: "vp9",
          preset: "good",
          quality: 23,
          lockGopForChunkConcat: true,
        },
        inputArgs,
        "out.webm",
      ),
    ).toThrow(/lockGopForChunkConcat=true requires a positive integer gopSize/);
  });

  it("true is a no-op on ProRes (intra-only — no GOP forcing needed)", () => {
    const args = buildEncoderArgs(
      {
        ...baseOptions,
        codec: "prores",
        preset: "4444",
        quality: 23,
        lockGopForChunkConcat: true,
        gopSize: 240,
      },
      inputArgs,
      "out.mov",
    );
    expect(args).not.toContain("-g");
    expect(args).not.toContain("-keyint_min");
    expect(args).not.toContain("-force_key_frames");
  });

  it("true with missing or invalid gopSize throws", () => {
    for (const bad of [undefined, 0, -10, NaN, Infinity]) {
      expect(() =>
        buildEncoderArgs(
          {
            ...baseOptions,
            codec: "h264",
            preset: "medium",
            quality: 23,
            lockGopForChunkConcat: true,
            gopSize: bad as number | undefined,
          },
          inputArgs,
          "out.mp4",
        ),
      ).toThrow(/lockGopForChunkConcat=true requires a positive integer gopSize/);
    }
  });

  it("HDR + closed-GOP keeps HDR mastering metadata in x265-params", () => {
    const args = buildEncoderArgs(
      {
        ...baseOptions,
        codec: "h265",
        preset: "medium",
        quality: 23,
        hdr: { transfer: "pq" },
        lockGopForChunkConcat: true,
        gopSize: 240,
      },
      inputArgs,
      "out.mp4",
    );
    const paramIdx = args.indexOf("-x265-params");
    expect(args[paramIdx + 1]).toContain("colorprim=bt2020");
    expect(args[paramIdx + 1]).toContain("transfer=smpte2084");
    expect(args[paramIdx + 1]).toContain("master-display=");
    expect(args[paramIdx + 1]).toContain("max-cll=");
    expect(args[paramIdx + 1]).toContain("keyint=240");
    expect(args[paramIdx + 1]).toContain("scenecut=0");
  });
});

describe("buildEncoderArgs HDR color space", () => {
  const baseOptions = { fps: { num: 30, den: 1 }, width: 1920, height: 1080 };
  const inputArgs = ["-framerate", "30", "-i", "frames/%04d.png"];

  it("emits BT.2020 + arib-std-b67 tags for HDR HLG (h265 SW)", () => {
    // When options.hdr is set, the caller asserts the input pixels are
    // already in the BT.2020 color space — tag the output truthfully so
    // HDR-aware players apply the right transform.
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h265", preset: "medium", quality: 23, hdr: { transfer: "hlg" } },
      inputArgs,
      "out.mp4",
    );
    expect(args[args.indexOf("-colorspace:v") + 1]).toBe("bt2020nc");
    expect(args[args.indexOf("-color_primaries:v") + 1]).toBe("bt2020");
    expect(args[args.indexOf("-color_trc:v") + 1]).toBe("arib-std-b67");
    const paramIdx = args.indexOf("-x265-params");
    expect(args[paramIdx + 1]).toContain("colorprim=bt2020");
    expect(args[paramIdx + 1]).toContain("transfer=arib-std-b67");
    expect(args[paramIdx + 1]).toContain("colormatrix=bt2020nc");
  });

  it("emits BT.2020 + smpte2084 tags for HDR PQ (h265 SW)", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h265", preset: "medium", quality: 23, hdr: { transfer: "pq" } },
      inputArgs,
      "out.mp4",
    );
    expect(args[args.indexOf("-colorspace:v") + 1]).toBe("bt2020nc");
    expect(args[args.indexOf("-color_primaries:v") + 1]).toBe("bt2020");
    expect(args[args.indexOf("-color_trc:v") + 1]).toBe("smpte2084");
    const paramIdx = args.indexOf("-x265-params");
    expect(args[paramIdx + 1]).toContain("colorprim=bt2020");
    expect(args[paramIdx + 1]).toContain("transfer=smpte2084");
    expect(args[paramIdx + 1]).toContain("colormatrix=bt2020nc");
  });

  it("embeds HDR static mastering metadata in x265-params when HDR is set", () => {
    // master-display + max-cll SEI messages are required so HDR-aware
    // players (Apple QuickTime, YouTube, HDR TVs) treat the stream as
    // HDR10 instead of falling back to SDR BT.2020 tone-mapping.
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h265", preset: "medium", quality: 23, hdr: { transfer: "pq" } },
      inputArgs,
      "out.mp4",
    );
    const paramIdx = args.indexOf("-x265-params");
    expect(args[paramIdx + 1]).toContain("master-display=");
    expect(args[paramIdx + 1]).toContain("max-cll=");
  });

  it("uses bt709 when HDR is not set (SDR Chrome captures)", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h265", preset: "medium", quality: 23 },
      inputArgs,
      "out.mp4",
    );
    expect(args[args.indexOf("-colorspace:v") + 1]).toBe("bt709");
    expect(args[args.indexOf("-color_trc:v") + 1]).toBe("bt709");
    const paramIdx = args.indexOf("-x265-params");
    expect(args[paramIdx + 1]).toContain("colorprim=bt709");
    expect(args[paramIdx + 1]).not.toContain("master-display");
  });

  it("does not embed HDR mastering metadata when HDR is not set", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h265", preset: "medium", quality: 23 },
      inputArgs,
      "out.mp4",
    );
    const paramIdx = args.indexOf("-x265-params");
    expect(args[paramIdx + 1]).not.toContain("master-display");
    expect(args[paramIdx + 1]).not.toContain("max-cll");
  });

  it("strips HDR and tags as SDR/BT.709 when codec=h264 (libx264 has no HDR support)", () => {
    // libx264 cannot encode HDR. Rather than emit a "half-HDR" file (BT.2020
    // container tags + BT.709 VUI inside the bitstream — confusing to HDR-aware
    // players), we strip hdr and tag the whole output as SDR/BT.709. The caller
    // gets a warning telling them to use codec=h265 for real HDR output.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h264", preset: "medium", quality: 23, hdr: { transfer: "pq" } },
      inputArgs,
      "out.mp4",
    );
    const paramIdx = args.indexOf("-x264-params");
    expect(args[paramIdx + 1]).toContain("colorprim=bt709");
    expect(args[paramIdx + 1]).not.toContain("master-display");
    expect(args[args.indexOf("-colorspace:v") + 1]).toBe("bt709");
    expect(args[args.indexOf("-color_primaries:v") + 1]).toBe("bt709");
    expect(args[args.indexOf("-color_trc:v") + 1]).toBe("bt709");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("HDR is not supported with codec=h264"),
    );
    warnSpy.mockRestore();
  });

  it("uses range conversion for HDR CPU encoding", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h265", preset: "medium", quality: 23, hdr: { transfer: "hlg" } },
      inputArgs,
      "out.mp4",
    );
    const vfIdx = args.indexOf("-vf");
    expect(vfIdx).toBeGreaterThan(-1);
    expect(args[vfIdx + 1]).toContain("scale=in_range=pc:out_range=tv");
  });

  it("uses same range conversion for SDR CPU encoding", () => {
    const args = buildEncoderArgs(
      { ...baseOptions, codec: "h264", preset: "medium", quality: 23 },
      inputArgs,
      "out.mp4",
    );
    const vfIdx = args.indexOf("-vf");
    expect(args[vfIdx + 1]).toContain("scale=in_range=pc:out_range=tv");
  });

  it("tags BT.2020 + transfer for HDR GPU H.265 (no mastering metadata via -x265-params)", () => {
    // GPU encoders (nvenc, videotoolbox, qsv, vaapi) still emit the BT.2020
    // color tags via the codec-level -colorspace/-color_primaries/-color_trc
    // flags, but cannot accept x265-params, so HDR static mastering metadata
    // (master-display, max-cll) is not embedded. Acceptable for previews,
    // not for HDR-aware delivery.
    const args = buildEncoderArgs(
      {
        ...baseOptions,
        codec: "h265",
        preset: "medium",
        quality: 23,
        useGpu: true,
        hdr: { transfer: "pq" },
      },
      inputArgs,
      "out.mp4",
      "nvenc",
    );
    expect(args[args.indexOf("-colorspace:v") + 1]).toBe("bt2020nc");
    expect(args[args.indexOf("-color_primaries:v") + 1]).toBe("bt2020");
    expect(args[args.indexOf("-color_trc:v") + 1]).toBe("smpte2084");
    expect(args.indexOf("-x265-params")).toBe(-1);
  });
});
