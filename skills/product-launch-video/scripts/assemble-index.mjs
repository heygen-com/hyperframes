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
//   { "bgm":   { "path": "assets/bgm/x.mp3", "volume": 0.12 } | null,
//     "voices":[ { "frame": 3, "path": "assets/voice/03.wav" } ],
//     "sfx":   [ { "frame": 3, "file": "assets/sfx/x.mp3", "offset_s": 0,
//                  "duration_s": 1.0, "volume": 0.35 } ] }
//
// Reads:  --storyboard STORYBOARD.md, --hyperframes <project root>,
//         [--audio-meta audio_meta.json]. On disk: each built frame's src html,
//         capture/{assets,assets/videos,screenshots}/<basename> for staging, compositions/captions.html.
// Writes: <project>/index.html  +  stages assets/<basename>  +  (guard ① below)
//         repairs a frame file in place when its root is missing data-width/height.
//
// Pre-assembly frame guards (run in the same pass that reads each frame, so common
// `lint` failures surface HERE instead of after assembly + a wasted render):
//   ① AUTO-REPAIR — a sub-comp root missing data-width/data-height: inject the canvas
//      dims (the renderer needs them on the cloned root; else lint root_missing_dimensions).
//   ② APPROVED VIDEO HOIST — an explicitly marked frame video is moved to the host root;
//      audio remains orchestrator-owned and unmarked media is still a hard failure.
//   ③ HARD FAIL  — a timed element (data-start+duration+track-index) that is not the root
//      and lacks class="clip" (shows the whole frame), or two same-track clips that overlap.
//
// Exit 0 = index.html written + summary. Exit 1 = fatal contract break (no
// frames, a built/animated frame missing its src/file, a frame with no
// duration, an inner data-composition-id mismatch, or a guard ②/③ violation).
// No backstop: fix upstream.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, join, resolve } from "node:path";
import { parseStoryboard } from "./lib/storyboard.mjs";
import { parseFormat } from "./lib/dimensions.mjs";
import { stageAssets } from "./lib/assets.mjs";
import { parseColors, semanticColors } from "./lib/tokens.mjs";
import { bgmDefaultVolume } from "../../media-use/audio/scripts/lib/bgm.mjs";

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

// Ensure the BGM track is at least `total` seconds long. HeyGen (and most music
// libraries) return a short loopable clip (~15–30s); mounting it at data-duration=total
// would leave the video's TAIL SILENT. If the file is short, loop-extend it to `total`
// (with a 0.4s fade-in + 1.5s fade-out) into a sibling *.loop.mp3 and return that path.
// Needs ffprobe+ffmpeg (present in the render env); degrades to the original + a warning
// when they're absent, so assembly never hard-fails on audio tooling.
function ensureBgmCovers(relPath, hyperframesDir, total) {
  const abs = join(hyperframesDir, relPath);
  const probe = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", abs],
    { encoding: "utf8" },
  );
  if (probe.status !== 0) return { looped: false, short: false, reason: "ffprobe unavailable" };
  const dur = parseFloat(String(probe.stdout || "").trim());
  if (!Number.isFinite(dur) || dur <= 0)
    return { looped: false, short: false, reason: "unreadable duration" };
  if (dur >= total - 0.1) return { looped: false, short: false, dur }; // already covers
  const relOut = relPath.replace(/\.([^./]+)$/, ".loop.$1");
  const absOut = join(hyperframesDir, relOut);
  const fadeOut = Math.max(0, total - 1.5);
  const ff = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-stream_loop",
      "-1",
      "-i",
      abs,
      "-t",
      String(total),
      "-af",
      `afade=t=in:st=0:d=0.4,afade=t=out:st=${fadeOut}:d=1.5`,
      "-c:a",
      "libmp3lame",
      "-q:a",
      "2",
      absOut,
    ],
    { encoding: "utf8" },
  );
  if (ff.status !== 0 || !existsSync(absOut))
    return { looped: false, short: true, dur, reason: "ffmpeg unavailable" };
  return { looped: true, rel: relOut, from: dur };
}

