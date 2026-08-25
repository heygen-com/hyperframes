// paint-compiler.mjs — image-to-strokes compiler (pure, deterministic, seeded).
// Pipeline: Sobel gradient field -> circular smoothing -> seeded k-means palette
// (with saturation restore) -> layered jittered-grid stroke placement, coarse to
// fine, fine layers gated on local variance. Emits an ordered stroke list whose
// order doubles as reveal order for the generated painter.

/**
 * @typedef {Object} Stroke
 * @property {number} x
 * @property {number} y
 * @property {number} len
 * @property {number} angle
 * @property {number} bend
 * @property {[number, number, number]} color
 * @property {number} weight
 * @property {number} alpha
 */

/**
 * @typedef {Object} PaintLayer
 * @property {number} radius
 * @property {number} [cellFactor]
 * @property {number} [baseAngle]
 * @property {number} [edgeThreshold]
 * @property {number} [angleJitter]
 * @property {number} [lenFactor]
 * @property {number} [weightFactor]
 * @property {number} [alpha]
 * @property {boolean} [detailOnly]
 * @property {number} [detailThreshold]
 */

/**
 * @typedef {Object} CompileOptions
 * @property {number} [seed]
 * @property {number} width  display width of the emitted canvas in px
 * @property {PaintLayer[]} layers
 * @property {number} [paletteSize]
 * @property {number} [angleSmoothing]
 */

/**
 * @typedef {Object} CompileResult
 * @property {number} width
 * @property {number} height
 * @property {Stroke[]} strokes
 * @property {[number, number, number]} background  mean image color (ground prime)
 */

/** @param {number} seed */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {Uint8ClampedArray | Uint8Array} px RGBA
 * @param {number} w
 * @param {number} h
 */
export function luminanceMap(px, w, h) {
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = px[i * 4] ?? 0;
    const g = px[i * 4 + 1] ?? 0;
    const b = px[i * 4 + 2] ?? 0;
    lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return lum;
}

/**
 * @param {Float32Array} lum
 * @param {number} w
 * @param {number} h
 */
export function sobelField(lum, w, h) {
  const mag = new Float32Array(w * h);
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const tl = lum[i - w - 1] ?? 0;
      const t = lum[i - w] ?? 0;
      const tr = lum[i - w + 1] ?? 0;
      const l = lum[i - 1] ?? 0;
      const r = lum[i + 1] ?? 0;
      const bl = lum[i + w - 1] ?? 0;
      const b = lum[i + w] ?? 0;
      const br = lum[i + w + 1] ?? 0;
      gx[i] = tr + 2 * r + br - (tl + 2 * l + bl);
      gy[i] = bl + 2 * b + br - (tl + 2 * t + tr);
      mag[i] = Math.hypot(gx[i] ?? 0, gy[i] ?? 0);
    }
  }
  return { mag, gx, gy };
}

/**
 * Circular smoothing of the gradient vectors (magnitude-weighted average), then
 * rotate 90 degrees so strokes follow contours instead of crossing them.
 * @param {Float32Array} gx
 * @param {Float32Array} gy
 * @param {number} w
 * @param {number} h
 * @param {number} iterations
 */
export function smoothAngles(gx, gy, w, h, iterations) {
  let ax = Float32Array.from(gx);
  let ay = Float32Array.from(gy);
  for (let it = 0; it < iterations; it++) {
    const nx = new Float32Array(w * h);
    const ny = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sx = 0;
        let sy = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = Math.min(w - 1, Math.max(0, x + dx));
            const yy = Math.min(h - 1, Math.max(0, y + dy));
            sx += ax[yy * w + xx] ?? 0;
            sy += ay[yy * w + xx] ?? 0;
          }
        }
        nx[y * w + x] = sx / 9;
        ny[y * w + x] = sy / 9;
      }
    }
    ax = nx;
    ay = ny;
  }
  const dir = new Float32Array(w * h);
  const mag = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    dir[i] = Math.atan2(ay[i] ?? 0, ax[i] ?? 0) + Math.PI / 2;
    mag[i] = Math.hypot(ax[i] ?? 0, ay[i] ?? 0);
  }
  return { dir, mag };
}

