export function buildRmsEnvelope(samples: Int16Array, windowSize = 2048, hopSize = 1024): number[] {
  if (samples.length < windowSize) return [];
  const envelope: number[] = [];
  for (let start = 0; start + windowSize <= samples.length; start += hopSize) {
    let energy = 0;
    for (let i = 0; i < windowSize; i += 1) {
      const normalized = (samples[start + i] ?? 0) / 32768;
      energy += normalized * normalized;
    }
    envelope.push(Math.sqrt(energy / windowSize));
  }
  return envelope;
}

function correlationAtLag(a: number[], b: number[], lag: number): number {
  const startA = Math.max(0, lag);
  const startB = Math.max(0, -lag);
  const length = Math.min(a.length - startA, b.length - startB);
  if (length <= 32) return -1;

  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < length; i += 1) {
    meanA += a[startA + i] ?? 0;
    meanB += b[startB + i] ?? 0;
  }
  meanA /= length;
  meanB /= length;

  let numerator = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < length; i += 1) {
    const da = (a[startA + i] ?? 0) - meanA;
    const db = (b[startB + i] ?? 0) - meanB;
    numerator += da * db;
    denA += da * da;
    denB += db * db;
  }
  if (denA <= 1e-12 || denB <= 1e-12) return -1;
  return numerator / Math.sqrt(denA * denB);
}

function bestEnvelopeCorrelation(
  rendered: number[],
  snapshot: number[],
  maxLagWindows: number,
): { correlation: number; lagWindows: number } {
  let best = -1;
  let bestLag = 0;
  for (let lag = -maxLagWindows; lag <= maxLagWindows; lag += 1) {
    const corr = correlationAtLag(rendered, snapshot, lag);
    if (corr > best) {
      best = corr;
      bestLag = lag;
    }
  }
  return { correlation: best, lagWindows: bestLag };
}

function isSilentEnvelope(envelope: number[]): boolean {
  return envelope.length > 0 && envelope.every((sample) => Math.abs(sample) <= 1e-9);
}

export function compareAudioEnvelopes(
  rendered: number[],
  snapshot: number[],
  maxLagWindows: number,
): { correlation: number; lagWindows: number } {
  if (rendered.length === 0 || snapshot.length === 0) {
    return { correlation: 1, lagWindows: 0 };
  }

  if (isSilentEnvelope(rendered) && isSilentEnvelope(snapshot)) {
    return { correlation: 1, lagWindows: 0 };
  }

  return bestEnvelopeCorrelation(rendered, snapshot, maxLagWindows);
}

// ── Sample-level residual RMS ───────────────────────────────────────────────
//
// Rio-style precise equivalence check: subtract one audio stream from
// the other, run `astats`, read the residual Overall RMS in dBFS.
// Perfectly-equivalent streams produce silence (≤ -90 dBFS in practice
// for AAC-vs-AAC); the Rio convention is `≤ -50 dBFS = effectively
// identical`.
//
// This catches level/phase drift the envelope-correlation check cannot.
// Correlation measures shape similarity at envelope granularity (2048-
// sample windows by default); residual RMS measures sample-level
// cancellation, so it falls out as soon as the two streams disagree by
// a fraction of a sample in alignment or by a fraction of a dB in
// level.
//
// `astats` is invoked via `ffmpeg` spawned in-process. We require ffmpeg
// on PATH — the regression harness already requires it for encode +
// envelope extraction.

import { spawnSync } from "node:child_process";

/**
 * Result of {@link computeAudioResidualRmsDb}.
 *
 * `overallDb` is the residual Overall RMS reading from astats. For
 * exact-cancellation (truly identical streams), ffmpeg returns `-inf`;
 * this helper normalizes that to `Number.NEGATIVE_INFINITY` so callers
 * don't have to special-case the literal string.
 */
