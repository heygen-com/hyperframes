#!/usr/bin/env node
// audio.mjs — audio ADAPTER (reuses the product-launch SCRIPT.md / STORYBOARD.md
// model; this file is intentionally identical across the reusing skills). The
// TTS / BGM / SFX implementation
// no longer lives here: it is the shared engine at
// ../../media-use/audio/scripts/audio.mjs. This file only (a) maps the
// product-launch model (SCRIPT.md frames + STORYBOARD.md music/sfx) into the
// engine's neutral audio_request.json, (b) converts the engine's id-keyed
// audio_meta back into the frame-keyed shape captions.mjs / assemble-index.mjs
// already consume, and (c) keeps the local `sync-durations` pass (it rewrites
// STORYBOARD.md, which is product-launch-specific).
//
// Three modes (unchanged CLI surface):
//   (default) generate — engine --only tts,bgm. BGM mode is "retrieve" (strict:
//        no HeyGen credential ⇒ skip, never a detached generate, since this
//        workflow has no wait-bgm step). Runs in the background during Step 4.
//   sync-durations — write real voice durations into STORYBOARD.md (local).
//   fetch-sfx      — engine --only sfx, merged into the existing meta (Step 5,
//        after the frames' `sfx:` cues exist).
//
//   node audio.mjs --script ./SCRIPT.md --storyboard ./STORYBOARD.md --hyperframes . --out ./audio_meta.json
//   node audio.mjs sync-durations --audio-meta ./audio_meta.json --storyboard ./STORYBOARD.md
//   node audio.mjs fetch-sfx --storyboard ./STORYBOARD.md --hyperframes .

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseStoryboard } from "./lib/storyboard.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ENGINE = join(HERE, "..", "..", "media-use", "audio", "scripts", "audio.mjs");

const flag = (argv, name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
};
const pad2 = (n) => String(n).padStart(2, "0");

