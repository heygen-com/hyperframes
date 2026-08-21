import { describe, expect, it } from "bun:test";
import { normalizeFfprobeMetadata, parseCanonicalFrameHashes } from "./plan-parity-analysis.js";

describe("parseCanonicalFrameHashes()", () => {
  it("returns ordered SHA-256 hashes from ffmpeg framemd5 output", () => {
    const first = "a".repeat(64);
    const second = "b".repeat(64);
    expect(
      parseCanonicalFrameHashes(
        [
          "#format: frame checksums",
          "#hash: SHA256",
          `0, 0, 0, 1, 16, ${first}`,
          `0, 1, 1, 1, 16, ${second}`,
          "",
        ].join("\n"),
      ),
    ).toEqual([first, second]);
  });

  it("refuses malformed or empty output", () => {
    expect(() => parseCanonicalFrameHashes("# only comments")).toThrow(/no decoded/);
    expect(() => parseCanonicalFrameHashes("0, 0, not-a-sha")).toThrow(/unexpected/);
  });
});

describe("normalizeFfprobeMetadata()", () => {
  it("normalizes relevant video, audio, and duration fields", () => {
    expect(
      normalizeFfprobeMetadata({
        streams: [
          {
            codec_type: "video",
            codec_name: "h264",
            width: 320,
            height: 180,
            pix_fmt: "yuv420p",
            avg_frame_rate: "30/1",
            r_frame_rate: "30/1",
            nb_frames: "60",
            color_space: "bt709",
            color_transfer: "bt709",
            color_primaries: "bt709",
          },
          {
            codec_type: "audio",
            codec_name: "aac",
            sample_rate: "48000",
            channels: 2,
            channel_layout: "stereo",
          },
        ],
        format: { duration: "2.000000" },
      }),
    ).toEqual({
      video: {
        codecName: "h264",
        width: 320,
        height: 180,
        pixelFormat: "yuv420p",
        averageFrameRate: "30/1",
        realFrameRate: "30/1",
        frameCount: 60,
        colorSpace: "bt709",
        colorTransfer: "bt709",
        colorPrimaries: "bt709",
      },
      audio: {
        codecName: "aac",
        sampleRate: 48_000,
        channels: 2,
        channelLayout: "stereo",
      },
      durationSeconds: 2,
    });
  });

  it("uses stream duration and maps N/A values to null", () => {
    expect(
      normalizeFfprobeMetadata({
        streams: [
          {
            codec_type: "video",
            codec_name: "rawvideo",
            width: 1,
            height: 1,
            nb_frames: "N/A",
            duration: "0.5",
          },
        ],
        format: {},
      }),
    ).toMatchObject({
      video: { frameCount: null },
      audio: null,
      durationSeconds: 0.5,
    });
  });
});
