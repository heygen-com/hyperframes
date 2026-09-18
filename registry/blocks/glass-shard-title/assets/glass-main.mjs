/* ================================================================
         Three.js module: rasterise the headline, break its footprint into
         seeded Voronoi glass shards, and render purely from scripted state.
         ================================================================ */
import * as THREE from "three";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";

const G = window.__GST;
const st = G.st;

/* ---- One instance per document -------------------------------------
         This composition is mounted in short-lived documents all over the
         place: Studio's preview stage, the sidebar's hover previews, a
         composition-stack push, the gallery's per-block tiles. One live
         instance costs roughly 350 MB (a 1920x1080 WebGL context with
         antialias + preserveDrawingBuffer, a 4096x2304 headline raster with
         mipmaps, a PMREM environment, a transmission render target and 34
         extruded shard geometries), so a stale one is not a rounding error.
         Never build two on the same document, and always hand the host an
         explicit way to release one. */
if (window.__gstInstance && window.__gstInstance.dispose) {
  try {
    window.__gstInstance.dispose();
  } catch (e) {
    /* best effort */
  }
}

const canvas = document.getElementById("gst-canvas");
const renderer = new THREE.WebGLRenderer({
  canvas,
  alpha: true,
  antialias: true,
  preserveDrawingBuffer: true,
});
renderer.setSize(1920, 1080, false);
renderer.setPixelRatio(1);
renderer.setClearColor(0x0a0a0f, 1); /* flat dark — no gradient wash */
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const FOV = 42;
const CAM_Z = 5.2;
const PANE_Z = 0.6;
const scene = new THREE.Scene();
/* Include the full configured flight, 15% seeded depth jitter, lateral
         offsets rotated by the pane group, and shard extents. The old fixed
         far=60 clipped distant starts even with fog disabled. */
const FAR = Math.max(
  60,
  CAM_Z + Math.max(-G.vars.zDist, -G.vars.zOut, 0) * 1.15 + G.vars.sideDist * 1.5 + 12,
);
const camera = new THREE.PerspectiveCamera(FOV, 1920 / 1080, 0.1, FAR);
camera.position.set(0, 0, CAM_Z);

/* Frustum size at the shard plane: world <-> texture mapping basis. */
const distPane = CAM_Z - PANE_Z;
const VH = 2 * distPane * Math.tan((FOV * Math.PI) / 360);
const VW = VH * (1920 / 1080);

/* ---- Lights ---- */
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const spot = new THREE.SpotLight(0xffffff, 7, 0, Math.PI / 4, 0.5, 1);
spot.position.set(0, 7.1, 2);
scene.add(spot);
const point = new THREE.PointLight(0xccddff, 4, 0, 1);
point.position.set(0, -3, 1);
scene.add(point);

/* ---- Environment + matcap (glass look) ---- */
const hdrTex = await new HDRLoader().loadAsync("assets/ferndale_studio_01_1k.hdr");
const pmrem = new THREE.PMREMGenerator(renderer);
const envRT = pmrem.fromEquirectangular(hdrTex);
scene.environment = envRT.texture;
scene.environmentRotation = new THREE.Euler(0, 0.6, 0);
hdrTex.dispose();
pmrem.dispose();

const matcapTex = await new THREE.TextureLoader().loadAsync("https://static.heygen.ai/hyperframes-oss/docs/images/catalog/assets/glass-shard-title/matcap-1.png");
matcapTex.colorSpace = THREE.SRGBColorSpace;
matcapTex.wrapS = matcapTex.wrapT = THREE.RepeatWrapping;
const mk = 1 / 0.2;
matcapTex.repeat.set(mk, mk);
matcapTex.offset.set((1 - mk) * 0.5, (1 - mk) * 0.5);

/* Fonts must be resident BEFORE rasterising: shard selection samples
         the text pixels. */
try {
  await Promise.all([
    document.fonts.load('600 100px "Geist"'),
    document.fonts.load('400 100px "Geist"'),
  ]);
  await document.fonts.ready;
} catch (e) {
  /* system fallback */
}

/* ---- Headline raster (the ONLY content). Canvas spans the camera
         frustum at the shard plane: world (x,y) -> px via VW/VH. ---- */
const TEXW = 4096;
const TEXH = Math.round(TEXW * (VH / VW));
const headCanvas = document.createElement("canvas");
headCanvas.width = TEXW;
headCanvas.height = TEXH;
const hctx = headCanvas.getContext("2d");
{
  hctx.clearRect(0, 0, TEXW, TEXH);
  hctx.textAlign = "center";
  hctx.textBaseline = "middle";
  /* Fit headline to 70% of frame width so the blob silhouette + padding stays inside frame. */
  let fpx = 300;
  hctx.font = `600 ${fpx}px "Geist", ui-sans-serif, sans-serif`;
  hctx.letterSpacing = `${-0.035 * fpx}px`;
  const w0 = hctx.measureText(G.vars.headline).width;
  const maxW = TEXW * 0.7;
  if (w0 > maxW) fpx = Math.floor((fpx * maxW) / w0);
  hctx.font = `600 ${fpx}px "Geist", ui-sans-serif, sans-serif`;
  hctx.letterSpacing = `${-0.035 * fpx}px`;
  hctx.fillStyle = "#f4f4f8";
  hctx.fillText(G.vars.headline, TEXW / 2, TEXH / 2);
  G.fontPx = fpx;
}
const headTex = new THREE.CanvasTexture(headCanvas);
headTex.colorSpace = THREE.SRGBColorSpace;
headTex.anisotropy = 16;

