import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getCachedGpuEncoder,
  getCompiledGpuEncoders,
  getGpuEncoderName,
  getProbeArgs,
  mapPresetForGpuEncoder,
  parseEncoderPresetNames,
  resetCachedGpuEncoder,
  selectUsableGpuEncoder,
} from "./gpuEncoder.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("getCompiledGpuEncoders", () => {
  it("recognizes AMD AMF in FFmpeg's encoder list", () => {
    expect(
      getCompiledGpuEncoders(`
 V....D h264_nvenc           NVIDIA NVENC H.264 encoder
 V....D h264_amf             AMD AMF H.264 Encoder
 V....D h264_qsv             H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (Intel Quick Sync Video)
`),
    ).toEqual(["nvenc", "qsv", "amf"]);
  });
});

describe("selectUsableGpuEncoder", () => {
  it("runs probe checks concurrently while preserving candidate priority", async () => {
    vi.useFakeTimers();
    const started: string[] = [];
    const usable = selectUsableGpuEncoder(["nvenc", "amf"], async (encoder) => {
      started.push(encoder);
      await new Promise((resolve) => setTimeout(resolve, encoder === "nvenc" ? 50 : 1));
      return true;
    });

    await vi.advanceTimersByTimeAsync(1);
    expect(started).toEqual(["nvenc", "amf"]);

    await vi.advanceTimersByTimeAsync(49);
    expect(await usable).toBe("nvenc");
  });

  it("falls through from compiled-but-unusable NVENC to usable AMD AMF", async () => {
    const usable = await selectUsableGpuEncoder(["nvenc", "amf"], async (encoder) => {
      return encoder === "amf";
    });

    expect(usable).toBe("amf");
  });

  it("treats rejected probe checks as unusable", async () => {
    const usable = await selectUsableGpuEncoder(["nvenc", "amf"], async (encoder) => {
      if (encoder === "nvenc") {
        throw new Error("driver probe failed");
      }
      return encoder === "amf";
    });

    expect(usable).toBe("amf");
  });
});

describe("getGpuEncoderName", () => {
  it("maps AMD AMF to FFmpeg's h264 and hevc encoder names", () => {
    expect(getGpuEncoderName("amf", "h264")).toBe("h264_amf");
    expect(getGpuEncoderName("amf", "h265")).toBe("hevc_amf");
  });
});

describe("mapPresetForGpuEncoder", () => {
  describe("nvenc", () => {
    it.each([
      ["ultrafast", "p1"],
      ["superfast", "p1"],
      ["veryfast", "p2"],
      ["faster", "p3"],
      ["fast", "p4"],
      ["medium", "p4"],
      ["slow", "p5"],
      ["slower", "p6"],
      ["veryslow", "p7"],
      ["placebo", "p7"],
    ])("maps libx264 preset %s to NVENC %s", (input, expected) => {
      expect(mapPresetForGpuEncoder("nvenc", input)).toBe(expected);
    });

    it.each(["p1", "p2", "p3", "p4", "p5", "p6", "p7"])(
      "passes NVENC-native preset %s through unchanged",
      (preset) => {
        expect(mapPresetForGpuEncoder("nvenc", preset)).toBe(preset);
      },
    );

    it("falls back to p4 for unknown preset values", () => {
      expect(mapPresetForGpuEncoder("nvenc", "nonsense")).toBe("p4");
    });

    describe("on an ffmpeg build whose encoder lists only the legacy presets", () => {
      const legacy = parseEncoderPresetNames(LEGACY_NVENC_HELP);

      it.each([
        ["ultrafast", "hp"],
        ["superfast", "hp"],
        ["veryfast", "hp"],
        ["faster", "fast"],
        ["fast", "fast"],
        ["medium", "medium"],
        ["slow", "slow"],
        ["slower", "slow"],
        ["veryslow", "slow"],
        ["placebo", "slow"],
        ["p4", "medium"],
        ["nonsense", "medium"],
      ])("maps %s to the legacy preset %s", (input, expected) => {
        expect(mapPresetForGpuEncoder("nvenc", input, legacy)).toBe(expected);
      });
    });

    it("keeps the pN names when the encoder lists them", () => {
      const modern = parseEncoderPresetNames(MODERN_NVENC_HELP);
      expect(mapPresetForGpuEncoder("nvenc", "slow", modern)).toBe("p5");
      expect(mapPresetForGpuEncoder("nvenc", "p7", modern)).toBe("p7");
    });

    it("keeps the pN names when the encoder's list could not be read", () => {
      expect(mapPresetForGpuEncoder("nvenc", "slow", new Set())).toBe("p5");
    });
  });

  describe("qsv", () => {
    it.each([
      ["ultrafast", "veryfast"],
      ["superfast", "veryfast"],
      ["placebo", "veryslow"],
    ])("rewrites libx264-only preset %s to QSV-supported %s", (input, expected) => {
      expect(mapPresetForGpuEncoder("qsv", input)).toBe(expected);
    });

    it.each(["veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"])(
      "passes supported preset %s through unchanged",
      (preset) => {
        expect(mapPresetForGpuEncoder("qsv", preset)).toBe(preset);
      },
    );
  });

  describe("other encoders", () => {
    it.each(["videotoolbox", "vaapi", "amf"] as const)(
      "passes preset through unchanged for %s",
      (encoder) => {
        expect(mapPresetForGpuEncoder(encoder, "medium")).toBe("medium");
        expect(mapPresetForGpuEncoder(encoder, "ultrafast")).toBe("ultrafast");
      },
    );

    it("passes preset through unchanged when encoder is null (CPU)", () => {
      expect(mapPresetForGpuEncoder(null, "ultrafast")).toBe("ultrafast");
    });
  });
});

