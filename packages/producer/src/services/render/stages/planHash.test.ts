import { describe, expect, it } from "bun:test";
import {
  canonicalJsonStringify,
  computePlanHash,
  sha256Hex,
  type PlanAssetHash,
  type PlanHashInput,
} from "./planHash.js";

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function makeInput(overrides: Partial<PlanHashInput> = {}): PlanHashInput {
  return {
    compositionHtml: utf8("<!doctype html><html><body>hi</body></html>"),
    assets: [
      { path: "assets/a.png", sha256: "a".repeat(64) },
      { path: "assets/b.png", sha256: "b".repeat(64) },
    ],
    fontSnapshotSha: "f".repeat(64),
    encoderConfigCanonicalJson: '{"closedGop":true,"encoder":"libx264-software","gopSize":240}',
    producerVersion: "0.5.7",
    ffmpegVersion: "ffmpeg version 6.1.1",
    dimensions: {
      fpsNum: 30,
      fpsDen: 1,
      width: 1920,
      height: 1080,
      format: "mp4",
    },
    ...overrides,
  };
}

describe("computePlanHash", () => {
  it("is deterministic for identical inputs", () => {
    const a = computePlanHash(makeInput());
    const b = computePlanHash(makeInput());
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  // Pin the schema-prefix-mixed-in result for one fixed input. If the
  // framing of `computePlanHash` ever changes silently, this test must
  // be updated (which means bumping `PLAN_HASH_SCHEMA_PREFIX` in the
  // source too). Catches accidental drift across producer versions.
  it("matches the known digest for a fixed reference input", () => {
    expect(computePlanHash(makeInput())).toBe(
      "995b4105a1a629965e85dc5d92c6aab9b888e39acdb14369d1bc781aa3247a94",
    );
  });

  it("ignores asset order in the input array", () => {
    const ordered = computePlanHash(
      makeInput({
        assets: [
          { path: "assets/a.png", sha256: "a".repeat(64) },
          { path: "assets/b.png", sha256: "b".repeat(64) },
        ],
      }),
    );
    const reversed = computePlanHash(
      makeInput({
        assets: [
          { path: "assets/b.png", sha256: "b".repeat(64) },
          { path: "assets/a.png", sha256: "a".repeat(64) },
        ],
      }),
    );
    expect(ordered).toBe(reversed);
  });

  it("changes when composition HTML changes", () => {
    const a = computePlanHash(makeInput());
    const b = computePlanHash(
      makeInput({ compositionHtml: utf8("<!doctype html><body>bye</body>") }),
    );
    expect(a).not.toBe(b);
  });

  it("changes when any asset sha changes", () => {
    const a = computePlanHash(makeInput());
    const b = computePlanHash(
      makeInput({
        assets: [
          { path: "assets/a.png", sha256: "a".repeat(64) },
          { path: "assets/b.png", sha256: "c".repeat(64) }, // changed
        ],
      }),
    );
    expect(a).not.toBe(b);
  });

  it("changes when an asset path moves", () => {
    const a = computePlanHash(makeInput());
    const b = computePlanHash(
      makeInput({
        assets: [
          { path: "assets/a.png", sha256: "a".repeat(64) },
          { path: "assets/renamed.png", sha256: "b".repeat(64) },
        ],
      }),
    );
    expect(a).not.toBe(b);
  });

  it("distinguishes path-vs-sha boundary via delimiter framing", () => {
    // Without delimiters, concatenating ("ab", "cd...") and ("abc", "d...")
    // could hash equal because the byte stream is identical. With the
    // 0x00 delimiter between fields the two inputs produce distinct hashes.
    const a = computePlanHash(
      makeInput({
        assets: [{ path: "assets/ab", sha256: "cd" + "0".repeat(62) }],
      }),
    );
    const b = computePlanHash(
      makeInput({
        assets: [{ path: "assets/abc", sha256: "d" + "0".repeat(63) }],
      }),
    );
    expect(a).not.toBe(b);
  });

  it("changes when font snapshot changes", () => {
    const a = computePlanHash(makeInput());
    const b = computePlanHash(makeInput({ fontSnapshotSha: "0".repeat(64) }));
    expect(a).not.toBe(b);
  });

  it("changes when encoder config canonical JSON changes", () => {
    const a = computePlanHash(makeInput());
    const b = computePlanHash(
      makeInput({ encoderConfigCanonicalJson: '{"encoder":"libx265-software"}' }),
    );
    expect(a).not.toBe(b);
  });

  it("changes when producer or ffmpeg version changes", () => {
    const base = makeInput();
    const a = computePlanHash(base);
    const b = computePlanHash({ ...base, producerVersion: "0.5.8" });
    const c = computePlanHash({ ...base, ffmpegVersion: "ffmpeg version 7.0.0" });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
  });

  it("changes when dimensions or fps change", () => {
    const a = computePlanHash(makeInput());
    const b = computePlanHash(
      makeInput({
        dimensions: { fpsNum: 60, fpsDen: 1, width: 1920, height: 1080, format: "mp4" },
      }),
    );
    const c = computePlanHash(
      makeInput({
        dimensions: { fpsNum: 30, fpsDen: 1, width: 3840, height: 2160, format: "mp4" },
      }),
    );
    const d = computePlanHash(
      makeInput({
        dimensions: { fpsNum: 30, fpsDen: 1, width: 1920, height: 1080, format: "mov" },
      }),
    );
    expect(new Set([a, b, c, d]).size).toBe(4);
  });

  it("does not collide on empty assets", () => {
    const a = computePlanHash(makeInput({ assets: [] }));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    const b = computePlanHash(makeInput({ assets: [{ path: "", sha256: "0".repeat(64) }] }));
    expect(a).not.toBe(b);
  });

  it("does not mutate the input assets array", () => {
    const assets: PlanAssetHash[] = [
      { path: "b", sha256: "b".repeat(64) },
      { path: "a", sha256: "a".repeat(64) },
    ];
    const snapshot = assets.map((a) => ({ ...a }));
    computePlanHash(makeInput({ assets }));
    expect(assets).toEqual(snapshot);
  });
});

describe("canonicalJsonStringify", () => {
  it("sorts object keys byte-wise", () => {
    expect(canonicalJsonStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("preserves array order", () => {
    expect(canonicalJsonStringify([3, 1, 2])).toBe("[3,1,2]");
  });

  it("recurses into nested structures", () => {
    expect(
      canonicalJsonStringify({
        z: [{ b: 1, a: 2 }, "x"],
        a: { y: true, x: null },
      }),
    ).toBe('{"a":{"x":null,"y":true},"z":[{"a":2,"b":1},"x"]}');
  });

  it("escapes strings via JSON.stringify", () => {
    expect(canonicalJsonStringify('he said "hi"')).toBe('"he said \\"hi\\""');
  });

  it("rejects non-finite numbers", () => {
    expect(() => canonicalJsonStringify(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalJsonStringify(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });

  it("rejects unsupported value types", () => {
    expect(() => canonicalJsonStringify(() => 1)).toThrow(TypeError);
    expect(() => canonicalJsonStringify(Symbol("s"))).toThrow(TypeError);
  });

  it("rejects undefined at the top level", () => {
    expect(() => canonicalJsonStringify(undefined)).toThrow(TypeError);
  });

  it("produces equal output for semantically equal objects with different key order", () => {
    const a = canonicalJsonStringify({
      encoder: "libx264-software",
      gopSize: 240,
      closedGop: true,
    });
    const b = canonicalJsonStringify({
      gopSize: 240,
      closedGop: true,
      encoder: "libx264-software",
    });
    expect(a).toBe(b);
  });
});

describe("sha256Hex", () => {
  it("matches the well-known empty-string digest", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("matches the well-known abc digest", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("treats string and equivalent Uint8Array the same", () => {
    const s = "hyperframes";
    expect(sha256Hex(s)).toBe(sha256Hex(new TextEncoder().encode(s)));
  });
});
