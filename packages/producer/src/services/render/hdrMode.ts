/**
 * HDR / SDR mode resolution at the sequencer boundary.
 *
 * Folds three signals — `RenderConfig.hdrMode`, the probed video color
 * spaces, and the probed image color spaces — into a single
 * `effectiveHdr` decision, then emits the matching diagnostic log lines.
 * The format gate (HDR + alpha is unsupported, so non-mp4 output forces
 * SDR) lives here too so the sequencer doesn't need to know which
 * formats can carry an HDR signal.
 */

import { analyzeCompositionHdr } from "@hyperframes/engine";
import type { ExtractionResult, HdrTransfer, VideoColorSpace } from "@hyperframes/engine";
import type { ProducerLogger } from "../../logger.js";
import type { RenderConfig } from "../renderOrchestrator.js";

export function resolveHdrEncodingMode(
  effectiveHdr: { transfer: HdrTransfer } | undefined,
  nativeHdrResourceCount: number,
): {
  hasNativeHdrContent: boolean;
  encoderHdr: { transfer: HdrTransfer } | undefined;
} {
  return {
    hasNativeHdrContent: Boolean(effectiveHdr && nativeHdrResourceCount > 0),
    encoderHdr: effectiveHdr,
  };
}

export function resolveEffectiveHdrMode(input: {
  hdrMode: RenderConfig["hdrMode"];
  outputFormat: NonNullable<RenderConfig["format"]>;
  extractionResult: ExtractionResult | null | undefined;
  imageColorSpaces: (VideoColorSpace | null)[];
  log: ProducerLogger;
}): { transfer: HdrTransfer } | undefined {
  const hdrMode = input.hdrMode ?? "auto";
  const videoColorSpaces = (input.extractionResult?.extracted ?? []).map(
    (ext) => ext.metadata.colorSpace,
  );
  const allColorSpaces = [...videoColorSpaces, ...input.imageColorSpaces];
  const info = allColorSpaces.length > 0 ? analyzeCompositionHdr(allColorSpaces) : null;

  let effectiveHdr: { transfer: HdrTransfer } | undefined;
  let forcedHdrWithoutSources = false;

  if (hdrMode === "force-sdr") {
    effectiveHdr = undefined;
  } else if (hdrMode === "force-hdr") {
    if (info?.hasHdr && info.dominantTransfer) {
      effectiveHdr = { transfer: info.dominantTransfer };
    } else {
      effectiveHdr = { transfer: "hlg" };
      forcedHdrWithoutSources = true;
    }
  } else if (info?.hasHdr && info.dominantTransfer) {
    effectiveHdr = { transfer: info.dominantTransfer };
  }

  if (effectiveHdr && input.outputFormat !== "mp4") {
    const hdrSourceReason = forcedHdrWithoutSources
      ? "HDR was forced without detected HDR sources"
      : "HDR source detected";
    input.log.warn(
      `[Render] ${hdrSourceReason}, but format is "${input.outputFormat}" — falling back to SDR. ` +
        `HDR + alpha is not supported. Use --format mp4 for HDR10 output.`,
    );
    effectiveHdr = undefined;
  }

  if (forcedHdrWithoutSources) {
    input.log.warn(
      "[Render] HDR forced by --hdr flag, but no HDR sources were detected — defaulting to HLG. SDR-only compositions may look perceptually wrong on HDR displays.",
    );
  }
  if (effectiveHdr) {
    let reason: string;
    if (hdrMode === "force-hdr") {
      reason = forcedHdrWithoutSources
        ? "forced by --hdr flag (no HDR sources detected — defaulting to HLG)"
        : "forced by --hdr flag";
    } else {
      reason = "auto-detected from source(s)";
    }
    input.log.info(
      `[Render] HDR ${reason} — output: ${effectiveHdr.transfer.toUpperCase()} (BT.2020, 10-bit H.265)`,
    );
  } else if (hdrMode === "force-sdr") {
    input.log.info("[Render] SDR forced by --sdr flag");
  } else {
    input.log.info("[Render] No HDR sources detected — rendering SDR");
  }

  return effectiveHdr;
}
