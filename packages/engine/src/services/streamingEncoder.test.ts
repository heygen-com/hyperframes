/**
 * buildStreamingArgs unit tests.
 *
 * These tests focus on the FFmpeg CLI shape rather than spawning the encoder
 * — they're the cheap regression net for the HDR static-metadata bug
 * (side_data=[none] in the encoded MP4) reproduced by
 * packages/producer/scripts/hdr-smoke.ts. Without these assertions, future
 * refactors of the x265-params string can silently strip
 * master-display / max-cll and ship as SDR BT.2020 again.
 */

import { describe, expect, it } from "vitest";

import {
  buildStreamingArgs,
  createFrameReorderBuffer,
  type StreamingEncoderOptions,
} from "./streamingEncoder.js";
import { DEFAULT_HDR10_MASTERING } from "../utils/hdr.js";

const baseHdrPq: StreamingEncoderOptions = {
  fps: 30,
  width: 1920,
  height: 1080,
  codec: "h265",
  preset: "medium",
  quality: 23,
  pixelFormat: "yuv420p10le",
  useGpu: false,
  rawInputFormat: "rgb48le",
  hdr: { transfer: "pq" },
};

const baseHdrHlg: StreamingEncoderOptions = {
  ...baseHdrPq,
  hdr: { transfer: "hlg" },
};

const baseSdr: StreamingEncoderOptions = {
  fps: 30,
  width: 1920,
  height: 1080,
  codec: "h264",
  preset: "medium",
  quality: 23,
  useGpu: false,
};

function getX265ParamsValue(args: string[]): string | undefined {
  const idx = args.indexOf("-x265-params");
  return idx === -1 ? undefined : args[idx + 1];
}

