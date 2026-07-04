/**
 * HDR Compositor — pixel-level compositing primitives for the HDR
 * layered render path.
 *
 * Extracted from `renderOrchestrator.ts` so the ~600 LOC of HDR-specific
 * buffer manipulation, video/image blit logic, and per-frame compositor
 * live in a focused module that can be tested and evolved independently.
 *
 * Consumers: `captureHdrStage.ts`, `captureHdrSequentialLoop.ts`,
 * `captureHdrHybridLoop.ts`, `captureHdrFrameShared.ts`,
 * `captureHdrResources.ts`.
 */

import { readSync, closeSync } from "fs";
import { join } from "path";
import {
  type CaptureSession,
  type BeforeCaptureHook,
  type HdrTransfer,
  type ElementStackingInfo,
  type HfTransitionMeta,
  captureAlphaPng,
  applyDomLayerMask,
  removeDomLayerMask,
  decodePng,
  blitRgba8OverRgb48le,
  blitRgb48leRegion,
  groupIntoLayers,
  blitRgb48leAffine,
  parseTransformMatrix,
  convertTransfer,
} from "@hyperframes/engine";
import type { ProducerLogger } from "../logger.js";
import { type HdrImageTransferCache } from "./hdrImageTransferCache.js";
import { writeFileExclusiveSync } from "./render/shared.js";
import { type HdrPerfCollector, timeHdrPhase, timeHdrPhaseAsync } from "./render/hdrPerf.js";

// ─── Diagnostic helpers ────────────────────────────────────────────────────

// Diagnostic helpers used by the HDR layered compositor when KEEP_TEMP=1
// is set. They are pure (capture no state), so we keep them at module scope
// to avoid re-creating closures per frame and to make them callable from
// any future composite path that needs to log non-zero pixel counts.
function countNonZeroAlpha(rgba: Uint8Array): number {
  let n = 0;
  for (let p = 3; p < rgba.length; p += 4) {
    if (rgba[p] !== 0) n++;
  }
  return n;
}

function countNonZeroRgb48(buf: Uint8Array): number {
  let n = 0;
  for (let p = 0; p < buf.length; p += 6) {
    if (
      buf[p] !== 0 ||
      buf[p + 1] !== 0 ||
      buf[p + 2] !== 0 ||
      buf[p + 3] !== 0 ||
      buf[p + 4] !== 0 ||
      buf[p + 5] !== 0
    )
      n++;
  }
  return n;
}

// ─── Constants ────────────────────────────────────────────────────────────

const TRANSFORM_IDENTITY_EPSILON = 0.001;
const OPAQUE_ALPHA_THRESHOLD = 0.999;
const RGB48_BYTES_PER_PIXEL = 6;

type AffineMatrix = [number, number, number, number, number, number];

function isAffineMatrix(m: number[]): m is AffineMatrix {
  return m.length === 6;
}

function resolveBlitOpacity(opacity: number): number | undefined {
  return opacity < OPAQUE_ALPHA_THRESHOLD ? opacity : undefined;
}

// ─── Types ─────────────────────────────────────────────────────────────────

/**
 * Metadata for a shader transition between two scenes, extracted from
 * `window.__hf.transitions`. Re-exported from the engine so the producer
 * shares the contract with composition runtime code.
 */
export type HdrTransitionMeta = HfTransitionMeta;

/** Pre-computed frame range for an active transition. */
export interface TransitionRange extends HdrTransitionMeta {
  startFrame: number;
  endFrame: number;
}

// ─── Video frame source ────────────────────────────────────────────────────

/**
 * Crop an rgb48le buffer to a sub-region. Returns a new Buffer containing
 * only the cropped pixels.
 */
function cropRgb48le(
  src: Buffer,
  srcW: number,
  srcH: number,
  cropX: number,
  cropY: number,
  cropW: number,
  cropH: number,
): Buffer {
  const dst = Buffer.alloc(cropW * cropH * RGB48_BYTES_PER_PIXEL);
  for (let row = 0; row < cropH; row++) {
    const srcRow = cropY + row;
    if (srcRow < 0 || srcRow >= srcH) continue;
    const srcOff = (srcRow * srcW + cropX) * RGB48_BYTES_PER_PIXEL;
    const dstOff = row * cropW * RGB48_BYTES_PER_PIXEL;
    const copyLen = Math.min(cropW, srcW - cropX) * RGB48_BYTES_PER_PIXEL;
    if (copyLen > 0) src.copy(dst, dstOff, srcOff, srcOff + copyLen);
  }
  return dst;
}

