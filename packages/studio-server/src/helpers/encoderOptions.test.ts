import { describe, expect, it } from "vitest";
import { encoderJobOptions, parseEncoderOptions } from "./encoderOptions";

describe("parseEncoderOptions", () => {
  it("returns no overrides for an empty request", () => {
    expect(parseEncoderOptions({}, "mp4")).toEqual({ ok: true, options: {} });
  });

  it("accepts a bitrate for mp4 and webm and ignores rate control for mov", () => {
    expect(parseEncoderOptions({ videoBitrate: "10M" }, "mp4")).toEqual({
      ok: true,
      options: { videoBitrate: "10M" },
    });
    expect(parseEncoderOptions({ videoBitrate: "2500k" }, "webm").ok).toBe(true);
    expect(parseEncoderOptions({ videoBitrate: "10M", crf: 12 }, "mov")).toEqual({
      ok: true,
      options: {},
    });
  });

  it("rejects crf and videoBitrate together", () => {
    expect(parseEncoderOptions({ crf: 12, videoBitrate: "10M" }, "mp4")).toEqual({
      ok: false,
      error: "use either crf or videoBitrate, not both",
    });
  });

  it.each(["", "10 M", "-5M", "10M; rm", 10])("rejects bitrate %j", (videoBitrate) => {
    expect(parseEncoderOptions({ videoBitrate }, "mp4").ok).toBe(false);
  });

  it("passes frame format and HDR mode through for every format", () => {
    expect(parseEncoderOptions({ videoFrameFormat: "png", hdrMode: "force-sdr" }, "mov")).toEqual({
      ok: true,
      options: { videoFrameFormat: "png", hdrMode: "force-sdr" },
    });
  });

  it("rejects an unknown frame format or HDR mode", () => {
    expect(parseEncoderOptions({ videoFrameFormat: "webp" }, "mp4").ok).toBe(false);
    expect(parseEncoderOptions({ hdrMode: "on" }, "mp4").ok).toBe(false);
  });

  it("takes a ProRes profile for mov only, and rejects an unknown one", () => {
    expect(parseEncoderOptions({ proresProfile: "hq" }, "mov")).toEqual({
      ok: true,
      options: { proresProfile: "hq" },
    });
    expect(parseEncoderOptions({ proresProfile: "hq" }, "mp4")).toEqual({ ok: true, options: {} });
    expect(parseEncoderOptions({ proresProfile: "422hq" }, "mov").ok).toBe(false);
  });

  it("accepts a keyframe interval and a rate cap for mp4", () => {
    expect(
      parseEncoderOptions(
        { keyframeIntervalSeconds: 2, maxBitrate: "8M", bufferSize: "12M", crf: 20 },
        "mp4",
      ),
    ).toEqual({
      ok: true,
      options: { crf: 20, keyframeIntervalSeconds: 2, maxBitrate: "8M", bufferSize: "12M" },
    });
  });

  it("rejects delivery options on other formats, bad values and a buffer without a cap", () => {
    for (const format of ["webm", "mov", "gif", "hls"]) {
      expect(parseEncoderOptions({ maxBitrate: "8M" }, format).ok).toBe(false);
      expect(parseEncoderOptions({ keyframeIntervalSeconds: 2 }, format).ok).toBe(false);
    }
    for (const bad of [0, -1, "2", Number.NaN]) {
      expect(parseEncoderOptions({ keyframeIntervalSeconds: bad }, "mp4").ok).toBe(false);
    }
    expect(parseEncoderOptions({ maxBitrate: "fast" }, "mp4").ok).toBe(false);
    expect(parseEncoderOptions({ bufferSize: "2M" }, "mp4")).toEqual({
      ok: false,
      error: "bufferSize requires maxBitrate",
    });
  });
});

describe("encoderJobOptions", () => {
  it("passes every encoder field of a parsed request on to the render job", () => {
    const parsed = parseEncoderOptions(
      {
        crf: 20,
        keyframeIntervalSeconds: 2,
        maxBitrate: "8M",
        bufferSize: "12M",
        videoFrameFormat: "png",
        hdrMode: "force-sdr",
      },
      "mp4",
    );
    if (!parsed.ok) throw new Error(parsed.error);
    expect(encoderJobOptions(parsed.options)).toEqual({
      crf: 20,
      keyframeIntervalSeconds: 2,
      maxBitrate: "8M",
      bufferSize: "12M",
      videoFrameFormat: "png",
      hdrMode: "force-sdr",
    });
  });

  it("leaves out what the request did not set", () => {
    expect(encoderJobOptions({})).toEqual({});
  });
});