describe("getProbeArgs", () => {
  it("uses 320x240 probe dimensions for all GPU encoders", () => {
    const encoders = ["nvenc", "videotoolbox", "vaapi", "qsv", "amf"] as const;
    for (const encoder of encoders) {
      const args = getProbeArgs(encoder);
      expect(args).toContain("color=size=320x240:rate=1:duration=1");
    }
  });

  it("probes VideoToolbox with the same supported bitrate option as production", () => {
    const args = getProbeArgs("videotoolbox");

    expect(args).not.toContain("-q:v");
    expect(args[args.indexOf("-b:v") + 1]).toBe("1M");
    expect(args[args.indexOf("-allow_sw") + 1]).toBe("1");
  });
});

describe("getCachedGpuEncoder", () => {
  afterEach(() => resetCachedGpuEncoder());

  it("is one probe however many callers ask while it runs", () => {
    const first = getCachedGpuEncoder();
    expect(getCachedGpuEncoder()).toBe(first);
  });
});

const LEGACY_NVENC_HELP = `Encoder h264_nvenc [NVIDIA NVENC H.264 encoder]:
    General capabilities: dr1 delay hardware
h264_nvenc AVOptions:
  -preset            <int>        E..V....... Set the encoding preset (from 0 to 11) (default medium)
     default         0            E..V.......
     slow            1            E..V....... hq 2 passes
     medium          2            E..V....... hq 1 pass
     fast            3            E..V....... hp 1 pass
     hp              4            E..V.......
     hq              5            E..V.......
     bd              6            E..V.......
     ll              7            E..V....... low latency
     llhq            8            E..V....... low latency hq
     llhp            9            E..V....... low latency hp
     lossless        10           E..V.......
     losslesshp      11           E..V.......
  -profile           <int>        E..V....... Set the encoding profile (from 0 to 3) (default main)
     baseline        0            E..V.......
     main            1            E..V.......
`;

const MODERN_NVENC_HELP = `Encoder h264_nvenc [NVIDIA NVENC H.264 encoder]:
h264_nvenc AVOptions:
  -preset            <int>        E..V....... Set the encoding preset (from 0 to 18) (default p4)
     default         0            E..V.......
     slow            1            E..V....... hq 2 passes
     p1              12           E..V....... fastest (lowest quality)
     p4              15           E..V....... medium (default)
     p7              18           E..V....... slowest (best quality)
  -tune              <int>        E..V....... Set the encoding tuning info (from 1 to 4) (default hq)
     hq              1            E..V.......
`;

describe("parseEncoderPresetNames", () => {
  it("lists the names under -preset and stops at the next option", () => {
    expect([...parseEncoderPresetNames(LEGACY_NVENC_HELP)].sort()).toEqual(
      "bd default fast hp hq ll llhp llhq lossless losslesshp medium slow".split(" "),
    );
    const modern = parseEncoderPresetNames(MODERN_NVENC_HELP);
    expect(modern.has("p4")).toBe(true);
    expect(modern.has("main")).toBe(false);
  });

  it("is empty for text with no -preset option", () => {
    expect(parseEncoderPresetNames("Codec 'h264_nvenc' is not recognized by FFmpeg.").size).toBe(0);
  });
});
