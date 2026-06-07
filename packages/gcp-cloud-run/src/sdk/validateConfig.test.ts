/**
 * `validateDistributedRenderConfig` + `validateWorkflowsInputSize` unit
 * tests. Pins the shape rejections the SDK surfaces synchronously before a
 * Cloud Workflows execution starts.
 */

import { describe, expect, it } from "bun:test";
import type { SerializableDistributedRenderConfig } from "../events.js";
import {
  InvalidConfigError,
  MAX_WORKFLOWS_INPUT_BYTES,
  validateDistributedRenderConfig,
  validateVariablesPayload,
  validateWorkflowsInputSize,
} from "./validateConfig.js";

function base(): SerializableDistributedRenderConfig {
  return {
    fps: 30,
    width: 1920,
    height: 1080,
    format: "mp4",
  } as SerializableDistributedRenderConfig;
}

describe("validateDistributedRenderConfig", () => {
  it("accepts a minimal valid config", () => {
    expect(validateDistributedRenderConfig(base())).toBeDefined();
  });

  it("rejects a bad fps", () => {
    expect(() => validateDistributedRenderConfig({ ...base(), fps: 25 } as never)).toThrow(
      /config\.fps/,
    );
  });

  it("rejects odd dimensions (yuv420p)", () => {
    expect(() => validateDistributedRenderConfig({ ...base(), width: 1921 })).toThrow(/even/);
  });

  it("rejects an out-of-range dimension", () => {
    expect(() => validateDistributedRenderConfig({ ...base(), height: 8 })).toThrow(/\[16, 7680\]/);
  });

  it("rejects an unknown format", () => {
    expect(() => validateDistributedRenderConfig({ ...base(), format: "gif" as never })).toThrow(
      /config\.format/,
    );
  });

  it("rejects codec with a non-mp4 format", () => {
    expect(() =>
      validateDistributedRenderConfig({ ...base(), format: "webm", codec: "h264" } as never),
    ).toThrow(/only valid with format="mp4"/);
  });

  it("rejects crf + bitrate together", () => {
    expect(() =>
      validateDistributedRenderConfig({ ...base(), crf: 20, bitrate: "10M" } as never),
    ).toThrow(/mutually exclusive/);
  });

  it("rejects force-hdr", () => {
    expect(() =>
      validateDistributedRenderConfig({ ...base(), hdrMode: "force-hdr" as never }),
    ).toThrow(/force-sdr/);
  });

  it("rejects an over-cap chunkSize", () => {
    expect(() => validateDistributedRenderConfig({ ...base(), chunkSize: 5000 } as never)).toThrow(
      /<= 3600/,
    );
  });

  it("throws InvalidConfigError with a field pointer", () => {
    try {
      validateDistributedRenderConfig({ ...base(), fps: 1 } as never);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidConfigError);
      expect((err as InvalidConfigError).field).toBe("config.fps");
    }
  });
});

describe("validateVariablesPayload", () => {
  it("accepts a plain JSON object", () => {
    expect(() =>
      validateVariablesPayload({ title: "Hi", count: 3, nested: { ok: true } }),
    ).not.toThrow();
  });

  it("rejects undefined leaves", () => {
    expect(() => validateVariablesPayload({ a: undefined })).toThrow(/undefined leaves/);
  });

  it("rejects a top-level array", () => {
    expect(() => validateVariablesPayload([1, 2])).toThrow(/plain JSON object/);
  });

  it("rejects NaN", () => {
    expect(() => validateVariablesPayload({ x: NaN })).toThrow(/non-finite/);
  });

  it("rejects a Date (non-plain object)", () => {
    expect(() => validateVariablesPayload({ when: new Date(0) })).toThrow(/non-plain objects/);
  });
});

describe("validateWorkflowsInputSize", () => {
  it("accepts a small payload", () => {
    expect(() => validateWorkflowsInputSize({ a: "b" })).not.toThrow();
  });

  it("rejects a payload over the 512 KiB cap", () => {
    const big = { blob: "x".repeat(MAX_WORKFLOWS_INPUT_BYTES + 1) };
    expect(() => validateWorkflowsInputSize(big)).toThrow(/512 KiB/);
  });
});
