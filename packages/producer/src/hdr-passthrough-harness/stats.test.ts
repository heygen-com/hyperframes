import { describe, expect, it } from "bun:test";
import {
  DEFAULT_THRESHOLDS,
  PSNR_IDENTICAL_DB,
  checkHdrTags,
  checkPixelParity,
  classifyRenderLog,
  compareFrameHashes,
  expectedFrameCount,
  parseFrameRate,
  parseFramemd5,
  parseJobMs,
  parseCaptureStats,
  parseFfmpegVersion,
  compareProbes,
  describeRenderPath,
  expectedHdrTags,
  isFallback,
  parsePsnrStats,
  parseSsimStats,
  summarizeProbe,
  type ProbeSummary,
} from "./stats.js";

const PSNR_LOG = [
  "n:1 mse_avg:0.52 mse_y:0.61 mse_u:0.30 mse_v:0.33 psnr_avg:50.95 psnr_y:50.25 psnr_u:53.33 psnr_v:52.91",
  "n:2 mse_avg:0.00 mse_y:0.00 mse_u:0.00 mse_v:0.00 psnr_avg:inf psnr_y:inf psnr_u:inf psnr_v:inf",
  "n:3 mse_avg:2.10 mse_y:2.50 mse_u:1.00 mse_v:1.20 psnr_avg:44.05 psnr_y:43.20 psnr_u:48.00 psnr_v:47.40",
  "",
].join("\n");

const SSIM_LOG = [
  "n:1 Y:0.998 U:0.999 V:0.999 All:0.998500 (28.239)",
  "n:2 Y:0.990 U:0.995 V:0.995 All:0.991500 (20.713)",
  "n:3 Y:1.000 U:1.000 V:1.000 All:1.000000 (inf)",
].join("\n");

function probeFixture(overrides: Partial<ProbeSummary> = {}): ProbeSummary {
  return {
    videoCodec: "hevc",
    videoProfile: "Main 10",
    pixFmt: "yuv420p10le",
    width: 1920,
    height: 1080,
    frameRate: "30/1",
    colorPrimaries: "bt2020",
    colorTransfer: "arib-std-b67",
    colorSpace: "bt2020nc",
    colorRange: "tv",
    codecTag: "hvc1",
    videoFrames: 600,
    durationSec: 20,
    frameSideData: [],
    hasAudio: true,
    audioCodec: "aac",
    audioSampleRate: 48000,
    audioChannels: 2,
    ...overrides,
  };
}

describe("parsePsnrStats", () => {
  it("summarizes psnr_avg and counts identical frames at the cap", () => {
    const summary = parsePsnrStats(PSNR_LOG);
    expect(summary.frames).toBe(3);
    expect(summary.identicalFrames).toBe(1);
    expect(summary.min).toBeCloseTo(44.05, 5);
    expect(summary.minIndex).toBe(2);
    expect(summary.mean).toBeCloseTo((50.95 + PSNR_IDENTICAL_DB + 44.05) / 3, 5);
  });

  it("returns NaN stats for an empty file", () => {
    const summary = parsePsnrStats("");
    expect(summary.frames).toBe(0);
    expect(Number.isNaN(summary.mean)).toBe(true);
  });

  it("rejects a malformed value instead of silently skipping it", () => {
    expect(() => parsePsnrStats("n:1 psnr_avg:abc")).toThrow(/unparseable/);
  });
});

describe("parseSsimStats", () => {
  it("summarizes the All column", () => {
    const summary = parseSsimStats(SSIM_LOG);
    expect(summary.frames).toBe(3);
    expect(summary.min).toBeCloseTo(0.9915, 6);
    expect(summary.minIndex).toBe(1);
    expect(summary.mean).toBeCloseTo((0.9985 + 0.9915 + 1) / 3, 6);
  });
});

