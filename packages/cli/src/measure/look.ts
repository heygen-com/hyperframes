// The look of a stretch of film as numbers, ported from the Studio's look-stats.mjs: mean luma and contrast
// (0–255), mean saturation (0–1, HSV), the share of black-and-white frames (under 2% of mid-tone pixels carry
// colour, so a colour face in a white room is not black and white) and warmth (mean R − B, negative is cool).
import { ratio } from "./stats.js";
import { readClip, round, type Clip, type Roi } from "./media.js";

export interface Look {
  frames: number;
  luma: number;
  contrast: number;
  saturation: number;
  bw_share: number;
  warmth: number;
}

/** Sampled at `fps`, 160 px wide; `roi` measures one region, e.g. a person. */
export function look(clip: Clip, fps = 2, roi?: Roi): Look {
  const { frames } = readClip(clip, { fps, width: 160, roi });
  const per = frames.map((f) => {
    let [l, l2, s, warm, mid, tinted] = [0, 0, 0, 0, 0, 0];
    const n = f.length / 3;
    for (let i = 0; i < f.length; i += 3) {
      const [r, g, b] = [f[i]!, f[i + 1]!, f[i + 2]!];
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      const [mx, mn] = [Math.max(r, g, b), Math.min(r, g, b)];
      l += y;
      l2 += y * y;
      s += mx ? (mx - mn) / mx : 0;
      warm += r - b;
      if (y > 40 && y < 220) {
        mid++;
        if (mx - mn > 25) tinted++;
      }
    }
    const mean = l / n;
    return {
      luma: mean,
      contrast: Math.sqrt(Math.max(0, l2 / n - mean * mean)),
      sat: s / n,
      warm: warm / n,
      bw: tinted < 0.02 * Math.max(1, mid),
    };
  });
  const avg = (k: "luma" | "contrast" | "sat" | "warm") =>
    per.reduce((a, p) => a + p[k], 0) / (per.length || 1);
  return {
    frames: per.length,
    luma: round(avg("luma"), 1),
    contrast: round(avg("contrast"), 1),
    saturation: round(avg("sat"), 3),
    bw_share: round(per.filter((p) => p.bw).length / (per.length || 1), 2),
    warmth: round(avg("warm"), 1),
  };
}

export interface LookComparison {
  luma_ratio: number;
  contrast_ratio: number;
  saturation_ratio: number;
  bw_share_diff: number;
  warmth_diff: number;
}

// Under these, a level is none at all: black frames, a flat field, grey footage.
const LEVEL_FLOOR = { luma: 0.5, contrast: 0.5, saturation: 0.01 };

/** Yours over the reference's: ratios near 1 and differences near 0 are the same look. */
export function compareLook(ref: Look, yours: Look): LookComparison {
  const of = (k: "luma" | "contrast" | "saturation") =>
    round(ratio(yours[k], ref[k], LEVEL_FLOOR[k]), 2);
  return {
    luma_ratio: of("luma"),
    contrast_ratio: of("contrast"),
    saturation_ratio: of("saturation"),
    bw_share_diff: round(yours.bw_share - ref.bw_share, 2),
    warmth_diff: round(yours.warmth - ref.warmth, 1),
  };
}

/** The same look within a regenerated shot's tolerance (to be calibrated on the bench). */
export function sameLook(c: LookComparison): boolean {
  return (
    Math.abs(c.luma_ratio - 1) <= 0.15 &&
    Math.abs(c.contrast_ratio - 1) <= 0.25 &&
    Math.abs(c.saturation_ratio - 1) <= 0.25 &&
    Math.abs(c.warmth_diff) <= 12
  );
}
