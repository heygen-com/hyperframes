/**
 * HDR passthrough overlay capture: one transparent screenshot per overlay
 * state, mapped to the HDR signal space and written as a 16-bit RGBA PNG.
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import {
  type CaptureSession,
  type ElementStackingInfo,
  type HdrTransfer,
  applyDomLayerMask,
  captureAlphaPng,
  decodePng,
  getSrgbToSignalLut,
  groupIntoLayers,
  removeDomLayerMask,
} from "@hyperframes/engine";
import { selectDomLayerShowIds } from "../hdrCompositor.js";
import { seekInjectAndQueryStacking } from "../render/stages/captureHdrFrameShared.js";
import { readOverlayFingerprint } from "./overlayFingerprint.js";
import type {
  CaptureOverlayStatesArgs,
  CapturedOverlay,
  CapturedOverlaySet,
  OverlayState,
} from "./types.js";

/** Bytes per pixel of the 16-bit RGBA overlay PNG (4 channels x 2 bytes). */
const RGBA16_BYTES_PER_PIXEL = 8;

/**
 * Overlay PNGs are read once by the composite ffmpeg run, so encode speed
 * matters more than size; matches the engine's intermediate-frame PNG level.
 */
const OVERLAY_PNG_DEFLATE_LEVEL = 1;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Map 8-bit straight-alpha sRGB RGBA pixels (as `decodePng` returns them) to
 * 16-bit RGBA in the HDR signal space, in PNG byte order (big-endian).
 *
 * RGB goes through `getSrgbToSignalLut(transfer)`, the LUT
 * `blitRgba8OverRgb48le` applies before blending; alpha widens as
 * `a8 * 257`, so `a16 / 65535 === a8 / 255` exactly. Alpha stays straight
 * (not premultiplied): a straight-alpha `over` of the result onto an HDR
 * frame then computes the layered blend `signal * a + video * (1 - a)`.
 */
export function mapOverlayToSignalRgba16(rgba8: Uint8Array, transfer: HdrTransfer): Buffer {
  if (rgba8.length % 4 !== 0) {
    throw new Error(`mapOverlayToSignalRgba16: ${rgba8.length} bytes is not whole RGBA pixels`);
  }
  const lut = getSrgbToSignalLut(transfer);
  const pixelCount = rgba8.length / 4;
  const out = Buffer.allocUnsafe(pixelCount * RGBA16_BYTES_PER_PIXEL);
  for (let i = 0; i < pixelCount; i++) {
    const src = i * 4;
    const dst = i * RGBA16_BYTES_PER_PIXEL;
    const r = lut[rgba8[src] ?? 0] ?? 0;
    const g = lut[rgba8[src + 1] ?? 0] ?? 0;
    const b = lut[rgba8[src + 2] ?? 0] ?? 0;
    const a = (rgba8[src + 3] ?? 0) * 257;
    out[dst] = r >>> 8;
    out[dst + 1] = r & 0xff;
    out[dst + 2] = g >>> 8;
    out[dst + 3] = g & 0xff;
    out[dst + 4] = b >>> 8;
    out[dst + 5] = b & 0xff;
    out[dst + 6] = a >>> 8;
    out[dst + 7] = a & 0xff;
  }
  return out;
}

function pngChunk(type: string, body: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const header = Buffer.alloc(8);
  header.writeUInt32BE(body.length, 0);
  typeBytes.copy(header, 4);
  const trailer = Buffer.alloc(4);
  trailer.writeUInt32BE(crc32(body, crc32(typeBytes)), 0);
  return Buffer.concat([header, body, trailer]);
}

/**
 * Encode 16-bit RGBA pixels (big-endian, `mapOverlayToSignalRgba16` output)
 * as a PNG: colour type 6, bit depth 16, non-interlaced. Every scanline uses
 * filter 0 and zlib runs at a fixed level, so identical pixels give an
 * identical file.
 */
