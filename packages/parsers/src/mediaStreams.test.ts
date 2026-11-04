import { describe, expect, it } from "vitest";
import { decodableAudioStream } from "./mediaStreams";

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
