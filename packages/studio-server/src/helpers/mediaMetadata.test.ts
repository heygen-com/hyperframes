import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyMediaColor, pixelFormatHasAlpha, probeMediaMetadata } from "./mediaMetadata.js";

afterEach(() => vi.unstubAllEnvs());

describe("classifyMediaColor", () => {
  it("detects HDR PQ from BT.2020 + smpte2084 metadata", () => {
    expect(
      classifyMediaColor({
        codec_type: "video",
        codec_name: "hevc",
        profile: "Main 10",
        pix_fmt: "yuv420p10le",
        color_space: "bt2020nc",
        color_transfer: "smpte2084",
        color_primaries: "bt2020",
      }),
    ).toMatchObject({
      dynamicRange: "hdr",
      hdrTransfer: "pq",
      label: "HDR PQ",
      isHdr: true,
    });
  });

  it("detects HDR HLG from arib-std-b67 metadata", () => {
    expect(
      classifyMediaColor({
        codec_type: "video",
        color_space: "bt2020nc",
        color_transfer: "arib-std-b67",
        color_primaries: "bt2020",
      }),
    ).toMatchObject({
      dynamicRange: "hdr",
      hdrTransfer: "hlg",
      label: "HDR HLG",
      isHdr: true,
    });
  });

  it("labels BT.709 media as SDR Rec.709", () => {
    expect(
      classifyMediaColor({
        codec_type: "video",
        color_space: "bt709",
        color_transfer: "bt709",
        color_primaries: "bt709",
      }),
    ).toMatchObject({
      dynamicRange: "sdr",
      hdrTransfer: null,
      label: "SDR Rec.709",
      isHdr: false,
    });
  });
});

describe("probeMediaMetadata", () => {
  it("reads the first video stream from ffprobe JSON", async () => {
    const metadata = await probeMediaMetadata("/tmp/clip.mp4", () => ({
      status: 0,
      stdout: JSON.stringify({
        streams: [
          { codec_type: "audio", codec_name: "aac" },
          {
            codec_type: "video",
            codec_name: "hevc",
            pix_fmt: "yuv420p10le",
            color_space: "bt2020nc",
            color_transfer: "smpte2084",
            color_primaries: "bt2020",
          },
        ],
      }),
      stderr: "",
    }));

    expect(metadata).toMatchObject({
      kind: "video",
      color: { isHdr: true, label: "HDR PQ" },
    });
  });

  it("ignores attached cover art and reads the real video stream", async () => {
    const metadata = await probeMediaMetadata("/tmp/clip.mp4", () => ({
      status: 0,
      stdout: JSON.stringify({
        streams: [
          {
            codec_type: "video",
            codec_name: "mjpeg",
            pix_fmt: "yuvj420p",
            disposition: { attached_pic: 1 },
          },
          {
            codec_type: "video",
            codec_name: "hevc",
            pix_fmt: "yuv420p10le",
            disposition: { attached_pic: 0 },
          },
        ],
      }),
      stderr: "",
    }));

    expect(metadata).toMatchObject({
      kind: "video",
      color: { codecName: "hevc", pixelFormat: "yuv420p10le" },
    });
  });

  it("returns unknown metadata when ffprobe is unavailable", async () => {
    await expect(
      probeMediaMetadata("/tmp/clip.mp4", () => ({
        status: null,
        stdout: "",
        stderr: "",
        error: { code: "ENOENT" } as NodeJS.ErrnoException,
      })),
    ).resolves.toMatchObject({
      kind: "video",
      color: { dynamicRange: "unknown", isHdr: false },
      probeError: "ffprobe unavailable",
    });
  });

  it("supports an injected async runner without requiring local ffprobe", async () => {
    vi.stubEnv("HYPERFRAMES_FFPROBE_PATH", "/definitely/missing/ffprobe");
    const metadata = await probeMediaMetadata("/tmp/clip.mp4", async () => ({
      status: 0,
      stdout: JSON.stringify({
        streams: [{ codec_type: "video", codec_name: "h264", pix_fmt: "yuv420p" }],
      }),
      stderr: "",
    }));
    expect(metadata).toMatchObject({ kind: "video", color: { codecName: "h264" } });
  });
});

describe("pixelFormatHasAlpha", () => {
  it("detects alpha-bearing pixel formats", () => {
    for (const pixFmt of [
      "yuva420p",
      "yuva444p10le",
      "rgba",
      "argb",
      "bgra",
      "abgr",
      "gbrap12le",
      "ya8",
    ]) {
      expect(pixelFormatHasAlpha(pixFmt)).toBe(true);
    }
    for (const pixFmt of ["yuv420p", "yuv422p10le", "rgb24", "gbrp", "gray", undefined]) {
      expect(pixelFormatHasAlpha(pixFmt)).toBe(false);
    }
  });
});
