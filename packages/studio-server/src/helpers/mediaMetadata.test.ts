import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyMediaColor, probeMediaMetadata } from "./mediaMetadata.js";

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

  it("reports whether a video carries an audio stream", async () => {
    const withAudio = await probeMediaMetadata("/tmp/clip.mp4", () => ({
      status: 0,
      stdout: JSON.stringify({
        streams: [
          { codec_type: "video", codec_name: "h264" },
          { codec_type: "audio", codec_name: "aac" },
        ],
      }),
      stderr: "",
    }));
    expect(withAudio).toMatchObject({ kind: "video", hasAudio: true, audioStream: 0 });

    // A phone's spatial track names no codec ffmpeg can decode; the AAC track after it is the one to play.
    const phone = await probeMediaMetadata("/tmp/phone.mov", () => ({
      status: 0,
      stdout: JSON.stringify({
        streams: [
          { codec_type: "video", codec_name: "hevc" },
          { codec_type: "audio" },
          { codec_type: "audio", codec_name: "aac" },
        ],
      }),
      stderr: "",
    }));
    expect(phone).toMatchObject({ kind: "video", hasAudio: true, audioStream: 1 });
    const spatialOnly = await probeMediaMetadata("/tmp/spatial.mov", () => ({
      status: 0,
      stdout: JSON.stringify({
        streams: [{ codec_type: "video", codec_name: "hevc" }, { codec_type: "audio" }],
      }),
      stderr: "",
    }));
    expect(spatialOnly).toMatchObject({ kind: "video", hasAudio: false });
    expect(spatialOnly).not.toHaveProperty("audioStream");

    const silent = await probeMediaMetadata("/tmp/silent.mp4", () => ({
      status: 0,
      stdout: JSON.stringify({ streams: [{ codec_type: "video", codec_name: "h264" }] }),
      stderr: "",
    }));
    expect(silent).toMatchObject({ kind: "video", hasAudio: false });

    // An audio file is not a video; the flag is a video question only.
    const audioFile = await probeMediaMetadata("/tmp/music.wav", () => ({
      status: 0,
      stdout: "{}",
      stderr: "",
    }));
    expect(audioFile).not.toHaveProperty("hasAudio");
  });

  it("reads a flac file as audio", async () => {
    const flac = await probeMediaMetadata("/tmp/music.flac", () => ({
      status: 0,
      stdout: "{}",
      stderr: "",
    }));
    expect(flac.kind).toBe("audio");
  });

  it("reads the size, bit depth and bitrate a lighter copy is judged by", async () => {
    const probe = (stream: object, format: object = {}) =>
      probeMediaMetadata("/tmp/clip.mp4", () => ({
        status: 0,
        stdout: JSON.stringify({ streams: [{ codec_type: "video", ...stream }], format }),
        stderr: "",
      }));

    expect(
      (await probe({ width: 3840, height: 2160, pix_fmt: "yuv420p10le", bit_rate: "9" })).source,
    ).toEqual({
      width: 3840,
      height: 2160,
      bitDepth: 10,
      bitrate: 9,
    });
    expect(
      (await probe({ width: 1920, height: 1080, pix_fmt: "yuv420p" }, { bit_rate: "55000000" }))
        .source,
    ).toEqual({ width: 1920, height: 1080, bitDepth: 8, bitrate: 55_000_000 });
    expect(
      (await probe({ width: 1920, height: 1080, pix_fmt: "yuv420p", bits_per_raw_sample: "12" }))
        .source?.bitDepth,
    ).toBe(12);
    expect((await probe({ pix_fmt: "yuv420p" })).source).toBeUndefined();
  });

  it("lists every stream with its flags, for a failure report", async () => {
    const metadata = await probeMediaMetadata("/tmp/clip.mov", () => ({
      status: 0,
      stdout: JSON.stringify({
        streams: [
          { codec_type: "video", codec_name: "hevc", disposition: { default: 1, attached_pic: 0 } },
          { codec_type: "video", codec_name: "mjpeg", disposition: { attached_pic: 1 } },
          { codec_type: "data", disposition: {} },
        ],
      }),
      stderr: "",
    }));

    expect(metadata.streams).toEqual([
      "video:hevc[default]",
      "video:mjpeg[attached_pic]",
      "data:?[]",
    ]);
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
