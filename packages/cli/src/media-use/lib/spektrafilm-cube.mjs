// Spectral film + darkroom print + scanner 3D LUT generator based on spektrafilm
// (Andrea Volpato, CC BY-SA 4.0: https://github.com/andreavolpato/spektrafilm).

import { readFileSync } from "node:fs";
import { join } from "node:path";

let cachedBundle = null;

function loadBundle() {
  if (!cachedBundle) {
    const raw = readFileSync(
      join(import.meta.dirname, "spektrafilm-data.json"),
      "utf8",
    );
    cachedBundle = JSON.parse(raw);
  }
  return cachedBundle;
}

function srgbToLinear(u) {
  return u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4;
}

function linearToSrgbFloat(u) {
  const c = Math.min(1, Math.max(0, u));
  const enc = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.min(1, Math.max(0, enc));
}

const XYZ_TO_SRGB = [
  [3.2404542, -1.5371385, -0.4985314],
  [-0.969266, 1.8760108, 0.041556],
  [0.0556434, -0.2040259, 1.0572252],
];

const BRADFORD = [
  [0.8951, 0.2664, -0.1614],
  [-0.7502, 1.7135, 0.0367],
  [0.0389, -0.0685, 1.0296],
];

const BRADFORD_INV = [
  [0.9869929, -0.1470543, 0.1599627],
  [0.4323053, 0.5183603, 0.0492912],
  [-0.0085287, 0.0400428, 0.9684867],
];

const D65_WHITE = [0.95047, 1.0, 1.08883];

function matMul3(m, v) {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

function adaptXyzBradford(xyz, srcWhite, dstWhite) {
  const src = matMul3(BRADFORD, srcWhite);
  const dst = matMul3(BRADFORD, dstWhite);
  const cone = matMul3(BRADFORD, xyz);
  const adapted = [
    (cone[0] * dst[0]) / (src[0] || 1e-12),
    (cone[1] * dst[1]) / (src[1] || 1e-12),
    (cone[2] * dst[2]) / (src[2] || 1e-12),
  ];
  return matMul3(BRADFORD_INV, adapted);
}

function xyzToLinearSrgb(x, y, z) {
  return [
    XYZ_TO_SRGB[0][0] * x + XYZ_TO_SRGB[0][1] * y + XYZ_TO_SRGB[0][2] * z,
    XYZ_TO_SRGB[1][0] * x + XYZ_TO_SRGB[1][1] * y + XYZ_TO_SRGB[1][2] * z,
    XYZ_TO_SRGB[2][0] * x + XYZ_TO_SRGB[2][1] * y + XYZ_TO_SRGB[2][2] * z,
  ];
}

function illuminantToXyz(illuminant, cmfs) {
  let X = 0;
  let Y = 0;
  let Z = 0;
  for (let i = 0; i < illuminant.length; i++) {
    const s = illuminant[i] || 0;
    X += s * cmfs[i][0];
    Y += s * cmfs[i][1];
    Z += s * cmfs[i][2];
  }
  if (Y <= 1e-12) return D65_WHITE.slice();
  return [X / Y, 1, Z / Y];
}

function interp1(x, xp, fp) {
  if (x <= xp[0]) return fp[0];
  const n = xp.length;
  if (x >= xp[n - 1]) return fp[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xp[mid] <= x) lo = mid;
    else hi = mid;
  }
  const t = (x - xp[lo]) / (xp[hi] - xp[lo] || 1e-12);
  return fp[lo] * (1 - t) + fp[hi] * t;
}

function nanToNum(v, fallback = 0) {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function nanMinCol(curves, col) {
  let m = Infinity;
  for (let i = 0; i < curves.length; i++) {
    const v = curves[i][col];
    if (typeof v === "number" && Number.isFinite(v) && v < m) m = v;
  }
  return Number.isFinite(m) ? m : 0;
}

function prepareDensityCurves(densityCurves) {
  const out = densityCurves.map((row) => row.slice());
  for (let c = 0; c < 3; c++) {
    const m = nanMinCol(out, c);
    for (let i = 0; i < out.length; i++) {
      const v = out[i][c];
      out[i][c] = typeof v === "number" && Number.isFinite(v) ? v - m : NaN;
    }
  }
  return out;
}

function compileChannelCurves(logExposure, densityCurves, gamma = 1) {
  const channels = [];
  for (let c = 0; c < 3; c++) {
    const xp = [];
    const fp = [];
    for (let i = 0; i < logExposure.length; i++) {
      const d = densityCurves[i][c];
      if (typeof d !== "number" || !Number.isFinite(d)) continue;
      xp.push(logExposure[i] / gamma);
      fp.push(d);
    }
    channels.push({ xp, fp });
  }
  return channels;
}

function developPixel(logRawPx, compiledCurves) {
  return [
    interp1(logRawPx[0], compiledCurves[0].xp, compiledCurves[0].fp),
    interp1(logRawPx[1], compiledCurves[1].xp, compiledCurves[1].fp),
    interp1(logRawPx[2], compiledCurves[2].xp, compiledCurves[2].fp),
  ];
}

function buildRgbToRawMatrix(basis, illuminant, sensitivity) {
  const nWl = illuminant.length;
  const mid = [0, 0, 0];
  for (let l = 0; l < nWl; l++) {
    const ill = illuminant[l] * 0.184;
    for (let m = 0; m < 3; m++) mid[m] += ill * sensitivity[l][m];
  }
  const normG = mid[1] || 1;

  const mat = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let l = 0; l < nWl; l++) {
    const ill = illuminant[l];
    for (let m = 0; m < 3; m++) {
      const s = (ill * sensitivity[l][m]) / normG;
      mat[m][0] += basis[l][0] * s;
      mat[m][1] += basis[l][1] * s;
      mat[m][2] += basis[l][2] * s;
    }
  }
  return mat;
}

