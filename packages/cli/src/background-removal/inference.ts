/**
 * u2net_human_seg inference: RGB frame → RGBA frame (alpha = human mask).
 *
 * Pre/postprocessing matches rembg's u2net session
 * (https://github.com/danielgatis/rembg/blob/main/rembg/sessions/u2net.py)
 * so output should be pixel-equivalent to `rembg new_session("u2net_human_seg")`.
 */
import type { InferenceSession, Tensor } from "onnxruntime-node";
import type sharpType from "sharp";
import { ensureModel, selectProviders, type Device, type ModelId } from "./manager.js";

const INPUT_SIZE = 320;
const INPUT_PLANE = INPUT_SIZE * INPUT_SIZE;

// Must match rembg's U2netHumanSegSession.predict — ImageNet mean/std, NOT the
// (1.0, 1.0, 1.0) std used by the general-purpose u2net session.
// https://github.com/danielgatis/rembg/blob/main/rembg/sessions/u2net_human_seg.py#L33
export const MEAN = [0.485, 0.456, 0.406] as const;
export const STD = [0.229, 0.224, 0.225] as const;

type Sharp = typeof sharpType;
interface OrtModule {
  InferenceSession: typeof InferenceSession;
  Tensor: typeof Tensor;
}

export interface SessionResult {
  /** Subject opaque, background fully transparent. */
  fg: Buffer;
  /** Inverse-alpha plate: same RGB, alpha is `255 − mask`. Null unless `withBackground` was true. */
  bg: Buffer | null;
}

export interface Session {
  /**
   * Both `fg` and `bg` (when requested) are session-owned buffers reused on the
   * next call — drain the encoder's stdin before invoking `process` again.
   */
  process(
    rgb: Buffer,
    width: number,
    height: number,
    withBackground?: boolean,
  ): Promise<SessionResult>;
  provider: string;
  close(): Promise<void>;
}

export interface CreateSessionOptions {
  model?: ModelId;
  device?: Device;
  onProgress?: (message: string) => void;
}

// onnxruntime-node and sharp are optional native modules — their platform
// binaries don't install everywhere. Surface an actionable error instead of a
// raw "Cannot find module" when one can't load.
async function loadNative<T>(name: string, load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (err) {
    throw new Error(
      `remove-background needs the optional native module '${name}', which isn't available ` +
        `(${(err as Error).message}). Install it with \`npm i ${name}\`, or reinstall hyperframes with optional dependencies enabled.`,
    );
  }
}

export async function createSession(options: CreateSessionOptions = {}): Promise<Session> {
  const ort = (await loadNative(
    "onnxruntime-node",
    () => import("onnxruntime-node"),
  )) as unknown as OrtModule;
  const sharp = (await loadNative("sharp", () => import("sharp"))).default as Sharp;

  const choice = selectProviders(options.device ?? "auto");
  const path = await ensureModel(options.model, { onProgress: options.onProgress });

  options.onProgress?.(`Loading model on ${choice.label}...`);

  const tryCreate = (providers: string[]) =>
    ort.InferenceSession.create(path, {
      executionProviders: providers,
      graphOptimizationLevel: "all",
    });

  let session: InferenceSession;
  let providerUsed = choice.label;
  try {
    session = await tryCreate(choice.providers);
  } catch (err) {
    if (choice.providers[0] === "cpu") throw err;
    options.onProgress?.(
      `${choice.label} provider failed (${(err as Error).message}); falling back to CPU.`,
    );
    session = await tryCreate(["cpu"]);
    providerUsed = "CPU";
  }

  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  if (!inputName || !outputName) {
    throw new Error("ONNX session is missing input or output bindings");
  }

  // Reused across calls; sized lazily on first frame. Saves ~9 MB/frame at 1080p.
  const inputData = new Float32Array(3 * INPUT_PLANE);
  const maskBuf = Buffer.allocUnsafe(INPUT_PLANE);
  let rgbaBuf: Buffer | null = null;
  let rgbaBgBuf: Buffer | null = null;

  return {
    provider: providerUsed,
    async process(rgb, width, height, withBackground = false) {
      const tensor = await preprocess(sharp, ort, rgb, width, height, inputData);
      const outputs = await session.run({ [inputName]: tensor });
      const output = outputs[outputName];
      if (!output) throw new Error(`Model did not return output '${outputName}'`);
      const expectedBytes = width * height * 4;
      if (!rgbaBuf || rgbaBuf.length !== expectedBytes) {
        rgbaBuf = Buffer.allocUnsafe(expectedBytes);
      }
      if (withBackground) {
        if (!rgbaBgBuf || rgbaBgBuf.length !== expectedBytes) {
          rgbaBgBuf = Buffer.allocUnsafe(expectedBytes);
        }
      }
      return await postprocess(
        sharp,
        output,
        rgb,
        width,
        height,
        maskBuf,
        rgbaBuf,
        withBackground ? rgbaBgBuf : null,
      );
    },
    async close() {
      await session.release();
    },
  };
}