describe("summarizeProbe", () => {
  it("reads video, audio, packet count, duration and frame side data", () => {
    const streams = JSON.stringify({
      streams: [
        {
          codec_type: "video",
          codec_name: "hevc",
          profile: "Main 10",
          pix_fmt: "yuv420p10le",
          width: 1920,
          height: 1080,
          r_frame_rate: "30/1",
          color_primaries: "bt2020",
          color_transfer: "smpte2084",
          color_space: "bt2020nc",
          color_range: "tv",
          codec_tag_string: "hvc1",
          nb_read_packets: "600",
        },
        { codec_type: "audio", codec_name: "aac", sample_rate: "48000", channels: 2 },
      ],
      format: { duration: "20.000000" },
    });
    const frames = JSON.stringify({
      frames: [
        {
          side_data_list: [
            { side_data_type: "Mastering display metadata" },
            { side_data_type: "Content light level metadata" },
          ],
        },
      ],
    });
    const summary = summarizeProbe(streams, frames);
    expect(summary).toEqual(
      probeFixture({
        colorTransfer: "smpte2084",
        frameSideData: ["Content light level metadata", "Mastering display metadata"],
      }),
    );
  });

  it("reports a video-only file as having no audio", () => {
    const summary = summarizeProbe(JSON.stringify({ streams: [{ codec_type: "video" }] }));
    expect(summary.hasAudio).toBe(false);
    expect(summary.audioCodec).toBeNull();
    expect(summary.videoFrames).toBeNull();
    expect(summary.durationSec).toBeNull();
  });
});

describe("compareProbes", () => {
  it("passes identical outputs", () => {
    const results = compareProbes(probeFixture(), probeFixture(), 30);
    expect(results.every((result) => result.ok)).toBe(true);
  });

  it("flags tag, frame-count and audio differences by name", () => {
    const results = compareProbes(
      probeFixture(),
      probeFixture({ colorTransfer: "bt709", videoFrames: 599, hasAudio: false }),
      30,
    );
    const failed = results.filter((result) => !result.ok).map((result) => result.name);
    expect(failed).toEqual(["colorTransfer", "videoFrames", "hasAudio"]);
  });

  it("allows a one-frame container duration difference and no more", () => {
    const oneFrame = compareProbes(probeFixture(), probeFixture({ durationSec: 20 + 1 / 30 }), 30);
    expect(oneFrame.find((result) => result.name === "duration")?.ok).toBe(true);
    const twoFrames = compareProbes(probeFixture(), probeFixture({ durationSec: 20 + 2 / 30 }), 30);
    expect(twoFrames.find((result) => result.name === "duration")?.ok).toBe(false);
  });

  it("compares HDR frame side data", () => {
    const results = compareProbes(
      probeFixture({ frameSideData: ["Mastering display metadata"] }),
      probeFixture(),
      30,
    );
    expect(results.find((result) => result.name === "frameSideData")?.ok).toBe(false);
  });
});

describe("HDR tags", () => {
  it("maps transfers to ffprobe names", () => {
    expect(expectedHdrTags("hlg").colorTransfer).toBe("arib-std-b67");
    expect(expectedHdrTags("pq").colorTransfer).toBe("smpte2084");
  });

  it("fails an SDR output", () => {
    const results = checkHdrTags(
      "on",
      probeFixture({ colorPrimaries: "bt709", colorTransfer: "bt709", pixFmt: "yuv420p" }),
      "hlg",
    );
    expect(results.filter((result) => !result.ok).map((result) => result.name)).toEqual([
      "on.colorPrimaries",
      "on.colorTransfer",
      "on.pixFmt",
    ]);
  });
});

