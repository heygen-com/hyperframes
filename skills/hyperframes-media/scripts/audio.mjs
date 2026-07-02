#!/usr/bin/env node
// audio.mjs — the shared HyperFrames audio engine. ONE implementation of TTS +
// BGM + SFX for every video workflow (product-launch, general-video, pr-to-video,
// …). Workflows do NOT vendor a copy: they write a neutral `audio_request.json`
// (a tiny per-workflow adapter maps their storyboard/scenes into it) and call:
//
//   node <MEDIA_DIR>/scripts/audio.mjs --request ./audio_request.json --hyperframes . --out ./audio_meta.json
//
// The three capabilities degrade on ONE switch — whether HeyGen is configured
// (credential present, NOT the CLI). This mirrors the table in ../SKILL.md:
//
//   TTS : HeyGen REST → ElevenLabs → Kokoro (CLI)
//   BGM : HeyGen retrieve  → (no credential) Lyria/MusicGen generate
//   SFX : HeyGen retrieve  → (no credential) bundled 21-file library
//
// ── audio_request.json (input) ────────────────────────────────────────────────
//   {
//     "provider": "auto",          // auto|heygen|elevenlabs|kokoro (override: --provider)
//     "lang": "en", "speed": 1.0,
//     "lines": [                   // one TTS unit each; id joins back to the caller's model
//       { "id": "01", "text": "...", "sfx": ["whoosh", "ui click"] }
//     ],
//     "bgm": { "mode": "retrieve", // retrieve|generate|none (override: --bgm-mode / --no-bgm)
//              "query": "calm cinematic underscore",   // mood for retrieval
//              "prompt": null,      // full prompt for generation (else inferred)
//              "blob": "...", "archetype": "...", "arc": "..." }  // optional mood-inference hints
//   }
//
// ── audio_meta.json (output, id-keyed) ───────────────────────────────────────
//   { tts_provider, voice_id,
//     bgm: { path, volume, mode, query?, duration_s? } | null,
//     bgm_pending, bgm_provider, bgm_pid, bgm_log, bgm_mode, bgm_target_duration_s, …,
//     voices: [ { id, path, duration_s, words: [{id,text,start,end}] } ],
//     sfx:    [ { id, name, file, source, offset_s, duration_s, volume } ],
//     total_duration_s }
//
// --only tts,bgm,sfx  runs a subset and MERGES into an existing --out (so a
// workflow can do TTS+BGM early, then SFX later once cues exist). When BGM uses
// the generate path it is spawned detached (bgm_pending:true) — run wait-bgm.mjs
// before assembling.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { heygenAuthHeaders, heygenCredential, loadEnvFromDir } from "./lib/heygen.mjs";
import {
  ffprobeDuration,
  pickProvider,
  resolveVoiceId,
  synthesizeOne,
  transcribeWav,
  withWordIds,
} from "./lib/tts.mjs";
import { generateBgmDetached, inferBgmPrompt, retrieveBgm } from "./lib/bgm.mjs";
import { resolveSfx } from "./lib/sfx.mjs";
import { mapWithConcurrency } from "./lib/concurrency.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
};
const has = (name) => argv.includes(`--${name}`);
const die = (m) => {
  console.error(`✗ audio engine: ${m}`);
  process.exit(1);
};
const r3 = (x) => Number(x.toFixed(3));

// Two independent reports of an unbounded Promise.all over TTS lines
// overwhelming a machine: one OOM'd 12/13 concurrent Kokoro TTS +
// whisper-transcribe lines on a resource-constrained laptop, the other saw
// 7/8 lines fail on first run (concurrent cold-start model loads) and pass on
// retry once the model was cached. Kokoro/Whisper each load their own local
// model per subprocess, so firing every line at once multiplies that cost by
// the line count. mapWithConcurrency caps how many run at once — still
// parallel, just bounded.
const ttsConcurrency = Math.max(1, Number(process.env.HYPERFRAMES_TTS_CONCURRENCY) || 4);