/* ---- Fattened mask for cell selection (thick stroke = keep shards
         that hug the letterforms, not just ones dead-centre on strokes) ---- */
const maskCanvas = document.createElement("canvas");
maskCanvas.width = 1280;
maskCanvas.height = Math.round(1280 * (VH / VW));
const mctx = maskCanvas.getContext("2d", { willReadFrequently: true });
{
  const ms = maskCanvas.width / TEXW;
  mctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
  mctx.textAlign = "center";
  mctx.textBaseline = "middle";
  mctx.font = `600 ${G.fontPx * ms}px "Geist", ui-sans-serif, sans-serif`;
  mctx.letterSpacing = `${-0.035 * G.fontPx * ms}px`;
  mctx.fillStyle = "#fff";
  mctx.strokeStyle = "#fff";
  mctx.lineWidth = G.fontPx * ms * 0.22;
  mctx.lineJoin = "round";
  mctx.strokeText(G.vars.headline, maskCanvas.width / 2, maskCanvas.height / 2);
  mctx.fillText(G.vars.headline, maskCanvas.width / 2, maskCanvas.height / 2);
}
/* Setup-only: released the moment the shard set is final (see below). */
let maskData = mctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data;
let maskW = maskCanvas.width,
  maskH = maskCanvas.height;
function maskHit(wx, wy) {
  if (!maskData) return false;
  const px = Math.round((wx / VW + 0.5) * (maskW - 1));
  const py = Math.round((0.5 - wy / VH) * (maskH - 1));
  if (px < 0 || py < 0 || px >= maskW || py >= maskH) return false;
  return maskData[(py * maskW + px) * 4 + 3] > 24;
}

/* ---- Headline band in world units (from the raster metrics) ---- */
{
  hctx.font = `600 ${G.fontPx}px "Geist", ui-sans-serif, sans-serif`;
  hctx.letterSpacing = `${-0.035 * G.fontPx}px`;
  const m = hctx.measureText(G.vars.headline);
  G.bandW = ((m.width + G.fontPx * 0.2) / TEXW) * VW;
  G.bandH =
    ((m.actualBoundingBoxAscent + m.actualBoundingBoxDescent + G.fontPx * 0.34) / TEXH) * VH;
}

/* ---- Organic silhouette: the assembled cluster reads as one shard of
         a larger broken pane, not a rounded rectangle. A seeded harmonic blob
         around the headline defines the region; chaos scales the noise,
         padding sets how far the glass extends past the glyphs. The jagged
         outer edge comes from natural Voronoi cell borders against a ring of
         sacrificial outside sites (never rectangle clipping). ---- */
const SEED = 11;
const rnd = gstMulberry32(SEED);
const HW = G.bandW / 2,
  HH = G.bandH / 2;

const PADW = G.bandH * (0.18 + G.vars.padding * 0.85);
const A0 = HW + PADW,
  B0 = HH + PADW;
const randBlob = gstMulberry32(SEED * 511 + 3);
const HARM = [];
for (let k = 2; k <= 9; k++)
  HARM.push({ k, amp: (randBlob() * 2 - 1) / Math.sqrt(k), ph: randBlob() * Math.PI * 2 });
function ellipseR(a, b, th) {
  return (a * b) / Math.hypot(b * Math.cos(th), a * Math.sin(th));
}
function blobR(th) {
  let n = 0;
  for (const h of HARM) n += h.amp * Math.sin(h.k * th + h.ph);
  /* chaos is deliberately violent at the top end — 1.0 is ~10x the old
           deformation, so the outline can go properly feral. */
  let r = ellipseR(A0, B0, th) * (1 + G.vars.chaos * 2.4 * n);
  /* Floor on the text band RECT (not an ellipse): the whole headline plus
           a padding margin is always inside the blob, so tiling the blob always
           covers the text — at any tile count. */
  const rc = Math.abs(Math.cos(th)),
    rs = Math.abs(Math.sin(th));
  const rectR = Math.min(
    rc > 1e-6 ? (HW + PADW * 0.3) / rc : 1e9,
    rs > 1e-6 ? (HH + PADW * 0.3) / rs : 1e9,
  );
  r = Math.max(r, rectR);
  /* Hard frustum cap: whatever the sliders say, the silhouette never
           spills past the frame and gets viewport-cut. */
  const acx = Math.abs(Math.cos(th)),
    asy = Math.abs(Math.sin(th));
  const lim = Math.min(acx > 1e-6 ? (VW * 0.44) / acx : 1e9, asy > 1e-6 ? (VH * 0.43) / asy : 1e9);
  return Math.min(r, lim);
}
function inBlob(x, y) {
  return Math.hypot(x, y) <= blobR(Math.atan2(y, x));
}

/* Domain + density: keep tileCount as shard density over the blob. */
let blobArea = 0,
  maxRX = 0,
  maxRY = 0;