/**
 * Blit a single HDR video layer onto an rgb48le canvas.
 *
 * Shared between the normal-frame compositing path (compositeToBuffer)
 * and the transition dual-scene compositing loop to avoid duplicating
 * the frame lookup, raw read, transfer, transform, and blit logic.
 */
export interface HdrVideoFrameSource {
  dir: string;
  rawPath: string;
  fd: number;
  width: number;
  height: number;
  frameSize: number;
  frameCount: number;
  scratch: Buffer;
}

export function closeHdrVideoFrameSource(source: HdrVideoFrameSource, log?: ProducerLogger): void {
  try {
    closeSync(source.fd);
  } catch (err) {
    log?.warn("Failed to close HDR raw frame file", {
      rawPath: source.rawPath,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// fallow-ignore-next-line complexity
export function blitHdrVideoLayer(
  canvas: Buffer,
  el: ElementStackingInfo,
  time: number,
  fps: number,
  hdrVideoFrameSources: Map<string, HdrVideoFrameSource>,
  hdrStartTimes: Map<string, number>,
  width: number,
  height: number,
  log?: ProducerLogger,
  sourceTransfer?: HdrTransfer,
  targetTransfer?: HdrTransfer,
  hdrPerf?: HdrPerfCollector,
): void {
  const frameSource = hdrVideoFrameSources.get(el.id);
  const startTime = hdrStartTimes.get(el.id);
  if (!frameSource || startTime === undefined || el.opacity <= 0) {
    return;
  }

  // Frame index within the video. Clamp to the extracted raw frame count so
  // a composition that outlives the source clip freezes on the last frame,
  // matching Chrome's <video> behavior.
  const videoFrameIndex = Math.round((time - startTime) * fps) + 1;
  if (videoFrameIndex < 1) return;
  const effectiveIndex = Math.min(videoFrameIndex, frameSource.frameCount);
  if (effectiveIndex < 1) return;
  const frameOffset = (effectiveIndex - 1) * frameSource.frameSize;

  try {
    if (hdrPerf) hdrPerf.hdrVideoLayerBlits += 1;
    const bytesRead = timeHdrPhase(hdrPerf, "hdrVideoReadDecodeMs", () =>
      readSync(frameSource.fd, frameSource.scratch, 0, frameSource.frameSize, frameOffset),
    );
    if (bytesRead !== frameSource.frameSize) return;
    const hdrRgb = frameSource.scratch;
    const srcW = frameSource.width;
    const srcH = frameSource.height;

    // Convert between HDR transfer functions if source doesn't match output
    if (sourceTransfer && targetTransfer && sourceTransfer !== targetTransfer) {
      timeHdrPhase(hdrPerf, "hdrVideoTransferMs", () =>
        convertTransfer(hdrRgb, sourceTransfer, targetTransfer),
      );
    }

    const rawMatrix = parseTransformMatrix(el.transform);
    const matrix = rawMatrix && isAffineMatrix(rawMatrix) ? rawMatrix : null;

    const br = el.borderRadius;
    const hasBorderRadius = br[0] > 0 || br[1] > 0 || br[2] > 0 || br[3] > 0;
    const borderRadiusParam = hasBorderRadius ? br : undefined;

    let blitX = el.x;
    let blitY = el.y;
    let blitSrcX = 0;
    let blitSrcY = 0;
    let blitW = srcW;
    let blitH = srcH;
    let clipped = false;

    if (el.clipRect) {
      const cr = el.clipRect;
      const cx1 = Math.max(blitX, cr.x);
      const cy1 = Math.max(blitY, cr.y);
      const cx2 = Math.min(blitX + blitW, cr.x + cr.width);
      const cy2 = Math.min(blitY + blitH, cr.y + cr.height);
      if (cx2 <= cx1 || cy2 <= cy1) return;
      blitSrcX = cx1 - blitX;
      blitSrcY = cy1 - blitY;
      blitW = cx2 - cx1;
      blitH = cy2 - cy1;
      blitX = cx1;
      blitY = cy1;
      clipped = true;
    }

    const isTranslationOnly = !!(
      matrix &&
      Math.abs(matrix[0] - 1) < TRANSFORM_IDENTITY_EPSILON &&
      Math.abs(matrix[1]) < TRANSFORM_IDENTITY_EPSILON &&
      Math.abs(matrix[2]) < TRANSFORM_IDENTITY_EPSILON &&
      Math.abs(matrix[3] - 1) < TRANSFORM_IDENTITY_EPSILON
    );

    timeHdrPhase(hdrPerf, "hdrVideoBlitMs", () => {
      if (matrix && !isTranslationOnly) {
        if (clipped && log) {
          log.debug(
            `HDR clip rect on affine-transformed element ${el.id} — clip not applied (affine scissor not yet supported)`,
          );
        }
        blitRgb48leAffine(
          canvas,
          hdrRgb,
          matrix,
          srcW,
          srcH,
          width,
          height,
          resolveBlitOpacity(el.opacity),
          borderRadiusParam,
        );
      } else if (clipped) {
        const croppedBuf = cropRgb48le(hdrRgb, srcW, srcH, blitSrcX, blitSrcY, blitW, blitH);
        blitRgb48leRegion(
          canvas,
          croppedBuf,
          blitX,
          blitY,
          blitW,
          blitH,
          width,
          height,
          resolveBlitOpacity(el.opacity),
          borderRadiusParam,
        );
      } else {
        blitRgb48leRegion(
          canvas,
          hdrRgb,
          el.x,
          el.y,
          srcW,
          srcH,
          width,
          height,
          resolveBlitOpacity(el.opacity),
          borderRadiusParam,
        );
      }
    });
  } catch (err) {
    if (log) {
      log.debug(`HDR blit failed for ${el.id}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// ─── Image buffer ──────────────────────────────────────────────────────────

/**
 * Pre-decoded HDR image buffer with its native pixel dimensions.
 *
 * Static images decode exactly once at setup time and are blitted on every
 * visible frame, unlike video frames which are read fresh per timestamp.
 */
export interface HdrImageBuffer {
  data: Buffer;
  width: number;
  height: number;
}

/**
 * Blit a single HDR image layer onto an rgb48le canvas.
 *
 * Image-equivalent of `blitHdrVideoLayer` — the buffer is pre-decoded and
 * static, so there's no time-based frame lookup or per-frame PNG read.
 */
export function blitHdrImageLayer(
  canvas: Buffer,
  el: ElementStackingInfo,
  hdrImageBuffers: Map<string, HdrImageBuffer>,
  hdrImageTransferCache: HdrImageTransferCache,
  width: number,
  height: number,
  log?: ProducerLogger,
  sourceTransfer?: HdrTransfer,
  targetTransfer?: HdrTransfer,
  hdrPerf?: HdrPerfCollector,
): void {
  const buf = hdrImageBuffers.get(el.id);
  if (!buf || el.opacity <= 0) {
    return;
  }
  if (el.clipRect && log) {
    log.debug(`HDR clip rect on image element ${el.id} — clip not yet supported for images`);
  }

  try {
    if (hdrPerf) hdrPerf.hdrImageLayerBlits += 1;
    // The cache returns `buf.data` unchanged when no conversion is needed,
    // and otherwise returns a per-(imageId, targetTransfer) buffer that was
    // converted exactly once and reused across every subsequent frame.
    const hdrRgb = timeHdrPhase(hdrPerf, "hdrImageTransferMs", () =>
      sourceTransfer && targetTransfer
        ? hdrImageTransferCache.getConverted(el.id, sourceTransfer, targetTransfer, buf.data)
        : buf.data,
    );

    const rawMatrix = parseTransformMatrix(el.transform);
    const matrix = rawMatrix && isAffineMatrix(rawMatrix) ? rawMatrix : null;

    const br = el.borderRadius;
    const hasBorderRadius = br[0] > 0 || br[1] > 0 || br[2] > 0 || br[3] > 0;
    const borderRadiusParam = hasBorderRadius ? br : undefined;

    timeHdrPhase(hdrPerf, "hdrImageBlitMs", () => {
      if (matrix) {
        blitRgb48leAffine(
          canvas,
          hdrRgb,
          matrix,
          buf.width,
          buf.height,
          width,
          height,
          resolveBlitOpacity(el.opacity),
          borderRadiusParam,
        );
      } else {
        blitRgb48leRegion(
          canvas,
          hdrRgb,
          el.x,
          el.y,
          buf.width,
          buf.height,
          width,
          height,
          resolveBlitOpacity(el.opacity),
          borderRadiusParam,
        );
      }
    });
  } catch (err) {
    if (log) {
      log.debug(`HDR image blit failed for ${el.id}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// ─── Composite transfer + strategy ─────────────────────────────────────────

/**
 * Dependencies passed to `compositeHdrFrame`.
 *
 * Every field except the per-frame arguments is captured once when the HDR
 * render path opens its `try { ... }` block and reused across every frame —
 * extracting them into an explicit struct lets the helper live at module
 * scope (no closure-over-renderJob) and keeps the per-call signature small.
 */
export type CompositeTransfer = HdrTransfer | "srgb";

export function shouldUseLayeredComposite(options: {
  hasHdrContent: boolean;
  hasShaderTransitions: boolean;
  isPngSequence: boolean;
}): boolean {
  return options.hasHdrContent || (options.hasShaderTransitions && !options.isPngSequence);
}

export function resolveCompositeTransfer(
  hasHdrContent: boolean,
  effectiveHdr: { transfer: HdrTransfer } | undefined,
): CompositeTransfer {
  return hasHdrContent && effectiveHdr ? effectiveHdr.transfer : "srgb";
}

export function selectDomLayerShowIds(
  layerElementIds: string[],
  fullStacking: ElementStackingInfo[],
): string[] {
  const byId = new Map(fullStacking.map((el) => [el.id, el]));
  return layerElementIds.filter((id) => {
    const el = byId.get(id);
    return !!el && el.opacity > 0 && (el.visible || el.renderFrameVisible === true);
  });
}

export interface HdrCompositeContext {
  log: ProducerLogger;
  domSession: CaptureSession;
  beforeCaptureHook: BeforeCaptureHook | null;
  width: number;
  height: number;
  fps: number;
  compositeTransfer: CompositeTransfer;
  nativeHdrImageIds: Set<string>;
  hdrImageBuffers: Map<string, HdrImageBuffer>;
  hdrImageTransferCache: HdrImageTransferCache;
  hdrVideoFrameSources: Map<string, HdrVideoFrameSource>;
  hdrVideoStartTimes: Map<string, number>;
  imageTransfers: Map<string, HdrTransfer>;
  videoTransfers: Map<string, HdrTransfer>;
  debugDumpEnabled: boolean;
  debugDumpDir: string | null;
  hdrPerf?: HdrPerfCollector;
}

// ─── Per-frame compositor ──────────────────────────────────────────────────

/**
 * Composite a single HDR frame into a pre-allocated `rgb48le` canvas.
 *
 * Bottom-to-top z-order: HDR layers are blitted directly from cached image
 * buffers / extracted video frames; DOM layers are screenshotted with a
 * mass-hide mask (so each layer paints only its own elements) and then
 * blended into the canvas via `blitRgba8OverRgb48le` in the active HDR
 * transfer space.
 *
 * The `elementFilter` parameter exists so the transition path can composite
 * each scene independently; pass `undefined` for whole-stack rendering.
 *
 * @param ctx - Long-lived dependencies (logger, browser session, dimensions,
 *              HDR layer maps). Captured once per render — see
 *              {@link HdrCompositeContext}.
 * @param canvas - Pre-allocated `width * height * 6` byte buffer. Caller must
 *                 zero-fill before every frame (this helper does not).
 * @param time - Seek time in seconds.
 * @param fullStacking - Stacking info for ALL elements at this time. Even when
 *                       filtering, every other element id is needed to build
 *                       the DOM-layer hide-list.
 * @param elementFilter - When set, only elements whose id is in the set are
 *                        composited.
 * @param debugFrameIndex - Frame index used to label per-layer diagnostic
 *                          dumps. Pass `-1` to disable per-layer dumps even
 *                          when `KEEP_TEMP=1` (e.g. for warmup frames).
 */
// fallow-ignore-next-line complexity
export async function compositeHdrFrame(
  ctx: HdrCompositeContext,
  canvas: Buffer,
  time: number,
  fullStacking: ElementStackingInfo[],
  elementFilter?: Set<string>,
  debugFrameIndex: number = -1,
): Promise<void> {
  const {
    log,
    domSession,
    beforeCaptureHook,
    width,
    height,
    fps,
    compositeTransfer,
    nativeHdrImageIds,
    hdrImageBuffers,
    hdrImageTransferCache,
    hdrVideoFrameSources,
    hdrVideoStartTimes,
    imageTransfers,
    videoTransfers,
    debugDumpEnabled,
    debugDumpDir,
    hdrPerf,
  } = ctx;

  const filteredStacking = elementFilter
    ? fullStacking.filter((e) => elementFilter.has(e.id))
    : fullStacking;

  // Zero-opacity elements stay in the stacking for correct hide-list
  // generation (their <img> replacements must be hidden from sibling
  // screenshots). The actual blit is skipped in the compositing loop below.
  const layers = groupIntoLayers(filteredStacking);
  const allElementIds = fullStacking.map((e) => e.id);

  const shouldLog = debugDumpEnabled && debugFrameIndex >= 0;
  if (shouldLog) {
    log.info("[diag] compositeToBuffer plan", {
      frame: debugFrameIndex,
      time: time.toFixed(3),
      filterSize: elementFilter?.size,
      fullStackingCount: fullStacking.length,
      filteredCount: filteredStacking.length,
      layerCount: layers.length,
      layers: layers.map((l) =>
        l.type === "hdr"
          ? {
              type: "hdr",
              id: l.element.id,
              z: l.element.zIndex,
              visible: l.element.visible,
              opacity: l.element.opacity,
              bounds: `${Math.round(l.element.x)},${Math.round(l.element.y)} ${Math.round(l.element.width)}x${Math.round(l.element.height)}`,
            }
          : { type: "dom", ids: l.elementIds },
      ),
    });
  }

  for (const [layerIdx, layer] of layers.entries()) {
    if (layer.type === "hdr") {
      // Skip zero-opacity HDR elements — their parent scene may have faded out.
      if (layer.element.opacity <= 0) continue;
      const before = shouldLog ? countNonZeroRgb48(canvas) : 0;
      const isHdrImage = nativeHdrImageIds.has(layer.element.id);
      const hdrTargetTransfer = compositeTransfer === "srgb" ? undefined : compositeTransfer;
      if (isHdrImage) {
        blitHdrImageLayer(
          canvas,
          layer.element,
          hdrImageBuffers,
          hdrImageTransferCache,
          width,
          height,
          log,
          imageTransfers.get(layer.element.id),
          hdrTargetTransfer,
          hdrPerf,
        );
      } else {
        blitHdrVideoLayer(
          canvas,
          layer.element,
          time,
          fps,
          hdrVideoFrameSources,
          hdrVideoStartTimes,
          width,
          height,
          log,
          videoTransfers.get(layer.element.id),
          hdrTargetTransfer,
          hdrPerf,
        );
      }
      if (shouldLog) {
        const after = countNonZeroRgb48(canvas);
        if (isHdrImage) {
          const buf = hdrImageBuffers.get(layer.element.id);
          log.info("[diag] hdr layer blit", {
            frame: debugFrameIndex,
            layerIdx,
            id: layer.element.id,
            kind: "image",
            pixelsAdded: after - before,
            totalNonZero: after,
            bufferDecoded: !!buf,
            bufferDims: buf ? `${buf.width}x${buf.height}` : null,
          });
        } else {
          const frameSource = hdrVideoFrameSources.get(layer.element.id);
          const startTime = hdrVideoStartTimes.get(layer.element.id) ?? 0;
          const localTime = time - startTime;
          const frameNum = Math.floor(localTime * fps) + 1;
          log.info("[diag] hdr layer blit", {
            frame: debugFrameIndex,
            layerIdx,
            id: layer.element.id,
            kind: "video",
            pixelsAdded: after - before,
            totalNonZero: after,
            startTime,
            localTime: localTime.toFixed(3),
            hdrFrameNum: frameNum,
            rawPath: frameSource?.rawPath ?? null,
            frameCount: frameSource?.frameCount ?? null,
          });
        }
      }
    } else {
      // DOM layer: capture only elements in this layer.
      //
      // Each layer gets a fresh seek + inject cycle to guarantee correct
      // visibility state — avoids fragile interactions between the frame
      // injector, applyDomLayerMask, removeDomLayerMask, and GSAP re-seek.
      //
      // The mask:
      //   - mass-hides every body descendant via stylesheet
      //   - re-shows the layer's currently paintable elements (and their
      //     descendants and injected `__render_frame_*` siblings) so
      //     deep-nested content stays visible even though intermediate
      //     ancestors are hidden
      //   - inline-hides every other data-start element so they don't
      //     paint when they happen to be descendants of a layer element
      //     (most importantly: HDR videos and other-layer SDR videos
      //     that live inside `#root` when capturing the root DOM layer)
      //
      // Without the mask, every DOM screenshot captures the full page
      // (root background, sibling scenes' static content, the painted
      // border/box-shadow of cards, etc.) and the resulting opaque
      // pixels overwrite previously composited HDR content beneath.
      const layerIds = new Set(layer.elementIds);
      const showIds = selectDomLayerShowIds(layer.elementIds, fullStacking);
      if (showIds.length === 0) {
        if (shouldLog) {
          log.info("[diag] dom layer skipped, all elements not paintable", {
            frame: debugFrameIndex,
            layerIdx,
            layerIds: layer.elementIds,
          });
        }
        continue;
      }
      const hideIds = allElementIds.filter((id) => !layerIds.has(id));
      if (hdrPerf) hdrPerf.domLayerCaptures += 1;

      // 1. Seek GSAP to restore all animated properties from clean state
      await timeHdrPhaseAsync(hdrPerf, "domLayerSeekMs", () =>
        domSession.page.evaluate((t: number) => {
          if (window.__hf && typeof window.__hf.seek === "function") window.__hf.seek(t);
        }, time),
      );

      // 2. Run frame injector to set correct SDR video visibility
      if (beforeCaptureHook) {
        await timeHdrPhaseAsync(hdrPerf, "domLayerInjectMs", () =>
          beforeCaptureHook(domSession.page, time),
        );
      }

      // 3. Install the mask (mass-hide stylesheet + inline-hide non-layer ids)
      await timeHdrPhaseAsync(hdrPerf, "domMaskApplyMs", () =>
        applyDomLayerMask(domSession.page, showIds, hideIds),
      );

      // 4. Screenshot
      const domPng = await timeHdrPhaseAsync(hdrPerf, "domScreenshotMs", () =>
        captureAlphaPng(domSession.page, width, height),
      );

      // 5. Tear down the mask
      await timeHdrPhaseAsync(hdrPerf, "domMaskRemoveMs", () =>
        removeDomLayerMask(domSession.page, hideIds),
      );

      try {
        const { data: domRgba } = timeHdrPhase(hdrPerf, "domPngDecodeMs", () => decodePng(domPng));
        const before = shouldLog ? countNonZeroRgb48(canvas) : 0;
        const alphaPixels = shouldLog ? countNonZeroAlpha(domRgba) : 0;
        timeHdrPhase(hdrPerf, "domBlitMs", () =>
          blitRgba8OverRgb48le(domRgba, canvas, width, height, compositeTransfer),
        );
        if (shouldLog && debugDumpDir) {
          const after = countNonZeroRgb48(canvas);
          const dumpName = `frame_${String(debugFrameIndex).padStart(4, "0")}_layer_${String(layerIdx).padStart(2, "0")}_dom.png`;
          const dumpPath = join(debugDumpDir, dumpName);
          writeFileExclusiveSync(dumpPath, domPng);
          log.info("[diag] dom layer blit", {
            frame: debugFrameIndex,
            layerIdx,
            layerIds: layer.elementIds,
            showIds,
            hideCount: hideIds.length,
            pngBytes: domPng.length,
            alphaPixels,
            pixelsAdded: after - before,
            totalNonZero: after,
            dumpPath,
          });
        }
      } catch (err) {
        log.warn("DOM layer decode/blit failed; skipping overlay", {
          layerIds: layer.elementIds,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  if (shouldLog && debugDumpDir) {
    const finalNonZero = countNonZeroRgb48(canvas);
    log.info("[diag] compositeToBuffer end", {
      frame: debugFrameIndex,
      finalNonZeroPixels: finalNonZero,
      totalPixels: width * height,
      coverage: ((finalNonZero / (width * height)) * 100).toFixed(1) + "%",
    });
  }
}
