/**
 * Tests for `resolveEffectiveHdrMode` — pins the four-signal fold
 * (caller hdrMode × probed video color × probed image color × output
 * format) so the format-gate ordering can't silently regress under a
 * future cleanup.
 */

import { describe, expect, it, vi } from "vitest";
import type { ExtractionResult, VideoColorSpace } from "@hyperframes/engine";
import { resolveEffectiveHdrMode, resolveHdrEncodingMode } from "./hdrMode.js";

function makeLog() {
  return { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
}

function extractionWith(colorSpaces: (VideoColorSpace | null)[]): ExtractionResult | undefined {
  if (colorSpaces.length === 0) return undefined;
  return {
    extracted: colorSpaces.map((colorSpace) => ({
      videoId: "v",
      outputDir: "/tmp/v",
      framePaths: new Map<number, string>(),
      metadata: {
        width: 1920,
        height: 1080,
        durationSeconds: 1,
        colorSpace,
      },
    })),
  } as unknown as ExtractionResult;
}

const HDR_PQ: VideoColorSpace = {
  colorTransfer: "smpte2084",
  colorPrimaries: "bt2020",
  colorSpace: "bt2020nc",
};

describe("resolveEffectiveHdrMode", () => {
  it("returns undefined when force-sdr is set, regardless of HDR sources", () => {
    const log = makeLog();
    const result = resolveEffectiveHdrMode({
      hdrMode: "force-sdr",
      outputFormat: "mp4",
      extractionResult: extractionWith([HDR_PQ]),
      imageColorSpaces: [],
      log,
    });
    expect(result).toBeUndefined();
    expect(log.info).toHaveBeenCalledWith("[Render] SDR forced by --sdr flag");
  });

  it("auto-detects HDR from video sources when format=mp4", () => {
    const log = makeLog();
    const result = resolveEffectiveHdrMode({
      hdrMode: "auto",
      outputFormat: "mp4",
      extractionResult: extractionWith([HDR_PQ]),
      imageColorSpaces: [],
      log,
    });
    expect(result).toEqual({ transfer: "pq" });
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining("auto-detected from source(s)"));
  });

  it("auto-detects SDR with no HDR sources", () => {
    const log = makeLog();
    const result = resolveEffectiveHdrMode({
      hdrMode: "auto",
      outputFormat: "mp4",
      extractionResult: extractionWith([]),
      imageColorSpaces: [],
      log,
    });
    expect(result).toBeUndefined();
    expect(log.info).toHaveBeenCalledWith("[Render] No HDR sources detected — rendering SDR");
  });

  it("force-hdr without sources falls back to HLG and warns", () => {
    const log = makeLog();
    const result = resolveEffectiveHdrMode({
      hdrMode: "force-hdr",
      outputFormat: "mp4",
      extractionResult: extractionWith([]),
      imageColorSpaces: [],
      log,
    });
    expect(result).toEqual({ transfer: "hlg" });
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("HDR forced by --hdr flag, but no HDR sources were detected"),
    );
  });

  it("force-hdr uses the dominant probed transfer when sources are HDR", () => {
    const log = makeLog();
    const result = resolveEffectiveHdrMode({
      hdrMode: "force-hdr",
      outputFormat: "mp4",
      extractionResult: extractionWith([HDR_PQ]),
      imageColorSpaces: [],
      log,
    });
    expect(result).toEqual({ transfer: "pq" });
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("downgrades to SDR with a warning when output format can't carry HDR", () => {
    for (const fmt of ["webm", "mov", "png-sequence"] as const) {
      const log = makeLog();
      const result = resolveEffectiveHdrMode({
        hdrMode: "auto",
        outputFormat: fmt,
        extractionResult: extractionWith([HDR_PQ]),
        imageColorSpaces: [],
        log,
      });
      expect(result).toBeUndefined();
      expect(log.warn).toHaveBeenCalledWith(
        expect.stringContaining(`format is "${fmt}" — falling back to SDR`),
      );
    }
  });

  it("force-hdr without sources + non-mp4 format: still downgrades, two warns fire", () => {
    const log = makeLog();
    const result = resolveEffectiveHdrMode({
      hdrMode: "force-hdr",
      outputFormat: "webm",
      extractionResult: extractionWith([]),
      imageColorSpaces: [],
      log,
    });
    // Effective is undefined: format gate wins.
    expect(result).toBeUndefined();
    // Both warns fired in order: format-downgrade, then the
    // forced-without-sources note (preserved verbatim from the in-process
    // renderer's diagnostic ordering).
    expect(log.warn).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("HDR was forced without detected HDR sources"),
    );
    expect(log.warn).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("HDR forced by --hdr flag, but no HDR sources were detected"),
    );
  });
});

describe("resolveHdrEncodingMode", () => {
  it("keeps forced HDR encoding enabled for an SDR-only composition", () => {
    expect(resolveHdrEncodingMode({ transfer: "hlg" }, 0)).toEqual({
      hasNativeHdrContent: false,
      encoderHdr: { transfer: "hlg" },
    });
  });
});