function densitySpectralPixel(cmyPx, channelDensity, baseDensity) {
  const nWl = channelDensity.length;
  const row = new Float64Array(nWl);
  for (let l = 0; l < nWl; l++) {
    let v = nanToNum(baseDensity[l], 0);
    v += cmyPx[0] * nanToNum(channelDensity[l][0], 0);
    v += cmyPx[1] * nanToNum(channelDensity[l][1], 0);
    v += cmyPx[2] * nanToNum(channelDensity[l][2], 0);
    row[l] = v;
  }
  return row;
}

function colorEnlarger(illuminant, dichroicCmy, filterCcCmy) {
  const t = filterCcCmy.map((cc) => 10 ** -(cc / 100));
  const n = illuminant.length;
  const out = new Float64Array(n);
  for (let l = 0; l < n; l++) {
    let total = 1;
    for (let c = 0; c < 3; c++) {
      const f = dichroicCmy[l][c];
      total *= 1 - (1 - f) * (1 - t[c]);
    }
    out[l] = illuminant[l] * total;
  }
  return out;
}

function exposureFactorMidgray(
  sensitivity,
  printIlluminant,
  densitySpectralMid,
) {
  const nWl = printIlluminant.length;
  const raw = [0, 0, 0];
  for (let l = 0; l < nWl; l++) {
    const light = 10 ** -densitySpectralMid[l] * printIlluminant[l];
    for (let m = 0; m < 3; m++) raw[m] += light * sensitivity[l][m];
  }
  const safe = raw.map((v) => Math.max(v, 1e-10));
  const geomean = Math.exp(
    (Math.log(safe[0]) + Math.log(safe[1]) + Math.log(safe[2])) / 3,
  );
  return 1 / geomean;
}

export function listSpektrafilmStocks() {
  const bundle = loadBundle();
  return Object.values(bundle.profiles).map((p) => p.info);
}

