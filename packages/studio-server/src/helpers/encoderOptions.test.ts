import { describe, expect, it } from "vitest";
import { parseEncoderOptions } from "./encoderOptions";

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

  it("passes 4:4:4 chroma through for SDR mp4 on the software encoder", () => {
    expect(parseEncoderOptions({ chromaSubsampling: "444", crf: 16 }, "mp4")).toEqual({
      ok: true,
      options: { crf: 16, chromaSubsampling: "444" },
    });
    expect(parseEncoderOptions({ chromaSubsampling: "420" }, "webm")).toEqual({
      ok: true,
      options: { chromaSubsampling: "420" },
    });
  });

  it("rejects an unknown chroma value", () => {
    expect(parseEncoderOptions({ chromaSubsampling: "422" }, "mp4")).toEqual({
      ok: false,
      error: "chromaSubsampling must be one of 420, 444",
    });
    expect(parseEncoderOptions({ chromaSubsampling: 444 }, "mp4").ok).toBe(false);
  });

  it.each([
    [{ chromaSubsampling: "444" }, "webm", "supports mp4 only"],
    [{ chromaSubsampling: "444" }, "mov", "supports mp4 only"],
    [{ chromaSubsampling: "444", gpu: true }, "mp4", "software encoder"],
    [{ chromaSubsampling: "444", hdrMode: "force-hdr" }, "mp4", "SDR only"],
  ])("rejects 4:4:4 that would not stay 4:4:4: %j as %s", (body, format, message) => {
    const parsed = parseEncoderOptions(body, format);
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? "" : parsed.error).toContain(message);
  });
});
