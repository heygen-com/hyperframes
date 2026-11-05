import { describe, expect, it } from "bun:test";
import {
  chunkGopFrames,
  resolveDeliveryEncoderOptions,
  validateDeliveryEncoderConfig,
} from "./deliveryEncoder.js";
import { computeSegmentPlanHash } from "./segmentManifest.js";

const fps = { num: 30, den: 1 };

describe("validateDeliveryEncoderConfig", () => {
  it("is a no-op when no delivery option is set, for every format", () => {
    for (const format of ["mp4", "webm", "mov", "hls", "gif", undefined]) {
      expect(() => validateDeliveryEncoderConfig({ format, fps })).not.toThrow();
    }
  });

  it("accepts the options on an mp4 render", () => {
    expect(() =>
      validateDeliveryEncoderConfig({
        format: "mp4",
        fps,
        keyframeIntervalSeconds: 2,
        maxBitrate: "8M",
        bufferSize: "16M",
      }),
    ).not.toThrow();
    expect(() => validateDeliveryEncoderConfig({ fps, maxBitrate: "5000k" })).not.toThrow();
  });

  it("rejects what the encoders cannot honor", () => {
    expect(() => validateDeliveryEncoderConfig({ format: "webm", fps, maxBitrate: "8M" })).toThrow(
      /apply to mp4/,
    );
    expect(() =>
      validateDeliveryEncoderConfig({ format: "hls", fps, keyframeIntervalSeconds: 2 }),
    ).toThrow(/hls/);
    for (const bad of [0, -1, Number.NaN]) {
      expect(() => validateDeliveryEncoderConfig({ fps, keyframeIntervalSeconds: bad })).toThrow(
        /positive/,
      );
    }
    expect(() => validateDeliveryEncoderConfig({ fps, maxBitrate: "fast" })).toThrow(
      /invalid bitrate/,
    );
    expect(() => validateDeliveryEncoderConfig({ fps, bufferSize: "2M" })).toThrow(
      /requires maxBitrate/,
    );
  });
});

describe("validateDeliveryEncoderConfig proresProfile", () => {
  it("accepts every profile on a mov render", () => {
    for (const proresProfile of ["4444", "hq", "422", "lt", "proxy"]) {
      expect(() =>
        validateDeliveryEncoderConfig({ format: "mov", fps, proresProfile }),
      ).not.toThrow();
    }
  });

  it("refuses an unknown name with the list, and any profile outside mov", () => {
    expect(() =>
      validateDeliveryEncoderConfig({ format: "mov", fps, proresProfile: "422hq" }),
    ).toThrow("must be one of 4444, hq, 422, lt, proxy");
    expect(() =>
      validateDeliveryEncoderConfig({ format: "mp4", fps, proresProfile: "hq" }),
    ).toThrow("applies to mov renders, not mp4");
  });
});

describe("chunkGopFrames", () => {
  it("uses the chunk when no interval is set or the interval is longer", () => {
    expect(chunkGopFrames(120)).toBe(120);
    expect(chunkGopFrames(120, 300)).toBe(120);
  });

  it("uses the interval when it is shorter than the chunk", () => {
    expect(chunkGopFrames(120, 60)).toBe(60);
  });
});

describe("resolveDeliveryEncoderOptions", () => {
  it("leaves every encoder path as it was when nothing is set", () => {
    expect(resolveDeliveryEncoderOptions({ format: "mp4", fps })).toEqual({
      maxBitrate: undefined,
      bufferSize: undefined,
      lockGopForChunkConcat: false,
      gopSize: undefined,
    });
  });

  it("turns a keyframe interval into a locked GOP at the render's fps", () => {
    const options = resolveDeliveryEncoderOptions({
      format: "mp4",
      fps,
      keyframeIntervalSeconds: 2,
    });
    expect(options.lockGopForChunkConcat).toBe(true);
    expect(options.gopSize).toBe(60);
    expect(
      resolveDeliveryEncoderOptions({
        format: "mp4",
        fps: { num: 24, den: 1 },
        keyframeIntervalSeconds: 2.5,
      }).gopSize,
    ).toBe(60);
  });

  it("passes the rate cap through and keeps HLS on its segment-length GOP", () => {
    expect(
      resolveDeliveryEncoderOptions({ format: "mp4", fps, maxBitrate: "8M", bufferSize: "12M" }),
    ).toMatchObject({ maxBitrate: "8M", bufferSize: "12M", lockGopForChunkConcat: false });
    expect(
      resolveDeliveryEncoderOptions({ format: "hls", fps, hlsSegmentSeconds: 4 }),
    ).toMatchObject({
      lockGopForChunkConcat: true,
      gopSize: 120,
    });
  });
});

describe("computeSegmentPlanHash", () => {
  const base = {
    compositionHash: "c",
    cliVersion: "v",
    totalFrames: 300,
    segmentFrames: 100,
    fps,
    width: 1920,
    height: 1080,
    codec: "h264",
    preset: "medium",
    quality: 23,
    bitrate: undefined,
    maxBitrate: undefined,
    bufferSize: undefined,
    gopSize: undefined,
    pixelFormat: "yuv420p",
    imageFormat: "jpeg",
    useGpu: false,
    outputWidth: 1920,
    outputHeight: 1080,
    motionBlur: "",
    pageMotionBlur: undefined,
    captureQuality: undefined,
  };

  it("changes with the cap and the keyframe interval, so a cached segment is never reused across them", () => {
    const plain = computeSegmentPlanHash(base);
    expect(computeSegmentPlanHash({ ...base, maxBitrate: "8M" })).not.toBe(plain);
    expect(computeSegmentPlanHash({ ...base, gopSize: 60 })).not.toBe(plain);
    expect(computeSegmentPlanHash({ ...base, bufferSize: "2M" })).not.toBe(plain);
  });

  it("keeps the hash of a render that sets none of them", () => {
    expect(computeSegmentPlanHash(base)).toBe(computeSegmentPlanHash({ ...base }));
  });
});
