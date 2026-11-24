// Body and camera motion where the pixels differ (a regenerated shot, another person, another room), ported from
// the Studio's motion-energy.mjs. Both clips share one 12 fps grid, as mixed 24/30 fps skews per-frame differences.
import { meanAbsDiff, pearson, ratioOf, readClip, round, type Clip, type Roi } from "./media.js";

const ENERGY_RATE = 12;
const STILL_SHOT_GREY_LEVELS = 0.1;

export function energyCurve(clip: Clip, roi?: Roi): number[] {
  const { frames } = readClip(clip, { fps: ENERGY_RATE, width: 270, gray: true, roi });
  return frames.slice(1).map((f, i) => meanAbsDiff(f, frames[i]!));
}

export interface EnergyComparison {
  /** Pearson r of the two curves at the best lag within ±1 s; only meaningful when the action is the same. */
  r: number;
  lag_s: number;
  peak_ratio: number;
  /** Amount of movement, yours over the reference's. */
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
    r: round(best[0] === -2 ? 0 : best[0]),
    lag_s: round(best[1] / ENERGY_RATE, 2),
    peak_ratio: round(
      ratioOf(Math.max(...yours, 0), Math.max(...ref, 0), STILL_SHOT_GREY_LEVELS),
      2,
    ),
    mean_ratio: round(ratioOf(mean(yours), mean(ref), STILL_SHOT_GREY_LEVELS), 2),
  };
}