for (let i = 0; i < 96; i++) {
  const th = (i / 96) * Math.PI * 2;
  const r = blobR(th);
  blobArea += 0.5 * r * r * ((Math.PI * 2) / 96);
  maxRX = Math.max(maxRX, Math.abs(r * Math.cos(th)));
  maxRY = Math.max(maxRY, Math.abs(r * Math.sin(th)));
}
/* tileCount is the exact number of pieces — no density inflation, no
         minimum. tileCount 1 = the whole silhouette as one pane of glass. */
const N_INT = Math.max(1, Math.min(400, Math.round(G.vars.tileCount)));
void blobArea;
const bounds = [-maxRX * 1.3, -maxRY * 1.3, maxRX * 1.3, maxRY * 1.3];

/* Size variance: 0 = uniform cells (full Lloyd relaxation, even spread);
         1 = chaotic — sites cluster around seeded attractors (dense regions =
         small shards, sparse = huge ones) and relaxation is skipped. */
const VAR = G.vars.sizeVariance;
const randVar = gstMulberry32(SEED * 977 + 5);
const centres = [];
let cGuard = 0;
while (centres.length < 4 && cGuard++ < 400) {
  const x = (randVar() * 2 - 1) * maxRX;
  const y = (randVar() * 2 - 1) * maxRY;
  if (inBlob(x, y)) centres.push([x, y]);
}
function gauss(r) {
  /* Box-Muller from the seeded stream */
  const u = Math.max(1e-9, r()),
    v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
let points = [];
let guard = 0;
const sigma = Math.max(maxRX, maxRY) * 0.14;
while (points.length < N_INT && guard++ < N_INT * 200) {
  let x, y;
  if (centres.length && rnd() < 0.85 * VAR) {
    const c = centres[Math.floor(rnd() * centres.length) % centres.length];
    x = c[0] + gauss(rnd) * sigma;
    y = c[1] + gauss(rnd) * sigma;
  } else {
    x = (rnd() * 2 - 1) * maxRX;
    y = (rnd() * 2 - 1) * maxRY;
  }
  if (inBlob(x, y)) points.push([x, y]);
}
const interiorCount = points.length;
/* The blob polygon itself is the outer boundary — every cell is clipped
         against it, so the union of pieces IS the silhouette at any count. */
/* The silhouette polygon is COARSE and jittered on purpose: broken
         glass has straight facet edges meeting at sharp vertices. A smooth
         densely-sampled outline gave the boundary shards melted, scooped
         edges — nothing like the experiment's fragments. */
const randEdge = gstMulberry32(SEED * 733 + 9);
const BLOB_VERTS = 22;
const blobPoly = [];
for (let j = 0; j < BLOB_VERTS; j++) {
  const th = ((j + (randEdge() - 0.5) * 0.72) / BLOB_VERTS) * Math.PI * 2;
  const r = blobR(th) * (1 + (randEdge() - 0.5) * 0.09);
  blobPoly.push([r * Math.cos(th), r * Math.sin(th)]);
}
const RELAX = Math.round(3 * (1 - VAR));
for (let iter = 0; iter < RELAX; iter++) {
  const vorR = d3.Delaunay.from(points).voronoi(bounds);
  points = points.map((p, idx) => {
    const cell = vorR.cellPolygon(idx);
    if (!cell || cell.length < 3) return p;
    let cx = 0,
      cy = 0;
    for (const pt of cell) {
      cx += pt[0];
      cy += pt[1];
    }
    return [cx / cell.length, cy / cell.length];
  });
}

/* Polygon inset (seams between shards). */
function lineIntersect(p1, p2, p3, p4) {
  const d = (p1[0] - p2[0]) * (p3[1] - p4[1]) - (p1[1] - p2[1]) * (p3[0] - p4[0]);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((p1[0] - p3[0]) * (p3[1] - p4[1]) - (p1[1] - p3[1]) * (p3[0] - p4[0])) / d;
  return [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])];
}
function insetPolygon(poly, inset) {
  if (inset <= 0) return poly;
  const n = poly.length;
  if (n < 3) return null;
  const edges = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i],
      b = poly[(i + 1) % n];
    const dx = b[0] - a[0],
      dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const nx = -dy / len,
      ny = dx / len;
    edges.push({
      p1: [a[0] + nx * inset, a[1] + ny * inset],
      p2: [b[0] + nx * inset, b[1] + ny * inset],
    });
  }
  const m = edges.length;
  if (m < 3) return null;
  const out = [];
  for (let k = 0; k < m; k++) {
    const e1 = edges[(k + m - 1) % m],
      e2 = edges[k];
    out.push(lineIntersect(e1.p1, e1.p2, e2.p1, e2.p2) || e2.p1);
  }
  let area = 0;
  for (let q = 0; q < out.length; q++) {
    const [x1, y1] = out[q];
    const [x2, y2] = out[(q + 1) % out.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) < 1e-6 ? null : out;
}

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i],
      [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function cellTouchesText(poly) {
  let minX = 1e9,
    minY = 1e9,
    maxX = -1e9,
    maxY = -1e9;
  for (const [x, y] of poly) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const N = 7;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const x = minX + ((i + 0.5) / N) * (maxX - minX);
      const y = minY + ((j + 0.5) / N) * (maxY - minY);
      if (pointInPoly(x, y, poly) && maskHit(x, y)) return true;
    }
  }
  return false;
}

