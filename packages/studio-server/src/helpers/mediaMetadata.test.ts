import { describe, expect, it } from "vitest";
import { classifyMediaColor, probeMediaMetadata } from "./mediaMetadata.js";

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
  it("reads the first video stream from ffprobe JSON", () => {
    const metadata = probeMediaMetadata("/tmp/clip.mp4", () => ({
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

  it("returns unknown metadata when ffprobe is unavailable", () => {
    expect(
      probeMediaMetadata("/tmp/clip.mp4", () => ({
        status: null,
        stdout: "",
        stderr: "",
        error: { code: "ENOENT" } as NodeJS.ErrnoException,
      })),
    ).toMatchObject({
      kind: "video",
      color: { dynamicRange: "unknown", isHdr: false },
      probeError: "ffprobe unavailable",
    });
  });
});
