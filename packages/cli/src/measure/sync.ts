// Picture against sound for a person speaking, ported from the Studio's hf-media av_sync: per frame the mouth
// region's mean luma change, per frame the change of the sound's loudness, and the lag where the two correlate best.
// A motion and energy proxy, not phoneme sync: head motion, gestures, cuts and music in the ROI or mix move it.
import {
  Fix,
  pearson,
  readClip,
  round,
  runFfmpeg,
  videoClip,
  type Roi,
  type VideoInfo,
} from "./media.js";

const RATE = 16000;

/** Mono samples of the window at RATE Hz. */
function samples(info: VideoInfo, start: number, seconds: number): Float32Array {
  const raw = runFfmpeg([
    ...["-ss", String(start), "-i", info.path, "-t", String(seconds), "-vn"],
    ...["-af", "aresample=async=1:first_pts=0"],
    ...["-ac", "1", "-ar", String(RATE), "-f", "f32le", "-"],
  ]);
  return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + (raw.byteLength & ~3)));
}

export interface SyncResult {
  best_lag_frames: number | null;
  best_lag_ms: number | null;
  peak_correlation: number | null;
  zero_lag_correlation: number | null;
  margin_over_other_lags: number | null;
  confidence: "high" | "medium" | "low" | "none";
  speech_active_fraction: number;
  mouth_motion_mean: number;
  note: string | null;
}

// fallow-ignore-next-line complexity
export function avSync(
  info: VideoInfo,
  mouth: Roi,
  start: number,
  end: number,
  maxLagMs = 400,
): SyncResult {
  if (!info.audio)
    throw new Fix(
      `${info.path} has no sound`,
      "measure sync needs the picture and its sound in one file",
    );
  if (!(maxLagMs > 0)) throw new Fix("--max-lag-ms must be positive", "--max-lag-ms 400");
  const { frames, w, h } = readClip(videoClip(info.path, start, end - start, info), {
    roi: mouth,
    width: 160,
    gray: true,
  });
  const motion = frames.map((f, i) => {
    if (!i) return 0;
    let s = 0;
    for (let k = 0; k < f.length; k++) s += Math.abs(f[k]! - frames[i - 1]![k]!);
    return s / (w * h);
  });
  const audio = samples(info, start, end - start);
  const frame = 1 / info.fps;
  const envelope = frames.map((_, i) => {
    const [a, b] = [Math.floor(i * frame * RATE), Math.floor((i + 1) * frame * RATE)];
    const chunk = audio.subarray(a, Math.max(b, a + 1));
    let s = 0;
    for (const v of chunk) s += v * v;
    return chunk.length ? Math.sqrt(s / chunk.length) : 0;
  });
  const speech = envelope.slice(1).map((v, i) => Math.abs(v - envelope[i]!));
  const mouthMotion = motion.slice(1);
  const reach = Math.max(1, Math.round(maxLagMs / 1000 / frame));
  // Positive lag: the mouth moves after the sound, the picture is late.
  const curve = Array.from({ length: 2 * reach + 1 }, (_, i) => {
    const lag = i - reach;
    const [a, b] =
      lag >= 0
        ? [speech.slice(0, speech.length - lag), mouthMotion.slice(lag)]
        : [speech.slice(-lag), mouthMotion.slice(0, lag)];
    return { lag, r: Math.min(a.length, b.length) < 10 ? null : pearson(a, b) };
  });
  const top = Math.max(...envelope);
  const active = top > 0 ? envelope.filter((v) => v > 0.1 * top).length / envelope.length : 0;
  const base = {
    speech_active_fraction: round(active, 3),
    mouth_motion_mean: round(mouthMotion.reduce((s, v) => s + v, 0) / (mouthMotion.length || 1), 3),
  };
  const valid = curve.filter((c) => c.r !== null);
  if (!valid.length)
    return {
      best_lag_frames: null,
      best_lag_ms: null,
      peak_correlation: null,
      zero_lag_correlation: null,
      margin_over_other_lags: null,
      confidence: "none",
      ...base,
      note: "no mouth motion or no change in the sound in this window; check the ROI and the window",
    };
  const best = curve.reduce(
    (b, c, i) => ((c.r ?? -Infinity) > (curve[b]!.r ?? -Infinity) ? i : b),
    0,
  );
  const peak = curve[best]!.r!;
  // A parabola through the peak and its neighbours places it between frames.
  let shift = 0;
  const [left, right] = [curve[best - 1]?.r, curve[best + 1]?.r];
  if (typeof left === "number" && typeof right === "number") {
    const bend = left - 2 * peak + right;
    if (bend < 0) shift = (0.5 * (left - right)) / bend;
  }
  const lag = curve[best]!.lag;
  const rest = curve.filter((c) => Math.abs(c.lag - lag) > 2 && c.r !== null).map((c) => c.r!);
  const margin = rest.length ? peak - Math.max(...rest) : null;
  const edge = best === 0 || best === curve.length - 1;
  const confidence =
    peak >= 0.5 && margin !== null && margin >= 0.1 && !edge && active >= 0.1
      ? "high"
      : peak >= 0.3 && !edge
        ? "medium"
        : "low";
  const notes = [
    ...(edge ? ["the peak is at the search edge; raise --max-lag-ms or check the window"] : []),
    ...(active < 0.1 ? ["little speech in this window; choose a span with continuous speech"] : []),
  ];
  return {
    best_lag_frames: round(lag + shift, 2),
    best_lag_ms: round((lag + shift) * frame * 1000, 1),
    peak_correlation: round(peak, 3),
    zero_lag_correlation: round(curve.find((c) => c.lag === 0)?.r ?? 0, 3),
    margin_over_other_lags: margin === null ? null : round(margin, 3),
    confidence,
    ...base,
    note: notes.join("; ") || null,
  };
}