/* ---- Cells -> shard descriptors (seeded choreography per shard) ---- */
const GAP = Math.max(0, G.vars.gap);
const CORNER_R = 0.01 + G.vars.roundness * 0.16;
const PANE_DEPTH = 0.09;

function polyArea2(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i],
      [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}
/* Sutherland-Hodgman: clip any polygon against a CONVEX Voronoi cell. */
function clipToConvex(subject, clip) {
  const ccw = polyArea2(clip) > 0 ? 1 : -1;
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i],
      b = clip[(i + 1) % clip.length];
    const input = out;
    out = [];
    const inside = (pt) =>
      ccw * ((b[0] - a[0]) * (pt[1] - a[1]) - (b[1] - a[1]) * (pt[0] - a[0])) >= -1e-9;
    for (let j = 0; j < input.length; j++) {
      const P = input[j],
        Q = input[(j + 1) % input.length];
      const Pin = inside(P),
        Qin = inside(Q);
      if (Pin) {
        out.push(P);
        if (!Qin) out.push(lineIntersect(P, Q, a, b) || Q);
      } else if (Qin) {
        out.push(lineIntersect(P, Q, a, b) || P);
      }
    }
  }
  return out;
}
/* Merge near-collinear boundary samples so corner rounding keeps scale. */
function simplifyPoly(poly, angTol) {
  let out = poly;
  for (let pass = 0; pass < 3 && out.length > 6; pass++) {
    const next = [];
    let dropped = false;
    for (let i = 0; i < out.length; i++) {
      const A = out[(i + out.length - 1) % out.length];
      const B = out[i];
      const C = out[(i + 1) % out.length];
      const v1x = B[0] - A[0],
        v1y = B[1] - A[1];
      const v2x = C[0] - B[0],
        v2y = C[1] - B[1];
      const ang = Math.abs(Math.atan2(v1x * v2y - v1y * v2x, v1x * v2x + v1y * v2y));
      if (ang < angTol && !dropped && out.length - 1 > 5) {
        dropped = true;
        continue;
      }
      dropped = false;
      next.push(B);
    }
    if (next.length === out.length) break;
    out = next;
  }
  return out;
}

const vor = d3.Delaunay.from(points).voronoi(bounds);
/* ---- polygon hygiene: the blob clip can emit degenerate results
         (duplicate points, collinear runs, self-intersecting "bowties").
         Those extrude into folded shards with broken reflections, so every
         piece is sanitised and must be a simple polygon before it becomes
         geometry. ---- */
function sanitizePoly(poly) {
  if (!poly || poly.length < 3) return null;
  let out = [];
  for (const pt of poly) {
    const last = out[out.length - 1];
    if (last && Math.hypot(pt[0] - last[0], pt[1] - last[1]) < 1e-4) continue;
    out.push(pt);
  }
  while (
    out.length > 1 &&
    Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 1e-4
  )
    out.pop();
  if (out.length < 3) return null;
  /* drop collinear vertices */
  const clean = [];
  for (let i = 0; i < out.length; i++) {
    const a = out[(i + out.length - 1) % out.length];
    const b = out[i];
    const c = out[(i + 1) % out.length];
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const l2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
    if (Math.abs(cr) < 1e-6 * Math.max(1e-6, l1 * l2)) continue;
    clean.push(b);
  }
  if (clean.length < 3) return null;
  /* enforce CCW (the source inset assumes it) */
  if (polyArea2(clean) < 0) clean.reverse();
  return clean;
}
function segsIntersect(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const o1 = o(a, b, c),
    o2 = o(a, b, d),
    o3 = o(c, d, a),
    o4 = o(c, d, b);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}
function isSimplePolygon(poly) {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i],
      b = poly[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || j === (i + 1) % n) continue;
      const c = poly[j],
        d = poly[(j + 1) % n];
      if (segsIntersect(a, b, c, d)) return false;
    }
  }
  return true;
}
function goodPoly(poly, minArea) {
  const sp = sanitizePoly(poly);
  if (!sp) return null;
  if (polyArea2(sp) < minArea) return null;
  if (!isSimplePolygon(sp)) return null;
  return sp;
}