describe("checkPixelParity", () => {
  const good = { frames: 600, min: 41, mean: 47, minIndex: 3, identicalFrames: 0 };
  const goodSsim = { frames: 600, min: 0.985, mean: 0.995, minIndex: 3 };

  it("passes at the documented thresholds", () => {
    expect(checkPixelParity(good, goodSsim, 600).every((result) => result.ok)).toBe(true);
  });

  it("fails each metric independently", () => {
    const results = checkPixelParity(
      { ...good, min: 39.9, mean: 44.9 },
      { ...goodSsim, min: 0.97, mean: 0.98 },
      601,
      DEFAULT_THRESHOLDS,
    );
    expect(results.filter((result) => !result.ok).map((result) => result.name)).toEqual([
      "psnr.mean",
      "psnr.min",
      "ssim.mean",
      "ssim.min",
      "metrics.frames",
    ]);
  });
});

describe("classifyRenderLog", () => {
  it("reads an ineligibility reason and detail", () => {
    const path = classifyRenderLog(
      "[INFO] [Render] HDR passthrough off: transform_or_filter (hdr-source: matrix(0.9, ...))\n",
    );
    expect(path).toEqual({
      kind: "ineligible",
      reason: "transform_or_filter",
      detail: "hdr-source: matrix(0.9, ...)",
    });
    expect(isFallback(path)).toBe(true);
  });

  it("reads a reason followed by the logger's JSON context", () => {
    expect(
      classifyRenderLog(
        '[INFO] [Render] HDR passthrough off: not_full_canvas {"renderJobId":"001cc61e"}\n',
      ),
    ).toEqual({ kind: "ineligible", reason: "not_full_canvas", detail: undefined });
    expect(
      classifyRenderLog(
        '[INFO] [Render] HDR passthrough off: video_animated (wrap: x) {"renderJobId":"1"}\n',
      ),
    ).toEqual({ kind: "ineligible", reason: "video_animated", detail: "wrap: x" });
  });

  it("reads a reason with no detail", () => {
    expect(classifyRenderLog("[Render] HDR passthrough off: video_count\n")).toEqual({
      kind: "ineligible",
      reason: "video_count",
      detail: undefined,
    });
  });

  it("reads a stage failure with its error", () => {
    const path = classifyRenderLog(
      '[WARN] [Render] HDR passthrough failed; falling back to the layered HDR composite {"error":"captureOverlayStates: not implemented"}\n',
    );
    expect(path).toEqual({
      kind: "passthrough_error",
      detail: "captureOverlayStates: not implemented",
    });
    expect(describeRenderPath(path)).toContain("not implemented");
  });

  it("detects a completed passthrough", () => {
    const path = classifyRenderLog(
      '[INFO] [Render] HDR passthrough: overlay states captured {"states":21}\n',
    );
    expect(path).toEqual({ kind: "passthrough" });
    expect(isFallback(path)).toBe(false);
  });

  it("detects the layered stage and unknown logs", () => {
    expect(classifyRenderLog("Layered composite frame 10/600").kind).toBe("layered");
    expect(classifyRenderLog("nothing relevant").kind).toBe("unknown");
  });
});

describe("parseFfmpegVersion", () => {
  it("reads the version from the first line", () => {
    expect(
      parseFfmpegVersion(
        "ffmpeg version 7.0.2-static https://johnvansickle.com/ffmpeg/  Copyright (c) 2000-2024\nbuilt with gcc 8",
      ),
    ).toBe("7.0.2-static");
    expect(parseFfmpegVersion("ffmpeg version n8.0.1 Copyright (c) 2000-2025")).toBe("n8.0.1");
  });

  it("returns null for anything else", () => {
    expect(parseFfmpegVersion("")).toBeNull();
    expect(parseFfmpegVersion("command not found")).toBeNull();
  });
});