async function preprocess(
  sharp: Sharp,
  ort: OrtModule,
  rgb: Buffer,
  width: number,
  height: number,
  inputData: Float32Array,
): Promise<Tensor> {
  const resized = await sharp(rgb, { raw: { width, height, channels: 3 } })
    .resize(INPUT_SIZE, INPUT_SIZE, { kernel: "lanczos3", fit: "fill" })
    .raw()
    .toBuffer();

  // rembg's normalize divides by `np.max(im_ary)` (NOT 255). Match exactly so
  // we hit the same operating point as the model's training distribution.
  let maxPixel = 0;
  for (let i = 0; i < resized.length; i++) {
    if (resized[i]! > maxPixel) maxPixel = resized[i]!;
  }
  if (maxPixel === 0) maxPixel = 1;

  for (let y = 0; y < INPUT_SIZE; y++) {
    for (let x = 0; x < INPUT_SIZE; x++) {
      const src = (y * INPUT_SIZE + x) * 3;
      const dst = y * INPUT_SIZE + x;
      inputData[dst] = (resized[src]! / maxPixel - MEAN[0]) / STD[0];
      inputData[INPUT_PLANE + dst] = (resized[src + 1]! / maxPixel - MEAN[1]) / STD[1];
      inputData[2 * INPUT_PLANE + dst] = (resized[src + 2]! / maxPixel - MEAN[2]) / STD[2];
    }
  }

  return new ort.Tensor("float32", inputData, [1, 3, INPUT_SIZE, INPUT_SIZE]);
}

async function postprocess(
  sharp: Sharp,
  output: Tensor,
  rgb: Buffer,
  width: number,
  height: number,
  maskBuf: Buffer,
  rgbaBuf: Buffer,
  rgbaBgBuf: Buffer | null,
): Promise<SessionResult> {
  const raw = output.data as Float32Array;

  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < INPUT_PLANE; i++) {
    const v = raw[i]!;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const range = hi - lo || 1;

  for (let i = 0; i < INPUT_PLANE; i++) {
    const norm = (raw[i]! - lo) / range;
    maskBuf[i] = Math.max(0, Math.min(255, Math.round(norm * 255)));
  }

  // lanczos3 keeps soft edges; nearest leaves visible jaggies on hair.
  // Sharp upcasts the single-channel raw input to a 3-channel buffer during
  // resize, so the output is laid out as RGB-interleaved (R0,G0,B0,R1,G1,B1,...)
  // even though all three channels carry the same grayscale value. Force the
  // output back to single channel with toColourspace("b-w") so we can index
  // it linearly as a mask.
  const fullMask = await sharp(maskBuf, {
    raw: { width: INPUT_SIZE, height: INPUT_SIZE, channels: 1 },
  })
    .resize(width, height, { kernel: "lanczos3", fit: "fill" })
    .toColourspace("b-w")
    .raw()
    .toBuffer();

  return applyMask(rgb, fullMask, rgbaBuf, rgbaBgBuf, width * height);
}

/**
 * Composite the RGB source frame with the segmentation mask into one or two
 * RGBA buffers. The contract this PR is built on:
 *  - `fg`'s alpha is the mask, `bg`'s alpha (when provided) is `255 − mask`,
 *    so `fg.alpha + bg.alpha === 255` for every pixel.
 *  - RGB triples are byte-identical between `fg` and `bg`.
 *  - When `bg` is null, only `fg` is touched.
 *
 * Exported for direct unit testing of the invariants above without spinning
 * up an ONNX session.
 */
export function applyMask(
  rgb: Buffer,
  mask: Buffer,
  fg: Buffer,
  bg: Buffer | null,
  pixels: number,
): SessionResult {
  if (bg) {
    for (let i = 0; i < pixels; i++) {
      const r = rgb[i * 3]!;
      const g = rgb[i * 3 + 1]!;
      const b = rgb[i * 3 + 2]!;
      const m = mask[i]!;
      const o = i * 4;
      fg[o] = r;
      fg[o + 1] = g;
      fg[o + 2] = b;
      fg[o + 3] = m;
      bg[o] = r;
      bg[o + 1] = g;
      bg[o + 2] = b;
      bg[o + 3] = 255 - m;
    }
    return { fg, bg };
  }
  for (let i = 0; i < pixels; i++) {
    fg[i * 4] = rgb[i * 3]!;
    fg[i * 4 + 1] = rgb[i * 3 + 1]!;
    fg[i * 4 + 2] = rgb[i * 3 + 2]!;
    fg[i * 4 + 3] = mask[i]!;
  }
  return { fg, bg: null };
}
