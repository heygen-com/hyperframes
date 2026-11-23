import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findFfBinary } from "@hyperframes/parsers/ff-binaries";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MEDIA_INPUT_ARGS, NOT_MEDIA, startsAsMediaPlaylist } from "./mediaExtensions.js";
import { classifyMediaColor, probeAudioTrack, probeMediaMetadata } from "./mediaMetadata.js";

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
    expect(
      (
        await probe({
          width: 1920,
          height: 1080,
          r_frame_rate: "30000/1001",
          avg_frame_rate: "30000/1001",
        })
      ).source,
    ).toMatchObject({ frameRate: 30000 / 1001, variableFrameRate: false });
    expect(
      (await probe({ width: 1920, height: 1080, r_frame_rate: "60/1", avg_frame_rate: "24/1" }))
        .source,
    ).toMatchObject({ frameRate: 60, variableFrameRate: true });
  });

  it("reads how a file's pixels stretch and turn, for the size it shows at", async () => {
    const asked: string[][] = [];
    const probe = (stream: object) =>
      probeMediaMetadata("/tmp/clip.mp4", (_path, args) => {
        asked.push(args);
        return {
          status: 0,
          stdout: JSON.stringify({ streams: [{ codec_type: "video", ...stream }] }),
          stderr: "",
        };
      });
    const size = { width: 1440, height: 1080 };

    expect(
      (await probe({ ...size, sample_aspect_ratio: "4:3", side_data_list: [{ rotation: -90 }] }))
        .source,
    ).toMatchObject({ ...size, sampleAspectRatio: 4 / 3, rotation: -90 });
    expect((await probe({ ...size, tags: { rotate: "90" } })).source).toMatchObject({
      rotation: 90,
    });
    const plain = (await probe({ ...size, sample_aspect_ratio: "1:1" })).source;
    expect(plain).not.toHaveProperty("sampleAspectRatio");
    expect(plain).not.toHaveProperty("rotation");
    expect(asked[0]?.join(" ")).toMatch(
      /sample_aspect_ratio.*stream_tags=alpha_mode,rotate:stream_side_data_list:format/,
    );
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

  it.each([
    ["an HLS playlist", "#EXTM3U\n#EXT-X-TARGETDURATION:10\n/elsewhere/clip.mp4\n"],
    ["a DASH manifest", '\uFEFF<?xml version="1.0"?>\n<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">'],
    ["a concat script", "ffconcat version 1.0\nfile clip.mp4\n"],
  ])("never hands %s named as a video to ffprobe", async (_name, text) => {
    const dir = mkdtempSync(join(tmpdir(), "hf-media-metadata-"));
    try {
      writeFileSync(join(dir, "clip.mp4"), text);
      const runner = vi.fn();
      const metadata = await probeMediaMetadata(join(dir, "clip.mp4"), runner);
      expect(metadata).toMatchObject({ kind: "video", probeError: NOT_MEDIA });
      expect(runner).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!findFfBinary("ffmpeg") || !findFfBinary("ffprobe"))(
    "stops ffprobe for a caller that has left",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "hf-media-metadata-"));
      const clip = join(dir, "clip.mp4");
      try {
        execFileSync(findFfBinary("ffmpeg")!, [
          ...["-v", "error", "-f", "lavfi", "-i", "color=s=16x16:d=1", "-pix_fmt", "yuv420p", clip],
        ]);
        expect((await probeMediaMetadata(clip)).durationSeconds).toBeCloseTo(1, 0);
        expect(await probeMediaMetadata(clip, undefined, AbortSignal.abort())).toMatchObject({
          probeError: "ffprobe failed",
        });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

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

describe("startsAsMediaPlaylist", () => {
  it.each([
    [
      "a concat script with a control byte in a comment",
      "ffconcat version 1.0\n#\u0001\nfile seg.ts",
      true,
    ],
    ["an HLS playlist with a control byte", "#EXTM3U\n\u0002", true],
    ["markup", '<?xml version="1.0"?><MPD>', true],
    ["binary that starts with <", "<\u0000\u0001\u0002binary", false],
    ["an MP4 header", "\u0000\u0000\u0000\u0018ftypisom", false],
  ])("reads %s as %s", (_name, text, playlist) => {
    expect(startsAsMediaPlaylist(Buffer.from(text, "latin1"))).toBe(playlist);
  });
});

describe("probeAudioTrack", () => {
  it("never hands a playlist named as audio to ffprobe", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-media-metadata-"));
    try {
      writeFileSync(join(dir, "song.mp3"), "#EXTM3U\n#EXT-X-TARGETDURATION:10\n/elsewhere.mp3\n");
      const runner = vi.fn();
      expect(await probeAudioTrack(join(dir, "song.mp3"), runner)).toBeNull();
      expect(runner).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the media probes", () => {
  it("hand ffprobe only the self-contained media demuxers", async () => {
    vi.stubEnv("HYPERFRAMES_FFPROBE_PATH", "/definitely/missing/ffprobe");
    const seen: string[][] = [];
    const runner = async (_command: string, args: string[]) => {
      seen.push(args);
      return { status: 0, stdout: "{}", stderr: "" };
    };
    await probeMediaMetadata("/tmp/missing-clip.mp4", runner);
    await probeAudioTrack("/tmp/missing-song.mp3", runner);
    expect(seen).toHaveLength(2);
    for (const args of seen) {
      const at = args.indexOf("--");
      expect(args.slice(at - MEDIA_INPUT_ARGS.length, at)).toEqual(MEDIA_INPUT_ARGS);
    }
  });
});
