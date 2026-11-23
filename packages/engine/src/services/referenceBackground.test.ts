import { describe, expect, it, vi } from "vitest";
import {
  classifyReferenceBackground,
  createReferenceBackgroundRecorder,
  referenceBackgroundResult,
  type BackgroundLayer,
  type ReferenceBackgroundResult,
} from "./referenceBackground.js";

const layer = (overrides: Partial<BackgroundLayer> = {}): BackgroundLayer => ({
  rgba: [10, 46, 138, 255],
  image: "none",
  opacity: "1",
  filter: "none",
  blend: "normal",
  varying: false,
  ...overrides,
});

describe("reference background", () => {
  it("returns opaque browser-resolved RGB, not a named/default color", () => {
    expect(classifyReferenceBackground({ layers: [layer()], explicitNone: false })).toEqual({
      kind: "solid",
      rgb: [10, 46, 138],
    });
  });
  it.each(["linear-gradient(red, blue)", 'url("film.png")'])(
    "never coerces %s to its background color",
    (image) => {
      expect(
        classifyReferenceBackground({ layers: [layer({ image })], explicitNone: false }),
      ).toEqual({ kind: "unsupported_non_solid" });
    },
  );
  it("requires positive absence proof, not merely transparent computed color", () => {
    const layers = [layer({ rgba: [0, 0, 0, 0] })];
    expect(classifyReferenceBackground({ layers, explicitNone: false })).toEqual({
      kind: "unknown",
    });
    expect(classifyReferenceBackground({ layers, explicitNone: true })).toEqual({ kind: "none" });
  });
  it("does not use a hidden ancestor image behind an opaque root", () => {
    expect(
      classifyReferenceBackground({
        layers: [layer(), layer({ image: "url(image.png)" })],
        explicitNone: false,
      }),
    ).toEqual({ kind: "solid", rgb: [10, 46, 138] });
  });
  it.each([
    null,
    { layers: [], explicitNone: false },
    { layers: [layer({ rgba: [NaN, 0, 0, 255] })], explicitNone: false },
    { layers: [layer({ rgba: [0, 0, 0, 128] }), layer()], explicitNone: false },
    { layers: [layer({ varying: true })], explicitNone: false },
  ])("leaves unavailable, malformed, translucent or varying paint unknown", (observation) => {
    expect(classifyReferenceBackground(observation)).toEqual({ kind: "unknown" });
  });
  it.each([
    undefined,
    {},
    { kind: "solid", rgb: [1, 2, 256] },
    { kind: "solid", rgb: [1, 2.5, 3] },
    { kind: "solid", rgb: [1, 2] },
  ])("normalizes malformed receipts to unknown", (value) => {
    expect(referenceBackgroundResult(value)).toEqual({ reference_background: { kind: "unknown" } });
  });
  it("reserves exactly one initial read across concurrent and later sessions", async () => {
    const records: ReferenceBackgroundResult[] = [];
    const record = createReferenceBackgroundRecorder((value) => {
      records.push(value);
    });
    const first = vi.fn(async () => ({
      kind: "solid" as const,
      rgb: [10, 46, 138] as [number, number, number],
    }));
    const later = vi.fn(async () => ({ kind: "unsupported_non_solid" as const }));
    await Promise.all([record(first), record(later)]);
    await record(later);
    expect(first).toHaveBeenCalledTimes(1);
    expect(later).not.toHaveBeenCalled();
    expect(records).toEqual([{ reference_background: { kind: "solid", rgb: [10, 46, 138] } }]);
  });
  it("does not replace an indeterminate canonical read with a chunk-local fallback", async () => {
    const records: ReferenceBackgroundResult[] = [];
    const record = createReferenceBackgroundRecorder((value) => {
      records.push(value);
    });
    await record(async () => {
      throw new Error("page closed");
    });
    const fallback = vi.fn(async () => ({ kind: "none" as const }));
    await record(fallback);
    expect(fallback).not.toHaveBeenCalled();
    expect(records).toEqual([{ reference_background: { kind: "unknown" } }]);
  });
});
