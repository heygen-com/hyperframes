import { describe, expect, it } from "vitest";
import { COMPOSITION_ATTRIBUTES } from "./compositionContract";
import {
  cropPackOutputPath,
  elementRequiresFrame,
  outputSizeForCrop,
  parseCropPackFlag,
  parseSafeFrames,
  parseSafeFramesAttribute,
  pixelRect,
  resolveCropPackSelection,
  snapPixelSizeToRatio,
  tryPixelRect,
  type SafeFrameAttributeReader,
} from "./safeFrames";

function attr(values: Record<string, string>): SafeFrameAttributeReader {
  return {
    getAttribute: (name) => values[name] ?? null,
    hasAttribute: (name) => Object.prototype.hasOwnProperty.call(values, name),
  };
}

const VERTICAL = {
  id: "vertical",
  ratio: "9:16" as const,
  x: (1920 - 608) / 2 / 1920,
  y: 0,
  width: 608 / 1920,
  height: 1,
};

const SQUARE = {
  id: "square",
  ratio: "1:1" as const,
  x: (1920 - 1080) / 2 / 1920,
  y: 0,
  width: 1080 / 1920,
  height: 1,
};

describe("parseSafeFrames", () => {
  it("parses a valid 9:16 + 1:1 pair", () => {
    const root = attr({
      "data-width": "1920",
      "data-height": "1080",
      "data-safe-frames": JSON.stringify([VERTICAL, SQUARE]),
    });
    const result = parseSafeFrames(root);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frames.map((frame) => frame.id)).toEqual(["vertical", "square"]);
    expect(pixelRect(result.frames[0]!, 1920, 1080)).toEqual({
      x: 656,
      y: 0,
      width: 608,
      height: 1080,
    });
    expect(pixelRect(result.frames[1]!, 1920, 1080)).toEqual({
      x: 420,
      y: 0,
      width: 1080,
      height: 1080,
    });
  });

  it("snaps a 9:16 window whose rounded width is a fraction of a pixel off", () => {
    // 1080 × 9/16 = 607.5. A fractional width that rounds to 607 still snaps.
    const widthFraction = 607.4 / 1920;
    const result = parseSafeFramesAttribute(
      JSON.stringify([
        { id: "vertical", ratio: "9:16", x: 0.3, y: 0, width: widthFraction, height: 1 },
      ]),
      { width: 1920, height: 1080 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(pixelRect(result.frames[0]!, 1920, 1080)).toEqual({
      x: Math.round(0.3 * 1920),
      y: 0,
      width: 608,
      height: 1080,
    });
  });

  it("rejects fractions that leave the authored frame", () => {
    const result = parseSafeFramesAttribute(
      JSON.stringify([{ id: "vertical", ratio: "9:16", x: 0.8, y: 0, width: 0.3, height: 1 }]),
    );
    expect(result).toMatchObject({ ok: false, code: "safe_frame_bad_rect" });
  });

  it("rejects duplicate ids", () => {
    const result = parseSafeFramesAttribute(JSON.stringify([VERTICAL, { ...VERTICAL }]));
    expect(result).toMatchObject({ ok: false, code: "safe_frame_bad_id" });
  });

  it("rejects invalid JSON", () => {
    expect(parseSafeFramesAttribute("{not json")).toMatchObject({
      ok: false,
      code: "safe_frames_invalid_json",
    });
  });
});

describe("elementRequiresFrame", () => {
  it("treats a boolean data-safe-critical as requiring every frame", () => {
    const el = attr({ [COMPOSITION_ATTRIBUTES.safeCritical]: "" });
    expect(elementRequiresFrame(el, "vertical")).toBe(true);
    expect(elementRequiresFrame(el, "square")).toBe(true);
  });

  it("limits a named list to those ids", () => {
    const el = attr({ [COMPOSITION_ATTRIBUTES.safeCritical]: "vertical" });
    expect(elementRequiresFrame(el, "vertical")).toBe(true);
    expect(elementRequiresFrame(el, "square")).toBe(false);
  });
});

describe("snap and output size", () => {
  it("keeps an 844×1080 crop from a 1920×1080 9:16 window at 844×1080", () => {
    const crop = { x: 0, y: 0, width: 844, height: 1080 };
    expect(outputSizeForCrop(crop, "9:16")).toEqual({ x: 0, y: 0, width: 844, height: 1080 });
  });

  it("returns null when the ratio is more than one pixel off", () => {
    expect(snapPixelSizeToRatio(844, 1080, "9:16")).toBeNull();
  });
});

describe("crop pack selection", () => {
  it("resolves all in authored order", () => {
    const resolved = resolveCropPackSelection([VERTICAL, SQUARE], "all");
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.members.map((frame) => frame.id)).toEqual(["vertical", "square"]);
  });

  it("reports unknown ids", () => {
    const resolved = resolveCropPackSelection([VERTICAL], ["square"]);
    expect(resolved).toEqual({ ok: false, unknownIds: ["square"] });
  });

  it("parses the CLI flag", () => {
    expect(parseCropPackFlag("all")).toBe("all");
    expect(parseCropPackFlag("vertical,square")).toEqual(["vertical", "square"]);
  });

  it("names sibling deliverables next to the master", () => {
    expect(cropPackOutputPath("renders/launch.mp4", "vertical")).toBe(
      "renders/launch.vertical.mp4",
    );
  });

  it("exposes tryPixelRect for lint without throwing", () => {
    expect(tryPixelRect({ ...VERTICAL, width: 0.9 }, 1920, 1080)).toBeNull();
  });
});