const randFly = gstMulberry32(SEED * 31337 + 7);
const randTilt = gstMulberry32(SEED * 9973 + 1);
let cells = [];
let globalMinEdge = Infinity;
for (let ci = 0; ci < interiorCount; ci++) {
  const cellPoly = vor.cellPolygon(ci);
  if (!cellPoly) continue;
  const cell = cellPoly.slice(0, -1);
  /* The piece is the blob ∩ this cell: pieces always tile the whole
           silhouette, so the text is always fully covered — tileCount only
           decides how many pieces share the job. */
  let raw = goodPoly(simplifyPoly(clipToConvex(blobPoly, cell), 0.14), 3e-4);
  if (!raw) {
    /* Degenerate clip. A text-bearing cell must not vanish (that is a
             hole in a letter) — fall back to the unclipped Voronoi cell;
             a non-text sliver is simply dropped. */
    const fallback = goodPoly(cell, 3e-4);
    if (!fallback || !cellTouchesText(fallback)) continue;
    raw = fallback;
  }
  let off = insetPolygon(raw, GAP / 2);
  off = (off && goodPoly(off, 2e-4)) || raw;
  let cellMinEdge = Infinity;
  for (let ei = 0; ei < off.length; ei++) {
    const pa = off[ei],
      pb = off[(ei + 1) % off.length];
    const el = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
    if (el > 1e-6 && el < cellMinEdge) cellMinEdge = el;
  }
  let ccx = 0,
    ccy = 0;
  for (const pt of off) {
    ccx += pt[0];
    ccy += pt[1];
  }
  ccx /= off.length;
  ccy /= off.length;
  /* Per-corner clamping happens inside buildPieceGeometry (each corner
           is limited by its own adjacent edges), so the radius is passed
           through — a single short edge no longer disables rounding for the
           whole shard. */
  cells.push({
    cx: ccx,
    cy: ccy,
    radius: CORNER_R,
    local: off.map((pt) => [pt[0] - ccx, pt[1] - ccy]),
  });
  void cellMinEdge;
}
void globalMinEdge;

/* The fattened text mask has done its only job (cell selection). Drop
         the 1280x720 RGBA readback and its backing canvas now instead of
         keeping ~7 MB alive for the whole life of the instance. */
maskData = null;
maskCanvas.width = maskCanvas.height = 1;

const shards = cells.map((c) => {
  const sign = c.cx >= 0 ? 1 : -1;
  /* Direct fly coordinates: sideDist is how far to the side (world
           units, 0 = no sideways motion at all), zDist is the z coordinate
           the shards come from (negative = behind the pane). Both jittered
           slightly per shard so the swarm doesn't move as one block. */
  const inOff = [
    sign * G.vars.sideDist * (0.7 + randFly() * 0.6),
    G.vars.sideDist === 0 && G.vars.zDist === 0 ? 0 : (randFly() - 0.5) * 1.7,
    G.vars.zDist * (0.85 + randFly() * 0.3),
  ];
  const inSpin = [
    (randFly() - 0.5) * Math.PI * 1.0 * G.vars.flyInRotation,
    (randFly() - 0.5) * Math.PI * 1.3 * G.vars.flyInRotation,
    (randFly() - 0.5) * Math.PI * 0.5 * G.vars.flyInRotation,
  ];
  /* Fly-out: mirror of the fly-in — back out the same side and back
           into the same depth, faster, spinning harder. */
  const outOff = [
    sign * G.vars.sideDist * (0.8 + randFly() * 0.7),
    G.vars.sideDist === 0 && G.vars.zOut === 0 ? 0 : (randFly() - 0.5) * 2.2,
    G.vars.zOut * (0.85 + randFly() * 0.3),
  ];
  const outSpin = [
    (randFly() - 0.5) * Math.PI * 1.6 * G.vars.flyOutRotation,
    (randFly() - 0.5) * Math.PI * 2.0 * G.vars.flyOutRotation,
    (randFly() - 0.5) * Math.PI * 0.8 * G.vars.flyOutRotation,
  ];
  return {
    cx: c.cx,
    cy: c.cy,
    local: c.local,
    radius: c.radius,
    baseRot: [(randTilt() - 0.5) * 0.08, (randTilt() - 0.5) * 0.08, (randTilt() - 0.5) * 0.03],
    wobPhase: randTilt() * Math.PI * 2,
    wobFreq: 0.45 + randTilt() * 0.5,
    inOff,
    inSpin,
    outOff,
    outSpin,
    rIn: randFly(),
    rOut: randFly(),
  };
});
const n1 = Math.max(1, shards.length - 1);
/* IN: centre shards knit first. OUT: edges peel first. */
const inRank = shards.map((s, i) => [Math.abs(s.cx), i]).sort((a, b) => a[0] - b[0]);
const STG = G.vars.stagger;
inRank.forEach((pair, rank) => {
  const s = shards[pair[1]];
  s.inDelay = STG * 0.85 * (rank / n1) + s.rIn * 0.05 * STG;
  /* The delay is bounded below 0.9, so at least 10% remains. A 0.12
           duration floor pushed the last shards past tin=1 at high stagger,
           leaving residual flight rotation throughout the hold and exit. */
  s.inDur = 1 - s.inDelay;
});
const outRank = shards.map((s, i) => [Math.abs(s.cx), i]).sort((a, b) => b[0] - a[0]);
outRank.forEach((pair, rank) => {
  const s = shards[pair[1]];
  s.outDelay = STG * 0.85 * (rank / n1) + s.rOut * 0.05 * STG;
  s.outDur = Math.max(0.12, 1 - s.outDelay);
});

/* ---- Materials: iridescent glass carrying its slice of the headline
         (planar UVs + emissive map — no Chrome HTML-in-canvas API) ---- */