describe("parseCaptureStats", () => {
  it("reads the counts from the CLI log line's JSON meta", () => {
    const log = [
      "[INFO] HDR passthrough: something else",
      '[INFO] [Render] HDR passthrough: overlay states captured {"states":21,"candidates":84,"captures":11,"unique":11,"captureMs":2778}',
      "[INFO] done",
    ].join("\n");
    expect(parseCaptureStats(log)).toEqual({
      states: 21,
      candidates: 84,
      captures: 11,
      unique: 11,
      captureMs: 2778,
    });
  });

  it("is null without the line, with broken JSON, or with a missing count", () => {
    expect(parseCaptureStats("[INFO] Layered composite frame 1/600")).toBeNull();
    expect(parseCaptureStats("HDR passthrough: overlay states captured {nope}")).toBeNull();
    expect(
      parseCaptureStats('HDR passthrough: overlay states captured {"states":3,"unique":2}'),
    ).toBeNull();
  });
});

describe("parseFrameRate", () => {
  it("takes integers and num/den as the CLI does", () => {
    expect(parseFrameRate(30)).toEqual({ arg: "30", value: 30 });
    expect(parseFrameRate("30000/1001")).toEqual({ arg: "30000/1001", value: 30000 / 1001 });
  });

  it("rejects decimals, zero and junk", () => {
    expect(() => parseFrameRate("29.97")).toThrow();
    expect(() => parseFrameRate("0")).toThrow();
    expect(() => parseFrameRate("30/0")).toThrow();
    expect(() => parseFrameRate("fast")).toThrow();
  });
});

describe("expectedFrameCount", () => {
  it("rounds up a partial last frame and absorbs float noise at a whole frame", () => {
    expect(expectedFrameCount(7.01, 30)).toBe(211);
    expect(expectedFrameCount(5, 30)).toBe(150);
    expect(expectedFrameCount(5, 30000 / 1001)).toBe(150);
    expect(expectedFrameCount(0.1 + 0.2, 10)).toBe(3);
  });
});

describe("framemd5", () => {
  const output = [
    "#format: frame checksums",
    "#version: 2",
    "#tb 0: 1/30",
    "#stream#, dts,        pts, duration,     size, hash",
    "0,          0,          0,        1,  6220800, 0123456789abcdef0123456789abcdef",
    "0,          1,          1,        1,  6220800, fedcba9876543210fedcba9876543210",
    "",
  ].join("\n");

  it("reads one hash per frame, skipping the header", () => {
    expect(parseFramemd5(output)).toEqual([
      "0123456789abcdef0123456789abcdef",
      "fedcba9876543210fedcba9876543210",
    ]);
  });

  it("rejects a line without a hash", () => {
    expect(() => parseFramemd5("0, 0, 0, 1, 10, nope\n")).toThrow();
  });

  it("finds the first differing frame and counts a missing frame as different", () => {
    expect(compareFrameHashes(["a", "b"], ["a", "b"])).toEqual({
      referenceFrames: 2,
      candidateFrames: 2,
      identicalFrames: 2,
      firstDifference: null,
      identical: true,
    });
    expect(compareFrameHashes(["a", "b", "c"], ["a", "x", "c"]).firstDifference).toBe(1);
    const short = compareFrameHashes(["a", "b"], ["a"]);
    expect(short.identical).toBe(false);
    expect(short.firstDifference).toBe(1);
    expect(short.identicalFrames).toBe(1);
  });
});

describe("parseJobMs", () => {
  it("reads the assemble end checkpoint's elapsed time", () => {
    const log = [
      '[INFO] [Render:trace] {"renderJobId":"j","phase":"compile","status":"end","elapsedMs":136}',
      '[INFO] [Render:trace] {"renderJobId":"j","phase":"assemble","status":"start","elapsedMs":7383}',
      '[INFO] [Render:trace] {"renderJobId":"j","phase":"assemble","status":"end","elapsedMs":7634,"durationMs":251}',
      '[INFO] [Render:trace] {"renderJobId":"j","phase":"pipeline","status":"checkpoint","elapsedMs":7659}',
    ].join("\n");
    expect(parseJobMs(log)).toBe(7634);
  });

  it("is null without an assemble end line", () => {
    expect(parseJobMs("[INFO] [Render:trace] {broken\n")).toBeNull();
    expect(parseJobMs("")).toBeNull();
  });
});