const hyperframesDir = resolve(flag("hyperframes", "."));
const requestPath = resolve(flag("request", join(hyperframesDir, "audio_request.json")));
const outPath = resolve(flag("out", join(hyperframesDir, "audio_meta.json")));
const sfxLibDir = resolve(flag("sfx-lib", join(HERE, "..", "assets", "sfx")));
const lyriaRecipe = resolve(flag("lyria-recipe", join(HERE, "lyria-recipe.py")));
const onlyArg = flag("only", "tts,bgm,sfx");
const only = new Set(
  onlyArg
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
const providerOverride = flag("provider", null);
const bgmModeOverride = flag("bgm-mode", null);
const noBgm = has("no-bgm");
const voiceOverride = flag("voice", null);
const speedOverride = flag("speed", null);
const langOverride = flag("lang", null);
const seedSeconds = Number(flag("seed-seconds", "28")) || 28;

if (!existsSync(requestPath)) die(`audio_request.json not found at ${requestPath}`);
let request;
try {
  request = JSON.parse(readFileSync(requestPath, "utf8"));
} catch (e) {
  die(`audio_request.json parse: ${e.message}`);
}
const lines = Array.isArray(request.lines) ? request.lines : [];
const lang = langOverride || request.lang || "en";
const speed = Number(speedOverride ?? request.speed ?? 1.0) || 1.0;

// ── env + HeyGen availability (the single switch) ─────────────────────────────
loadEnvFromDir(hyperframesDir);
const heygenOK = heygenCredential() !== null;
const headers = heygenOK ? heygenAuthHeaders() : null;

// ── merge base: preserve sections not selected by --only ──────────────────────
const prev = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : {};
const anomalies = [];

// ── TTS ───────────────────────────────────────────────────────────────────────
let voices = prev.voices ?? [];
let ttsProvider = prev.tts_provider ?? null;
let voiceId = prev.voice_id ?? null;
if (only.has("tts") && lines.length) {
  try {
    ttsProvider = pickProvider(
      providerOverride || (request.provider === "auto" ? null : request.provider),
    );
  } catch (e) {
    die(e.message);
  }
  voiceId = await resolveVoiceId({
    provider: ttsProvider,
    userVoice: voiceOverride || request.voice,
    lang,
  });
  console.error(`· tts: ${ttsProvider} · voice ${voiceId} · ${lines.length} line(s)`);
  const synthLine = async (line) => {
    const id = String(line.id);
    const text = String(line.text ?? "").trim();
    if (!text) {
      anomalies.push(`line ${id}: empty text — skipped`);
      return null;
    }
    const rel = `assets/voice/${id}.wav`;
    const abs = join(hyperframesDir, rel);
    const { ok, words } = await synthesizeOne({
      provider: ttsProvider,
      text,
      voiceId,
      lang,
      speed,
      wavAbs: abs,
      hyperframesDir,
    });
    if (!ok) {
      anomalies.push(`line ${id}: TTS failed — omitted`);
      return null;
    }
    let wordArr = words; // heygen: native; else transcribe
    if (!wordArr) wordArr = await transcribeWav({ wavRel: rel, lang, hyperframesDir });
    const dur = ffprobeDuration(abs);
    if (!isFinite(dur) || dur <= 0) {
      anomalies.push(`line ${id}: bad voice duration — omitted`);
      return null;
    }
    return { id, path: rel, duration_s: r3(dur), words: withWordIds(wordArr) };
  };
  const results = await mapWithConcurrency(lines, ttsConcurrency, synthLine);
  voices = results.filter(Boolean);
  for (const v of voices)
    console.error(`  voice ${v.id}: ${v.path} (${v.duration_s}s, ${v.words.length} words)`);
}
const hasVoice = voices.length > 0;
const totalDuration = r3(voices.reduce((a, v) => a + (v.duration_s || 0), 0));

// ── BGM ─────────────────────────────────────────────────────────────────────
let bgm = prev.bgm ?? null;
const bgmFields = {
  bgm_pending: prev.bgm_pending ?? false,
  bgm_provider: prev.bgm_provider ?? null,
  bgm_pid: prev.bgm_pid ?? null,
  bgm_log: prev.bgm_log ?? null,
  bgm_mode: prev.bgm_mode ?? null,
  bgm_target_duration_s: prev.bgm_target_duration_s ?? null,
  bgm_seed_duration_s: prev.bgm_seed_duration_s ?? null,
  bgm_loop_count: prev.bgm_loop_count ?? null,
};
if (only.has("bgm")) {
  bgm = null;
  Object.keys(bgmFields).forEach((k) => (bgmFields[k] = k === "bgm_pending" ? false : null));
  // Mode resolution. An EXPLICIT mode (flag or request.bgm.mode) is strict:
  // "retrieve" means retrieve-or-nothing — it never silently starts a detached
  // generate (a caller with no wait-bgm step, e.g. product-launch, must not get
  // a pending job it can't await). Only the UNSET/auto default picks generate
  // when HeyGen is absent.
  const explicitMode = bgmModeOverride || request.bgm?.mode || null;
  let mode = noBgm ? "none" : explicitMode || (heygenOK ? "retrieve" : "generate");
  if (mode === "retrieve" && !heygenOK) {
    anomalies.push(
      "bgm: retrieve requires a HeyGen credential — skipped (no generate fallback for an explicit retrieve)",
    );
    mode = "none";
  }

  if (mode === "none") {
    console.error(`· bgm: disabled`);
  } else if (mode === "retrieve") {
    try {
      bgm = await retrieveBgm({ query: request.bgm?.query, headers, hyperframesDir, hasVoice });
      if (bgm) {
        bgmFields.bgm_provider = "heygen";
        bgmFields.bgm_mode = "retrieve";
        console.error(`  bgm: ${bgm.path} (retrieve "${bgm.query}")`);
      } else {
        anomalies.push(`bgm: no music match for "${request.bgm?.query ?? ""}" — skipped`);
      }
    } catch (e) {
      anomalies.push(`bgm retrieve failed: ${e.message} — skipped`);
    }
  } else {
    // generate
    const prompt = inferBgmPrompt({
      userPrompt: request.bgm?.prompt,
      blob: request.bgm?.blob || request.bgm?.query,
      archetype: request.bgm?.archetype,
      arc: request.bgm?.arc,
    });
    const gen = generateBgmDetached({
      prompt,
      durationS: totalDuration || 30,
      hyperframesDir,
      lyriaRecipe: existsSync(lyriaRecipe) ? lyriaRecipe : null,
      seedSeconds,
      hasVoice,
    });
    if (gen.disabled) {
      anomalies.push(`bgm: ${gen.reason}`);
    } else {
      bgm = { path: gen.path, volume: gen.volume, mode: gen.mode, duration_s: null };
      bgmFields.bgm_pending = true;
      bgmFields.bgm_provider = gen.provider;
      bgmFields.bgm_pid = gen.pid;
      bgmFields.bgm_log = gen.log;
      bgmFields.bgm_mode = gen.mode;
      bgmFields.bgm_target_duration_s = gen.target_duration_s ?? null;
      bgmFields.bgm_seed_duration_s = gen.seed_duration_s ?? null;
      bgmFields.bgm_loop_count = gen.loop_count ?? null;
      console.error(`  bgm: launched ${gen.provider} (detached, pid ${gen.pid}) → ${gen.path}`);
    }
  }
}

// ── SFX ─────────────────────────────────────────────────────────────────────
let sfx = prev.sfx ?? [];
if (only.has("sfx")) {
  const cues = lines.flatMap((l) =>
    (Array.isArray(l.sfx) ? l.sfx : [])
      .map((name) => ({ id: String(l.id), name: String(name).trim() }))
      .filter((c) => c.name),
  );
  const res = await resolveSfx({ cues, heygenOK, headers, hyperframesDir, sfxLibDir });
  sfx = res.sfx;
  anomalies.push(...res.anomalies);
  console.error(
    `· sfx: ${sfx.length} cue(s) resolved (${heygenOK ? "heygen retrieval" : "bundled library"})`,
  );
}

// ── write audio_meta.json ─────────────────────────────────────────────────────
const meta = {
  tts_provider: ttsProvider,
  voice_id: voiceId,
  bgm,
  ...bgmFields,
  voices,
  sfx,
  total_duration_s: totalDuration,
};
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(meta, null, 2));

console.log(`✓ audio engine → ${outPath}`);
console.log(`  heygen: ${heygenOK ? "yes" : "no"}  ·  ran: ${[...only].join(",")}`);
console.log(
  `  voices: ${voices.length}  ·  bgm: ${bgm ? `${bgmFields.bgm_provider}${bgmFields.bgm_pending ? " (pending)" : ""}` : "none"}  ·  sfx: ${sfx.length}`,
);
console.log(`  total voice duration: ${totalDuration}s`);
if (anomalies.length) {
  console.log(`\nanomalies (non-fatal):`);
  for (const a of anomalies) console.log(`  - ${a}`);
}