function makeIridescenceThicknessMap(size) {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0.0, "#202020");
  grad.addColorStop(0.5, "#a0a0a0");
  grad.addColorStop(1.0, "#f0f0f0");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const radial = ctx.createRadialGradient(
    size * 0.3,
    size * 0.4,
    0,
    size * 0.3,
    size * 0.4,
    size * 0.9,
  );
  radial.addColorStop(0, "rgba(255,255,255,0.4)");
  radial.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/* Flat dark transmission target, painted before all shards WITHOUT
         occupying depth. Writing depth here hid every shard behind z=-3.5:
         neither increasing fog distance nor disabling fog could reveal it.
         Keep the original shading/color, including in the transmission pass. */
{
  const d = CAM_Z + 3.5;
  const bh2 = 2 * d * Math.tan((FOV * Math.PI) / 360);
  const back = new THREE.Mesh(
    new THREE.PlaneGeometry(bh2 * (1920 / 1080) * 1.05, bh2 * 1.05),
    new THREE.MeshBasicMaterial({ color: 0x0a0a0f, depthWrite: false, depthTest: false }),
  );
  back.position.z = -3.5;
  back.renderOrder = -1;
  scene.add(back);
}

/* Manual per-FRAGMENT fog (three's scene.fog is bypassed entirely):
         each fragment's own view depth drives an exp2 mix toward the
         background, starting just behind the seated plane — so a tumbling
         shard's near edge resolves before its far edge, like flying through
         real fog. Applied to the glass shading and, as a pure fade, to the
         additive matcap sheen (otherwise the sheen ghosts through the fog). */
const FOG_START = CAM_Z - PANE_Z + 0.28;
const FOG_RHO = G.vars.fog > 0 ? 4.6 / Math.max(2, G.vars.fog) : 0.0;

/* The headline belongs on the FRONT cap only — not mirrored on the back
         cap, not smeared down the side walls. Masked by the object-space
         normal. The same patch pushes the fog start just past the seated
         plane so resting shards are fog-free. */
function addManualFog(shader, additive) {
  shader.uniforms.uGstFogStart = { value: FOG_START };
  shader.uniforms.uGstFogRho = { value: FOG_RHO };
  shader.uniforms.uGstFogColor = { value: new THREE.Color(0x0a0a0f) };
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nvarying float vGstDep;")
    .replace("#include <project_vertex>", "#include <project_vertex>\nvGstDep = -mvPosition.z;");
  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      "#include <common>\nvarying float vGstDep;\nuniform float uGstFogStart;\nuniform float uGstFogRho;\nuniform vec3 uGstFogColor;",
    )
    .replace(
      "#include <dithering_fragment>",
      (additive
        ? "gl_FragColor.rgb *= exp(-pow(max(0.0, vGstDep - uGstFogStart) * uGstFogRho, 2.0));\n"
        : "gl_FragColor.rgb = mix(gl_FragColor.rgb, uGstFogColor, 1.0 - exp(-pow(max(0.0, vGstDep - uGstFogStart) * uGstFogRho, 2.0)));\n") +
        "#include <dithering_fragment>",
    );
}
function patchGlass(shader) {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nvarying float vNzObj;")
    .replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\nvNzObj = normal.z;");
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", "#include <common>\nvarying float vNzObj;")
    .replace(
      "#include <emissivemap_fragment>",
      "#include <emissivemap_fragment>\ntotalEmissiveRadiance *= smoothstep(0.5, 0.78, vNzObj);",
    );
  addManualFog(shader, false);
}

const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  transmission: 1,
  thickness: st.thickness,
  ior: st.ior,
  dispersion: 0.24,
  roughness: st.roughness,
  metalness: 0,
  clearcoat: 1,
  clearcoatRoughness: 0.59,
  specularIntensity: 1,
  specularColor: 0xffffff,
  attenuationDistance: 4.7,
  attenuationColor: 0xffffff,
  envMapIntensity: 1.1,
  iridescence: 1,
  iridescenceIOR: 2.34,
  iridescenceThicknessRange: [80, 500],
  iridescenceThicknessMap: makeIridescenceThicknessMap(256),
  side: THREE.DoubleSide,
  emissive: 0xffffff,
  emissiveMap: headTex,
  emissiveIntensity: 0.95,
});
glassMat.onBeforeCompile = patchGlass;
const matcapMat = new THREE.MeshMatcapMaterial({
  fog: false,
  matcap: matcapTex,
  transparent: true,
  opacity: 0.11,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
});
matcapMat.onBeforeCompile = (sh) => addManualFog(sh, true);

