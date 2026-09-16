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

import {
  analyzeCompositionHdr,
  formatHdrAutoPromotionWarning,
  HDR_AUTO_PROMOTION_PIPELINE,
  isHdrColorSpace,
  sanitizeHdrAutoPromotionAsset,
} from "@hyperframes/engine";
import type { ExtractionResult, HdrTransfer, VideoColorSpace } from "@hyperframes/engine";
import type { ProducerLogger } from "../../logger.js";
import type { RenderConfig } from "../renderOrchestrator.js";

type EffectiveHdr = { transfer: HdrTransfer } | undefined;
type HdrModeInput = {
  hdrMode: RenderConfig["hdrMode"];
  outputFormat: NonNullable<RenderConfig["format"]>;
  extractionResult: ExtractionResult | null | undefined;
  imageColorSpaces: (VideoColorSpace | null)[];
  autoPromotionTrigger?: string;
  log: ProducerLogger;
};

export function findRenderHdrAutoPromotionTrigger(input: {
  extractionResult: ExtractionResult | null | undefined;
  videos: readonly { id: string; src: string }[];
  images: readonly { id: string; src: string }[];
  nativeHdrImageIds: ReadonlySet<string>;
}): string | undefined {
  for (const extracted of input.extractionResult?.extracted ?? []) {
    if (!isHdrColorSpace(extracted.metadata.colorSpace)) continue;
    const source = input.videos.find(({ id }) => id === extracted.videoId)?.src;
    if (source) return source;
  }
  return input.images.find(({ id }) => input.nativeHdrImageIds.has(id))?.src;
}

function logHdrResolution(
  input: HdrModeInput,
  hdrMode: NonNullable<RenderConfig["hdrMode"]>,
  effectiveHdr: EffectiveHdr,
  forcedHdrWithoutSources: boolean,
): void {
  if (forcedHdrWithoutSources) {
    input.log.warn(
      "[Render] HDR forced by --hdr flag, but no HDR sources were detected — defaulting to HLG. SDR-only compositions may look perceptually wrong on HDR displays.",
    );
  }
  if (!effectiveHdr) {
    input.log.info(
      hdrMode === "force-sdr"
        ? "[Render] SDR forced by --sdr flag"
        : "[Render] No HDR sources detected — rendering SDR",
    );
    return;
  }
  if (hdrMode === "auto") {
    input.log.warn(
      formatHdrAutoPromotionWarning({
        triggeringAsset: sanitizeHdrAutoPromotionAsset(
          input.autoPromotionTrigger ?? "an HDR-tagged asset",
        ),
        output: HDR_AUTO_PROMOTION_PIPELINE,
      }),
    );
    return;
  }
  const reason = forcedHdrWithoutSources
    ? "forced by --hdr flag (no HDR sources detected — defaulting to HLG)"
    : "forced by --hdr flag";
  input.log.info(
    `[Render] HDR ${reason} — output: ${effectiveHdr.transfer.toUpperCase()} (BT.2020, 10-bit H.265)`,
  );
}

export function resolveEffectiveHdrMode(input: HdrModeInput): EffectiveHdr {
  const hdrMode = input.hdrMode ?? "auto";
  const videoColorSpaces = (input.extractionResult?.extracted ?? []).map(
    (ext) => ext.metadata.colorSpace,
  );
  const allColorSpaces = [...videoColorSpaces, ...input.imageColorSpaces];
  const info = allColorSpaces.length > 0 ? analyzeCompositionHdr(allColorSpaces) : null;

  let effectiveHdr: EffectiveHdr;
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

  logHdrResolution(input, hdrMode, effectiveHdr, forcedHdrWithoutSources);

  return effectiveHdr;
}
