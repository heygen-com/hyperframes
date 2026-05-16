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
// Precise sample-cancellation equivalence check: subtract one audio
// stream from the other, run `astats`, read the residual Overall RMS in
// dBFS. Perfectly-equivalent streams produce silence (≤ -90 dBFS in
// practice for AAC-vs-AAC); ≤ -50 dBFS is the conventional threshold
// for treating two streams as effectively identical.
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
  /**
   * Diagnostic when the helper could not produce a residual reading
   * (ffmpeg missing, ffprobe duration mismatch, astats output unparseable,
   * etc.). When set, callers should treat it as a hard failure even though
   * `overallDb` may be `NaN`.
   */
  error?: string;
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
 * `maxResidualRmsDb` defaults to `-50`. Pass `-Infinity`
 * to compute the value without gating it.
 */
export function computeAudioResidualRmsDb(
  rendered: string,
  snapshot: string,
  maxResidualRmsDb = -50,
): AudioResidualRms {
  // Pre-probe both inputs' audio durations. `amix=duration=shortest`
  // truncates at the shorter input, which means trailing audio on the
  // longer side never enters astats — a fixture that drops the last
  // half-second of audio would still report a clean residual. Fail
  // up-front instead. One-frame tolerance @ 48 kHz ≈ 20.83 µs (one
  // audio frame); we widen to 5 ms (~240 samples) so trivial container
  // muxer rounding doesn't trip the gate.
  const renderedDur = probeAudioDuration(rendered);
  const snapshotDur = probeAudioDuration(snapshot);
  if (renderedDur.error || snapshotDur.error) {
    return {
      overallDb: Number.NaN,
      ok: false,
      rmsLines: [],
      error: renderedDur.error ?? snapshotDur.error,
    };
  }
  const delta = Math.abs(renderedDur.seconds - snapshotDur.seconds);
  const TOLERANCE_SECONDS = 0.005;
  if (delta > TOLERANCE_SECONDS) {
    return {
      overallDb: Number.NaN,
      ok: false,
      rmsLines: [],
      error: `audio duration mismatch: rendered=${renderedDur.seconds.toFixed(
        4,
      )}s, snapshot=${snapshotDur.seconds.toFixed(4)}s (Δ=${delta.toFixed(
        4,
      )}s > ${TOLERANCE_SECONDS}s) — amix=duration=shortest would hide the trailing difference`,
    };
  }

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

  // `spawnSync` swallows `ENOENT`, signal kills, and non-zero exits
  // silently — without surfacing them, every failure mode collapses
  // into "no RMS line found, NaN, fail". Surface the actual cause so
  // CI logs are actionable.
  if (proc.error) {
    return {
      overallDb: Number.NaN,
      ok: false,
      rmsLines: [],
      error: `ffmpeg spawn failed: ${(proc.error as NodeJS.ErrnoException).code ?? proc.error.message}`,
    };
  }
  if (proc.signal) {
    return {
      overallDb: Number.NaN,
      ok: false,
      rmsLines: [],
      error: `ffmpeg killed by signal ${proc.signal}`,
    };
  }
  if (typeof proc.status === "number" && proc.status !== 0) {
    return {
      overallDb: Number.NaN,
      ok: false,
      rmsLines: [],
      error: `ffmpeg exited with status ${proc.status}: ${tailStderr(proc.stderr ?? "")}`,
    };
  }

  const stderr = proc.stderr || "";
  // Modern ffmpeg's astats emits per-channel stats first, then an
  // `Overall` section header on its own line, then overall stats.
  // Example (ffmpeg 6.x / 7.x / 8.x):
  //   [Parsed_astats_0 @ 0x...] RMS level dB: -21.43         ← channel 1
  //   [Parsed_astats_0 @ 0x...] ...
  //   [Parsed_astats_0 @ 0x...] Overall                       ← section header (no value)
  //   [Parsed_astats_0 @ 0x...] DC offset: ...
  //   [Parsed_astats_0 @ 0x...] RMS level dB: -21.43         ← overall value
  // A single-line `Overall RMS level dB:` regex never fires on these
  // builds — the `Overall` token and `RMS level` token are on different
  // lines. We do a stateful scan: find the `Overall` header, take the
  // first `RMS level dB:` line that follows. Older ffmpeg builds (4.x)
  // do emit `Overall RMS level dB:` on a single line; the
  // single-line fallback regex covers those.
  const lines = stderr.split(/\r?\n/);
  const rmsLines = lines.filter((line) => /RMS level/.test(line));

  const overallDb = parseOverallRms(lines) ?? parseInlineOverallRms(rmsLines);
  // Fallback to per-channel max if the Overall section is missing
  // (unusual ffmpeg build, or astats truncated). For a 2-channel mix
  // this is the more pessimistic of the two channels, which is a
  // strictly tighter gate than Overall.
  const channelMax =
    pickRms(rmsLines, /RMS level\s*dB:\s*(-?inf|[-\d.]+)/i, "max") ??
    pickRms(rmsLines, /RMS level:\s*(-?inf|[-\d.]+)/i, "max");

  const value = overallDb ?? channelMax;
  if (value === null) {
    return { overallDb: Number.NaN, ok: false, rmsLines };
  }
  return {
    overallDb: value,
    ok: value <= maxResidualRmsDb,
    rmsLines,
  };
}