/* ---- Shard geometry (rounded Voronoi cells, extruded + beveled) ---- */
function softMin3(a, b, c, k) {
  if (k <= 0) return Math.min(a, b, c);
  const m = Math.min(a, b, c);
  return m - k * Math.log(Math.exp(-(a - m) / k) + Math.exp(-(b - m) / k) + Math.exp(-(c - m) / k));
}
function buildPieceGeometry(
  poly,
  cornerRadius,
  depth,
  clampSmoothness,
  smoothChamferDist,
  smoothChamferAngle,
) {
  const shape = new THREE.Shape();
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const prev = poly[(i + n - 1) % n];
    const curr = poly[i];
    const next = poly[(i + 1) % n];
    const v1x = curr[0] - prev[0],
      v1y = curr[1] - prev[1];
    const v2x = next[0] - curr[0],
      v2y = next[1] - curr[1];
    const len1 = Math.hypot(v1x, v1y),
      len2 = Math.hypot(v2x, v2y);
    if (len1 < 1e-6 || len2 < 1e-6) continue;
    const u1x = v1x / len1,
      u1y = v1y / len1;
    const u2x = v2x / len2,
      u2y = v2y / len2;
    const cosI = Math.max(-1, Math.min(1, -u1x * u2x - u1y * u2y));
    const sinI = Math.sqrt(Math.max(0, 1 - cosI * cosI));
    const oneCosI = 1 + cosI;
    const tanHalf = oneCosI > 1e-6 ? sinI / oneCosI : 0;
    let d = 0;
    if (tanHalf > 1e-4) {
      const dRaw = cornerRadius / tanHalf;
      const lim1 = len1 * 0.49,
        lim2 = len2 * 0.49;
      let dTarget = dRaw;
      if (smoothChamferDist > 0 && smoothChamferAngle > 0) {
        const interior = Math.acos(cosI);
        if (interior < smoothChamferAngle) {
          const tLin = Math.min(1, (smoothChamferAngle - interior) / smoothChamferAngle);
          const tEased = tLin * tLin * (3 - 2 * tLin);
          dTarget = Math.max(dRaw, smoothChamferDist * tEased);
        }
      }
      d = Math.max(0, softMin3(dTarget, lim1, lim2, clampSmoothness));
    }
    const startX = curr[0] - u1x * d,
      startY = curr[1] - u1y * d;
    const endX = curr[0] + u2x * d,
      endY = curr[1] + u2y * d;
    if (i === 0) shape.moveTo(startX, startY);
    else shape.lineTo(startX, startY);
    if (d > 1e-4) {
      const kappa = 0.5523;
      shape.bezierCurveTo(
        startX + u1x * d * kappa,
        startY + u1y * d * kappa,
        endX - u2x * d * kappa,
        endY - u2y * d * kappa,
        endX,
        endY,
      );
    } else {
      shape.lineTo(curr[0], curr[1]);
    }
  }
  shape.closePath();
  /* Source: bevelThickness = bevelSize = depth*0.25,
           bevelSegments 6, curveSegments 24. The vars scale those constants:
           bevel 0.35 and meshSmooth 0.6 reproduce the source exactly, and a
           near-zero bevel disables bevelling outright — clean flat-sided
           tiles instead of a micro-sliver bevel. */
  const bev = depth * G.vars.bevel * 0.714;
  const bevelOn = G.vars.bevel > 0.02;
  return new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevelOn,
    bevelThickness: bevelOn ? bev : 0,
    bevelSize: bevelOn ? bev : 0,
    bevelSegments: Math.max(1, Math.round((G.vars.meshSmooth / 0.6) * 6)),
    curveSegments: Math.max(4, Math.round((G.vars.meshSmooth / 0.6) * 24)),
  });
}

const paneGroup = new THREE.Group();
paneGroup.position.z = PANE_Z;
scene.add(paneGroup);

const chamferAngle = (28 * Math.PI) / 180;
const shardGroups = [];
for (const sh of shards) {
  const chamferDist = Math.max(GAP / 2, sh.radius * 1.5);
  const geom = buildPieceGeometry(sh.local, sh.radius, PANE_DEPTH, 0, chamferDist, chamferAngle);
  geom.translate(0, 0, -PANE_DEPTH / 2);
  /* Planar frustum-space UVs: each shard samples its slice of the
           headline raster, so the assembled shards read as the text. */
  const pos = geom.attributes.position;
  const uvs = new Float32Array(pos.count * 2);
  for (let v = 0; v < pos.count; v++) {
    uvs[v * 2] = (pos.getX(v) + sh.cx) / VW + 0.5;
    uvs[v * 2 + 1] = (pos.getY(v) + sh.cy) / VH + 0.5;
  }
  geom.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  const grp = new THREE.Group();
  grp.add(new THREE.Mesh(geom, glassMat));
  grp.add(new THREE.Mesh(geom, matcapMat));
  grp.position.set(sh.cx, sh.cy, 0);
  paneGroup.add(grp);
  shardGroups.push(grp);
}

/* ---- Closed-form easings for per-shard local progress ---- */
/* Position-only power ease-out — never overshoots. Rotation has its
         own gentle curve below, but shares position's local flight clock. */
