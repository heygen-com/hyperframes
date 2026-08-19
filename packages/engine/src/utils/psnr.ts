import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
