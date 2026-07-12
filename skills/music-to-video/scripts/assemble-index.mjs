#!/usr/bin/env node
// assemble-index.mjs — deterministic top-level index.html assembly for a
// music-to-video project. No subagent, no judgment: turns STORYBOARD.md + the
// built per-frame composition files (+ assets/bgm.mp3) into the standalone
// index.html the renderer consumes.
//
// index.html is a *standalone* composition (root <div id="root"> directly in
// <body>, no <template> wrapper — template is for the frame sub-comps). Each
// frame is referenced (not inlined) as a <div class="frame"> with
// data-composition-src pointing at its file; the renderer seeks each at its
// absolute data-start. Frames tile the track gap-free, so frame→frame is a
// plain back-to-back HARD CUT — there is NO transition injector (unlike
// product-launch, whose transitions.mjs exists only for soft transitions).
//
// Track lanes:
//   1   frame clips (sequential, gap-free, hard cut between)
//   10  optional per-frame VO <audio>  (deferred; mounted only if audio_meta has it)
//   11  BGM <audio> (full duration)
//
// Reads:  --storyboard STORYBOARD.md, --hyperframes <root>, [--audiomap audiomap.json],
//         [--bgm assets/bgm.mp3], [--audio-meta audio_meta.json]. On disk: each frame's src html.
// Writes: <project>/index.html
//
// Exit 0 = index.html written + summary. Exit 1 = fatal contract break (no
// frames, a frame missing/empty/with-no-duration, an inner id mismatch).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseStoryboard } from "./lib/storyboard.mjs";

const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
};
function die(msg) {
  console.error(`✗ assemble-index.mjs: ${msg}`);
  process.exit(1);
}
const r3 = (x) => Math.round(x * 1000) / 1000;
const anomalies = [];

const hyperframesDir = resolve(flag("hyperframes", "."));
const storyboardPath = resolve(flag("storyboard", join(hyperframesDir, "STORYBOARD.md")));
const audiomapPath = resolve(flag("audiomap", join(hyperframesDir, "audiomap.json")));
const audioMetaPath = resolve(flag("audio-meta", join(hyperframesDir, "audio_meta.json")));
const bgmRel = flag("bgm", "assets/bgm.mp3");
const outPath = resolve(flag("out", join(hyperframesDir, "index.html")));

// ---------- parse storyboard ----------
if (!existsSync(storyboardPath)) die(`STORYBOARD.md not found at ${storyboardPath}`);
const manifest = parseStoryboard(readFileSync(storyboardPath, "utf8"));
const G = manifest.globals.extra ?? {};

// canvas from frontmatter `canvas: {"w":1920,"h":1080,"fps":30}` (key lowercased by parser)
let WIDTH = 1920,
  HEIGHT = 1080;
if (G.canvas) {
  try {
    const c = JSON.parse(G.canvas);
    if (Number.isFinite(c.w)) WIDTH = c.w;
    if (Number.isFinite(c.h)) HEIGHT = c.h;
  } catch {
    anomalies.push(
      `could not JSON.parse canvas frontmatter: ${G.canvas} — using ${WIDTH}×${HEIGHT}`,
    );
  }
}

// audio duration is the spine truth
let audioDur = null;
if (existsSync(audiomapPath)) {
  try {
    audioDur = JSON.parse(readFileSync(audiomapPath, "utf8"))?.audio?.duration_sec ?? null;
  } catch (e) {
    anomalies.push(`audiomap.json parse failed (${e.message}) — using frame sum for duration`);
  }
}

// ---------- resolve mountable frames in document order ----------
const mounted = [];
for (const f of manifest.frames) {
  const label = `frame ${f.number ?? f.index}${f.title ? ` (${f.title})` : ""}`;
  if (!f.src) die(`${label} has no \`src\` — the planner must write it in STORYBOARD.md`);
  const compAbs = join(hyperframesDir, f.src);
  if (!existsSync(compAbs))
    die(`${label}: src ${f.src} is not on disk — re-dispatch its frame-worker before assembling`);
  if (!Number.isFinite(f.durationSeconds) || f.durationSeconds <= 0)
    die(`${label}: no positive \`duration\` (got ${JSON.stringify(f.duration)})`);
  const compId = basename(f.src).replace(/\.html?$/i, "");
  const inner = readFileSync(compAbs, "utf8");
  if (!inner.trim() || !/<\w/.test(inner))
    die(
      `${label}: ${f.src} is empty/blank — the frame-worker wrote a partial file. Re-dispatch it.`,
    );
  if (
    !inner.includes(`data-composition-id="${compId}"`) &&
    !inner.includes(`data-composition-id='${compId}'`)
  )
    die(`${label}: ${f.src} has no data-composition-id="${compId}" (host/inner id must match)`);
  mounted.push({ frame: f, compId, durationSeconds: r3(f.durationSeconds) });
}
if (mounted.length === 0) die("no mountable frames (none with an on-disk src)");