export function encodePngRgba16(width: number, height: number, rgba16be: Buffer): Buffer {
  const stride = width * RGBA16_BYTES_PER_PIXEL;
  const expected = stride * height;
  if (rgba16be.length !== expected) {
    throw new Error(
      `encodePngRgba16: expected ${expected} bytes for ${width}x${height}, got ${rgba16be.length}`,
    );
  }
  const filtered = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    filtered[y * (stride + 1)] = 0;
    rgba16be.copy(filtered, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 16; // bit depth
  ihdr[9] = 6; // colour type RGBA
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(filtered, { level: OVERLAY_PNG_DEFLATE_LEVEL })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Hex sha256 of 8-bit RGBA overlay pixels; the dedupe key for overlay states. */
export function hashOverlayPixels(rgba8: Uint8Array): string {
  return createHash("sha256").update(rgba8).digest("hex");
}

/**
 * Element ids that paint above the passthrough video, in the layered
 * compositor's z-order (`groupIntoLayers`). DOM layers below the video are
 * dropped: the layered path paints them first and the opaque full-frame
 * video blit then covers them.
 */
export function overlayElementIdsAboveVideo(
  stacking: ElementStackingInfo[],
  videoId: string,
): string[] {
  const layers = groupIntoLayers(stacking);
  const videoLayer = layers.findIndex((l) => l.type === "hdr" && l.element.id === videoId);
  if (videoLayer < 0) {
    throw new Error(`hdrPassthrough: video ${videoId} is missing from the element stacking`);
  }
  const ids: string[] = [];
  for (const layer of layers.slice(videoLayer + 1)) {
    if (layer.type === "dom") ids.push(...layer.elementIds);
  }
  return ids;
}

/**
 * The fields of the video's stacking entry the layered compositor blits the
 * video from on every frame (`blitHdrVideoLayer`) and orders its layers by.
 * Its paintability is left out: the frame injector hides the native video on
 * a capture and not on a probe.
 */
const VIDEO_LAYER_FIELDS = [
  "zIndex",
  "x",
  "y",
  "width",
  "height",
  "layoutWidth",
  "layoutHeight",
  "opacity",
  "isHdr",
  "transform",
  "borderRadius",
  "objectFit",
  "objectPosition",
  "clipRect",
] as const satisfies ReadonlyArray<keyof ElementStackingInfo>;

/** Thrown when the video's own layer is not the one the composite lays on a frame. */
export class VideoLayerChangedError extends Error {
  constructor(frame: number, detail: string) {
    super(`hdrPassthrough: the video's layer changes at frame ${frame} (${detail})`);
    this.name = "VideoLayerChangedError";
  }
}

/**
 * A check of the video's stacking entry on every probed and captured frame.
 * The composite always lays the full-opacity source in one place, so the
 * entry must be fully opaque and, field for field (`VIDEO_LAYER_FIELDS`),
 * `expected`, the analysis page's entry at frame 0, which eligibility's
 * layout gates hold to the canvas (without it, the entry of the first frame
 * checked). The capture page loads on its own, never paused, so a page that
 * lays its video out differently there declines too. Overlay fingerprints leave the video out, so
 * without this a stylesheet rule that reaches the video through a selector
 * (`:has()`, a sibling combinator) and fires on a caption's clip window or a
 * GSAP `set()` of another element would dim the layered render only.
 * Throws `VideoLayerChangedError`.
 */
export function createVideoLayerGuard(
  videoId: string,
  expected?: ElementStackingInfo,
): (frame: number, stacking: readonly ElementStackingInfo[]) => void {
  let baseline: { frame: number | string; entry: ElementStackingInfo } | undefined = expected
    ? { frame: "0 on the analysis page", entry: expected }
    : undefined;
  return (frame, stacking) => {
    const entry = stacking.find((e) => e.id === videoId);
    if (!entry) throw new VideoLayerChangedError(frame, "missing from the element stacking");
    if (entry.opacity !== 1) throw new VideoLayerChangedError(frame, `opacity ${entry.opacity}`);
    if (!baseline) {
      baseline = { frame, entry };
      return;
    }
    const was = baseline.entry;
    const changed = VIDEO_LAYER_FIELDS.filter(
      (field) => JSON.stringify(entry[field]) !== JSON.stringify(was[field]),
    );
    if (changed.length === 0) return;
    const detail = changed
      .map((f) => `${f} ${JSON.stringify(was[f])} -> ${JSON.stringify(entry[f])}`)
      .join(", ");
    throw new VideoLayerChangedError(frame, `${detail}, against frame ${baseline.frame}`);
  };
}

/**
 * Where the overlay pixels come from. `probe(frame, time)` puts the page at
 * `time` (`frame / fps`) and returns the overlay fingerprint there (equal
 * fingerprints render equal pixels); `capture(frame, time)` returns the 8-bit
 * RGBA pixels (`width * height * 4` bytes) at `time`, the frame just probed.
 */
export interface OverlayStateSource {
  probe(frame: number, time: number): Promise<string>;
  capture(frame: number, time: number): Promise<Uint8Array>;
}

/**
 * Capture the overlay DOM at `time` as 8-bit straight-alpha RGBA, the same
 * way `compositeHdrFrame` captures a DOM layer: seek + frame injector +
 * stacking query, then mask every element outside the overlay (the video
 * included), `captureAlphaPng`, and tear the mask down. Returns an all-zero
 * buffer when nothing in the overlay is paintable (the layered path skips
 * that layer, leaving the video untouched).
 */
async function captureOverlayRgba(
  session: CaptureSession,
  time: number,
  videoId: string,
  width: number,
  height: number,
  checkStacking: (stacking: ElementStackingInfo[]) => void,
): Promise<Uint8Array> {
  const { page } = session;
  const stacking = await seekInjectAndQueryStacking(
    page,
    time,
    session.onBeforeCapture,
    new Set([videoId]),
    undefined,
    "domLayerSeekMs",
    "domLayerInjectMs",
    "stackingQueryMs",
  );
  checkStacking(stacking);
  const overlayIds = overlayElementIdsAboveVideo(stacking, videoId);
  const showIds = selectDomLayerShowIds(overlayIds, stacking);
  if (showIds.length === 0) return new Uint8Array(width * height * 4);
  const overlaySet = new Set(overlayIds);
  const hideIds = stacking.map((e) => e.id).filter((id) => !overlaySet.has(id));

  await applyDomLayerMask(page, showIds, hideIds);
  let png: Buffer;
  try {
    png = await captureAlphaPng(page, width, height);
  } finally {
    await removeDomLayerMask(page, hideIds);
  }
  const decoded = decodePng(png);
  if (decoded.width !== width || decoded.height !== height) {
    throw new Error(
      `hdrPassthrough: overlay capture is ${decoded.width}x${decoded.height}, expected ${width}x${height}`,
    );
  }
  return decoded.data;
}

/**
 * Seek to `time` and fingerprint the overlay there. The video-frame injector
 * is skipped: it only writes the video element, its replacement frame and
 * colour-grading canvases, which the fingerprint leaves out and the capture
 * masks (a capture runs the full seek + inject itself).
 */
async function probeOverlay(
  session: CaptureSession,
  time: number,
  videoId: string,
  checkStacking: (stacking: ElementStackingInfo[]) => void,
): Promise<string> {
  const stacking = await seekInjectAndQueryStacking(
    session.page,
    time,
    null,
    new Set([videoId]),
    undefined,
    "domLayerSeekMs",
    "domLayerInjectMs",
    "stackingQueryMs",
  );
  checkStacking(stacking);
  return readOverlayFingerprint(session, videoId, stacking);
}

/** The PNG one captured fingerprint renders to. */
interface CapturedPixels {
  hash: string;
  pngPath: string;
}

/** A merged state being built: the candidates folded into it so far. */
interface OpenState extends CapturedPixels {
  startFrame: number;
  endFrame: number;
  captureFrame: number;
  /** Every fingerprint seen inside this state; all render its pixels. */
  keys: Set<string>;
}

/** Thrown when a frame inside a merged state renders a different overlay. */
export class OverlayStateMismatchError extends Error {
  constructor(frame: number, state: { startFrame: number; endFrame: number }) {
    super(
      `hdrPassthrough: overlay at frame ${frame} differs from its state ` +
        `[${state.startFrame}, ${state.endFrame}); something the static analysis ` +
        `cannot see changes the overlay`,
    );
    this.name = "OverlayStateMismatchError";
  }
}

/**
 * Probe every frame once, in ascending order, capture only fingerprints not
 * captured before, and fold each candidate state into the state before it
 * when it renders the same overlay (same fingerprint, or a new fingerprint
 * whose pixels hash the same). Split from `captureOverlayStates` so the
 * merge and file layout are testable without a browser.
 *
 * The page is walked as the layered loop walks it: every frame is reached
 * from the frame before it, never from a later one, and no frame is visited
 * twice except that a capture follows its own probe. Browser state a seek
 * can leave behind (a scroll offset a shorter layout clamped, a lazy image
 * loaded, a popover opened) is then the state the layered render has at the
 * same frame.
 *
 * A candidate's first frame decides it: it folds into the open merged state
 * or starts a new one. The other frames of a candidate are the planner's
 * claim, which holds only for drivers its static analysis sees: each is
 * probed, a fingerprint not seen in the state is screenshotted, and pixels
 * that differ from the state's throw `OverlayStateMismatchError`, which the
 * caller turns into a fallback to the layered path instead of a render with
 * stale overlays.
 */
export async function writeOverlayStates(
  args: CaptureOverlayStatesArgs,
  source: OverlayStateSource,
): Promise<CapturedOverlaySet> {
  const { plan, outDir, onStateCaptured } = args;
  const startedAt = Date.now();
  await mkdir(outDir, { recursive: true });

  const run: StateRun = {
    args,
    source,
    pathByHash: new Map(),
    pixelsByKey: new Map(),
    merged: [],
    captureCount: 0,
    verifyProbeCount: 0,
  };
  let framesCovered = 0;
  let candidatesDone = 0;
  for (const candidate of plan.states) {
    await walkCandidate(run, candidate);
    framesCovered += candidate.endFrame - candidate.startFrame;
    candidatesDone += 1;
    onStateCaptured?.(framesCovered, candidatesDone, plan.states.length);
  }

  const overlays: CapturedOverlay[] = run.merged.map((s, index) => ({
    state: {
      index,
      startFrame: s.startFrame,
      endFrame: s.endFrame,
      captureFrame: s.captureFrame,
    },
    pngPath: s.pngPath,
    hash: s.hash,
  }));
  return {
    overlays,
    plan: { ...plan, states: overlays.map((o) => o.state) },
    uniqueCount: run.pathByHash.size,
    candidateCount: plan.states.length,
    captureCount: run.captureCount,
    verifyProbeCount: run.verifyProbeCount,
    dir: outDir,
    captureMs: Date.now() - startedAt,
  };
}

/** What `writeOverlayStates` carries from one frame to the next. */
interface StateRun {
  args: CaptureOverlayStatesArgs;
  source: OverlayStateSource;
  /** PNG written for each distinct 8-bit pixel hash. */
  pathByHash: Map<string, string>;
  /** Pixels each fingerprint seen so far renders to. */
  pixelsByKey: Map<string, CapturedPixels>;
  merged: OpenState[];
  captureCount: number;
  verifyProbeCount: number;
}

function frameTime(plan: { fps: { num: number; den: number } }, frame: number): number {
  return (frame * plan.fps.den) / plan.fps.num;
}

/**
 * Probe each frame of one candidate in order: the first folds the
 * candidate into the open merged state or opens a new one
 * (`openOrFold`), the rest must render that state's pixels (`checkHeldFrame`).
 * Each settled frame goes to `onFrame` with the open state's PNG.
 */
async function walkCandidate(run: StateRun, candidate: OverlayState): Promise<void> {
  for (let frame = candidate.startFrame; frame < candidate.endFrame; frame++) {
    run.args.input.assertNotAborted();
    const time = frameTime(run.args.plan, frame);
    const key = await run.source.probe(frame, time);
    if (frame === candidate.startFrame) await openOrFold(run, candidate, time, key);
    else await checkHeldFrame(run, frame, time, key);
    const shown = run.merged.at(-1);
    if (!shown) throw new Error("hdrPassthrough: a frame settled with no overlay state");
    run.args.onFrame?.(frame, shown.pngPath);
  }
}

/**
 * Fold a candidate, from the fingerprint at its first frame, into the open
 * merged state (a fingerprint the state has seen, or one whose pixels are
 * the state's), or open a new state there.
 */
async function openOrFold(
  run: StateRun,
  candidate: OverlayState,
  time: number,
  key: string,
): Promise<void> {
  const { source, merged, pixelsByKey } = run;
  const frame = candidate.startFrame;
  const open = merged.at(-1);
  if (open?.keys.has(key)) {
    open.endFrame = candidate.endFrame;
    return;
  }
  let pixels = pixelsByKey.get(key);
  if (pixels === undefined) {
    const rgba8 = await source.capture(frame, time);
    run.captureCount += 1;
    pixels = await storeOverlayPixels(rgba8, run.args, merged.length, run.pathByHash);
    pixelsByKey.set(key, pixels);
  }
  if (open && open.hash === pixels.hash) {
    open.endFrame = candidate.endFrame;
    open.keys.add(key);
    return;
  }
  merged.push({
    ...pixels,
    startFrame: frame,
    endFrame: candidate.endFrame,
    captureFrame: frame,
    keys: new Set([key]),
  });
}

/**
 * A frame after its candidate's first: a fingerprint the open state has not
 * seen is screenshotted (unless its pixels are already known); pixels other
 * than the state's throw `OverlayStateMismatchError`.
 */
async function checkHeldFrame(
  run: StateRun,
  frame: number,
  time: number,
  key: string,
): Promise<void> {
  const { args, source, pixelsByKey } = run;
  const index = run.merged.length - 1;
  const state = run.merged[index];
  if (!state) throw new Error("hdrPassthrough: a held frame before any overlay state");
  run.verifyProbeCount += 1;
  args.onVerifyProbe?.();
  if (state.keys.has(key)) return;
  let hash = pixelsByKey.get(key)?.hash;
  if (hash === undefined) {
    const rgba8 = await source.capture(frame, time);
    run.captureCount += 1;
    assertOverlaySize(rgba8, args.plan, index);
    hash = hashOverlayPixels(rgba8);
    if (hash === state.hash) pixelsByKey.set(key, { hash, pngPath: state.pngPath });
  }
  if (hash !== state.hash) throw new OverlayStateMismatchError(frame, state);
  state.keys.add(key);
}

function assertOverlaySize(
  rgba8: Uint8Array,
  plan: { width: number; height: number },
  stateIndex: number,
): void {
  const expected = plan.width * plan.height * 4;
  if (rgba8.length !== expected) {
    throw new Error(
      `hdrPassthrough: overlay state ${stateIndex} has ${rgba8.length} bytes, expected ${expected}`,
    );
  }
}

/**
 * Hash one capture's pixels and, when no earlier capture had them, map them
 * to the 16-bit signal space and write `<outDir>/overlay-<stateIndex>.png`.
 */
async function storeOverlayPixels(
  rgba8: Uint8Array,
  args: CaptureOverlayStatesArgs,
  stateIndex: number,
  pathByHash: Map<string, string>,
): Promise<CapturedPixels> {
  const { plan, video, outDir } = args;
  assertOverlaySize(rgba8, plan, stateIndex);
  const hash = hashOverlayPixels(rgba8);
  let pngPath = pathByHash.get(hash);
  if (pngPath === undefined) {
    pngPath = join(outDir, `overlay-${stateIndex}.png`);
    const rgba16 = mapOverlayToSignalRgba16(rgba8, video.transfer);
    await writeFile(pngPath, encodePngRgba16(plan.width, plan.height, rgba16));
    pathByHash.set(hash, pngPath);
  }
  return { hash, pngPath };
}

/**
 * Walk every frame of `plan.states` (the planner's candidate states) once,
 * in ascending order, on a page whose history before frame 0 is the layered
 * DOM session's (`index.ts`):
 *   1. Seek the page to `frame / fps`, query the element stacking and read
 *      the overlay fingerprint (`overlayFingerprint.ts`). No frame
 *      injection: see `probeOverlay`.
 *   2. A fingerprint the open merged state has seen: the frame is that
 *      state's, no capture.
 *   3. A fingerprint captured earlier (a caption-free gap again): reuse that
 *      capture's PNG, no capture.
 *   4. Otherwise capture exactly as the layered loop does: seek again, to
 *      the same time, with the session's `onBeforeCapture` hook
 *      (`seekInjectAndQueryStacking`), mask everything outside the DOM
 *      layers above the passthrough video (the video included) with
 *      `applyDomLayerMask`, `captureAlphaPng`, remove the mask, `decodePng`,
 *      and hash the 8-bit RGBA pixels (sha256). Pixels seen before reuse
 *      that PNG; new ones are mapped with `mapOverlayToSignalRgba16` (RGB →
 *      `getSrgbToSignalLut(transfer)`, alpha → `a8 * 257`, straight alpha)
 *      and written as a 16-bit RGBA PNG (`<outDir>/overlay-<index>.png`).
 *   5. On a candidate's first frame, pixels equal to the open state's fold
 *      the candidate into it, and any others open a new state; on any other
 *      frame, pixels other than the open state's throw
 *      `OverlayStateMismatchError`.
 *   6. Call `onStateCaptured(framesCovered, i + 1, states.length)` after
 *      each candidate with the cumulative `endFrame - startFrame` so far.
 *   7. On every probe and capture, hold the video's own stacking entry to
 *      the analysis page's (`args.analysisVideoLayer`, or the first one
 *      checked, `createVideoLayerGuard`); a frame where it differs throws
 *      `VideoLayerChangedError`.
 *
 * The result's `plan` holds the merged states (one per run of identical
 * overlay output, tiling `[0, totalFrames)` like the input) and `overlays`
 * one entry per merged state. Calls `input.assertNotAborted()` before each
 * frame; the mask is removed after every capture, including a failed one.
 * Pixel parity: a straight-alpha `over` of a returned PNG onto a video
 * frame equals `blitRgba8OverRgb48le(domRgba, frame, w, h, transfer)` within
 * 1 LSB at 16 bit.
 */
export async function captureOverlayStates(
  args: CaptureOverlayStatesArgs,
): Promise<CapturedOverlaySet> {
  const { session, plan, video } = args;
  const checkVideoLayer = createVideoLayerGuard(video.id, args.analysisVideoLayer);
  return writeOverlayStates(args, {
    probe: (frame, time) =>
      probeOverlay(session, time, video.id, (stacking) => checkVideoLayer(frame, stacking)),
    capture: (frame, time) =>
      captureOverlayRgba(session, time, video.id, plan.width, plan.height, (stacking) =>
        checkVideoLayer(frame, stacking),
      ),
  });
}
