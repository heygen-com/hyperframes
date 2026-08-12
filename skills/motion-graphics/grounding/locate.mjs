#!/usr/bin/env node
/* locate.mjs — find "X" in an image WITHOUT any detector API or key.
 *
 * You (the author model) are weak at regressing pixel coordinates but strong at
 * "which numbered strip is the target in?" — so localization = RSVP grid-index
 * (ACL 2025 long.715): pick strips on a numbered grid, reconstruct the box
 * geometrically. Zero npm deps — node + ffmpeg (both already required by
 * hyperframes). Full protocol: grounding/PROTOCOL.md.
 *
 * THE LOOP (you read images between steps):
 *   1) node locate.mjs overlay <img> --out DIR
 *        → DIR/gv.png (vertical strips 1..9) + DIR/gh.png (horizontal 1..9).
 *        READ both, pick the strip numbers the target spans.
 *   2) node locate.mjs region <img> --vids 4,5 --hids 6,7 --out DIR
 *        → prints coarse region + writes DIR/gc.png (region cropped+upscaled,
 *        finer 6×6 grid). READ it, pick the finer strips.
 *   3) node locate.mjs final <img> --region x0,y0,x1,y1 --vids 3,4 --hids 3,4
 *        → {box, center} normalized to the FULL image.
 *   4) node locate.mjs mark <img> --box x0,y0,x1,y1 --out DIR/check.png
 *        → VERIFY: read check.png — is the red box on the target? If off,
 *        redo step 2/3 with corrected strips. Never skip this.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync } from "node:fs";

const N1 = 9,
  PAD1 = 0.4; // stage 1: strips per axis, padding in STRIP units
const N2 = 6,
  PAD2 = 0.25; // stage 2 (crop)
const GREEN = "0x3CDC5A",
  BLUE = "0x3C82FF",
  RED = "0xFF3232";

const ff = (args) =>
  execFileSync("ffmpeg", ["-v", "error", "-y", ...args], {
    stdio: ["ignore", "ignore", "inherit"],
  });
function probe(img) {
  const out = execFileSync("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "csv=p=0",
    "--",
    img,
  ])
    .toString()
    .trim();
  const [w, h] = out.split(",").map(Number);
  return { w, h };
}
function font() {
  const dst = "/tmp/locate-font.ttf";
  if (!existsSync(dst)) {
    for (const c of [
      "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
      "/System/Library/Fonts/Supplemental/Arial.ttf",
      "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ]) {
      if (existsSync(c)) {
        copyFileSync(c, dst);
        break;
      }
    }
  }
  return dst;
}
function gridFilters(w, h, n, axis, fz) {
  const F = font(),
    fs = [];
  if (axis === "v" || axis === "both") {
    for (let i = 1; i < n; i++)
      fs.push(`drawbox=x=${Math.round((i * w) / n)}:y=0:w=2:h=${h}:color=${GREEN}@0.8:t=fill`);
    for (let i = 0; i < n; i++)
      fs.push(
        `drawtext=fontfile=${F}:text='${i + 1}':x=${Math.round(((i + 0.5) * w) / n - fz * 0.3)}:y=6:fontsize=${fz}:fontcolor=black:box=1:boxcolor=white@0.95:boxborderw=5`,
      );
  }
  if (axis === "h" || axis === "both") {
    for (let j = 1; j < n; j++)
      fs.push(`drawbox=x=0:y=${Math.round((j * h) / n)}:w=${w}:h=2:color=${BLUE}@0.8:t=fill`);
    for (let j = 0; j < n; j++)
      fs.push(
        `drawtext=fontfile=${F}:text='${j + 1}':x=6:y=${Math.round(((j + 0.5) * h) / n - fz * 0.5)}:fontsize=${fz}:fontcolor=black:box=1:boxcolor=white@0.95:boxborderw=5`,
      );
  }
  return fs;
}
const ids = (s) => String(s).split(",").filter(Boolean).map(Number);
const regionOf = (v, h, n, pad) => [
  Math.max(Math.min(...v) - 1 - pad, 0) / n,
  Math.max(Math.min(...h) - 1 - pad, 0) / n,
  Math.min(Math.max(...v) + pad, n) / n,
  Math.min(Math.max(...h) + pad, n) / n,
];
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const out = (o) => console.log(JSON.stringify(o));

// --- tiny arg parsing: locate.mjs <cmd> <img?> --k v ---
const [cmd, ...rest] = process.argv.slice(2);
const pos = rest.filter((a) => !a.startsWith("--"));
const opt = {};
for (let i = 0; i < rest.length; i++)
  if (rest[i].startsWith("--")) opt[rest[i].slice(2)] = rest[i + 1];
const img = pos[0];

if (cmd === "overlay") {
  const dir = opt.out || ".";
  mkdirSync(dir, { recursive: true });
  const n = Number(opt.n || N1);
  const { w, h } = probe(img);
  const fz = Math.max(16, Math.round(Math.min(w, h) / 22));
  ff(["-i", img, "-vf", gridFilters(w, h, n, "v", fz).join(","), `${dir}/gv.png`]);
  ff(["-i", img, "-vf", gridFilters(w, h, n, "h", fz).join(","), `${dir}/gh.png`]);
  out({
    w,
    h,
    n,
    vertical: `${dir}/gv.png`,
    horizontal: `${dir}/gh.png`,
    next: "READ gv.png + gh.png, then: locate.mjs region <img> --vids .. --hids .. --out " + dir,
  });
} else if (cmd === "region") {
  const dir = opt.out || ".";
  mkdirSync(dir, { recursive: true });
  const n = Number(opt.n || N1),
    nf = Number(opt.nf || N2);
  const reg = regionOf(ids(opt.vids), ids(opt.hids), n, PAD1);
  const { w, h } = probe(img);
  const cx = Math.floor(reg[0] * w),
    cy = Math.floor(reg[1] * h);
  const cw = Math.max(2, Math.floor((reg[2] - reg[0]) * w)),
    ch = Math.max(2, Math.floor((reg[3] - reg[1]) * h));
  const uw = Math.max(cw, 640),
    uh = Math.round((ch * uw) / cw);
  const fz = Math.max(15, Math.round(Math.min(uw, uh) / 16));
  ff([
    "-i",
    img,
    "-vf",
    [
      `crop=${cw}:${ch}:${cx}:${cy}`,
      `scale=${uw}:${uh}`,
      ...gridFilters(uw, uh, nf, "both", fz),
    ].join(","),
    `${dir}/gc.png`,
  ]);
  out({
    region: reg.map(r4),
    crop_grid: `${dir}/gc.png`,
    nf,
    next: `READ gc.png, then: locate.mjs final <img> --region ${reg.map(r4).join(",")} --vids .. --hids ..`,
  });
} else if (cmd === "final") {
  const nf = Number(opt.nf || N2);
  const reg = opt.region.split(",").map(Number);
  const rl = regionOf(ids(opt.vids), ids(opt.hids), nf, PAD2);
  const [x0, y0, x1, y1] = reg;
  const box = [
    x0 + rl[0] * (x1 - x0),
    y0 + rl[1] * (y1 - y0),
    x0 + rl[2] * (x1 - x0),
    y0 + rl[3] * (y1 - y0),
  ].map(r4);
  out({
    box,
    center: [r4((box[0] + box[2]) / 2), r4((box[1] + box[3]) / 2)],
    next:
      "VERIFY: locate.mjs mark <img> --box " +
      box.join(",") +
      " --out <dir>/check.png — then READ it",
  });
} else if (cmd === "mark") {
  const box = opt.box.split(",").map(Number);
  const { w, h } = probe(img);
  const bx = Math.round(box[0] * w),
    by = Math.round(box[1] * h);
  const bw = Math.max(2, Math.round((box[2] - box[0]) * w)),
    bh = Math.max(2, Math.round((box[3] - box[1]) * h));
  const dst = opt.out || "./check.png";
  ff(["-i", img, "-vf", `drawbox=x=${bx}:y=${by}:w=${bw}:h=${bh}:color=${RED}@1:t=6`, dst]);
  out({
    marked: dst,
    next: "READ it — red box on the target? If off, redo region/final with corrected strips.",
  });
} else if (cmd === "auto") {
  // OPTIONAL fast path — only if a strong detector key happens to exist. Never assume it.
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error(
      "auto needs GEMINI_API_KEY; use the grid loop instead (overlay→region→final→mark)",
    );
    process.exit(1);
  }
  const target = pos[1];
  const b64 = execFileSync("base64", ["-i", img]).toString().replace(/\n/g, "");
  const mime = img.match(/\.png$/i) ? "image/png" : "image/jpeg";
  const body = {
    contents: [
      {
        parts: [
          { inline_data: { mime_type: mime, data: b64 } },
          {
            text: `Detect "${target}". Return ONLY {"box_2d":[ymin,xmin,ymax,xmax]} integers 0-1000.`,
          },
        ],
      },
    ],
    generationConfig: { temperature: 0, response_mime_type: "application/json" },
  };
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${key}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
  const t = (await res.json()).candidates[0].content.parts[0].text;
  let bb = JSON.parse(t.match(/\{[\s\S]*\}/)[0]).box_2d;
  if (Array.isArray(bb[0])) bb = bb[0];
  const s = Math.max(...bb) > 1.5 ? 1000 : 1;
  const box = [bb[1] / s, bb[0] / s, bb[3] / s, bb[2] / s].map(r4);
  out({ box, center: [r4((box[0] + box[2]) / 2), r4((box[1] + box[3]) / 2)] });
} else {
  console.error("usage: locate.mjs overlay|region|final|mark|auto … (see header comment)");
  process.exit(1);
}
