#!/usr/bin/env node
/*
 * safe-zones.cjs — PRECOMPUTE where captions can safely go, from the subject matte.
 *
 *   node safe-zones.cjs <project-dir>            → safe-zones.json (global + per-sentence windows) + summary
 *   node safe-zones.cjs <project-dir> <in> <out> → just that time window's zones (ad-hoc query)
 *
 * The inverse of check-occlusion: read the silhouette FIRST and hand the author the
 * clean regions + an embed-vs-fg verdict, so layout is right the first time instead of
 * after N occlusion-failure rounds.
 *
 * Uses the per-pixel ALPHA matte (not a bounding box): a cell counts as subject only
 * where the silhouette actually is, so the empty pocket beside the head / above the
 * shoulders stays FREE (a bbox would wrongly claim it). The subject MOVES, so zones are
 * computed PER TIME WINDOW (the union over just that window's frames), not one global box.
 */
const path = require("path");
const fs = require("fs");
const os = require("os");

const THRESH = 30 / 255; // a cell is "subject" if ≥12% covered at any sampled frame in the window
const SAMPLES = 48; // frames cached across the clip (windows aggregate the cached grids)

const HF_ROOTS = [
  process.argv[2] && path.resolve(process.argv[2]), // project-owned helper dependencies
  process.env.HYPERFRAMES_ROOT,
  path.resolve(__dirname, "../../.."),
  path.join(os.homedir(), "Downloads", "hyperframes"),
].filter(Boolean);
let sharp = null;
for (const root of HF_ROOTS) {
  const cands = [path.join(root, "node_modules", "sharp")];
  const bunDir = path.join(root, "node_modules", ".bun");
  try {
    if (fs.existsSync(bunDir))
      for (const d of fs.readdirSync(bunDir))
        if (d.startsWith("sharp@")) cands.push(path.join(bunDir, d, "node_modules", "sharp"));
  } catch {}
  for (const c of cands) {
    try {
      if (fs.existsSync(c)) {
        sharp = require(c);
        break;
      }
    } catch {}
  }
  if (sharp) break;
}

// largest all-clear (1) rectangle within [c0,c1)×[r0,r1), in CELL units
function largestRect(safe, GW, c0, c1, r0, r1) {
  const cols = c1 - c0;
  const heights = new Array(cols).fill(0);
  let best = { area: 0, x: 0, y: 0, w: 0, h: 0 };
  for (let r = r0; r < r1; r++) {
    for (let cc = 0; cc < cols; cc++) heights[cc] = safe[r * GW + (c0 + cc)] ? heights[cc] + 1 : 0;
    const st = [];
    for (let cc = 0; cc <= cols; cc++) {
      const h = cc < cols ? heights[cc] : 0;
      let start = cc;
      while (st.length && st[st.length - 1].h >= h) {
        const top = st.pop();
        const area = top.h * (cc - top.i);
        if (area > best.area)
          best = { area, x: c0 + top.i, y: r - top.h + 1, w: cc - top.i, h: top.h };
        start = top.i;
      }
      st.push({ i: start, h });
    }
  }
  return best;
}