/** Stateful parse: find an `Overall` header line, return the first `RMS level dB:` value after it. */
function parseOverallRms(lines: string[]): number | null {
  let inOverall = false;
  for (const line of lines) {
    // The `Overall` header is the literal token at end of an astats
    // prefix; match on word boundary so `Overall RMS level...` (the
    // inline form for older ffmpeg) isn't accidentally consumed here.
    if (!inOverall && /\bOverall\s*$/.test(line)) {
      inOverall = true;
      continue;
    }
    if (inOverall) {
      const m = /RMS level\s*dB:\s*(-?inf|[-\d.]+)/i.exec(line);
      if (m && m[1] !== undefined) {
        return m[1] === "-inf" || m[1] === "inf"
          ? Number.NEGATIVE_INFINITY
          : Number.parseFloat(m[1]);
      }
    }
  }
  return null;
}

/** Single-line `Overall RMS level dB: <value>` parser for older ffmpeg builds (4.x). */
function parseInlineOverallRms(rmsLines: string[]): number | null {
  return pickRms(rmsLines, /Overall RMS level(?:\s*dB)?:\s*(-?inf|[-\d.]+)/i);
}

/**
 * Probe a media file's audio-stream duration via `ffprobe`. Returns
 * `{ seconds: NaN, error }` if the file has no audio stream or
 * `ffprobe` can't be invoked.
 */
function probeAudioDuration(file: string): { seconds: number; error?: string } {
  const proc = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      file,
    ],
    { encoding: "utf-8" },
  );
  if (proc.error) {
    return {
      seconds: Number.NaN,
      error: `ffprobe spawn failed for ${file}: ${(proc.error as NodeJS.ErrnoException).code ?? proc.error.message}`,
    };
  }
  if (typeof proc.status === "number" && proc.status !== 0) {
    return {
      seconds: Number.NaN,
      error: `ffprobe exited ${proc.status} for ${file}: ${tailStderr(proc.stderr ?? "")}`,
    };
  }
  const raw = (proc.stdout ?? "").trim();
  if (!raw || raw === "N/A") {
    return { seconds: Number.NaN, error: `no audio stream in ${file}` };
  }
  const seconds = Number.parseFloat(raw);
  if (!Number.isFinite(seconds)) {
    return {
      seconds: Number.NaN,
      error: `ffprobe returned unparseable duration "${raw}" for ${file}`,
    };
  }
  return { seconds };
}

function tailStderr(stderr: string, lines = 5): string {
  const trimmed = stderr.trim();
  if (!trimmed) return "<empty>";
  const tail = trimmed.split(/\r?\n/).slice(-lines).join(" | ");
  return tail.length > 500 ? `${tail.slice(0, 500)}…` : tail;
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
