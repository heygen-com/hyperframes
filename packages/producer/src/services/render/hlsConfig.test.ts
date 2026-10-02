import { describe, expect, it } from "bun:test";
import {
  DEFAULT_HLS_SEGMENT_SECONDS,
  resolveHlsEncoderGopLock,
  resolveHlsGopSize,
  resolveHlsSegmentSeconds,
  validateHlsRenderConfig,
} from "./hlsConfig.js";

describe("validateHlsRenderConfig", () => {
  it("is a no-op for every other format, including the invalid-for-HLS combinations", () => {
    expect(() =>
      validateHlsRenderConfig({ format: "mp4", hdrMode: "force-hdr", useGpu: true }),
    ).not.toThrow();
    expect(() => validateHlsRenderConfig({ format: "webm", hlsSegmentSeconds: 0 })).not.toThrow();
    expect(() => validateHlsRenderConfig({})).not.toThrow();
  });

  it("accepts the default and any positive integer segment length", () => {
    expect(() => validateHlsRenderConfig({ format: "hls" })).not.toThrow();
    expect(() => validateHlsRenderConfig({ format: "hls", hlsSegmentSeconds: 1 })).not.toThrow();
    expect(() => validateHlsRenderConfig({ format: "hls", hlsSegmentSeconds: 10 })).not.toThrow();
  });

  it("rejects a fractional or non-positive segment length", () => {
    for (const hlsSegmentSeconds of [0, -4, 0.5, 4.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => validateHlsRenderConfig({ format: "hls", hlsSegmentSeconds })).toThrow(
        /hlsSegmentSeconds must be a positive integer/,
      );
    }
  });

  it("rejects force-hdr because HLS v1 packages SDR H.264 into MPEG-TS", () => {
    expect(() => validateHlsRenderConfig({ format: "hls", hdrMode: "force-hdr" })).toThrow(
      /does not support hdrMode "force-hdr"/,
    );
  });

  it("accepts the HDR modes that resolve to SDR", () => {
    expect(() => validateHlsRenderConfig({ format: "hls", hdrMode: "auto" })).not.toThrow();
    expect(() => validateHlsRenderConfig({ format: "hls", hdrMode: "force-sdr" })).not.toThrow();
  });

  // The GOP lock is software-only, so a GPU encode emits its own keyframe
  // cadence: nvenc's ~250-frame default would give 8 s segments at 30 fps,
  // while videotoolbox's dense keyframes segment correctly by accident. That
  // asymmetry passes on a Mac and ships wrong segments from Linux.
  it("rejects GPU encoding, which ignores the forced-keyframe lock", () => {
    expect(() => validateHlsRenderConfig({ format: "hls", useGpu: true })).toThrow(
      /does not support GPU encoding/,
    );
  });

  it("accepts an explicitly disabled or unset GPU", () => {
    expect(() => validateHlsRenderConfig({ format: "hls", useGpu: false })).not.toThrow();
    expect(() => validateHlsRenderConfig({ format: "hls" })).not.toThrow();
  });
});

describe("resolveHlsSegmentSeconds", () => {
  it("defaults to 4 s and honors an explicit value", () => {
    expect(DEFAULT_HLS_SEGMENT_SECONDS).toBe(4);
    expect(resolveHlsSegmentSeconds({ format: "hls" })).toBe(4);
    expect(resolveHlsSegmentSeconds({ format: "hls", hlsSegmentSeconds: 6 })).toBe(6);
  });
});

describe("resolveHlsGopSize", () => {
  it("is segmentSeconds x fps on integer frame rates", () => {
    expect(resolveHlsGopSize({ num: 30, den: 1 }, 4)).toBe(120);
    expect(resolveHlsGopSize({ num: 60, den: 1 }, 4)).toBe(240);
    expect(resolveHlsGopSize({ num: 24, den: 1 }, 2)).toBe(48);
  });

  // 30000/1001 x 4 = 119.88 -> 120 frames -> 120 x 1001/30000 = 4.004 s
  // segments against `#EXT-X-TARGETDURATION:4`. Compliant (the spec rounds to
  // nearest), and rounding beats flooring: 119 frames would drift the other way
  // every segment.
  it("rounds to the nearest whole frame on fractional rates", () => {
    expect(resolveHlsGopSize({ num: 30_000, den: 1001 }, 4)).toBe(120);
    expect(resolveHlsGopSize({ num: 24_000, den: 1001 }, 4)).toBe(96);
    expect(resolveHlsGopSize({ num: 60_000, den: 1001 }, 1)).toBe(60);
  });

  // The engine throws on a non-positive gopSize; a pathological fps must not
  // turn that into a mid-render crash.
  it("never returns a non-positive GOP", () => {
    expect(resolveHlsGopSize({ num: 1, den: 10 }, 1)).toBe(1);
  });
});

describe("resolveHlsEncoderGopLock", () => {
  const fps = { num: 30, den: 1 };

  it("locks the GOP for hls at the default and at an explicit segment length", () => {
    expect(resolveHlsEncoderGopLock("hls", fps, undefined)).toEqual({
      lockGopForChunkConcat: true,
      gopSize: 120,
    });
    expect(resolveHlsEncoderGopLock("hls", fps, 6)).toEqual({
      lockGopForChunkConcat: true,
      gopSize: 180,
    });
  });

  // Regression guard on the mp4 byte-for-byte promise: a GOP lock leaking onto
  // any other format changes its encoder args, and nothing downstream would
  // complain.
  it("leaves every other format's open-GOP output untouched", () => {
    for (const format of ["mp4", "webm", "mov", "png-sequence", "gif"]) {
      expect(resolveHlsEncoderGopLock(format, fps, 4)).toEqual({
        lockGopForChunkConcat: false,
        gopSize: undefined,
      });
    }
  });
});