// turn a max-coverage grid into {coverage, subject, zones, recommendation}
function analyze(occ, GW, GH, W, H, lum, lumSeries) {
  const occCell = new Uint8Array(GW * GH);
  for (let c = 0; c < GW * GH; c++) occCell[c] = occ[c] >= THRESH ? 1 : 0;
  const safe = new Uint8Array(GW * GH); // 1-cell dilation margin around the silhouette
  for (let y = 0; y < GH; y++)
    for (let x = 0; x < GW; x++) {
      let o = 0;
      for (let dy = -1; dy <= 1 && !o; dy++)
        for (let dx = -1; dx <= 1 && !o; dx++) {
          const nx = x + dx,
            ny = y + dy;
          if (nx >= 0 && nx < GW && ny >= 0 && ny < GH && occCell[ny * GW + nx]) o = 1;
        }
      safe[y * GW + x] = o ? 0 : 1;
    }
  const occupied = occCell.reduce((a, b) => a + b, 0);
  const coverage = occupied / (GW * GH);
  let colMin = GW,
    colMax = -1,
    rowMin = GH,
    rowMax = -1;
  for (let x = 0; x < GW; x++)
    for (let y = 0; y < GH; y++)
      if (occCell[y * GW + x]) {
        if (x < colMin) colMin = x;
        if (x > colMax) colMax = x;
        if (y < rowMin) rowMin = y;
        if (y > rowMax) rowMax = y;
      }
  if (colMax < 0) {
    colMin = 0;
    colMax = -1;
    rowMin = 0;
    rowMax = -1;
  }
  const clearerSide = colMin >= GW - 1 - colMax ? "left" : "right";
  const cellW = W / GW,
    cellH = H / GH;
  // HERO anchor — where the ONE big promoted word should sit: ON the subject (centered,
  // crossing it so the head/torso occludes the middle). The OPPOSITE of the clean zones
  // above (those are for narration). A wide band ≈ centered on the subject, vertically
  // crossing the head/upper torso. Only meaningful when there IS a subject.
  let heroAnchor = null;
  if (colMax >= 0) {
    const subjCx = ((colMin + colMax + 1) / 2 / GW) * 100;
    const subjWpct = ((colMax - colMin + 1) / GW) * 100;
    const yTop = (rowMin / GH) * 100,
      yBot = ((rowMax + 1) / GH) * 100;
    const wPct = Math.round(Math.min(92, Math.max(58, subjWpct + 26)));
    const xPct = Math.round(Math.min(98 - wPct, Math.max(2, subjCx - wPct / 2)));
    const yPct = Math.round(yTop + (yBot - yTop) * 0.12); // band crosses the head / upper torso
    let bandLuma = null;
    if (lum) {
      const y0 = Math.round((yPct / 100) * GH),
        y1 = Math.min(GH, y0 + Math.max(2, Math.round(GH * 0.14)));
      const x0 = Math.round((xPct / 100) * GW),
        x1 = Math.min(GW, Math.round(((xPct + wPct) / 100) * GW));
      // luma of the BACKGROUND cells only — that's where the hero's glyphs are visible
      // (the subject-occluded middle doesn't show text; averaging it in hides washout).
      let s2 = 0,
        n = 0;
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          if (occCell[y * GW + x]) continue;
          s2 += lum[y * GW + x];
          n++;
        }
      bandLuma = n ? Math.round(s2 / n) : null;
    }
    heroAnchor = {
      centerXPct: +subjCx.toFixed(1),
      plane: { xPct, yPct, wPct, align: "center" },
      ...(bandLuma != null ? { bandLuma, washoutRisk: bandLuma > 175 } : {}),
      note:
        "Place the ONE big hero here (centered on the subject); the head/torso occludes its middle (~30-55%) — that is the embed. Do NOT put the hero in a clean zone." +
        (bandLuma != null && bandLuma > 175
          ? " ⚠ BAND IS BRIGHT (luma " +
            bandLuma +
            "): cream/screen text will wash out — lower the hero onto the darker subject body, or use a template/mode with opaque text."
          : ""),
    };
  }
  const zoneLuma = (r) => {
    if (!lum || r.area === 0) return null;
    let s2 = 0,
      n = 0;
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) {
        s2 += lum[y * GW + x];
        n++;
      }
    return n ? Math.round(s2 / n) : null;
  };
  // a TIME-AVERAGED map walks a moving minefield: a dark wall swept by a bright
  // moving object (handheld drift, screens) averages "clean" while peaking hot.
  // peakLuma = p95 of the zone's per-sample mean over the window.
  const zoneLumaPeak = (r) => {
    if (!lumSeries || !lumSeries.length || r.area === 0) return null;
    const means = lumSeries
      .map((Lg) => {
        let s2 = 0,
          n = 0;
        for (let y = r.y; y < r.y + r.h; y++)
          for (let x = r.x; x < r.x + r.w; x++) {
            s2 += Lg[y * GW + x];
            n++;
          }
        return n ? s2 / n : 0;
      })
      .sort((a, b) => a - b);
    return Math.round(means[Math.max(0, Math.ceil(means.length * 0.95) - 1)]);
  };
  const toZone = (r) =>
    r.area === 0
      ? null
      : {
          xPct: +((r.x / GW) * 100).toFixed(1),
          yPct: +((r.y / GH) * 100).toFixed(1),
          wPct: +((r.w / GW) * 100).toFixed(1),
          hPct: +((r.h / GH) * 100).toFixed(1),
          areaPct: +(((r.w * r.h) / (GW * GH)) * 100).toFixed(1),
          px: {
            x: Math.round(r.x * cellW),
            y: Math.round(r.y * cellH),
            w: Math.round(r.w * cellW),
            h: Math.round(r.h * cellH),
          },
          ...(zoneLuma(r) != null
            ? {
                meanLuma: zoneLuma(r),
                bright: zoneLuma(r) > 180,
                ...(zoneLumaPeak(r) != null ? { peakLuma: zoneLumaPeak(r) } : {}),
              }
            : {}),
        };
  const zones = {
    largest: toZone(largestRect(safe, GW, 0, GW, 0, GH)),
    left: toZone(largestRect(safe, GW, 0, Math.round(GW / 2), 0, GH)),
    right: toZone(largestRect(safe, GW, Math.round(GW / 2), GW, 0, GH)),
    top: toZone(largestRect(safe, GW, 0, GW, 0, Math.max(2, Math.round(GH * 0.38)))),
  };
  // HUGGING zones — clean strips that ABUT the silhouette (the embed aesthetic wants
  // text NEAR the subject, not parked in the farthest corner). Grown outward from the
  // subject's edge at upper-body height; prefer these for narration.
  const hug = (side) => {
    if (colMax < 0) return null;
    const pad = Math.max(1, Math.round(GW * 0.02));
    const y0 = rowMin,
      y1 = Math.min(GH, rowMin + Math.max(3, Math.round((rowMax - rowMin + 1) * 0.45)));
    let x0, x1;
    if (side === "right") {
      x0 = Math.min(GW - 1, colMax + 1 + pad);
      x1 = GW - pad;
    } else {
      x1 = Math.max(1, colMin - pad);
      x0 = pad;
    }
    if (x1 - x0 < Math.round(GW * 0.1)) return null;
    // shrink until actually clean (≤8% occupied cells)
    let occN = 0,
      tot = 0;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        tot++;
        if (occCell[y * GW + x]) occN++;
      }
    if (tot === 0 || occN / tot > 0.08) return null;
    const r = { x: x0, y: y0, w: x1 - x0, h: y1 - y0, area: (x1 - x0) * (y1 - y0) };
    const z2 = toZone(r);
    // GLYPHS must hug, not just the plane: in a wide column, text aligned to the far
    // edge parks the words a third of the frame away from the subject. Align TOWARD
    // the silhouette: right-side column → text-align:left (text starts beside the
    // subject); left-side column → text-align:right.
    if (z2) z2.align = side === "right" ? "left" : "right";
    return z2;
  };
  zones.hugLeft = hug("left");
  zones.hugRight = hug("right");
  // HERO BAND PROFILE — per-height predicted occlusion of a centered hero band. The hero
  // WANTS ~30–55% (occlusion IS the embed); fg is the LAST resort, only when no height
  // achieves ≤62%. Even an 88%-coverage frame usually has a feasible band over the hairline.
  let heroBands = null;
  if (colMax >= 0) {
    const bandH = Math.max(2, Math.round(GH * 0.13));
    const hx0 = Math.round(((heroAnchor ? heroAnchor.plane.xPct : 8) / 100) * GW);
    const hx1 = Math.min(
      GW,
      Math.round(((heroAnchor ? heroAnchor.plane.xPct + heroAnchor.plane.wPct : 92) / 100) * GW),
    );
    const profile = [];
    for (let y0 = 0; y0 + bandH <= GH; y0 += Math.max(1, Math.round(GH * 0.02))) {
      let n = 0,
        occN = 0,
        lsum = 0;
      for (let y = y0; y < y0 + bandH; y++)
        for (let x = hx0; x < hx1; x++) {
          n++;
          if (occCell[y * GW + x]) occN++;
          if (lum) lsum += lum[y * GW + x];
        }
      profile.push({
        topPct: +((y0 / GH) * 100).toFixed(1),
        occPct: +((occN / n) * 100).toFixed(1),
        ...(lum ? { bgLuma: Math.round(lsum / n) } : {}),
      });
    }
    const ok = profile.filter((b) => b.occPct >= 12 && b.occPct <= 62);
    const best = (ok.length ? ok : profile).reduce((a, b) =>
      Math.abs(b.occPct - 40) < Math.abs(a.occPct - 40) ? b : a,
    );
    heroBands = { feasible: ok.length > 0, best, profile };
  }
  const big = zones.largest;
  const embeddable = !!big && big.areaPct >= 8 && big.hPct >= 10 && big.wPct >= 18;
  return {
    coverage: +(coverage * 100).toFixed(1),
    subject: {
      colMinPct: +((colMin / GW) * 100).toFixed(1),
      colMaxPct: +(((colMax + 1) / GW) * 100).toFixed(1),
      clearerSide,
    },
    zones,
    heroAnchor,
    heroBands,
    recommendation: embeddable ? "embed" : "fg",
  };
}