describe("buildStreamingArgs", () => {
  describe("HDR PQ (libx265)", () => {
    it("emits master-display and max-cll in -x265-params", () => {
      const args = buildStreamingArgs(baseHdrPq, "/tmp/out.mp4");
      const x265 = getX265ParamsValue(args);
      expect(x265).toBeDefined();
      expect(x265).toContain(`master-display=${DEFAULT_HDR10_MASTERING.masterDisplay}`);
      expect(x265).toContain(`max-cll=${DEFAULT_HDR10_MASTERING.maxCll}`);
      expect(x265).toContain("colorprim=bt2020");
      expect(x265).toContain("transfer=smpte2084");
      expect(x265).toContain("colormatrix=bt2020nc");
    });

    it("tags the output stream with bt2020 / smpte2084 / tv range", () => {
      const args = buildStreamingArgs(baseHdrPq, "/tmp/out.mp4");
      expect(args).toContain("-colorspace:v");
      expect(args[args.indexOf("-colorspace:v") + 1]).toBe("bt2020nc");
      expect(args[args.indexOf("-color_primaries:v") + 1]).toBe("bt2020");
      expect(args[args.indexOf("-color_trc:v") + 1]).toBe("smpte2084");
      expect(args[args.indexOf("-color_range") + 1]).toBe("tv");
    });

    it("uses libx265 with -tag:v hvc1 for QuickTime compatibility", () => {
      const args = buildStreamingArgs(baseHdrPq, "/tmp/out.mp4");
      const cvIdx = args.indexOf("-c:v");
      expect(cvIdx).toBeGreaterThan(-1);
      expect(args[cvIdx + 1]).toBe("libx265");
      expect(args).toContain("-tag:v");
      expect(args[args.indexOf("-tag:v") + 1]).toBe("hvc1");
    });

    it("keeps the aq-mode prefix even with master-display present", () => {
      const args = buildStreamingArgs(baseHdrPq, "/tmp/out.mp4");
      const x265 = getX265ParamsValue(args);
      expect(x265?.startsWith("aq-mode=3")).toBe(true);
    });

    it("uses the simpler aq-mode prefix on ultrafast preset", () => {
      const args = buildStreamingArgs({ ...baseHdrPq, preset: "ultrafast" }, "/tmp/out.mp4");
      const x265 = getX265ParamsValue(args);
      expect(x265?.startsWith("aq-mode=3:")).toBe(true);
      expect(x265).not.toContain("aq-strength");
      expect(x265).toContain(`master-display=${DEFAULT_HDR10_MASTERING.masterDisplay}`);
    });
  });

  describe("HDR HLG (libx265)", () => {
    it("emits master-display, max-cll, and the HLG transfer", () => {
      const args = buildStreamingArgs(baseHdrHlg, "/tmp/out.mp4");
      const x265 = getX265ParamsValue(args);
      expect(x265).toContain("transfer=arib-std-b67");
      expect(x265).toContain(`master-display=${DEFAULT_HDR10_MASTERING.masterDisplay}`);
      expect(x265).toContain(`max-cll=${DEFAULT_HDR10_MASTERING.maxCll}`);
    });

    it("tags the output stream with arib-std-b67", () => {
      const args = buildStreamingArgs(baseHdrHlg, "/tmp/out.mp4");
      expect(args[args.indexOf("-color_trc:v") + 1]).toBe("arib-std-b67");
    });
  });

  describe("HDR raw input tagging", () => {
    it("tags the rawvideo input with the matching color metadata", () => {
      const args = buildStreamingArgs(baseHdrPq, "/tmp/out.mp4");
      const inputColorTrcIdx = args.indexOf("-color_trc");
      expect(inputColorTrcIdx).toBeGreaterThan(-1);
      expect(args[inputColorTrcIdx + 1]).toBe("smpte2084");
      const inputPrimariesIdx = args.indexOf("-color_primaries");
      expect(inputPrimariesIdx).toBeGreaterThan(-1);
      expect(args[inputPrimariesIdx + 1]).toBe("bt2020");
      // Pix_fmt of the raw input must match the buffer we hand FFmpeg.
      expect(args.indexOf("rgb48le")).toBeGreaterThan(-1);
    });

    it("does not strip the input color tags when bitrate is set instead of CRF", () => {
      const args = buildStreamingArgs({ ...baseHdrPq, bitrate: "20M" }, "/tmp/out.mp4");
      const x265 = getX265ParamsValue(args);
      expect(x265).toContain(`master-display=${DEFAULT_HDR10_MASTERING.masterDisplay}`);
      expect(args).toContain("-b:v");
      expect(args[args.indexOf("-b:v") + 1]).toBe("20M");
    });
  });

  describe("SDR fallback", () => {
    it("does NOT emit HDR mastering metadata for SDR encodes", () => {
      const args = buildStreamingArgs(baseSdr, "/tmp/out.mp4");
      const x264 = args[args.indexOf("-x264-params") + 1];
      expect(x264).toContain("colorprim=bt709");
      expect(x264).toContain("transfer=bt709");
      expect(x264).toContain("colormatrix=bt709");
      expect(x264).not.toContain("master-display");
      expect(x264).not.toContain("max-cll");
    });

    it("tags SDR output with bt709 and tv range", () => {
      const args = buildStreamingArgs(baseSdr, "/tmp/out.mp4");
      expect(args[args.indexOf("-color_trc:v") + 1]).toBe("bt709");
      expect(args[args.indexOf("-color_primaries:v") + 1]).toBe("bt709");
      expect(args[args.indexOf("-colorspace:v") + 1]).toBe("bt709");
      expect(args[args.indexOf("-color_range") + 1]).toBe("tv");
    });
  });

  describe("output path", () => {
    it("places the output path last after -y", () => {
      const args = buildStreamingArgs(baseHdrPq, "/tmp/some-output.mp4");
      expect(args[args.length - 2]).toBe("-y");
      expect(args[args.length - 1]).toBe("/tmp/some-output.mp4");
    });
  });

  describe("GPU preset mapping", () => {
    const baseGpu: StreamingEncoderOptions = {
      fps: 30,
      width: 1920,
      height: 1080,
      codec: "h264",
      preset: "ultrafast",
      quality: 28,
      useGpu: true,
    };

    function presetArg(args: string[]): string | undefined {
      const idx = args.indexOf("-preset");
      return idx === -1 ? undefined : args[idx + 1];
    }

    // Regression for the streaming-encode + --gpu failure: NVENC rejects
    // libx264 `ultrafast` with AVERROR(EINVAL), which previously surfaced
    // as a bare "FFmpeg exited with code -22".
    it("translates ultrafast to NVENC p1", () => {
      const args = buildStreamingArgs(baseGpu, "/tmp/out.mp4", "nvenc");
      expect(presetArg(args)).toBe("p1");
    });

    it("translates medium to NVENC p4", () => {
      const args = buildStreamingArgs({ ...baseGpu, preset: "medium" }, "/tmp/out.mp4", "nvenc");
      expect(presetArg(args)).toBe("p4");
    });

    // Same mapping applies to hevc_nvenc: NVENC's preset vocabulary is
    // codec-agnostic, so the helper must translate for H.265 too.
    it("translates libx264 preset names to NVENC pN for h265 as well", () => {
      for (const [libx264, nvencPreset] of [
        ["ultrafast", "p1"],
        ["medium", "p4"],
        ["veryslow", "p7"],
      ] as const) {
        const args = buildStreamingArgs(
          { ...baseGpu, codec: "h265", preset: libx264 },
          "/tmp/out.mp4",
          "nvenc",
        );
        expect(args[args.indexOf("-c:v") + 1]).toBe("hevc_nvenc");
        expect(presetArg(args)).toBe(nvencPreset);
      }
    });

    it("rewrites QSV's unsupported ultrafast preset to veryfast", () => {
      const args = buildStreamingArgs(baseGpu, "/tmp/out.mp4", "qsv");
      expect(presetArg(args)).toBe("veryfast");
    });

    it("passes QSV-supported preset names through unchanged", () => {
      const args = buildStreamingArgs({ ...baseGpu, preset: "medium" }, "/tmp/out.mp4", "qsv");
      expect(presetArg(args)).toBe("medium");
    });
  });
});

