#!/usr/bin/env node
// Self-contained HeyGen TTS — single text in → one wav (+ optional words JSON)
// out. A thin CLI over lib/tts.mjs (the same code the audio engine uses), so the
// HeyGen REST call, starfish voice pick, mp3→wav transcode, and word-timestamp
// filtering live in exactly one place. Bypasses the `hyperframes` CLI, which in
// the published build is Kokoro-only.
//
// Usage:
//   node heygen-tts.mjs "Text to speak"  -o narration.wav [--words narration.words.json]
//   node heygen-tts.mjs ./script.txt     -o narration.wav --words narration.words.json
//   node heygen-tts.mjs "Bonjour"        -o fr.wav --lang fr --voice <id>
//   node heygen-tts.mjs --list           # list starfish voices and exit
//
// Flags: -o/--output (.wav → ffmpeg transcode; .mp3 → raw bytes), --words,
//   --voice (starfish id), --speed, --lang, --list.
// Requires: $HEYGEN_API_KEY (or ~/.heygen) and ffmpeg for .wav output.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { heygenAuthHeaders, heygenJSON, loadEnvFromDir } from "./lib/heygen.mjs";
import { ffprobeDuration, resolveVoiceId, synthesizeOne, withWordIds } from "./lib/tts.mjs";

const argv = process.argv.slice(2);
function flag(name, def) {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return def;
  if (i + 1 >= argv.length) return true;
  const v = argv[i + 1];
  return v.startsWith("--") ? true : v;
}
const die = (m) => {
  console.error(`✗ heygen-tts: ${m}`);
  process.exit(1);
};

// First arg that isn't a flag or the -o value is the text / .txt path.
const positional = (() => {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) i++;
      continue;
    }
    if (a === "-o") {
      i++;
      continue;
    }
    return a;
  }
  return null;
})();

const output = resolve(
  (typeof flag("output") === "string" && flag("output")) ||
    (argv.includes("-o") && argv[argv.indexOf("-o") + 1]) ||
    "narration.wav",
);
const wordsPath = typeof flag("words") === "string" ? resolve(flag("words")) : null;
const userVoice = typeof flag("voice") === "string" ? flag("voice") : null;
const speedRaw = typeof flag("speed") === "string" ? Number(flag("speed")) : 1.0;
const speed = isFinite(speedRaw) && speedRaw > 0 ? speedRaw : 1.0;
const lang = typeof flag("lang") === "string" ? flag("lang") : "en";
const listOnly = flag("list") === true;

loadEnvFromDir(process.cwd());
let authHeaders;
try {
  authHeaders = heygenAuthHeaders();
} catch (e) {
  die(e.message);
}

// ---------- --list ----------
if (listOnly) {
  const payload = await heygenJSON(`/voices?engine=starfish&type=public&limit=50`, {
    headers: authHeaders,
  });
  for (const v of payload.data ?? payload.voices ?? []) {
    console.log(`${v.voice_id}\t${v.name}\t${v.language ?? ""}`);
  }
  process.exit(0);
}

// ---------- resolve text + voice ----------
if (!positional) die("no text given. Pass a string or a .txt path, or use --list.");
const text =
  positional.endsWith(".txt") && existsSync(resolve(positional))
    ? readFileSync(resolve(positional), "utf8").trim()
    : positional;
if (!text) die("input text is empty");

const voiceId = await resolveVoiceId({ provider: "heygen", userVoice, lang });
if (!userVoice) console.error(`· using voice ${voiceId}`);

// ---------- synthesize (shared engine code) ----------
const { ok, words } = await synthesizeOne({
  provider: "heygen",
  text,
  voiceId,
  lang,
  speed,
  wavAbs: output,
  hyperframesDir: process.cwd(),
});
if (!ok) die("synthesis failed (HeyGen request/transcode error)");

let wordCount = 0;
if (wordsPath) {
  if (words && words.length) {
    mkdirSync(dirname(wordsPath), { recursive: true });
    writeFileSync(wordsPath, JSON.stringify(withWordIds(words), null, 2));
    wordCount = words.length;
  } else {
    console.error("⚠ no word_timestamps in response — run `hyperframes transcribe` instead");
  }
}

const dur = ffprobeDuration(output);
const durStr = isFinite(dur) ? ` (${dur.toFixed(2)}s)` : "";
console.log(`✓ ${output}${durStr}${wordCount ? ` · ${wordsPath} (${wordCount} words)` : ""}`);
