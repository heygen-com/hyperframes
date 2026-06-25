#!/usr/bin/env node
// assemble-index.mjs — deterministic top-level index.html assembly for a
// product-launch project. No subagent, no judgment: turns STORYBOARD.md + the
// built frame files (+ optional audio_meta.json) into the standalone index.html
// the renderer consumes, and stages the frame-named capture assets into assets/.
//
// index.html is a *standalone* composition (root <div id="root"> directly in
// <body>, no <template> wrapper — template is for sub-comps). Structure is
// modeled on the canonical fixture packages/studio/fixtures/storyboard-sample/
// index.html and the authoritative head/audio template in
// packages/core/docs/quickstart-template.html. Frame mount order = STORYBOARD
// document order. Transitions are NOT written here — the transitions injector
// mutates this file afterward (data-start/duration/track-index + GSAP).
//
// Track lanes (same-track time-overlap is illegal — lint timeline_track_too_dense):
//   1      frame sub-comp clips (sequential; the injector 0/1-ping-pongs for overlaps)
//   2      captions sub-comp clip (full-duration overlay, on top of frames)
//   10     per-frame voice <audio>
//   11     BGM <audio>
//   20+i   SFX <audio> (one lane each)
//
// audio_meta.json contract (produced by audio.mjs; OPTIONAL — absent ⇒ silent
// video, frames only). Durations come from STORYBOARD (audio sync-durations
// writes them), NOT from here; this file carries only media PATHS, keyed by
// frame number:
//   { "bgm":   { "path": "assets/bgm/x.mp3", "volume": 0.8 } | null,
//     "voices":[ { "frame": 3, "path": "assets/voice/03.wav" } ],
//     "sfx":   [ { "frame": 3, "file": "assets/sfx/x.mp3", "offset_s": 0,
//                  "duration_s": 1.0, "volume": 0.35 } ] }
//
// Reads:  --storyboard STORYBOARD.md, --hyperframes <project root>,
//         [--audio-meta audio_meta.json]. On disk: each built frame's src html,
//         capture/{assets,assets/videos,screenshots}/<basename> for staging, compositions/captions.html.
// Writes: <project>/index.html  +  stages assets/<basename>.
//
// Exit 0 = index.html written + summary. Exit 1 = fatal contract break (no
// frames, a built/animated frame missing its src/file, a frame with no
// duration, an inner data-composition-id mismatch). No backstop: fix upstream.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseStoryboard } from "./lib/storyboard.mjs";
import { parseFormat } from "./lib/dimensions.mjs";
import { stageAssets } from "./lib/assets.mjs";
import { parseColors, semanticColors } from "./lib/tokens.mjs";

// ---------- argv ----------
const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
};
function die(msg) {
  console.error(`✗ assemble-index.mjs: ${msg}`);
  process.exit(1);
}

const hyperframesDir = resolve(flag("hyperframes", "."));
const storyboardPath = resolve(flag("storyboard", join(hyperframesDir, "STORYBOARD.md")));
const audioMetaPath = resolve(flag("audio-meta", join(hyperframesDir, "audio_meta.json")));
const outPath = resolve(flag("out", join(hyperframesDir, "index.html")));

const r3 = (x) => Math.round(x * 1000) / 1000;
const anomalies = [];

// ---------- parse storyboard ----------
if (!existsSync(storyboardPath)) die(`STORYBOARD.md not found at ${storyboardPath}`);
const manifest = parseStoryboard(readFileSync(storyboardPath, "utf8"));
const { width: WIDTH, height: HEIGHT } = parseFormat(manifest.globals.format);