const hyperframesDir = resolve(flag("hyperframes", "."));
const storyboardPath = resolve(flag("storyboard", join(hyperframesDir, "STORYBOARD.md")));
const audioMetaPath = resolve(flag("audio-meta", join(hyperframesDir, "audio_meta.json")));
const outPath = resolve(flag("out", join(hyperframesDir, "index.html")));

const r3 = (x) => Math.round(x * 1000) / 1000;
const anomalies = [];
const frameErrors = []; // fatal per-frame composition violations (guards ②/③) — reported together
const repairs = []; // auto-repairs applied to frame files in place (guard ①)

// ---------- parse storyboard ----------
if (!existsSync(storyboardPath)) die(`STORYBOARD.md not found at ${storyboardPath}`);
const manifest = parseStoryboard(readFileSync(storyboardPath, "utf8"));
const { width: WIDTH, height: HEIGHT } = parseFormat(manifest.globals.format);

// ---------- per-frame composition guards (see header ①②③) ----------
// String-level checks on each frame's HTML — no DOM parse, deterministic, run in
// the same pass that already reads the file. OPEN_TAG matches one opening tag while
// tolerating quoted attribute values that contain ">" (e.g. inline styles).
const OPEN_TAG = "<([a-zA-Z][a-zA-Z0-9-]*)((?:[^>\"']|\"[^\"]*\"|'[^']*')*)>";
const attrPresent = (attrs, name) => new RegExp(`(?:^|\\s)${name}(?:[\\s=]|$)`).test(attrs);
const attrValue = (attrs, name) => {
  const m = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`));
  return m ? (m[1] ?? m[2]) : null;
};
// The root (or a nested-comp mount) legitimately carries timing without class="clip".
const isRootish = (attrs) =>
  /(?:^|\s)id\s*=\s*["']root["']/.test(attrs) ||
  attrPresent(attrs, "data-composition-id") ||
  attrPresent(attrs, "data-composition-src");

// Locate the composition root opening tag: prefer id="root", else the first element
// carrying data-composition-id. Returns { start, end, full, attrs } or null.
function findRootTag(html) {
  const re = new RegExp(OPEN_TAG, "g");
  let m;
  let firstCompId = null;
  while ((m = re.exec(html))) {
    const attrs = m[2];
    if (/(?:^|\s)id\s*=\s*["']root["']/.test(attrs))
      return { start: m.index, end: m.index + m[0].length, full: m[0], attrs };
    if (attrPresent(attrs, "data-composition-id") && !firstCompId)
      firstCompId = { start: m.index, end: m.index + m[0].length, full: m[0], attrs };
  }
  return firstCompId;
}

function attrValueFrom(attrs, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = attrs.match(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`));
  return match ? (match[1] ?? match[2]) : null;
}

