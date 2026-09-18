import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { getFfmpegBinary } from "./ffmpegBinaries.js";

/**
 * PSNR (average, dB) between two same-dimension encoded images via ffmpeg.
 * Infinity means bit-identical pixels. Single source of truth for every
 * drawElement self-verify comparison (streaming drain + parallel disk path).
 */
export async function psnrDb(a: Buffer, b: Buffer): Promise<number> {
  // promisify(execFile) lazily, not at module load: this module is in the
  // engine's parallel-capture import chain, and a top-level call to a builtin
  // crashes any downstream test that partially mocks node:child_process
  // without an execFile export (vitest surfaces it as a load-time error).
  const execFileP = promisify(execFile);
  const dir = await mkdtemp(join(tmpdir(), "hf-de-verify-"));
  try {
    const pa = join(dir, "a.jpg");
    const pb = join(dir, "b.jpg");
    await Promise.all([writeFile(pa, a), writeFile(pb, b)]);
    const { stderr } = await execFileP(
      getFfmpegBinary(),
      ["-hide_banner", "-i", pa, "-i", pb, "-lavfi", "psnr", "-f", "null", "-"],
      { maxBuffer: 4 * 1024 * 1024 },
    );
    const m = /average:(inf|[\d.]+)/.exec(stderr);
    if (!m) throw new Error(`psnr parse failed: ${stderr.slice(-300)}`);
    return m[1] === "inf" ? Infinity : Number(m[1]);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * The drawElement self-verify PSNR floor (dB). HF_DE_VERIFY_MIN_DB overrides,
 * clamped to [10, 60]; out-of-range or unset falls back to 32 — the threshold
 * every prior eval used to separate real compositor damage from encoder noise.
 */
export function resolveDeVerifyMinDb(): number {
  const raw = Number(process.env.HF_DE_VERIFY_MIN_DB ?? "32");
  return Number.isFinite(raw) && raw >= 10 && raw <= 60 ? raw : 32;
}

/**
 * Worst-region mean signed channel shift between two same-dimension encoded
 * images, in 1/255 units (0 = no regional difference; 127 = saturated).
 *
 * `psnrDb` answers "how far off are the pixels on average" — a magnitude
 * average a correct background dilutes arbitrarily, so a fully-missing
 * low-contrast element can score 44dB+ and ship with a clean exit code. The
 * self-verify gate's real question is "did any content go missing", so this
 * instead averages the SIGNED per-pixel difference inside ~96px regions and
 * reports the worst one: random encoder noise cancels inside a region while
 * an absent element leaves its whole footprint shifted by its own delta —
 * a wrong region can no longer be averaged away by a correct background.
 * Measured on the issue-3345 repro: the weakest reported miss (a 4/255 luma
 * band over ~15% of a 4K frame, PSNR 44dB) reads ~5/255 here, and even an
 * adversarial independent-noise pair stays ≤2/255.
 *
 * One ffmpeg pass: `grainextract` centers the signed A−B on mid-gray (128),
 * the area-averaged downscale makes each region one cell whose distance from
 * 128 IS its mean shift, and the max |cell−128| over the rgb24 output is the
 * return value. ~96px regions are large enough to cancel encoder noise and
 * small enough that an element worth gating dominates at least one cell.
 */
export async function regionShift(a: Buffer, b: Buffer): Promise<number> {
  // Lazy promisify, same reason as psnrDb above.
  const execFileP = promisify(execFile);
  const dir = await mkdtemp(join(tmpdir(), "hf-de-verify-"));
  try {
    const pa = join(dir, "a.jpg");
    const pb = join(dir, "b.jpg");
    const outPath = join(dir, "shift.raw");
    await Promise.all([writeFile(pa, a), writeFile(pb, b)]);
    await execFileP(
      getFfmpegBinary(),
      [
        "-hide_banner",
        "-i",
        pa,
        "-i",
        pb,
        "-lavfi",
        "[0:v]format=rgb24[ga];[1:v]format=rgb24[gb];" +
          "[ga][gb]blend=all_mode=grainextract," +
          "scale='ceil(iw/96)':'ceil(ih/96)':flags=area",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-y",
        outPath,
      ],
      { maxBuffer: 4 * 1024 * 1024 },
    );
    const raw = await readFile(outPath);
    if (raw.length === 0) {
      throw new Error("regionShift parse failed: empty rawvideo output");
    }
    let max = 0;
    for (const byte of raw) {
      const shift = Math.abs(byte - 128);
      if (shift > max) max = shift;
    }
    return max;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * The drawElement self-verify region-shift ceiling (1/255 channel units).
 * HF_DE_VERIFY_MAX_SHIFT overrides, clamped to [1, 64]; out-of-range or unset
 * falls back to 3. Below ~1 the gate sits inside measured encoder noise; the
 * ceiling keeps an override able to weaken (not silently remove) the check.
 */
export function resolveDeVerifyMaxShift(): number {
  const raw = Number(process.env.HF_DE_VERIFY_MAX_SHIFT ?? "3");
  return Number.isFinite(raw) && raw >= 1 && raw <= 64 ? raw : 3;
}