// ── SCENE OPTICS + PALETTE (v2) ──────────────────────────────────────────────
// Deterministic scene measurements that drive the DNA tokens, so "design that fits
// the scene" is a pipeline product, not agent inspiration:
//   palette  — dominant scene colors + a READABLE accent suggestion (sampled, then
//              clamped to usable saturation/lightness) + warm/cool temperature
//   optics   — background vs subject sharpness (Laplacian proxy) → suggested text
//              blur so embed type matches the scene's depth-of-field
//   lighting — bright-side estimate → contact-shadow direction for embed type

function rgb2hsv(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b),
    mn = Math.min(r, g, b),
    d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: mx === 0 ? 0 : d / mx, v: mx };
}
function hsv2hex(h, s, v) {
  const c = v * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = v - c;
  let [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  const f = (n) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${f(r)}${f(g)}${f(b)}`;
}

// dominant colors + accent suggestion from the BACKGROUND cells of a mid frame
async function scenePalette(bgPath, occCell, GW, GH) {
  const { data, info } = await sharp(bgPath)
    .resize(GW, GH, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const cells = [];
  for (let c = 0; c < GW * GH; c++) {
    if (occCell && occCell[c]) continue; // background only
    cells.push([data[c * ch], data[c * ch + 1], data[c * ch + 2]]);
  }
  if (!cells.length) return null;
  // dominant: quantize to 3 bits/channel, top buckets by count
  const buckets = new Map();
  for (const [r, g, b] of cells) {
    const k = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const e = buckets.get(k) || { n: 0, r: 0, g: 0, b: 0 };
    e.n++;
    e.r += r;
    e.g += g;
    e.b += b;
    buckets.set(k, e);
  }
  const hex = (e) =>
    "#" +
    [e.r, e.g, e.b]
      .map((x) =>
        Math.round(x / e.n)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("");
  const dominant = [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 3)
    .map((e) => ({ hex: hex(e), sharePct: +((e.n / cells.length) * 100).toFixed(1) }));
  // chromatic accent: hue histogram over saturated cells, weighted s·v
  const bins = Array.from({ length: 12 }, () => ({ w: 0, h: 0, s: 0, v: 0, n: 0 }));
  let warmW = 0,
    coolW = 0;
  for (const [r, g, b] of cells) {
    const { h, s, v } = rgb2hsv(r, g, b);
    if (h <= 90 || h >= 330) warmW += s * v;
    else if (h >= 150 && h <= 300) coolW += s * v;
    if (s < 0.18 || v < 0.12 || v > 0.97) continue;
    const bi = Math.floor(h / 30) % 12,
      w = s * v;
    const B = bins[bi];
    B.w += w;
    B.h += h * w;
    B.s += s * w;
    B.v += v * w;
    B.n++;
  }
  const top = bins.reduce((a, b) => (b.w > a.w ? b : a));
  let accent = null;
  if (top.w > 0.5 && top.n >= 3) {
    const h = top.h / top.w,
      s = top.s / top.w,
      v = top.v / top.w;
    // clamp to a readable accent: saturated enough to read as a choice, light enough to sit on video
    accent = hsv2hex(
      h,
      Math.min(0.78, Math.max(0.5, s * 1.2)),
      Math.min(0.8, Math.max(0.55, v * 1.15)),
    );
  }
  const temperature = warmW > coolW * 1.25 ? "warm" : coolW > warmW * 1.25 ? "cool" : "neutral";
  return { dominant, accentSuggestion: accent, temperature };
}

// Laplacian-stdev sharpness proxy of a region crop (full-res)
async function regionSharpness(imgPath, rect, W, H) {
  const x = Math.max(0, Math.min(W - 2, Math.round(rect.x))),
    y = Math.max(0, Math.min(H - 2, Math.round(rect.y)));
  const w = Math.max(2, Math.min(W - x, Math.round(rect.w))),
    h = Math.max(2, Math.min(H - y, Math.round(rect.h)));
  // two passes: crop to a buffer FIRST, then convolve+stats on the crop — sharp's
  // internal pipeline ordering otherwise convolves/stats the full frame and the two
  // regions measure identical.
  const crop = await sharp(imgPath)
    .extract({ left: x, top: y, width: w, height: h })
    .png()
    .toBuffer();
  const st = await sharp(crop)
    .greyscale()
    .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], scale: 1, offset: 128 })
    .stats();
  return st.channels[0].stdev;
}

async function sceneOptics(project, bgPath, fgPath, zones, subjectBox, W, H) {
  let bgSharp = null,
    subjSharp = null;
  const bigZone = zones && zones.largest && zones.largest.px;
  try {
    if (bigZone && bigZone.w >= 64 && bigZone.h >= 64)
      bgSharp = await regionSharpness(bgPath, bigZone, W, H);
  } catch {}
  try {
    if (subjectBox && subjectBox.w >= 64)
      subjSharp = await regionSharpness(bgPath, subjectBox, W, H);
  } catch {}
  let suggestedTextBlurPx = 0,
    ratio = null;
  if (bgSharp != null && subjSharp != null && subjSharp > 1) {
    ratio = +(bgSharp / subjSharp).toFixed(3);
    // strong bokeh → text in that depth plane should soften to match
    suggestedTextBlurPx = ratio < 0.35 ? 1.6 : ratio < 0.55 ? 1.0 : ratio < 0.8 ? 0.5 : 0;
  }
  return {
    bgSharpness: bgSharp != null ? +bgSharp.toFixed(2) : null,
    subjSharpness: subjSharp != null ? +subjSharp.toFixed(2) : null,
    sharpnessRatio: ratio,
    suggestedTextBlurPx,
  };
}

// bright-side estimate from the luminance grid → contact-shadow vector (shadow falls AWAY from light)
function sceneLighting(lum, occCell, GW, GH) {
  if (!lum) return null;
  let sw = 0,
    sx = 0,
    sy = 0,
    n = 0,
    mean = 0;
  for (let c = 0; c < GW * GH; c++) {
    if (!occCell[c]) {
      mean += lum[c];
      n++;
    }
  }
  if (!n) return null;
  mean /= n;
  for (let y = 0; y < GH; y++)
    for (let x = 0; x < GW; x++) {
      const c = y * GW + x;
      if (occCell[c]) continue;
      const w = Math.max(0, lum[c] - mean);
      sw += w;
      sx += w * (x / GW - 0.5);
      sy += w * (y / GH - 0.5);
    }
  if (sw < 1) return { lightFrom: "flat", shadow: { dx: 0, dy: 3 } };
  const lx = sx / sw,
    ly = sy / sw; // light centroid offset from center, −0.5..0.5
  const mag = Math.hypot(lx, ly);
  if (mag < 0.04) return { lightFrom: "frontal", shadow: { dx: 0, dy: 3 } };
  // shadow direction = opposite the light, scaled to a subtle px offset
  const s = Math.min(1, mag / 0.25);
  const dx = Math.round((-lx / mag) * 4 * s),
    dy = Math.round(Math.max(1, (-ly / mag) * 4 * s + 2));
  const compass =
    Math.abs(lx) > Math.abs(ly) * 1.8
      ? lx > 0
        ? "right"
        : "left"
      : Math.abs(ly) > Math.abs(lx) * 1.8
        ? ly > 0
          ? "below"
          : "above"
        : `${ly > 0 ? "lower" : "upper"}-${lx > 0 ? "right" : "left"}`;
  return { lightFrom: compass, shadow: { dx, dy } };
}

// split the transcript into sentence windows (punctuation, or a > 0.7s gap)
function sentenceWindows(project) {
  const tp = path.join(project, "transcript.json");
  if (!fs.existsSync(tp)) return [];
  let words;
  try {
    words = (JSON.parse(fs.readFileSync(tp, "utf8")).words || []).filter((w) => w && "start" in w);
  } catch {
    return [];
  }
  const out = [];
  let cur = [];
  for (let i = 0; i < words.length; i++) {
    cur.push(words[i]);
    const w = words[i],
      nx = words[i + 1];
    const ends = /[.!?…]$/.test((w.text || "").trim());
    const gap = nx ? nx.start - w.end > 0.7 : true;
    if (ends || gap || !nx) {
      if (cur.length)
        out.push({
          in: +cur[0].start.toFixed(2),
          out: +cur[cur.length - 1].end.toFixed(2),
          text: cur.map((x) => x.text).join(" "),
        });
      cur = [];
    }
  }
  return out;
}

async function main() {
  const project = path.resolve(process.argv[2] || "");
  if (!process.argv[2]) {
    console.error("usage: safe-zones.cjs <project-dir> [in out]");
    process.exit(1);
  }
  const fgDir = path.join(project, "frames_fg");
  if (!fs.existsSync(fgDir)) {
    console.error(`[safe-zones] no ${fgDir} — run matte.cjs first`);
    process.exit(2);
  }
  if (!sharp) {
    console.error(
      "[safe-zones] sharp unavailable — install project dependencies per embedded-captions SKILL.md Runtime prerequisites",
    );
    process.exit(0);
  }

  const frames = fs
    .readdirSync(fgDir)
    .filter((f) => /\.png$/i.test(f))
    .sort();
  if (!frames.length) {
    console.error("[safe-zones] no PNG frames");
    process.exit(2);
  }
  const meta = await sharp(path.join(fgDir, frames[0])).metadata();
  const W = meta.width,
    H = meta.height;
  const CELL = Math.max(W, H) / 48;
  const GW = Math.max(8, Math.round(W / CELL)),
    GH = Math.max(8, Math.round(H / CELL));
  let fps = 24;
  try {
    const f = parseFloat(
      String(fs.readFileSync(path.join(project, "matte.fps"), "utf8")).replace(/[^\d.]/g, ""),
    );
    if (f > 0) fps = f;
  } catch {}

  const bgDir = path.join(project, "frames_bg");
  const hasBg = fs.existsSync(bgDir);
  // cache evenly-sampled frame grids once (each = per-cell avg subject alpha 0..1,
  // plus per-cell mean LUMINANCE from frames_bg — bright zones wash out cream/screen text)
  const sampleIdx = [
    ...new Set(
      Array.from({ length: SAMPLES }, (_, i) =>
        Math.min(frames.length - 1, Math.round((i / (SAMPLES - 1)) * (frames.length - 1))),
      ),
    ),
  ];
  const grids = [];
  for (const i of sampleIdx) {
    const { data, info } = await sharp(path.join(fgDir, frames[i]))
      .resize(GW, GH, { fit: "fill" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const ch = info.channels,
      g = new Float32Array(GW * GH);
    for (let c = 0; c < GW * GH; c++) g[c] = (ch >= 4 ? data[c * ch + 3] : 255) / 255;
    let lum = null;
    if (hasBg && fs.existsSync(path.join(bgDir, frames[i]))) {
      const { data: bd, info: bi } = await sharp(path.join(bgDir, frames[i]))
        .resize(GW, GH, { fit: "fill" })
        .greyscale()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const bch = bi.channels;
      lum = new Float32Array(GW * GH);
      for (let c = 0; c < GW * GH; c++) lum[c] = bd[c * bch];
    }
    grids.push({ t: i / fps, g, lum });
  }
  const lumWindow = (t0, t1) => {
    const acc = new Float32Array(GW * GH);
    let n = 0;
    let inWin = grids.filter((s2) => s2.t >= t0 - 1e-6 && s2.t <= t1 + 1e-6 && s2.lum);
    if (!inWin.length) inWin = grids.filter((s2) => s2.lum);
    for (const s2 of inWin) {
      for (let c = 0; c < GW * GH; c++) acc[c] += s2.lum[c];
      n++;
    }
    if (!n) return null;
    for (let c = 0; c < GW * GH; c++) acc[c] /= n;
    return acc;
  };
  const lumSeriesWindow = (t0, t1) => {
    let inWin = grids.filter((s2) => s2.t >= t0 - 1e-6 && s2.t <= t1 + 1e-6 && s2.lum);
    if (!inWin.length) inWin = grids.filter((s2) => s2.lum);
    return inWin.map((s2) => s2.lum);
  };
  const occWindow = (t0, t1) => {
    const occ = new Float32Array(GW * GH);
    let inWin = grids.filter((s) => s.t >= t0 - 1e-6 && s.t <= t1 + 1e-6);
    if (!inWin.length) {
      // window between samples → use nearest grid
      const mid = (t0 + t1) / 2;
      inWin = [grids.reduce((a, b) => (Math.abs(b.t - mid) < Math.abs(a.t - mid) ? b : a))];
    }
    for (const s of inWin) for (let c = 0; c < GW * GH; c++) if (s.g[c] > occ[c]) occ[c] = s.g[c];
    return occ;
  };

  // ad-hoc window query
  const qIn = parseFloat(process.argv[3]),
    qOut = parseFloat(process.argv[4]);
  if (Number.isFinite(qIn) && Number.isFinite(qOut)) {
    const a = analyze(
      occWindow(qIn, qOut),
      GW,
      GH,
      W,
      H,
      lumWindow(qIn, qOut),
      lumSeriesWindow(qIn, qOut),
    );
    console.log(
      `[safe-zones] window ${qIn}-${qOut}s: ${a.recommendation.toUpperCase()}  coverage ${a.coverage}%  clearer:${a.subject.clearerSide}`,
    );
    const z = a.zones;
    for (const k of ["largest", "left", "right", "top"])
      if (z[k]) console.log(`   ${k}: ${z[k].wPct}%×${z[k].hPct}% @ (${z[k].xPct}%,${z[k].yPct}%)`);
    console.log(JSON.stringify({ in: qIn, out: qOut, ...a }));
    return;
  }

  const globalOcc = occWindow(-1e9, 1e9);
  const globalLum = lumWindow(-1e9, 1e9);
  const global = analyze(globalOcc, GW, GH, W, H, globalLum, lumSeriesWindow(-1e9, 1e9));
  const windows = sentenceWindows(project).map((s) => {
    const a = analyze(
      occWindow(s.in, s.out),
      GW,
      GH,
      W,
      H,
      lumWindow(s.in, s.out),
      lumSeriesWindow(s.in, s.out),
    );
    return {
      in: s.in,
      out: s.out,
      text: s.text.slice(0, 48),
      coverage: a.coverage,
      recommendation: a.recommendation,
      clearerSide: a.subject.clearerSide,
      zones: a.zones,
    };
  });

  // ── v2: palette / optics / lighting from the mid frame + global grids ───────
  let palette = null,
    optics = null,
    lighting = null;
  try {
    const occCellG = new Uint8Array(GW * GH);
    for (let c = 0; c < GW * GH; c++) occCellG[c] = globalOcc[c] >= THRESH ? 1 : 0;
    const midName = frames[Math.floor(frames.length / 2)];
    const midBg = path.join(bgDir, midName);
    if (hasBg && fs.existsSync(midBg)) {
      palette = await scenePalette(midBg, occCellG, GW, GH);
      // subject bbox in px from the global occupancy grid
      let cx0 = GW,
        cx1 = -1,
        cy0 = GH,
        cy1 = -1;
      for (let y = 0; y < GH; y++)
        for (let x = 0; x < GW; x++)
          if (occCellG[y * GW + x]) {
            if (x < cx0) cx0 = x;
            if (x > cx1) cx1 = x;
            if (y < cy0) cy0 = y;
            if (y > cy1) cy1 = y;
          }
      const subjectBox =
        cx1 >= 0
          ? {
              x: (cx0 / GW) * W,
              y: (cy0 / GH) * H,
              w: ((cx1 - cx0 + 1) / GW) * W,
              h: ((cy1 - cy0 + 1) / GH) * H,
            }
          : null;
      optics = await sceneOptics(
        project,
        midBg,
        path.join(fgDir, midName),
        global.zones,
        subjectBox,
        W,
        H,
      );
      lighting = sceneLighting(globalLum, occCellG, GW, GH);
    }
  } catch (e) {
    console.error(`[safe-zones] scene optics skipped — ${e.message}`);
  }

  const out = {
    width: W,
    height: H,
    fps,
    grid: { cols: GW, rows: GH },
    ...global,
    palette,
    optics,
    lighting,
    windows,
  };
  fs.writeFileSync(path.join(project, "safe-zones.json"), JSON.stringify(out, null, 2));

  const z = (n, zn) =>
    zn
      ? `${n}: ${zn.wPct}%×${zn.hPct}% @ (${zn.xPct}%,${zn.yPct}%) [${zn.areaPct}%${zn.meanLuma != null ? ` · luma ${zn.meanLuma}${zn.bright ? " ⚠BRIGHT" : ""}` : ""}]`
      : `${n}: —`;
  console.log(
    `[safe-zones] ${W}×${H} grid ${GW}×${GH} @ ${fps}fps · GLOBAL coverage ${global.coverage}% · clearer ${global.subject.clearerSide} · verdict ${global.recommendation.toUpperCase()}`,
  );
  console.log(
    `             ${z("largest", global.zones.largest)} | ${z("left", global.zones.left)} | ${z("right", global.zones.right)} | ${z("top", global.zones.top)}`,
  );
  if (global.recommendation === "embed") {
    console.log(
      `[safe-zones] ✅ EMBED — NARRATION planes go in the clean zones (prefer ${global.subject.clearerSide}/top).`,
    );
    if (global.heroAnchor)
      console.log(
        `[safe-zones] 🎯 HERO → centered ON the subject: plane ≈ x${global.heroAnchor.plane.xPct}% y${global.heroAnchor.plane.yPct}% w${global.heroAnchor.plane.wPct}% center · BIG (~0.22–0.34·h) · target ~30–55% occlusion${global.heroAnchor.bandLuma != null ? ` · band luma ${global.heroAnchor.bandLuma}${global.heroAnchor.washoutRisk ? " ⚠WASHOUT RISK — see heroAnchor.note" : ""}` : ""}`,
      );
    if (global.heroBands)
      console.log(
        `[safe-zones] hero bands: best top ${global.heroBands.best.topPct}% (predicted occlusion ${global.heroBands.best.occPct}%) · bg-hero ${global.heroBands.feasible ? "FEASIBLE — keep the hero EMBEDDED (fg is last resort)" : "INFEASIBLE (no band ≤62%) → hero fg"}`,
      );
    if (global.zones.hugLeft || global.zones.hugRight)
      console.log(
        `[safe-zones] hugging zones (narration belongs HERE, abutting the silhouette): L ${global.zones.hugLeft ? global.zones.hugLeft.wPct + "%×" + global.zones.hugLeft.hPct + "%@x" + global.zones.hugLeft.xPct + "%" + (global.zones.hugLeft.bright ? "⚠bright" : "") : "—"} · R ${global.zones.hugRight ? global.zones.hugRight.wPct + "%×" + global.zones.hugRight.hPct + "%@x" + global.zones.hugRight.xPct + "%" + (global.zones.hugRight.bright ? "⚠bright" : "") : "—"}`,
      );
  } else {
    console.log(
      `[safe-zones] ⚠ FG — subject fills the frame; use caption_layer:"fg" (no clean region to embed behind).`,
    );
  }
  if (palette)
    console.log(
      `[safe-zones] 🎨 palette: dominant ${palette.dominant.map((d) => d.hex).join(" ")} · accent suggestion ${palette.accentSuggestion || "— (no chromatic anchor; use the DNA default)"} · ${palette.temperature}`,
    );
  if (optics && optics.sharpnessRatio != null)
    console.log(
      `[safe-zones] 🔭 depth: bg/subject sharpness ${optics.sharpnessRatio} → embed text blur ${optics.suggestedTextBlurPx}px${optics.suggestedTextBlurPx ? " (match the scene's depth-of-field)" : " (scene is uniformly sharp)"}`,
    );
  if (lighting)
    console.log(
      `[safe-zones] 💡 light from ${lighting.lightFrom} → contact shadow offset (${lighting.shadow.dx}px, ${lighting.shadow.dy}px)`,
    );
  if (windows.length) {
    console.log(`[safe-zones] per-sentence windows (place each group using ITS window's zones):`);
    for (const w of windows)
      console.log(
        `   [${w.in}-${w.out}s] ${w.recommendation.toUpperCase()} cov ${w.coverage}% clear:${w.clearerSide}  ${w.zones.largest ? `best ${w.zones.largest.wPct}%×${w.zones.largest.hPct}%@(${w.zones.largest.xPct}%,${w.zones.largest.yPct}%)` : ""}  "${w.text}"`,
      );
  }
  console.log(`[safe-zones] → ${path.join(project, "safe-zones.json")}`);
}
main().catch((e) => {
  console.error(`[safe-zones] (skipped — ${e.message})`);
  process.exit(0);
});