function powOut(x) {
  return 1 - Math.pow(1 - x, G.vars.easePow);
}
function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function renderScene() {
  const t = st.time;
  glassMat.thickness = st.thickness;
  glassMat.roughness = st.roughness;
  glassMat.ior = st.ior;

  /* Whole-cluster idle drift (the "all rotate slightly" hold motion). */
  paneGroup.rotation.x = 0.02 * Math.sin(t * 0.5 + 0.7);
  paneGroup.rotation.y = 0.045 * Math.sin(t * 0.33 + 2.1);
  paneGroup.position.z = PANE_Z + 0.02 * Math.sin(t * 0.5);
  scene.environmentRotation.y = 0.6 + t * 0.04;

  for (let i = 0; i < shards.length; i++) {
    const sh = shards[i];
    const grp = shardGroups[i];

    /* Local fly-in progress from the master, staggered + eased. */
    const ui = clamp01((st.tin - sh.inDelay) / sh.inDur);
    const p = 1 - powOut(ui); /* 1 = out at edge, 0 = seated */
    /* Depth travels near-linearly: with the full ease-out applied to z
             the shard crossed the whole fog zone in the first frames and
             arrived already clear — the fog had nothing to act on. */
    const pz = 1 - (1 - Math.pow(1 - ui, Math.max(1.15, G.vars.easePow * 0.38)));
    /* Keep tumbling through the FULL staggered flight window. Using p
             here consumed 99.9% of the spin halfway through an easePow=10
             entrance, long before depth arrived. A gentle, seeded ease-out
             retains visible rotation late in transit and reaches exactly
             zero only at this shard's position-arrival (ui=1), with zero
             terminal angular velocity. Reuse rIn so the exit's seeded random
             stream, all positions, and the arrival schedule stay unchanged.
             flyInRotation remains a linear amplitude, including true zero. */
    const pr = Math.pow(1 - ui, 1.15 + sh.rIn * 0.2);
    const uo = clamp01((st.tout - sh.outDelay) / sh.outDur);
    const q = uo * uo; /* power2.in departure */
    const qz = Math.pow(uo, 1.35); /* gentler depth exit too */

    let x = sh.cx,
      y = sh.cy,
      z = 0;
    let rx = sh.baseRot[0],
      ry = sh.baseRot[1],
      rz = sh.baseRot[2];

    if (p !== 0 || pz !== 0 || pr !== 0) {
      x += sh.inOff[0] * p;
      y += sh.inOff[1] * p;
      z += sh.inOff[2] * pz;
      rx += sh.inSpin[0] * pr;
      ry += sh.inSpin[1] * pr;
      rz += sh.inSpin[2] * pr;
    }
    /* Idle wobble: only when seated, fades in as p settles, out as q rises. */
    const seated = Math.max(0, 1 - Math.abs(p) * 3) * Math.max(0, 1 - q * 3);
    if (seated > 0.001) {
      const w = sh.wobFreq;
      rx += 0.03 * Math.sin(t * w + sh.wobPhase) * seated;
      ry += 0.045 * Math.sin(t * w * 0.83 + sh.wobPhase * 2.1) * seated;
      rz += 0.012 * Math.sin(t * w * 1.31 + sh.wobPhase * 0.7) * seated;
      z += 0.018 * Math.sin(t * 0.9 + sh.wobPhase) * seated;
    }
    if (uo > 0) {
      x += sh.outOff[0] * q;
      y += sh.outOff[1] * q;
      z += sh.outOff[2] * qz;
      rx += sh.outSpin[0] * q;
      ry += sh.outSpin[1] * q;
      rz += sh.outSpin[2] * q;
    }
    grp.position.set(x, y, z);
    grp.rotation.set(rx, ry, rz);
  }

  renderer.render(scene, camera);
}

window.__gstRender = renderScene;
renderScene();

/* ---- Teardown ------------------------------------------------------
         Nothing above this line was ever released. Every host that mounts
         this block does so in a document it later throws away (Studio detaches
         its preview iframes; the gallery keeps one per tile), and until the
         collector happens to run, a discarded instance still owns its WebGL
         context, its render targets, its 4096x2304 headline raster and 34
         extruded shard geometries. Release all of it the moment the document
         goes away, and expose the same call so a host can do it on demand.

         `pagehide` is the reliable frame-detach signal in current Chrome;
         `unload` is kept as a fallback for older engines. Deliberately NOT
         wired to `visibilitychange` — a backgrounded Studio tab must come
         back with a working stage. */
let gstDisposed = false;
function gstDispose(event) {
  /* A bfcache'd page is coming back with this canvas still on screen —
           tearing the context down here would restore a dead stage. */
  if (event && event.persisted === true) return;
  if (gstDisposed) return;
  gstDisposed = true;
  try {
    window.removeEventListener("pagehide", gstDispose);
    window.removeEventListener("unload", gstDispose);
    if (window.__gstRender === renderScene) window.__gstRender = null;
    if (window.__gstInstance && window.__gstInstance.dispose === gstDispose)
      window.__gstInstance = null;

    scene.traverse(function (obj) {
      if (obj.geometry) obj.geometry.dispose();
      const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
      for (const m of mats) {
        for (const key in m) {
          const v = m[key];
          if (v && v.isTexture) v.dispose();
        }
        m.dispose();
      }
    });
    headTex.dispose();
    matcapTex.dispose();
    envRT.dispose();
    scene.environment = null;
    scene.clear();
    shardGroups.length = 0;
    shards.length = 0;
    /* Free the 2D backing stores as well — the headline raster alone is
             4096 x 2304 x 4 B. */
    headCanvas.width = headCanvas.height = 1;
    maskCanvas.width = maskCanvas.height = 1;
    renderer.dispose();
    /* Hands the context back immediately instead of waiting for the
             canvas to be collected; Chrome only allows a small number of live
             WebGL contexts per renderer process. */
    renderer.forceContextLoss();
  } catch (e) {
    /* teardown is best-effort */
  }
}
window.__gstInstance = { dispose: gstDispose };
window.addEventListener("pagehide", gstDispose);
window.addEventListener("unload", gstDispose);