// ---------- resolve mountable frames in document order ----------
// A frame mounts when its src html exists on disk. A built/animated frame
// missing its src/file is a contract break (die). An outline frame with no
// file is skipped (still a placeholder) with an anomaly note.
const mounted = [];
for (const f of manifest.frames) {
  const label = `frame ${f.number ?? f.index}${f.title ? ` (${f.title})` : ""}`;
  const built = f.status === "built" || f.status === "animated";
  if (!f.src) {
    if (built) die(`${label} is ${f.status} but has no \`src\` — the orchestrator must write it`);
    anomalies.push(`${label}: status ${f.status}, no src — skipped`);
    continue;
  }
  const compAbs = join(hyperframesDir, f.src);
  if (!existsSync(compAbs)) {
    if (built)
      die(`${label} is ${f.status} but its src ${f.src} is not on disk — re-dispatch the worker`);
    anomalies.push(`${label}: src ${f.src} not on disk (status ${f.status}) — skipped`);
    continue;
  }
  if (!Number.isFinite(f.durationSeconds) || f.durationSeconds <= 0) {
    die(
      `${label}: no positive duration (got ${JSON.stringify(f.duration)}) — run audio sync-durations`,
    );
  }
  // Host data-composition-id MUST equal the inner file's, or the runtime never
  // finds the timeline. frame_id = src basename (frame-worker contract); verify
  // the inner html actually declares it.
  const compId = basename(f.src).replace(/\.html?$/i, "");
  const html = readFileSync(compAbs, "utf8");
  // Guard against blank/partial scene files: a worker that errors or is
  // interrupted mid-write leaves an empty (or markup-less) file that exists but
  // fails at render with "Composition HTML is empty or could not be parsed".
  // Catch it here — before emitting data-composition-src — and re-dispatch.
  if (!html.trim() || !/<\w/.test(html)) {
    die(
      `${label}: ${f.src} is empty or has no HTML — the worker wrote a blank/partial file. Re-dispatch that worker before assembling.`,
    );
  }
  if (
    !html.includes(`data-composition-id="${compId}"`) &&
    !html.includes(`data-composition-id='${compId}'`)
  ) {
    die(`${label}: ${f.src} has no data-composition-id="${compId}" (host/inner id must match)`);
  }
  mounted.push({ frame: f, compId, durationSeconds: r3(f.durationSeconds) });
}
if (mounted.length === 0) die("no mountable frames (none built with an on-disk src)");

// cumulative starts — emitted data-start[i] + data-duration[i] == start[i+1] by
// construction (renderer computes end the same way), so adjacent clips touch
// exactly with no float-overlap.
let acc = 0;
for (const m of mounted) {
  m.start = acc;
  acc += m.durationSeconds;
}
const TOTAL = r3(acc);
const startOfFrameNumber = new Map();
for (const m of mounted) if (m.frame.number != null) startOfFrameNumber.set(m.frame.number, m);

// ---------- audio_meta (optional) ----------
let audio = { bgm: null, voices: [], sfx: [] };
if (existsSync(audioMetaPath)) {
  try {
    const parsed = JSON.parse(readFileSync(audioMetaPath, "utf8"));
    audio = { bgm: parsed.bgm ?? null, voices: parsed.voices ?? [], sfx: parsed.sfx ?? [] };
  } catch (e) {
    die(`audio_meta.json parse: ${e.message}`);
  }
}
const voiceByFrame = new Map();
for (const v of audio.voices) if (v.frame != null) voiceByFrame.set(v.frame, v);

// ---------- build <body> in track order ----------
const body = [];
let voiceCount = 0;

for (const m of mounted) {
  // (track 1) frame sub-comp clip — no class="clip" semantics needed; .scene CSS sizes it.
  body.push(
    `      <div`,
    `        id="el-${m.compId}"`,
    `        class="scene"`,
    `        data-composition-id="${m.compId}"`,
    `        data-composition-src="${m.frame.src}"`,
    `        data-start="${m.start}"`,
    `        data-duration="${m.durationSeconds}"`,
    `        data-track-index="1"`,
    `      ></div>`,
  );
  // (track 10) voice — only when the file is actually on disk.
  const v = m.frame.number != null ? voiceByFrame.get(m.frame.number) : undefined;
  if (v?.path) {
    if (existsSync(join(hyperframesDir, v.path))) {
      body.push(
        `      <audio`,
        `        id="el-${m.compId}-voice"`,
        `        src="${v.path}"`,
        `        data-start="${m.start}"`,
        `        data-duration="${m.durationSeconds}"`,
        `        data-track-index="10"`,
        `        data-volume="1"`,
        `      ></audio>`,
      );
      voiceCount++;
    } else {
      anomalies.push(`${m.compId}: voice ${v.path} not on disk — skipped`);
    }
  }
  body.push("");
}

// (track 11) BGM — duck under narration when any voice is present.
let bgmEmitted = false;
if (audio.bgm?.path) {
  if (existsSync(join(hyperframesDir, audio.bgm.path))) {
    const vol = audio.bgm.volume != null ? audio.bgm.volume : voiceCount > 0 ? 0.8 : 0.9;
    body.push(
      `      <!-- BGM -->`,
      `      <audio`,
      `        id="el-bgm"`,
      `        src="${audio.bgm.path}"`,
      `        data-start="0"`,
      `        data-duration="${TOTAL}"`,
      `        data-track-index="11"`,
      `        data-volume="${vol}"`,
      `      ></audio>`,
      "",
    );
    bgmEmitted = true;
  } else {
    anomalies.push(`bgm ${audio.bgm.path} not on disk — skipped`);
  }
}

