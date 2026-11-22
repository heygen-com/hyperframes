import { describe, expect, it } from "vitest";
import { decodableAudioStream, untaggedVideoMatrix } from "./mediaStreams";

describe("decodableAudioStream", () => {
  it("skips an audio track ffprobe names no codec for, counting only audio streams", () => {
    const phone = [
      { codec_type: "video", codec_name: "hevc" },
      { codec_type: "audio" },
      { codec_type: "audio", codec_name: "aac" },
    ];
    expect(decodableAudioStream(phone)).toBe(1);
  });

  it("takes the first decodable track, and none when no audio can be decoded", () => {
    const two = [
      { codec_type: "audio", codec_name: "aac" },
      { codec_type: "audio", codec_name: "ac3" },
    ];
    expect(decodableAudioStream(two)).toBe(0);
    expect(decodableAudioStream([{ codec_type: "video", codec_name: "h264" }])).toBeNull();
    expect(decodableAudioStream([{ codec_type: "audio" }])).toBeNull();
  });
});

describe("untaggedVideoMatrix", () => {
  it("reads an untagged video's colours as Chrome does: BT.601 below 720 lines and for VP9 and AV1", () => {
    expect(untaggedVideoMatrix("avc", 360)).toBe("smpte170m");
    expect(untaggedVideoMatrix("h264", 719)).toBe("smpte170m");
    expect(untaggedVideoMatrix("avc", 720)).toBe("bt709");
    expect(untaggedVideoMatrix("hevc", 1080)).toBe("bt709");
    expect(untaggedVideoMatrix("vp9", 1080)).toBe("smpte170m");
    expect(untaggedVideoMatrix("av1", 2160)).toBe("smpte170m");
  });
});