// SCRIPT.md → [{ frame, text }]. `## … (Frame N)` opens a line; `**key:**` rows
// are metadata; the indented block is the spoken text (the only TTS input).
function parseScript(md) {
  const out = [];
  let cur = null;
  const flush = () => {
    if (cur && cur.text.trim()) out.push({ frame: cur.frame, text: cur.text.trim() });
    cur = null;
  };
  for (const line of md.split(/\r?\n/)) {
    const h = line.match(/^#{2,3}\s+.*?\(frame\s+(\d+)\)/i);
    if (h) {
      flush();
      cur = { frame: Number(h[1]), text: "" };
      continue;
    }
    if (!cur) continue;
    if (/^\s*\*\*/.test(line)) continue;
    const m = line.match(/^(?: {4,}|\t)(.+)$/);
    if (m) cur.text += (cur.text ? " " : "") + m[1].trim();
  }
  flush();
  return out;
}

// Path of the engine's neutral meta — a stable sidecar so `--only` merges
// (generate then fetch-sfx) accumulate, while audio_meta.json holds the PL shape.
const neutralPath = (plOutPath) => join(dirname(plOutPath), "audio_engine_meta.json");

// Run the shared engine. Returns nothing; dies on a non-zero exit.
function runEngine({ request, hyperframesDir, neutral, only, extra = [] }, die) {
  const reqPath = join(hyperframesDir, "audio_request.json");
  writeFileSync(reqPath, JSON.stringify(request, null, 2));
  const engine = process.env.HF_MEDIA_ENGINE || DEFAULT_ENGINE;
  if (!existsSync(engine)) die(`media audio engine not found at ${engine} (set $HF_MEDIA_ENGINE)`);
  const args = [
    engine,
    "--request",
    reqPath,
    "--hyperframes",
    hyperframesDir,
    "--out",
    neutral,
    "--only",
    only,
    ...extra,
  ];
  const r = spawnSync("node", args, { stdio: "inherit" });
  if (r.status !== 0) die(`media audio engine exited ${r.status}`);
}

// Engine neutral meta (id-keyed) → product-launch meta (frame-keyed) consumed by
// captions.mjs / assemble-index.mjs. id is the zero-padded frame number.
function toProductLaunchMeta(neutral) {
  const voices = (neutral.voices ?? []).map((v) => ({
    frame: Number(v.id),
    path: v.path,
    duration_s: v.duration_s,
    words: (v.words ?? []).map((w) => ({ id: w.id, text: w.text, start: w.start, end: w.end })),
  }));
  const bgm = neutral.bgm
    ? {
        path: neutral.bgm.path,
        volume: neutral.bgm.volume,
        query: neutral.bgm.query ?? null,
        duration_s: neutral.bgm.duration_s ?? null,
      }
    : null;
  const sfx = (neutral.sfx ?? []).map((s) => ({
    frame: Number(s.id),
    file: s.file,
    offset_s: s.offset_s ?? 0,
    duration_s: s.duration_s ?? 1,
    volume: s.volume ?? 0.35,
  }));
  return { bgm, voices, sfx };
}

// ── generate (TTS + BGM) ────────────────────────────────────────────────────
function runGenerate(argv) {
  const die = (m) => {
    console.error(`✗ audio generate: ${m}`);
    process.exit(1);
  };
  const hyperframesDir = resolve(flag(argv, "hyperframes", "."));
  const storyboardPath = resolve(flag(argv, "storyboard", join(hyperframesDir, "STORYBOARD.md")));
  const scriptPath = resolve(flag(argv, "script", join(hyperframesDir, "SCRIPT.md")));
  const outPath = resolve(flag(argv, "out", join(hyperframesDir, "audio_meta.json")));
  const userVoice = flag(argv, "voice", null);
  const speed = Number(flag(argv, "speed", "1.0")) || 1.0;

  if (!existsSync(storyboardPath)) die(`STORYBOARD.md not found at ${storyboardPath}`);
  const manifest = parseStoryboard(readFileSync(storyboardPath, "utf8"));
  const g = manifest.globals;

  const lines = existsSync(scriptPath)
    ? parseScript(readFileSync(scriptPath, "utf8")).map((l) => ({
        id: pad2(l.frame),
        text: l.text,
      }))
    : [];
  // The canonical fully-silent marker (SKILL.md Step 3.1): `music: none` in
  // the storyboard's top YAML block turns BGM off; combined with no SCRIPT.md
  // the project is fully silent — generate nothing and remove any stale meta
  // from a previous run (assemble treats an absent audio_meta.json as silent).
  const bgmOff =
    String(g.extra?.music ?? "")
      .trim()
      .toLowerCase() === "none";
  if (bgmOff && !lines.length) {
    rmSync(outPath, { force: true });
    rmSync(neutralPath(outPath), { force: true });
    console.log(
      "✓ audio generate: project marked silent (music: none, no SCRIPT.md) — nothing to generate",
    );
    return;
  }
  if (!lines.length) console.error("· no SCRIPT.md — silent film (BGM only)");

  // BGM mood: storyboard `music:` → message → arc → default. `mode: retrieve` is
  // strict here (no wait-bgm step downstream).
  const query = (g.extra && g.extra.music) || g.message || g.arc || "calm cinematic underscore";
  const request = {
    provider: "auto",
    speed,
    lines,
    bgm: bgmOff
      ? { mode: "none" }
      : { mode: "retrieve", query, blob: g.message || "", arc: g.arc || "" },
  };
  if (userVoice) request.voice = userVoice;

  const neutral = neutralPath(outPath);
  runEngine({ request, hyperframesDir, neutral, only: "tts,bgm" }, die);

  const meta = toProductLaunchMeta(JSON.parse(readFileSync(neutral, "utf8")));
  writeFileSync(outPath, JSON.stringify(meta, null, 2));
  console.log(
    `✓ audio generate: ${meta.voices.length} voice + ${meta.bgm ? "1 bgm" : "no bgm"} → ${outPath}`,
  );
}

// ── fetch-sfx ────────────────────────────────────────────────────────────────
function runFetchSfx(argv) {
  const die = (m) => {
    console.error(`✗ audio fetch-sfx: ${m}`);
    process.exit(1);
  };
  const hyperframesDir = resolve(flag(argv, "hyperframes", "."));
  const storyboardPath = resolve(flag(argv, "storyboard", join(hyperframesDir, "STORYBOARD.md")));
  const outPath = resolve(flag(argv, "audio-meta", join(hyperframesDir, "audio_meta.json")));

  if (!existsSync(storyboardPath)) die(`STORYBOARD.md not found at ${storyboardPath}`);
  const manifest = parseStoryboard(readFileSync(storyboardPath, "utf8"));

  // Per-frame `sfx:` cues (comma-separated) → engine lines carrying only sfx.
  const lines = [];
  for (const f of manifest.frames) {
    const names = (f.extra?.sfx ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (names.length && f.number != null) lines.push({ id: pad2(f.number), sfx: names });
  }

  const neutral = neutralPath(outPath);
  const request = { lines, bgm: { mode: "none" } };
  // --only sfx is a MERGE, not an overwrite: the engine reads the existing neutral
  // sidecar (audio_engine_meta.json) and recomputes only the sfx section, so the
  // voices/bgm written by the earlier generate (--only tts,bgm) pass are preserved.
  runEngine({ request, hyperframesDir, neutral, only: "sfx" }, die);

  const meta = toProductLaunchMeta(JSON.parse(readFileSync(neutral, "utf8")));
  writeFileSync(outPath, JSON.stringify(meta, null, 2));
  console.log(`✓ audio fetch-sfx: ${meta.sfx.length} SFX cue(s) → ${outPath}`);
}

// ── sync-durations (local; rewrites STORYBOARD.md) ────────────────────────────
function runSyncDurations(argv) {
  const die = (m) => {
    console.error(`✗ audio sync-durations: ${m}`);
    process.exit(1);
  };
  const hyperframesDir = resolve(flag(argv, "hyperframes", "."));
  const audioMetaPath = resolve(flag(argv, "audio-meta", join(hyperframesDir, "audio_meta.json")));
  const storyboardPath = resolve(flag(argv, "storyboard", join(hyperframesDir, "STORYBOARD.md")));
  if (!existsSync(audioMetaPath)) die(`audio_meta.json not found at ${audioMetaPath}`);

  const meta = JSON.parse(readFileSync(audioMetaPath, "utf8"));
  const durByFrame = new Map();
  for (const v of meta.voices ?? []) {
    if (v.frame != null && v.duration_s) durByFrame.set(v.frame, v.duration_s);
  }

  // Read directly and handle ENOENT here, rather than an existsSync precheck —
  // the check→write pair (write-back below) is a TOCTOU race CodeQL flags.
  let storyboardRaw = "";
  try {
    storyboardRaw = readFileSync(storyboardPath, "utf8");
  } catch {
    die(`STORYBOARD.md not found at ${storyboardPath}`);
  }
  const lines = storyboardRaw.split(/\r?\n/);
  const FRAME_RE = /^#{2,3}\s+(?:frame|beat|scene)\b.*?(\d+)/i;
  let curFrame = null;
  let updated = 0;
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(FRAME_RE);
    if (h) {
      curFrame = Number(h[1]);
      continue;
    }
    if (curFrame != null && durByFrame.has(curFrame)) {
      const m = lines[i].match(/^(\s*[-*]\s+duration\s*:\s*).*/i);
      if (m) {
        lines[i] = `${m[1]}${durByFrame.get(curFrame)}s`;
        durByFrame.delete(curFrame);
        updated++;
      }
    }
  }
  writeFileSync(storyboardPath, lines.join("\n"));
  const missing = [...durByFrame.keys()];
  console.log(
    `✓ audio sync-durations: ${updated} frame duration(s) updated` +
      (missing.length ? ` · no \`- duration:\` line for frame(s) ${missing.join(", ")}` : ""),
  );
}

// ── dispatch ──────────────────────────────────────────────────────────────────
const sub = process.argv[2];
if (sub === "sync-durations") runSyncDurations(process.argv.slice(3));
else if (sub === "fetch-sfx") runFetchSfx(process.argv.slice(3));
else runGenerate(process.argv.slice(2)); // default: generate