// (track 2) captions — captions.mjs writes this or legally skips; key off existence.
let captionsEmitted = false;
if (existsSync(join(hyperframesDir, "compositions/captions.html"))) {
  body.push(
    `      <!-- captions -->`,
    `      <div`,
    `        id="el-captions"`,
    `        class="scene"`,
    `        data-composition-id="captions"`,
    `        data-composition-src="compositions/captions.html"`,
    `        data-start="0"`,
    `        data-duration="${TOTAL}"`,
    `        data-track-index="2"`,
    `      ></div>`,
    "",
  );
  captionsEmitted = true;
}

// (track 20+i) SFX — placed at its frame's start + offset.
let sfxEmitted = 0;
audio.sfx.forEach((cue, i) => {
  const host = cue.frame != null ? startOfFrameNumber.get(cue.frame) : undefined;
  if (!host) {
    anomalies.push(`sfx ${cue.file}: frame ${cue.frame} not mounted — skipped`);
    return;
  }
  const rel = cue.file;
  if (!existsSync(join(hyperframesDir, rel))) {
    anomalies.push(`sfx ${rel} not on disk — skipped`);
    return;
  }
  const t = r3(host.start + (cue.offset_s ?? 0));
  const dur = r3(cue.duration_s ?? 1);
  const vol = cue.volume != null ? cue.volume : 0.35;
  if (sfxEmitted === 0) body.push(`      <!-- SFX -->`);
  body.push(
    `      <audio`,
    `        id="el-sfx-${i}"`,
    `        src="${rel}"`,
    `        data-start="${t}"`,
    `        data-duration="${dur}"`,
    `        data-track-index="${20 + i}"`,
    `        data-volume="${vol}"`,
    `      ></audio>`,
  );
  sfxEmitted++;
});

// ---------- stage frame-named assets: capture/ → assets/ (idempotent backstop) ----------
// Frame workers + the live preview reference assets/<basename>; stage-assets.mjs
// already ran this at Step 4 close. Re-run as a backstop so a late-named asset
// still lands. Shared logic: lib/assets.mjs (first-wins, safe to call twice).
const {
  staged,
  wanted,
  anomalies: assetAnomalies,
} = stageAssets({
  hyperframesDir,
  frames: manifest.frames,
});
for (const a of assetAnomalies) anomalies.push(a);

// ---------- <head> ----------
// ---------- ground color ----------
// Per-frame roots carry data-start/data-duration and get clip-gated against the
// global timeline in render (only the first frame's [0,dur] window overlaps global
// 0), so a frame's own full-bleed background can't be relied on as the video ground —
// every frame after the first would render on the bare body color (black). Paint the
// ground on the always-present root composition instead, using the project's frame.md
// canvas color (the same ground role the caption skin maps to --cap-canvas). Falls
// back to the body letterbox color when frame.md is absent or has no resolvable ground.
const framePath = join(hyperframesDir, "frame.md");
let groundColor = null;
if (existsSync(framePath)) {
  try {
    const roles = semanticColors(parseColors(readFileSync(framePath, "utf8")));
    if (roles && roles.canvas) groundColor = roles.canvas;
  } catch {
    /* leave groundColor null — #root stays transparent over the body letterbox */
  }
}

const headStyle = [
  "      * {",
  "        margin: 0;",
  "        padding: 0;",
  "        box-sizing: border-box;",
  "      }",
  "      html,",
  "      body {",
  `        width: ${WIDTH}px;`,
  `        height: ${HEIGHT}px;`,
  "        overflow: hidden;",
  "        background: #000;",
  "      }",
  "      #root {",
  "        position: relative;",
  `        width: ${WIDTH}px;`,
  `        height: ${HEIGHT}px;`,
  "        overflow: hidden;",
  ...(groundColor ? [`        background: ${groundColor};`] : []),
  "      }",
  "      .scene {",
  "        position: absolute;",
  "        inset: 0;",
  "        width: 100%;",
  "        height: 100%;",
  "      }",
].join("\n");

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${WIDTH}, height=${HEIGHT}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
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

// ---------- summary ----------
console.log(`✓ wrote ${outPath}`);
console.log(`  canvas:            ${WIDTH}×${HEIGHT}`);
console.log(`  frames (track 1):  ${mounted.length}`);
console.log(`  voice  (track 10): ${voiceCount}`);
console.log(`  bgm    (track 11): ${bgmEmitted ? "yes" : "no"}`);
console.log(`  captions (track 2): ${captionsEmitted ? "yes" : "no"}`);
console.log(`  sfx    (track 20+): ${sfxEmitted}`);
console.log(`  assets staged:     ${staged}/${wanted.size}`);
console.log(`  total duration:    ${TOTAL}s`);
if (anomalies.length) {
  console.log(`\nanomalies (non-fatal):`);
  for (const a of anomalies) console.log(`  - ${a}`);
}
