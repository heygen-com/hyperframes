import { describe, expect, it } from "bun:test";
import {
  assertChromaSubsamplingSdr,
  validateChromaSubsamplingConfig,
} from "./chromaSubsampling.js";

describe("validateChromaSubsamplingConfig", () => {
  it("is a no-op for the default and for explicit 4:2:0 on every format", () => {
    for (const format of ["mp4", "webm", "mov", "gif", "png-sequence", "hls"]) {
      expect(() => validateChromaSubsamplingConfig({ format })).not.toThrow();
      expect(() =>
        validateChromaSubsamplingConfig({ format, chromaSubsampling: "420", useGpu: true }),
      ).not.toThrow();
    }
  });

  it("accepts 4:4:4 for SDR mp4 with the software encoder", () => {
    for (const hdrMode of [undefined, "auto", "force-sdr"] as const) {
      expect(() =>
        validateChromaSubsamplingConfig({ format: "mp4", chromaSubsampling: "444", hdrMode }),
      ).not.toThrow();
    }
    // format defaults to mp4 when the caller leaves it out
    expect(() => validateChromaSubsamplingConfig({ chromaSubsampling: "444" })).not.toThrow();
  });

  it("rejects 4:4:4 for every non-mp4 format, naming the format", () => {
    for (const format of ["webm", "mov", "gif", "png-sequence", "hls"]) {
      expect(() => validateChromaSubsamplingConfig({ format, chromaSubsampling: "444" })).toThrow(
        `supports format "mp4" only (got "${format}")`,
      );
    }
  });

  it("rejects 4:4:4 with forced HDR output", () => {
    expect(() =>
      validateChromaSubsamplingConfig({ chromaSubsampling: "444", hdrMode: "force-hdr" }),
    ).toThrow("SDR only");
  });

  it("rejects 4:4:4 with GPU encoding", () => {
    expect(() =>
      validateChromaSubsamplingConfig({ chromaSubsampling: "444", useGpu: true }),
    ).toThrow("Re-run without --gpu");
  });
});

describe("assertChromaSubsamplingSdr", () => {
  it("rejects 4:4:4 once auto detection finds HDR sources, pointing at --sdr", () => {
    expect(() => assertChromaSubsamplingSdr({ chromaSubsampling: "444" }, true)).toThrow("--sdr");
  });

  it("passes 4:4:4 on SDR content and ignores 4:2:0 on HDR content", () => {
    expect(() => assertChromaSubsamplingSdr({ chromaSubsampling: "444" }, false)).not.toThrow();
    expect(() => assertChromaSubsamplingSdr({ chromaSubsampling: "420" }, true)).not.toThrow();
    expect(() => assertChromaSubsamplingSdr({}, true)).not.toThrow();
  });
});