/**
 * Seeded k-means palette in RGB, with a saturation restore pass: k-means
 * averages mute vivid paintings, so centers are pushed back out in HSL space.
 * @param {Uint8ClampedArray | Uint8Array} px
 * @param {number} w
 * @param {number} h
 * @param {number} k
 * @param {() => number} rng
 * @param {number} [iterations]
 */
export function kmeansPalette(px, w, h, k, rng, iterations = 10) {
  const n = w * h;
  /** @type {[number, number, number][]} */
  const centers = [];
  for (let i = 0; i < k; i++) {
    const idx = Math.floor(rng() * n);
    centers.push([px[idx * 4] ?? 0, px[idx * 4 + 1] ?? 0, px[idx * 4 + 2] ?? 0]);
  }
  for (let it = 0; it < iterations; it++) {
    /** @type {number[][]} */
    const sums = Array.from({ length: centers.length }, () => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      const r = px[i * 4] ?? 0;
      const g = px[i * 4 + 1] ?? 0;
      const b = px[i * 4 + 2] ?? 0;
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const ctr = centers[c] ?? [0, 0, 0];
        const dr = r - ctr[0];
        const dg = g - ctr[1];
        const db = b - ctr[2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      const s = sums[best];
      if (s) {
        s[0] += r;
        s[1] += g;
        s[2] += b;
        s[3]++;
      }
    }
    for (let c = 0; c < centers.length; c++) {
      const s = sums[c];
      if (s && s[3] > 0) {
        centers[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
      } else {
        const idx = Math.floor(rng() * n);
        centers[c] = [px[idx * 4] ?? 0, px[idx * 4 + 1] ?? 0, px[idx * 4 + 2] ?? 0];
      }
    }
  }
  const boosted = centers.map((ctr) => boostSaturation(ctr[0] ?? 0, ctr[1] ?? 0, ctr[2] ?? 0));
  return { centers: boosted };
}

/** @returns {[number, number, number]} */
export function boostSaturation(r, g, b, factor = 1.25) {
  const rf = r / 255;
  const gf = g / 255;
  const bf = b / 255;
  const mx = Math.max(rf, gf, bf);
  const mn = Math.min(rf, gf, bf);
  const l = (mx + mn) / 2;
  let s = mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (mx !== mn) {
    const d = mx - mn;
    if (mx === rf) h = ((gf - bf) / d + (gf < bf ? 6 : 0)) * 60;
    else if (mx === gf) h = ((bf - rf) / d + 2) * 60;
    else h = ((rf - gf) / d + 4) * 60;
  }
  s = Math.min(1, s * factor);
  const c2 = (1 - Math.abs(2 * l - 1)) * s;
  const x = c2 * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c2 / 2;
  let rr = 0;
  let gg = 0;
  let bb = 0;
  if (h < 60) {
    rr = c2;
    gg = x;
  } else if (h < 120) {
    rr = x;
    gg = c2;
  } else if (h < 180) {
    gg = c2;
    bb = x;
  } else if (h < 240) {
    gg = x;
    bb = c2;
  } else if (h < 300) {
    rr = x;
    bb = c2;
  } else {
    rr = c2;
    bb = x;
  }
  return [
    Math.round(Math.max(0, Math.min(255, (rr + m) * 255))),
    Math.round(Math.max(0, Math.min(255, (gg + m) * 255))),
    Math.round(Math.max(0, Math.min(255, (bb + m) * 255))),
  ];
}

/**
 * @param {[number, number, number][]} centers
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {[number, number, number]}
 */
export function nearestPaletteColor(centers, r, g, b) {
  let best = centers[0] ?? [0, 0, 0];
  let bestD = Infinity;
  for (const ctr of centers) {
    const dr = r - ctr[0];
    const dg = g - ctr[1];
    const db = b - ctr[2];
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) {
      bestD = d;
      best = ctr;
    }
  }
  return best;
}

/**
 * Layer presets calibrated on The Great Wave, Girl with a Pearl Earring, and
 * The Scream. `low` keeps stroke counts small; `high` resolves faces and foam.
 * @type {Record<"low" | "medium" | "high", PaintLayer[]>}
 */
export const DETAIL_PRESETS = {
  low: [
    {
      radius: 72,
      cellFactor: 0.6,
      baseAngle: -0.12,
      edgeThreshold: 30,
      angleJitter: 0.1,
      lenFactor: 2.6,
      weightFactor: 0.85,
      alpha: 1,
    },
    {
      radius: 36,
      cellFactor: 0.6,
      baseAngle: -0.06,
      edgeThreshold: 18,
      angleJitter: 0.14,
      lenFactor: 2.3,
      weightFactor: 0.75,
      alpha: 0.96,
    },
    {
      radius: 18,
      cellFactor: 0.6,
      baseAngle: 0,
      edgeThreshold: 11,
      angleJitter: 0.2,
      lenFactor: 2,
      weightFactor: 0.65,
      alpha: 0.94,
      detailOnly: true,
      detailThreshold: 0.1,
    },
  ],
  medium: [
    {
      radius: 64,
      cellFactor: 0.55,
      baseAngle: -0.12,
      edgeThreshold: 30,
      angleJitter: 0.1,
      lenFactor: 2.8,
      weightFactor: 0.9,
      alpha: 1,
    },
    {
      radius: 36,
      cellFactor: 0.55,
      baseAngle: -0.06,
      edgeThreshold: 18,
      angleJitter: 0.14,
      lenFactor: 2.5,
      weightFactor: 0.85,
      alpha: 0.97,
    },
    {
      radius: 20,
      cellFactor: 0.55,
      baseAngle: 0,
      edgeThreshold: 11,
      angleJitter: 0.2,
      lenFactor: 2.2,
      weightFactor: 0.75,
      alpha: 0.95,
      detailOnly: true,
      detailThreshold: 0.08,
    },
    {
      radius: 11,
      cellFactor: 0.55,
      baseAngle: 0,
      edgeThreshold: 7,
      angleJitter: 0.26,
      lenFactor: 2,
      weightFactor: 0.65,
      alpha: 0.92,
      detailOnly: true,
      detailThreshold: 0.03,
    },
  ],
  high: [
    {
      radius: 64,
      cellFactor: 0.55,
      baseAngle: -0.12,
      edgeThreshold: 30,
      angleJitter: 0.1,
      lenFactor: 2.8,
      weightFactor: 0.9,
      alpha: 1,
    },
    {
      radius: 36,
      cellFactor: 0.55,
      baseAngle: -0.06,
      edgeThreshold: 18,
      angleJitter: 0.14,
      lenFactor: 2.5,
      weightFactor: 0.85,
      alpha: 0.97,
    },
    {
      radius: 20,
      cellFactor: 0.48,
      baseAngle: 0,
      edgeThreshold: 11,
      angleJitter: 0.2,
      lenFactor: 2.2,
      weightFactor: 0.75,
      alpha: 0.95,
      detailOnly: true,
      detailThreshold: 0.06,
    },
    {
      radius: 11,
      cellFactor: 0.45,
      baseAngle: 0,
      edgeThreshold: 7,
      angleJitter: 0.26,
      lenFactor: 2,
      weightFactor: 0.65,
      alpha: 0.92,
      detailOnly: true,
      detailThreshold: 0.02,
    },
    {
      radius: 7,
      cellFactor: 0.45,
      baseAngle: 0,
      edgeThreshold: 5,
      angleJitter: 0.3,
      lenFactor: 1.8,
      weightFactor: 0.55,
      alpha: 0.9,
      detailOnly: true,
      detailThreshold: 0.008,
    },
  ],
};

/**
 * Compile RGBA pixels into an ordered stroke list.
 * @param {Uint8ClampedArray | Uint8Array} px
 * @param {number} w
 * @param {number} h
 * @param {CompileOptions} opts
 * @returns {CompileResult}
 */
export function compileStrokes(px, w, h, opts) {
  const rng = makeRng(opts.seed ?? 1337);
  const outW = opts.width;
  const outH = Math.round((h / w) * outW);

  const lum = luminanceMap(px, w, h);
  const { gx, gy } = sobelField(lum, w, h);
  const { dir, mag } = smoothAngles(gx, gy, w, h, opts.angleSmoothing ?? 4);
  const { centers } = kmeansPalette(px, w, h, opts.paletteSize ?? 22, rng);

  const sx = outW / w;
  const sy = outH / h;
  /** @type {Stroke[]} */
  const strokes = [];

  // local variance for detail gating (5x5 window)
  const variance = new Float32Array(w * h);
  {
    const R = 2;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        let sum2 = 0;
        let count = 0;
        for (let dy = -R; dy <= R; dy++) {
          for (let dx = -R; dx <= R; dx++) {
            const xx = Math.min(w - 1, Math.max(0, x + dx));
            const yy = Math.min(h - 1, Math.max(0, y + dy));
            const v = lum[yy * w + xx] ?? 0;
            sum += v;
            sum2 += v * v;
            count++;
          }
        }
        const mean = sum / count;
        variance[y * w + x] = sum2 / count - mean * mean;
      }
    }
  }
  let varMax = 0;
  for (let i = 0; i < variance.length; i++) {
    const v = variance[i] ?? 0;
    if (v > varMax) varMax = v;
  }

  let ar = 0;
  let ag = 0;
  let ab = 0;
  const total = w * h;
  for (let i = 0; i < total; i++) {
    ar += px[i * 4] ?? 0;
    ag += px[i * 4 + 1] ?? 0;
    ab += px[i * 4 + 2] ?? 0;
  }
  const background = [Math.round(ar / total), Math.round(ag / total), Math.round(ab / total)];

  for (const layer of opts.layers) {
    const radius = layer.radius;
    const cell = radius * (layer.cellFactor ?? 1);
    const baseWeight = Math.max(1.6, radius * 0.75);
    for (let gy2 = cell / 2; gy2 < outH; gy2 += cell) {
      for (let gxi = cell / 2; gxi < outW; gxi += cell) {
        const x = gxi + (rng() - 0.5) * cell * 0.9;
        const y = gy2 + (rng() - 0.5) * cell * 0.9;
        const wx = Math.min(w - 1, Math.max(0, Math.round(x / sx)));
        const wy = Math.min(h - 1, Math.max(0, Math.round(y / sy)));
        const widx = wy * w + wx;

        if (layer.detailOnly) {
          const v = (variance[widx] ?? 0) / (varMax || 1);
          if (v < (layer.detailThreshold ?? 0)) continue;
        }

        const strong = (mag[widx] ?? 0) > (layer.edgeThreshold ?? 12);
        const flowAngle = strong
          ? (dir[widx] ?? 0)
          : (layer.baseAngle ?? 0) + 0.15 * Math.sin((y / outH) * 3.1 + (x / outW) * 1.3);
        const angle = flowAngle + (rng() - 0.5) * (layer.angleJitter ?? 0.14);

        const ri = Math.min(w - 1, Math.max(0, Math.round(x / sx)));
        const rj = Math.min(h - 1, Math.max(0, Math.round(y / sy)));
        const pi = (rj * w + ri) * 4;
        const col = nearestPaletteColor(centers, px[pi] ?? 0, px[pi + 1] ?? 0, px[pi + 2] ?? 0);
        const jitter = 4;
        const cr = clamp255(col[0] + (rng() - 0.5) * 2 * jitter);
        const cg = clamp255(col[1] + (rng() - 0.5) * 2 * jitter);
        const cb = clamp255(col[2] + (rng() - 0.5) * 2 * jitter);

        const len = radius * (layer.lenFactor ?? 2.1) * (0.75 + rng() * 0.5);
        strokes.push({
          x: round1(x),
          y: round1(y),
          len: round1(len),
          angle: round1((angle * 180) / Math.PI),
          bend: round1(len * 0.14 * (rng() - 0.5)),
          color: [cr, cg, cb],
          weight: round2(baseWeight * (0.8 + rng() * 0.4) * (layer.weightFactor ?? 1)),
          alpha: layer.alpha ?? 0.9,
        });
      }
    }
  }
  return { width: outW, height: outH, strokes, background };
}

/** @param {number} v */
function clamp255(v) {
  return Math.round(Math.max(0, Math.min(255, v)));
}

/** @param {number} v */
function round1(v) {
  return Math.round(v * 10) / 10;
}

/** @param {number} v */
function round2(v) {
  return Math.round(v * 100) / 100;
}
