import { describe, expect, it } from "bun:test";
import type { SerializableDistributedRenderConfig } from "../events.js";
import { InvalidConfigError, validateDistributedRenderConfig } from "./validateConfig.js";

const VALID: SerializableDistributedRenderConfig = {
  fps: 30,
  width: 1920,
  height: 1080,
  format: "mp4",
};

describe("validateDistributedRenderConfig", () => {
  it("returns the same reference on the happy path", () => {
    expect(validateDistributedRenderConfig(VALID)).toBe(VALID);
  });

  it("accepts optional fields when valid", () => {
    const cfg: SerializableDistributedRenderConfig = {
      ...VALID,
      codec: "h265",
      quality: "high",
      crf: 18,
      chunkSize: 240,
      maxParallelChunks: 16,
      runtimeCap: "lambda",
      hdrMode: "force-sdr",
    };
    expect(validateDistributedRenderConfig(cfg)).toBe(cfg);
  });

  it.each([
    ["null config", null as unknown as SerializableDistributedRenderConfig, "config"],
    [
      "wrong fps",
      { ...VALID, fps: 25 as 24 | 30 | 60 } satisfies SerializableDistributedRenderConfig,
      "config.fps",
    ],
    [
      "non-integer width",
      { ...VALID, width: 1280.5 } satisfies SerializableDistributedRenderConfig,
      "config.width",
    ],
    [
      "odd width (yuv420p parity)",
      { ...VALID, width: 1281 } satisfies SerializableDistributedRenderConfig,
      "config.width",
    ],
    [
      "out-of-range height",
      { ...VALID, height: 8000 } satisfies SerializableDistributedRenderConfig,
      "config.height",
    ],
    [
      "unsupported format",
      {
        ...VALID,
        format: "webm",
      } as unknown as SerializableDistributedRenderConfig,
      "config.format",
    ],
    [
      "codec with non-mp4 format",
      { ...VALID, format: "mov", codec: "h264" } satisfies SerializableDistributedRenderConfig,
      "config.codec",
    ],
    [
      "unknown codec",
      {
        ...VALID,
        codec: "av1",
      } as unknown as SerializableDistributedRenderConfig,
      "config.codec",
    ],
    [
      "crf + bitrate together",
      { ...VALID, crf: 18, bitrate: "10M" } satisfies SerializableDistributedRenderConfig,
      "config.crf",
    ],
    [
      "crf out of range",
      { ...VALID, crf: 60 } satisfies SerializableDistributedRenderConfig,
      "config.crf",
    ],
    [
      "malformed bitrate",
      { ...VALID, bitrate: "fast" } satisfies SerializableDistributedRenderConfig,
      "config.bitrate",
    ],
    [
      "non-positive chunkSize",
      { ...VALID, chunkSize: 0 } satisfies SerializableDistributedRenderConfig,
      "config.chunkSize",
    ],
    [
      "chunkSize over Lambda ceiling",
      { ...VALID, chunkSize: 9999 } satisfies SerializableDistributedRenderConfig,
      "config.chunkSize",
    ],
    [
      "maxParallelChunks 0",
      { ...VALID, maxParallelChunks: 0 } satisfies SerializableDistributedRenderConfig,
      "config.maxParallelChunks",
    ],
    [
      "unknown runtimeCap",
      {
        ...VALID,
        runtimeCap: "azure",
      } as unknown as SerializableDistributedRenderConfig,
      "config.runtimeCap",
    ],
    [
      "force-hdr rejected",
      {
        ...VALID,
        hdrMode: "force-hdr",
      } as unknown as SerializableDistributedRenderConfig,
      "config.hdrMode",
    ],
  ])("rejects %s with field=%s", (_label, input, expectedField) => {
    try {
      validateDistributedRenderConfig(input);
      throw new Error("expected validateDistributedRenderConfig to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidConfigError);
      expect((err as InvalidConfigError).field).toBe(expectedField);
      expect((err as InvalidConfigError).name).toBe("InvalidConfigError");
    }
  });
});