export interface AudioResidualRms {
  overallDb: number;
  ok: boolean;
  /** Raw stderr lines that mention `RMS level` (one per channel + overall). Useful for debugging unexpected drift. */
  rmsLines: string[];
}

/**
 * Compute the residual Overall RMS (dBFS) of `rendered - snapshot`.
 *
 * Both inputs are paths to media files containing an audio stream.
 * They're resampled to 48 kHz stereo, the snapshot is phase-inverted,
 * the two are summed via `amix`, and `astats` reports the residual
 * level.
 *
 * Returns `{ ok: false, overallDb: NaN }` if either input lacks an
 * audio stream, or if ffmpeg's output didn't contain a parseable RMS
 * line — the caller decides whether that's a pass (no-audio fixture)
 * or a fail (audio expected but missing).
 *
 * `maxResidualRmsDb` defaults to `-50` (Rio convention). Pass `-Infinity`
 * to compute the value without gating it.
 */
export function computeAudioResidualRmsDb(
  rendered: string,
  snapshot: string,
  maxResidualRmsDb = -50,
): AudioResidualRms {
  const proc = spawnSync(
    "ffmpeg",
    [
      "-nostdin",
      "-v",
      "info",
      "-i",
      rendered,
      "-i",
      snapshot,
      "-filter_complex",
      // Align both streams (resample + stereo + zero-based PTS), invert the
      // snapshot, sum via amix, run astats. Avoids amix's `normalize`
      // option (not available on ffmpeg 4.x) — we use volume=-1 + amix to
      // subtract.
      [
        "[0:a]aresample=48000,pan=stereo|c0=c0|c1=c1,asetpts=N/SR/TB[a0]",
        "[1:a]aresample=48000,pan=stereo|c0=c0|c1=c1,asetpts=N/SR/TB,volume=-1[a1]",
        "[a0][a1]amix=inputs=2:duration=shortest:dropout_transition=0,astats=metadata=1:reset=1[out]",
      ].join(";"),
      "-map",
      "[out]",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf-8" },
  );

  const stderr = proc.stderr || "";
  // Per-channel + overall RMS lines look like:
  //   [Parsed_astats_8 @ 0x...] Overall RMS level dB: -90.32
  //   [Parsed_astats_8 @ 0x...] RMS level dB: -90.36         (per-channel; no "Overall" prefix)
  // Older ffmpeg builds use `Overall RMS level: -inf dB` — handle both shapes.
  const rmsLines = stderr.split(/\r?\n/).filter((line) => /RMS level/.test(line));

  // Prefer the "Overall" line if it appears; otherwise take the max
  // per-channel RMS (the most pessimistic channel — that's what Rio
  // does as its fallback path).
  const overall = pickRms(rmsLines, /Overall RMS level(?:\s*dB)?:\s*(-?inf|[-\d.]+)/i);
  const channelMax =
    pickRms(rmsLines, /RMS level\s*dB:\s*(-?inf|[-\d.]+)/i, "max") ??
    pickRms(rmsLines, /RMS level:\s*(-?inf|[-\d.]+)/i, "max");

  const value = overall ?? channelMax;
  if (value === null) {
    return { overallDb: Number.NaN, ok: false, rmsLines };
  }
  return {
    overallDb: value,
    ok: value <= maxResidualRmsDb,
    rmsLines,
  };
}

function pickRms(lines: string[], re: RegExp, mode: "first" | "max" = "first"): number | null {
  const values: number[] = [];
  for (const line of lines) {
    const m = re.exec(line);
    if (!m) continue;
    const raw = m[1];
    if (raw === "-inf" || raw === "inf") {
      values.push(Number.NEGATIVE_INFINITY);
    } else {
      const n = Number.parseFloat(raw ?? "");
      if (!Number.isNaN(n)) values.push(n);
    }
    if (mode === "first") break;
  }
  if (values.length === 0) return null;
  if (mode === "max") return Math.max(...values);
  return values[0] ?? null;
}