export function prepareSpektrafilmContext(params = {}) {
  const bundle = loadBundle();
  const { tables, profiles, refinedFilters } = bundle;

  const filmId = String(params.film || params.spektrafilm || "").trim();
  const film = profiles[filmId];
  if (!film || film.info.stage !== "filming") {
    const known = Object.values(profiles)
      .filter((p) => p.info.stage === "filming")
      .map((p) => p.info.stock)
      .join(", ");
    throw new Error(
      `unknown spektrafilm film stock "${filmId}" (available: ${known})`,
    );
  }

  const scanFilm =
    params.scanFilm != null
      ? Boolean(params.scanFilm)
      : film.info.type === "positive";
  const paperId = scanFilm
    ? null
    : String(
        params.paper || film.info.target_print || "kodak_portra_endura",
      ).trim();
  const paper = paperId ? profiles[paperId] : null;
  if (!scanFilm && (!paper || paper.info.stage !== "printing")) {
    throw new Error(`unknown spektrafilm print stock "${paperId}"`);
  }

  const exposureEv = Number.isFinite(Number(params.exposureEv))
    ? Number(params.exposureEv)
    : 0;
  const printExposure =
    Number.isFinite(Number(params.printExposure)) &&
    Number(params.printExposure) > 0
      ? Number(params.printExposure)
      : 1;

  let filterCcCmy = [0, 0, 0];
  if (!scanFilm && paper) {
    if (Array.isArray(params.filterCcCmy) && params.filterCcCmy.length === 3) {
      filterCcCmy = params.filterCcCmy.map(Number);
    } else {
      const key = `${paper.info.stock}|${film.info.stock}`;
      filterCcCmy = refinedFilters[key] || [0, 65, 55];
    }
  }

  const basis = tables.mallett_basis_srgb;
  const cmfs = tables.cmfs_xyz;
  const filmIllum =
    tables[`illuminant_${film.info.reference_illuminant}`] ||
    tables.illuminant_D55;
  const viewIllum =
    tables[`illuminant_${(scanFilm ? film : paper).info.viewing_illuminant}`] ||
    tables.illuminant_D50;

  const sens = film.data.log_sensitivity.map((row) =>
    row.map((v) => (typeof v === "number" && Number.isFinite(v) ? 10 ** v : 0)),
  );
  const rgbToRawMat = buildRgbToRawMatrix(basis, filmIllum, sens);
  const exposureScale = 2 ** exposureEv;

  const filmCurvesPrep = prepareDensityCurves(film.data.density_curves);
  const compiledFilmCurves = compileChannelCurves(
    film.data.log_exposure,
    filmCurvesPrep,
    1,
  );

  let printCtx = null;
  let scanStock = film;

  if (!scanFilm && paper) {
    const lamp = tables["illuminant_TH-KG3"] || tables.illuminant_D50;
    const printIllum = colorEnlarger(lamp, tables.dichroic_cmy, filterCcCmy);
    const paperSens = paper.data.log_sensitivity.map((row) =>
      row.map((v) =>
        typeof v === "number" && Number.isFinite(v) ? 10 ** v : 0,
      ),
    );

    const midLevel = 0.184 * exposureScale;
    const midRaw = [
      (rgbToRawMat[0][0] + rgbToRawMat[0][1] + rgbToRawMat[0][2]) * midLevel,
      (rgbToRawMat[1][0] + rgbToRawMat[1][1] + rgbToRawMat[1][2]) * midLevel,
      (rgbToRawMat[2][0] + rgbToRawMat[2][1] + rgbToRawMat[2][2]) * midLevel,
    ];
    const midLog = [
      Math.log10(Math.max(midRaw[0], 0) + 1e-10),
      Math.log10(Math.max(midRaw[1], 0) + 1e-10),
      Math.log10(Math.max(midRaw[2], 0) + 1e-10),
    ];
    const rawFilmCurves = compileChannelCurves(
      film.data.log_exposure,
      film.data.density_curves,
      1,
    );
    const midCmy = developPixel(midLog, rawFilmCurves);
    const midSpecComp = densitySpectralPixel(
      midCmy,
      film.data.channel_density,
      film.data.base_density,
    );
    const midFactor = exposureFactorMidgray(paperSens, printIllum, midSpecComp);
    const printExposureLogOffset = Math.log10(Math.max(printExposure, 1e-6));

    const paperCurvesPrep = prepareDensityCurves(paper.data.density_curves);
    const compiledPaperCurves = compileChannelCurves(
      paper.data.log_exposure,
      paperCurvesPrep,
      1,
    );

    const nWl = printIllum.length;
    const filmChanDens0 = new Float64Array(nWl);
    const filmChanDens1 = new Float64Array(nWl);
    const filmChanDens2 = new Float64Array(nWl);
    const weightedPaperSens0 = new Float64Array(nWl);
    const weightedPaperSens1 = new Float64Array(nWl);
    const weightedPaperSens2 = new Float64Array(nWl);

    for (let l = 0; l < nWl; l++) {
      const baseT = 10 ** -nanToNum(film.data.base_density[l], 0);
      filmChanDens0[l] = nanToNum(film.data.channel_density[l][0], 0);
      filmChanDens1[l] = nanToNum(film.data.channel_density[l][1], 0);
      filmChanDens2[l] = nanToNum(film.data.channel_density[l][2], 0);
      const pLight = printIllum[l] * baseT * midFactor;
      weightedPaperSens0[l] = pLight * paperSens[l][0];
      weightedPaperSens1[l] = pLight * paperSens[l][1];
      weightedPaperSens2[l] = pLight * paperSens[l][2];
    }

    printCtx = {
      filmChanDens0,
      filmChanDens1,
      filmChanDens2,
      weightedPaperSens0,
      weightedPaperSens1,
      weightedPaperSens2,
      printExposureLogOffset,
      compiledPaperCurves,
    };
    scanStock = paper;
  }

  const nWl = viewIllum.length;
  let norm = 0;
  for (let l = 0; l < nWl; l++) norm += viewIllum[l] * cmfs[l][1];
  norm = norm || 1;

  const scanChanDens0 = new Float64Array(nWl);
  const scanChanDens1 = new Float64Array(nWl);
  const scanChanDens2 = new Float64Array(nWl);
  const weightedCmfsX = new Float64Array(nWl);
  const weightedCmfsY = new Float64Array(nWl);
  const weightedCmfsZ = new Float64Array(nWl);

  for (let l = 0; l < nWl; l++) {
    const baseT = 10 ** -nanToNum(scanStock.data.base_density[l], 0);
    scanChanDens0[l] = nanToNum(scanStock.data.channel_density[l][0], 0);
    scanChanDens1[l] = nanToNum(scanStock.data.channel_density[l][1], 0);
    scanChanDens2[l] = nanToNum(scanStock.data.channel_density[l][2], 0);
    const vLight = (viewIllum[l] * baseT) / norm;
    weightedCmfsX[l] = vLight * cmfs[l][0];
    weightedCmfsY[l] = vLight * cmfs[l][1];
    weightedCmfsZ[l] = vLight * cmfs[l][2];
  }

  const viewWhite = illuminantToXyz(viewIllum, cmfs);

  return {
    film,
    paper,
    rgbToRawMat,
    exposureScale,
    compiledFilmCurves,
    printCtx,
    nWl,
    scanChanDens0,
    scanChanDens1,
    scanChanDens2,
    weightedCmfsX,
    weightedCmfsY,
    weightedCmfsZ,
    viewWhite,
  };
}