function escapeHtmlAttr(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function approvedVideoAttrs(attrs) {
  const forwarded = [];
  for (const name of ["id", "src", "poster", "preload", "aria-label", "data-media-start"]) {
    const value = attrValueFrom(attrs, name);
    if (value !== null) forwarded.push(`${name}="${escapeHtmlAttr(value)}"`);
  }
  for (const name of ["muted", "playsinline", "loop"]) {
    if (attrPresent(attrs, name)) forwarded.push(name);
  }
  return forwarded.join(" ");
}

function approvedVideoLayout(attrs) {
  const names = ["x", "y", "width", "height"];
  const raw = Object.fromEntries(
    names.map((name) => [name, attrValueFrom(attrs, `data-frame-video-${name}`)]),
  );
  const rawFit = attrValueFrom(attrs, "data-frame-video-fit");
  const values = Object.fromEntries(names.map((name) => [name, Number(raw[name])]));
  if (
    names.some(
      (name) => raw[name] === null || raw[name].trim() === "" || !Number.isFinite(values[name]),
    ) ||
    values.width <= 0 ||
    values.height <= 0
  ) {
    return {
      style: null,
      error:
        "approved frame video layout data-frame-video-x/y/width/height must all be finite numeric values, with positive width and height",
    };
  }

  const fit = rawFit ?? "cover";
  if (!["cover", "contain", "fill", "none", "scale-down"].includes(fit)) {
    return {
      style: null,
      error:
        'approved frame video layout data-frame-video-fit must be "cover", "contain", "fill", "none", or "scale-down"',
    };
  }

  return {
    style: `position:absolute;left:${values.x}px;top:${values.y}px;width:${values.width}px;height:${values.height}px;object-fit:${fit}`,
    error: null,
  };
}

function hoistApprovedVideos(html, label) {
  const videos = [];
  const errors = [];
  const scan = html
    .replace(/<!--[\s\S]*?-->/g, (match) => " ".repeat(match.length))
    .replace(/<script\b[\s\S]*?<\/script[^>]*>/gi, (match) => " ".repeat(match.length))
    .replace(/<style\b[\s\S]*?<\/style[^>]*>/gi, (match) => " ".repeat(match.length));
  const re = /<video\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/video\s*>/gi;
  const repaired = html.replace(re, (full, attrs, inner, offset) => {
    if (scan[offset] !== "<") return full;
    if (attrValueFrom(attrs, "data-frame-video") !== "approved") return full;
    const rawStart = attrValueFrom(attrs, "data-start");
    const rawDuration = attrValueFrom(attrs, "data-duration");
    const rawTrack = attrValueFrom(attrs, "data-track-index");
    if (rawStart === null || rawDuration === null || rawTrack === null) {
      errors.push(
        `${label}: approved frame video must declare quoted data-start, data-duration, and data-track-index`,
      );
      return full;
    }
    const start = Number(rawStart);
    const duration = Number(rawDuration);
    const track = Number(rawTrack);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(duration) ||
      duration <= 0 ||
      !Number.isFinite(track)
    ) {
      errors.push(
        `${label}: approved frame video must declare finite data-start, positive data-duration, and data-track-index`,
      );
      return full;
    }
    const layout = approvedVideoLayout(attrs);
    if (layout.error) {
      errors.push(`${label}: ${layout.error}`);
      return full;
    }
    videos.push({
      attrs: approvedVideoAttrs(attrs),
      inner,
      start,
      duration,
      track,
      layoutStyle: layout.style,
    });
    return "<!-- approved frame video hoisted by assemble-index -->";
  });
  return { html: repaired, videos, errors };
}

