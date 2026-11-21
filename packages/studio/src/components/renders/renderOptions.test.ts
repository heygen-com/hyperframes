import { describe, expect, it } from "vitest";
import { resolveRenderOptions, serializeEncoderOptions } from "./renderOptions";
import type { RenderSettings } from "./renderSettings";

const saved: RenderSettings = {
  format: "webm",
  quality: "high",
  fps: 60,
  gpu: true,
  rateControl: { mode: "bitrate", value: "500k" },
  videoFrameFormat: "png",
  hdrMode: "force-hdr",
};

describe("render option merge and wire contract", () => {
  it("merges saved values, then explicit false, CRF zero and Auto before omission", () => {
    const result = resolveRenderOptions(saved, {
      gpu: false,
      rateControl: { mode: "crf", value: 0 },
      videoFrameFormat: "auto",
      hdrMode: "auto",
      fps: 12,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.settings).toMatchObject({ format: "webm", quality: "high", fps: 12, gpu: false });
    expect(serializeEncoderOptions(result.settings)).toEqual({ crf: 0 });
  });

  it("atomically replaces a saved bitrate with Auto rather than reviving it", () => {
    const result = resolveRenderOptions(saved, {
      rateControl: { mode: "auto" },
      videoFrameFormat: "auto",
      hdrMode: "auto",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(serializeEncoderOptions(result.settings)).toEqual({});
  });

  it("normalizes a single MOV export without mutating saved preferences", () => {
    const result = resolveRenderOptions(saved, { format: "mov" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(serializeEncoderOptions(result.settings)).toEqual({
      videoFrameFormat: "png",
      hdrMode: "force-hdr",
    });
    expect(saved.rateControl).toEqual({ mode: "bitrate", value: "500k" });
  });

  it.each([
    { format: "mp4" as const, value: 51 },
    { format: "webm" as const, value: 63 },
  ])("allows the %s CRF endpoint", ({ format, value }) => {
    const result = resolveRenderOptions(saved, { format, rateControl: { mode: "crf", value } });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(serializeEncoderOptions(result.settings)).toMatchObject({ crf: value });
  });

  it.each([-1, 52, 18.5, Number.NaN])("refuses intentional invalid MP4 CRF %s", (value) => {
    expect(
      resolveRenderOptions(saved, { format: "mp4", rateControl: { mode: "crf", value } }).ok,
    ).toBe(false);
  });

  it("resets inherited incompatible CRF when the final format changes", () => {
    const result = resolveRenderOptions(
      { ...saved, rateControl: { mode: "crf", value: 63 } },
      { format: "mp4" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(serializeEncoderOptions(result.settings)).not.toHaveProperty("crf");
  });

  it("trims bitrate and maps empty bitrate to Auto, without serializing the union", () => {
    const result = resolveRenderOptions(saved, {
      rateControl: { mode: "bitrate", value: " 1.5M " },
    });
    if (!result.ok) throw new Error(result.error);
    expect(serializeEncoderOptions(result.settings)).toEqual({
      videoBitrate: "1.5M",
      videoFrameFormat: "png",
      hdrMode: "force-hdr",
    });
    const blank = resolveRenderOptions(saved, { rateControl: { mode: "bitrate", value: "  " } });
    if (!blank.ok) throw new Error(blank.error);
    expect(serializeEncoderOptions(blank.settings)).not.toHaveProperty("videoBitrate");
    expect(
      resolveRenderOptions(saved, { rateControl: { mode: "bitrate", value: "10MB" } }).ok,
    ).toBe(false);
  });
});