// cumulative starts — start[i] + duration[i] == start[i+1] exactly (gap-free hard cuts)
let acc = 0;
for (const m of mounted) {
  m.start = r3(acc);
  acc += m.durationSeconds;
}
const FRAME_SUM = r3(acc);
const TOTAL = r3(audioDur ?? FRAME_SUM);
if (audioDur != null && Math.abs(FRAME_SUM - audioDur) > 0.1)
  anomalies.push(
    `frames sum to ${FRAME_SUM}s but audio is ${audioDur}s (Δ${r3(FRAME_SUM - audioDur)}s) — frames should tile the track; check the plan`,
  );

// ---------- optional VO (deferred hook) ----------
let audio = { voices: [] };
if (existsSync(audioMetaPath)) {
  try {
    audio = JSON.parse(readFileSync(audioMetaPath, "utf8"));
  } catch (e) {
    anomalies.push(`audio_meta.json parse: ${e.message}`);
  }
}
const voiceByNum = new Map();
for (const v of audio.voices ?? []) if (v.frame != null) voiceByNum.set(v.frame, v);

// ---------- build <body> ----------
const body = [];
let voiceCount = 0;
for (const m of mounted) {
  body.push(
    `      <div`,
    `        id="el-${m.compId}"`,
    `        class="frame"`,
    `        data-composition-id="${m.compId}"`,
    `        data-composition-src="${m.frame.src}"`,
    `        data-start="${m.start}"`,
    `        data-duration="${m.durationSeconds}"`,
    `        data-track-index="1"`,
    `      ></div>`,
  );
  const v = m.frame.number != null ? voiceByNum.get(m.frame.number) : undefined;
  if (v?.path && existsSync(join(hyperframesDir, v.path))) {
    body.push(
      `      <audio id="el-${m.compId}-voice" src="${v.path}" data-start="${m.start}"`,
      `        data-duration="${m.durationSeconds}" data-track-index="10" data-volume="1"></audio>`,
    );
    voiceCount++;
  }
  body.push("");
}

// BGM (track 11) — full duration. Here the music IS the content (music-first
// skill), so it never drops to the explainer pipelines' narration-bed default
// (bgmDefaultVolume() 0.12 ≈ -18 dB): an incidental VO ducks it only slightly.
let bgmEmitted = false;
if (existsSync(join(hyperframesDir, bgmRel))) {
  const vol = voiceCount > 0 ? 0.8 : 0.9;
  body.push(
    `      <!-- BGM -->`,
    `      <audio id="el-bgm" src="${bgmRel}" data-start="0" data-duration="${TOTAL}"`,
    `        data-track-index="11" data-volume="${vol}"></audio>`,
  );
  bgmEmitted = true;
} else {
  anomalies.push(`BGM not found at ${bgmRel} — index has no music track`);
}

// ---------- head + emit ----------
const headStyle = [
  "      * { margin: 0; padding: 0; box-sizing: border-box; }",
  `      html, body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; background: #000; }`,
  `      #root { position: relative; width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }`,
  "      .frame { position: absolute; inset: 0; width: 100%; height: 100%; }",
].join("\n");

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${WIDTH}, height=${HEIGHT}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js" integrity="sha384-sG0Hv1tP1lZCk9KQmrIbY/XNwi+OY84GQqhMscbnsoBFqAz8KNCil1kvfL3Hbbk2" crossorigin="anonymous"></script>
    <style>
${headStyle}
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-duration="${TOTAL}"
      data-width="${WIDTH}"
      data-height="${HEIGHT}"
    >
${body.join("\n")}
    </div>

    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
`;
writeFileSync(outPath, html);

console.log(`✓ wrote ${outPath}`);
console.log(`  canvas:           ${WIDTH}×${HEIGHT}`);
console.log(`  frames (track 1): ${mounted.length}`);
console.log(`  bgm (track 11):   ${bgmEmitted ? bgmRel : "MISSING"}`);
console.log(`  vo (track 10):    ${voiceCount}`);
console.log(`  total duration:   ${TOTAL}s` + (audioDur != null ? ` (audio ${audioDur}s)` : ""));
if (anomalies.length) {
  console.log(`\nanomalies (non-fatal):`);
  for (const a of anomalies) console.log(`  - ${a}`);
}