export function evaluateSpektrafilmRgb([r, g, b], ctx) {
  const linR = srgbToLinear(r);
  const linG = srgbToLinear(g);
  const linB = srgbToLinear(b);

  const { rgbToRawMat, exposureScale, compiledFilmCurves, printCtx, nWl } = ctx;
  const raw0 =
    (rgbToRawMat[0][0] * linR +
      rgbToRawMat[0][1] * linG +
      rgbToRawMat[0][2] * linB) *
    exposureScale;
  const raw1 =
    (rgbToRawMat[1][0] * linR +
      rgbToRawMat[1][1] * linG +
      rgbToRawMat[1][2] * linB) *
    exposureScale;
  const raw2 =
    (rgbToRawMat[2][0] * linR +
      rgbToRawMat[2][1] * linG +
      rgbToRawMat[2][2] * linB) *
    exposureScale;

  const logRaw = [
    Math.log10(Math.max(raw0, 0) + 1e-10),
    Math.log10(Math.max(raw1, 0) + 1e-10),
    Math.log10(Math.max(raw2, 0) + 1e-10),
  ];

  let cmy = developPixel(logRaw, compiledFilmCurves);

  if (printCtx) {
    const {
      filmChanDens0,
      filmChanDens1,
      filmChanDens2,
      weightedPaperSens0,
      weightedPaperSens1,
      weightedPaperSens2,
      printExposureLogOffset,
      compiledPaperCurves,
    } = printCtx;

    let pRaw0 = 0;
    let pRaw1 = 0;
    let pRaw2 = 0;
    const d0 = cmy[0];
    const d1 = cmy[1];
    const d2 = cmy[2];

    for (let l = 0; l < nWl; l++) {
      const atten =
        10 **
        -(
          d0 * filmChanDens0[l] +
          d1 * filmChanDens1[l] +
          d2 * filmChanDens2[l]
        );
      pRaw0 += atten * weightedPaperSens0[l];
      pRaw1 += atten * weightedPaperSens1[l];
      pRaw2 += atten * weightedPaperSens2[l];
    }

    const logPrint = [
      Math.log10(Math.max(pRaw0, 0) + 1e-10) + printExposureLogOffset,
      Math.log10(Math.max(pRaw1, 0) + 1e-10) + printExposureLogOffset,
      Math.log10(Math.max(pRaw2, 0) + 1e-10) + printExposureLogOffset,
    ];
    cmy = developPixel(logPrint, compiledPaperCurves);
  }

  let X = 0;
  let Y = 0;
  let Z = 0;
  const sc0 = cmy[0];
  const sc1 = cmy[1];
  const sc2 = cmy[2];
  const {
    scanChanDens0,
    scanChanDens1,
    scanChanDens2,
    weightedCmfsX,
    weightedCmfsY,
    weightedCmfsZ,
    viewWhite,
  } = ctx;

  for (let l = 0; l < nWl; l++) {
    const atten =
      10 **
      -(
        sc0 * scanChanDens0[l] +
        sc1 * scanChanDens1[l] +
        sc2 * scanChanDens2[l]
      );
    X += atten * weightedCmfsX[l];
    Y += atten * weightedCmfsY[l];
    Z += atten * weightedCmfsZ[l];
  }

  const adapted = adaptXyzBradford([X, Y, Z], viewWhite, D65_WHITE);
  const outLin = xyzToLinearSrgb(adapted[0], adapted[1], adapted[2]);
  return [
    linearToSrgbFloat(outLin[0]),
    linearToSrgbFloat(outLin[1]),
    linearToSrgbFloat(outLin[2]),
  ];
}