describe("createFrameReorderBuffer", () => {
  it("fast-paths waitForFrame(cursor) without queueing", async () => {
    const buf = createFrameReorderBuffer(0, 3);
    await buf.waitForFrame(0);
  });

  it("gates out-of-order writers into cursor order", async () => {
    const buf = createFrameReorderBuffer(0, 4);
    const writeOrder: number[] = [];

    const writer = async (frame: number) => {
      await buf.waitForFrame(frame);
      writeOrder.push(frame);
      buf.advanceTo(frame + 1);
    };

    const p3 = writer(3);
    const p1 = writer(1);
    const p2 = writer(2);
    const p0 = writer(0);

    await Promise.all([p0, p1, p2, p3]);
    expect(writeOrder).toEqual([0, 1, 2, 3]);
  });

  it("supports multiple waiters registered for the same frame", async () => {
    const buf = createFrameReorderBuffer(0, 2);
    const resolved: string[] = [];

    const a = buf.waitForFrame(1).then(() => resolved.push("a"));
    const b = buf.waitForFrame(1).then(() => resolved.push("b"));

    buf.advanceTo(0);
    await Promise.resolve();
    expect(resolved).toEqual([]);

    buf.advanceTo(1);
    await Promise.all([a, b]);
    expect(resolved.sort()).toEqual(["a", "b"]);
  });

  it("waitForAllDone resolves when cursor reaches endFrame", async () => {
    const buf = createFrameReorderBuffer(0, 3);
    let done = false;
    const allDone = buf.waitForAllDone().then(() => {
      done = true;
    });

    buf.advanceTo(1);
    await Promise.resolve();
    expect(done).toBe(false);

    buf.advanceTo(3);
    await allDone;
    expect(done).toBe(true);
  });

  it("waitForAllDone fast-paths when cursor already past endFrame", async () => {
    const buf = createFrameReorderBuffer(0, 3);
    buf.advanceTo(5);
    await buf.waitForAllDone();
  });
});
