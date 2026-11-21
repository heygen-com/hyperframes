#!/usr/bin/env bun
/**
 * Generate original Rec.709 film-look .cube LUTs for the film-looks example.
 * Mathematical approximations only — not measured film stock data.
 * License: Apache-2.0 (HyperFrames contribution).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// 17³ keeps each .cube under ~150KB while remaining smooth for Rec.709 looks.
const SIZE = 17;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "registry/examples/film-looks/assets/luts");
const GRADES_DIR = join(ROOT, "registry/examples/film-looks/grades");

/** @typedef {{ title: string; matrix: number[][]; lift: number[]; gamma: number[]; gain: number[]; sat: number }} Look */

/** @type {Record<string, Look>} */
const LOOKS = {
  "soft-color-neg": {
    title: "Soft Color Neg (original look, unaffiliated)",
    // Soft contrast, warm skin bias — descriptive only.
    matrix: [
      [1.04, 0.02, -0.01],
      [0.01, 0.98, 0.02],
      [-0.02, 0.01, 0.96],
    ],
    lift: [0.03, 0.02, 0.015],
    gamma: [1.05, 1.03, 1.02],
    gain: [0.97, 0.96, 0.94],
    sat: 0.92,
  },
  "vivid-slide": {
    title: "Vivid Slide (original look, unaffiliated)",
    matrix: [
      [1.08, -0.04, 0.02],
      [-0.03, 1.1, -0.02],
      [0.02, -0.05, 1.06],
    ],
    lift: [0.0, 0.0, 0.0],
    gamma: [0.92, 0.9, 0.93],
    gain: [1.05, 1.06, 1.04],
    sat: 1.18,
  },
  "cinema-daylight": {
    title: "Cinema Daylight (original look, unaffiliated)",
    matrix: [
      [0.98, 0.01, 0.04],
      [0.0, 1.02, 0.02],
      [0.03, 0.02, 1.05],
    ],
    lift: [0.02, 0.025, 0.04],
    gamma: [1.08, 1.06, 1.04],
    gain: [0.94, 0.95, 0.98],
    sat: 0.88,
  },
};

/** @type {Record<string, { lut: string; details: Record<string, number>; intensity: number }>} */
const GRADE_META = {
  "soft-color-neg": {
    lut: "assets/luts/soft-color-neg.cube",
    details: {
      grain: 0.1,
      grainSize: 0.22,
      grainRoughness: 0.45,
      vignette: 0.08,
      vignetteFeather: 0.7,
    },
    intensity: 0.9,
  },
  "vivid-slide": {
    lut: "assets/luts/vivid-slide.cube",
    details: {
      grain: 0.04,
      grainSize: 0.15,
      grainRoughness: 0.35,
      vignette: 0.12,
      vignetteFeather: 0.55,
    },
    intensity: 0.95,
  },
  "cinema-daylight": {
    lut: "assets/luts/cinema-daylight.cube",
    details: {
      grain: 0.14,
      grainSize: 0.2,
      grainRoughness: 0.55,
      vignette: 0.14,
      vignetteMidpoint: 0.48,
      vignetteFeather: 0.68,
    },
    intensity: 0.88,
  },
};

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

function mulMat([r, g, b], m) {
  return [
    m[0][0] * r + m[0][1] * g + m[0][2] * b,
    m[1][0] * r + m[1][1] * g + m[1][2] * b,
    m[2][0] * r + m[2][1] * g + m[2][2] * b,
  ];
}

function applySat([r, g, b], sat) {
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return [y + (r - y) * sat, y + (g - y) * sat, y + (b - y) * sat];
}

function applyLook(r, g, b, look) {
  let rgb = applySat([r, g, b], look.sat);
  rgb = mulMat(rgb, look.matrix);
  rgb = rgb.map((c, i) => {
    const lifted = c + look.lift[i];
    const gained = Math.max(0, lifted * look.gain[i]);
    return gained ** (1 / look.gamma[i]);
  });
  return rgb.map(clamp01);
}

function writeCube(id, look) {
  const lines = [
    `# Apache-2.0 original HyperFrames film-look approximation.`,
    `# Not affiliated with any film manufacturer. Not measured stock data.`,
    `TITLE "${look.title}"`,
    `LUT_3D_SIZE ${SIZE}`,
    `DOMAIN_MIN 0.0 0.0 0.0`,
    `DOMAIN_MAX 1.0 1.0 1.0`,
  ];
  for (let b = 0; b < SIZE; b++) {
    for (let g = 0; g < SIZE; g++) {
      for (let r = 0; r < SIZE; r++) {
        const rin = r / (SIZE - 1);
        const gin = g / (SIZE - 1);
        const bin = b / (SIZE - 1);
        const [ro, go, bo] = applyLook(rin, gin, bin, look);
        lines.push(`${ro.toFixed(6)} ${go.toFixed(6)} ${bo.toFixed(6)}`);
      }
    }
  }
  const path = join(OUT_DIR, `${id}.cube`);
  writeFileSync(path, `${lines.join("\n")}\n`);
  return path;
}

function writeGrade(id) {
  const meta = GRADE_META[id];
  const payload = {
    intensity: meta.intensity,
    lut: { src: meta.lut, intensity: 1 },
    details: meta.details,
  };
  const path = join(GRADES_DIR, `${id}.json`);
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
  return path;
}

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(GRADES_DIR, { recursive: true });

for (const id of Object.keys(LOOKS)) {
  const cube = writeCube(id, LOOKS[id]);
  const grade = writeGrade(id);
  console.log(`wrote ${cube}`);
  console.log(`wrote ${grade}`);
}
