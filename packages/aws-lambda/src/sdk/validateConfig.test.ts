import { describe, expect, it } from "bun:test";
import type { SerializableDistributedRenderConfig } from "../events.js";
import {
  InvalidConfigError,
  MAX_STEP_FUNCTIONS_INPUT_BYTES,
  validateDistributedRenderConfig,
  validateStepFunctionsInputSize,
  validateVariablesPayload,
} from "./validateConfig.js";

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
        format: "gif",
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

  describe("variables", () => {
    it("accepts a plain JSON object", () => {
      const cfg: SerializableDistributedRenderConfig = {
        ...VALID,
        variables: {
          title: "Hello",
          accent: "#ff0000",
          nested: { items: [1, 2, 3], visible: true, note: null },
        },
      };
      expect(validateDistributedRenderConfig(cfg)).toBe(cfg);
    });

    it("rejects variables that's an array, not a plain object", () => {
      try {
        validateDistributedRenderConfig({
          ...VALID,
          variables: [1, 2, 3] as unknown as Record<string, unknown>,
        });
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidConfigError);
        expect((err as InvalidConfigError).field).toBe("config.variables");
      }
    });

    it("rejects functions inside variables", () => {
      try {
        validateVariablesPayload({ greet: () => "hi" });
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidConfigError);
        expect((err as InvalidConfigError).field).toBe("config.variables.greet");
        expect((err as Error).message).toMatch(/function/i);
      }
    });

    it("rejects undefined leaves (silently dropped by JSON.stringify)", () => {
      try {
        validateVariablesPayload({ title: "x", maybe: undefined });
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidConfigError);
        expect((err as InvalidConfigError).field).toBe("config.variables.maybe");
      }
    });

    it("rejects BigInt values", () => {
      try {
        validateVariablesPayload({ count: 9_007_199_254_740_993n });
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidConfigError);
        expect((err as InvalidConfigError).field).toBe("config.variables.count");
      }
    });

    it("rejects NaN / Infinity numbers", () => {
      try {
        validateVariablesPayload({ ratio: Number.NaN });
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidConfigError);
        expect((err as InvalidConfigError).field).toBe("config.variables.ratio");
      }
      try {
        validateVariablesPayload({ ratio: Number.POSITIVE_INFINITY });
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidConfigError);
        expect((err as InvalidConfigError).field).toBe("config.variables.ratio");
      }
    });

    it("rejects Symbols", () => {
      try {
        validateVariablesPayload({ id: Symbol("hi") });
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidConfigError);
        expect((err as InvalidConfigError).field).toBe("config.variables.id");
      }
    });

    it("rejects Date instances (non-plain objects)", () => {
      try {
        validateVariablesPayload({ when: new Date("2026-01-01") });
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidConfigError);
        expect((err as InvalidConfigError).field).toBe("config.variables.when");
        expect((err as Error).message).toMatch(/Date|non-plain/);
      }
    });

    it("walks into arrays and reports nested paths", () => {
      try {
        validateVariablesPayload({ items: ["a", { broken: () => 1 }] });
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidConfigError);
        expect((err as InvalidConfigError).field).toBe("config.variables.items[1].broken");
      }
    });

    it("rejects circular references with a typed error instead of stack-overflowing", () => {
      const cyclic: Record<string, unknown> = { title: "x" };
      cyclic.self = cyclic;
      try {
        validateVariablesPayload(cyclic);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidConfigError);
        expect((err as Error).message).toMatch(/circular/i);
      }
    });

    it("rejects cycles via arrays too", () => {
      const arr: unknown[] = ["a"];
      arr.push(arr);
      try {
        validateVariablesPayload({ items: arr });
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidConfigError);
        expect((err as Error).message).toMatch(/circular/i);
      }
    });

    it("round-trips through JSON for the validated set", () => {
      const variables = {
        title: "Personalised render",
        scene: { intro: { lines: ["one", "two"], delay: 0.5 } },
        tags: ["alpha", "beta"],
        active: true,
        nothing: null,
      };
      validateVariablesPayload(variables);
      const round = JSON.parse(JSON.stringify(variables));
      expect(round).toEqual(variables);
    });
  });
});

describe("validateStepFunctionsInputSize", () => {
  it("accepts inputs under the 256 KiB cap", () => {
    const input = {
      ProjectS3Uri: "s3://bucket/sites/abc/project.tar.gz",
      Config: { fps: 30, width: 1280, height: 720, format: "mp4" },
    };
    expect(() => validateStepFunctionsInputSize(input)).not.toThrow();
  });

  it("rejects inputs over the 256 KiB cap with a message that names the byte count", () => {
    // Build a variables blob that pushes the serialised input over the cap.
    // 256 KiB ÷ 2 bytes per char × 1 char per byte for ASCII; pad to 260 KiB
    // worth of payload so the serialiser overhead is dwarfed.
    const huge = "x".repeat(260 * 1024);
    const input = {
      ProjectS3Uri: "s3://bucket/sites/abc/project.tar.gz",
      Config: {
        fps: 30,
        width: 1280,
        height: 720,
        format: "mp4",
        variables: { blob: huge },
      },
    };
    try {
      validateStepFunctionsInputSize(input);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidConfigError);
      const msg = (err as Error).message;
      expect(msg).toMatch(/256/);
      // Names the actual byte count so users see how far over the cap they are.
      const serialized = JSON.stringify(input);
      const expectedBytes = Buffer.byteLength(serialized, "utf8");
      expect(msg).toContain(String(expectedBytes));
      // Pointer to the docs section on URL'ing assets.
      expect(msg).toMatch(/templates-on-lambda/);
    }
  });

  it("MAX_STEP_FUNCTIONS_INPUT_BYTES is 256 KiB", () => {
    expect(MAX_STEP_FUNCTIONS_INPUT_BYTES).toBe(256 * 1024);
  });

  it("rejects non-JSON-serializable roots with a clear error", () => {
    // A top-level function reference makes JSON.stringify return undefined.
    expect(() => validateStepFunctionsInputSize(() => "boom")).toThrow(/not JSON-serializable/);
  });
});