// Returns { errors: string[], repairedHtml: string|null, repairNote: string|null }.
function guardFrame(html, label) {
  const errors = [];
  const originalHtml = html;
  const approved = hoistApprovedVideos(html, label);
  html = approved.html;
  errors.push(...approved.errors);
  // Scan a copy with comments + <script>/<style> bodies blanked, so a tag-like string
  // in a comment (e.g. "<!-- match the host <video> coords -->") or in GSAP code can't
  // trip ②/③. ① still splices into the ORIGINAL html, so its offsets stay correct.
  const scan = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[\s\S]*?<\/script[^>]*>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style[^>]*>/gi, " ");

  // ② media inside a sub-comp — never driven by the runtime (renders blank/black).
  const media = scan.match(/<(video|audio)(?=[\s/>])/i);
  if (media) {
    errors.push(
      `${label}: has a <${media[1].toLowerCase()}> inside the sub-composition. The runtime only drives media that is a DIRECT child of the host root (index.html) — sub-comp media renders blank/black. Move the clip to index.html as a root-level <video>/<audio> and drive any per-scene motion on the main timeline (composition-patterns.md archetype B).`,
    );
  }

  // ③ timed-element checks: missing class="clip", and same-track window overlap.
  const re = new RegExp(OPEN_TAG, "g");
  const clips = [];
  let m;
  while ((m = re.exec(scan))) {
    const attrs = m[2];
    if (
      !attrPresent(attrs, "data-start") ||
      !attrPresent(attrs, "data-duration") ||
      !attrPresent(attrs, "data-track-index")
    )
      continue;
    if (isRootish(attrs)) continue;
    if (!/(?:^|\s)class\s*=\s*["'][^"']*\bclip\b[^"']*["']/.test(attrs)) {
      errors.push(
        `${label}: a timed <${m[1]}> (data-start/duration/track-index) has no class="clip" — it renders for the whole frame instead of only its window. Add class="clip", or remove the timing attrs if it is a GSAP-animated element meant to be present throughout.`,
      );
    }
    const track = attrValue(attrs, "data-track-index");
    const start = parseFloat(attrValue(attrs, "data-start"));
    const dur = parseFloat(attrValue(attrs, "data-duration"));
    if (track != null && Number.isFinite(start) && Number.isFinite(dur))
      clips.push({ track, start, end: start + dur });
  }
  const EPS = 1e-3; // adjacent clips that merely touch are legal
  const byTrack = new Map();
  for (const c of clips) {
    const arr = byTrack.get(c.track);
    if (arr) arr.push(c);
    else byTrack.set(c.track, [c]);
  }
  for (const [track, list] of byTrack) {
    list.sort((a, b) => a.start - b.start);
    for (let i = 1; i < list.length; i++) {
      if (list[i].start < list[i - 1].end - EPS) {
        errors.push(
          `${label}: clips on track ${track} overlap (one ends at ${r3(list[i - 1].end)}s, the next starts at ${r3(list[i].start)}s) — same-track time-overlap causes a render conflict. Put them on distinct data-track-index lanes or fix their windows.`,
        );
        break; // one report per track is enough
      }
    }
  }

  // ① auto-repair: ensure the root carries data-width / data-height.
  let repairedHtml = approved.html !== originalHtml ? approved.html : null;
  let repairNote = null;
  const root = findRootTag(html);
  if (root) {
    const needW = !attrPresent(root.attrs, "data-width");
    const needH = !attrPresent(root.attrs, "data-height");
    if (needW || needH) {
      const inject =
        (needW ? ` data-width="${WIDTH}"` : "") + (needH ? ` data-height="${HEIGHT}"` : "");
      const newTag = root.full.replace(/(\/?>)$/, `${inject}$1`);
      repairedHtml = html.slice(0, root.start) + newTag + html.slice(root.end);
      repairNote = `${label}: injected${needW ? " data-width" : ""}${needH ? " data-height" : ""} (${WIDTH}×${HEIGHT}) on the root — was missing (would lint root_missing_dimensions)`;
    }
  }

  return { errors, repairedHtml, repairNote, hoistedVideos: approved.videos };
}

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
  // Read directly and handle ENOENT here rather than an existsSync precheck — the
  // check→read/write pair is a TOCTOU race CodeQL flags (js/file-system-race).
  let html;
  try {
    html = readFileSync(compAbs, "utf8");
  } catch {
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
  // Guard against blank/partial scene files: a worker that errors or is
  // interrupted mid-write leaves an empty (or markup-less) file that exists but
  // fails at render with "Composition HTML is empty or could not be parsed".
  // Catch it here — before emitting data-composition-src — and re-dispatch.
  if (!html.trim() || !/<\w/.test(html)) {
    die(
      `${label}: ${f.src} is empty or has no HTML — the worker wrote a blank/partial file. Re-dispatch that worker before assembling.`,
    );
  }
  // pre-assembly guards: ① repair missing root dims in place, ②/③ collect fatal violations.
  const guard = guardFrame(html, label);
  if (guard.repairedHtml) {
    writeFileSync(compAbs, guard.repairedHtml);
    html = guard.repairedHtml;
    repairs.push(guard.repairNote);
  }
  for (const e of guard.errors) frameErrors.push(e);
  if (
    !html.includes(`data-composition-id="${compId}"`) &&
    !html.includes(`data-composition-id='${compId}'`)
  ) {
    die(`${label}: ${f.src} has no data-composition-id="${compId}" (host/inner id must match)`);
  }
  mounted.push({
    frame: f,
    compId,
    durationSeconds: r3(f.durationSeconds),
    hoistedVideos: guard.hoistedVideos,
  });
}
if (frameErrors.length) {
  die(
    `${frameErrors.length} frame composition violation(s) — fix the worker output and re-assemble:\n` +
      frameErrors.map((e) => `  • ${e}`).join("\n"),
  );
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

// ---------- duration expectation (advisory) ----------
// Frontmatter `duration:` carries the brief's rough length expectation
// (storyboard-format.md § Frontmatter). Never blocks the build: report where
// the cut lands, and flag a large gap so the agent judges whether the drift
// serves the piece.
let durationNote = "";
const rawTarget = manifest.globals.extra?.duration;
if (rawTarget != null && String(rawTarget).trim() !== "") {
  const targetMatch = String(rawTarget).match(/(\d+(?:\.\d+)?)/);
  const target = targetMatch ? parseFloat(targetMatch[1]) : NaN;
  if (!Number.isFinite(target) || target <= 0) {
    anomalies.push(
      `frontmatter duration "${rawTarget}" is not parseable (e.g. "22s") — skipped the expectation check`,
    );
  } else {
    const diff = r3(TOTAL - target);
    durationNote = ` (expected ~${target}s, ${diff >= 0 ? "+" : ""}${diff}s)`;
    const pct = Math.abs((diff / target) * 100);
    if (pct > 10) {
      anomalies.push(
        `total ${TOTAL}s lands ${Math.round(pct)}% ${diff > 0 ? "over" : "under"} the brief's ~${target}s expectation — ` +
          `judge whether the drift serves the piece (pacing, narration fit); re-pace, or update \`duration:\` if the new length is intended`,
      );
    }
  }
}
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

// Approved frame videos are mounted at the host root after frame clips. Translate
// frame-relative timing to the global timeline and keep them off audio/frame lanes.
for (const [frameIndex, m] of mounted.entries()) {
  for (const video of m.hoistedVideos ?? []) {
    const globalStart = r3(m.start + video.start);
    const track = 1000 + frameIndex * 1000 + video.track;
    const id = /(?:^|\s)id\s*=/.test(video.attrs) ? "" : ` id="el-${m.compId}-video-${frameIndex}"`;
    body.push(
      `      <video${id} ${video.attrs}`,
      `        class="clip"`,
      ...(video.layoutStyle ? [`        style="${video.layoutStyle}"`] : []),
      `        data-start="${globalStart}"`,
      `        data-duration="${r3(video.duration)}"`,
      `        data-track-index="${track}"`,
      `      >${video.inner}</video>`,
      "",
    );
  }
}

// (track 11) BGM — duck under narration when any voice is present. Loop-extend a short
// track to the full video length so the tail isn't silent (libraries return ~15–30s clips).
let bgmEmitted = false;
let bgmNote = "";
if (audio.bgm?.path) {
  if (existsSync(join(hyperframesDir, audio.bgm.path))) {
    let bgmSrc = audio.bgm.path;
    const cov = ensureBgmCovers(audio.bgm.path, hyperframesDir, TOTAL);
    if (cov.looped) {
      bgmSrc = cov.rel;
      bgmNote = ` (looped ${cov.from.toFixed(1)}s→${TOTAL}s)`;
    } else if (cov.short) {
      anomalies.push(
        `bgm is ${cov.dur?.toFixed?.(1) ?? "?"}s (< ${TOTAL}s) and could not be extended (${cov.reason}) — the tail will be silent; install ffmpeg`,
      );
    }
    // An explicit volume from audio_meta always wins; otherwise the shared
    // media-use default (bed ~ -18 dB under narration, forward for a silent film).
    const vol = audio.bgm.volume != null ? audio.bgm.volume : bgmDefaultVolume(voiceCount > 0);
    body.push(
      `      <!-- BGM -->`,
      `      <audio`,
      `        id="el-bgm"`,
      `        src="${bgmSrc}"`,
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

// ---------- summary ----------
console.log(`✓ wrote ${outPath}`);
console.log(`  canvas:            ${WIDTH}×${HEIGHT}`);
console.log(`  frames (track 1):  ${mounted.length}`);
console.log(`  voice  (track 10): ${voiceCount}`);
console.log(`  bgm    (track 11): ${bgmEmitted ? "yes" + bgmNote : "no"}`);
console.log(`  captions (track 2): ${captionsEmitted ? "yes" : "no"}`);
console.log(`  sfx    (track 20+): ${sfxEmitted}`);
console.log(`  assets staged:     ${staged}/${wanted.size}`);
console.log(`  total duration:    ${TOTAL}s${durationNote}`);
if (repairs.length) {
  console.log(`\nrepaired (frame files updated in place):`);
  for (const rp of repairs) console.log(`  - ${rp}`);
}
if (anomalies.length) {
  console.log(`\nanomalies (non-fatal):`);
  for (const a of anomalies) console.log(`  - ${a}`);
}
