// Motion where the pixels differ (a regenerated shot, another person): both clips on one 12 fps grid, since mixed
// 24/30 fps skews per-frame differences.
import { meanAbsDiff, readClip, round, type Clip, type Roi } from "./media.js";
import { pearson, ratio } from "./stats.js";

const ENERGY_RATE = 12;
const COMPRESSION_NOISE = 0.05;

export function energyCurve(clip: Clip, roi?: Roi): number[] {
  const { frames } = readClip(clip, { fps: ENERGY_RATE, width: 270, gray: true, roi });
  return frames.slice(1).map((f, i) => meanAbsDiff(f, frames[i]!));
}

export interface EnergyComparison {
  /** Pearson r of the two curves at the best lag within ±1 s; only meaningful when the action is the same. Null
   * when the window is too short to correlate (under about 0.75 s), where the ratios still hold. */
  r: number | null;
  lag_s: number;
  peak_ratio: number;
  mean_ratio: number;
}

export function compareEnergy(ref: number[], yours: number[]): EnergyComparison {
  let best: [number, number] = [-2, 0];
  for (let lag = -ENERGY_RATE; lag <= ENERGY_RATE; lag++) {
    const [aa, bb] =
      lag >= 0
        ? [ref.slice(0, ref.length - lag), yours.slice(lag)]
        : [ref.slice(-lag), yours.slice(0, yours.length + lag)];
    if (Math.min(aa.length, bb.length) > 8) {
      const r = pearson(aa, bb) ?? 0;
      if (r > best[0]) best = [r, lag];
    }
  }
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / (v.length || 1);
  return {
    r: best[0] === -2 ? null : round(best[0]),
    lag_s: round(best[1] / ENERGY_RATE, 2),
    peak_ratio: round(ratio(Math.max(...yours, 0), Math.max(...ref, 0), COMPRESSION_NOISE), 2),
    mean_ratio: round(ratio(mean(yours), mean(ref), COMPRESSION_NOISE), 2),
  };
}
