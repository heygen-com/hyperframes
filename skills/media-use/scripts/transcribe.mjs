#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { mergeTokensToWords } from "./lib/parakeet-words.mjs";

// The DEFAULT local transcription path. Prefers NVIDIA Parakeet-TDT via
// parakeet-mlx, which beats whisper.cpp on the Open ASR Leaderboard (~6.05% vs
// 7.44% avg WER, and 4.73% vs 5.96% on noisy test-other) and is 5-10x faster
// with native punctuation. Emits { text, words:[{text,start,end}] } (word
// timestamps merged from Parakeet's sub-word tokens) for transcript-cut /
// captions / the audio engine.
//
// Parakeet v3 covers English + 25 European languages. For other languages, or
// when parakeet-mlx is not installed, it falls back to the packaged whisper.cpp
// (`hyperframes transcribe`, 99 languages). `--engine` forces one.

const { values: args } = parseArgs({
  options: {
    input: { type: "string", short: "i" },
    out: { type: "string", short: "o" },
    engine: { type: "string", default: "auto" }, // auto | parakeet | whisper
    model: { type: "string", default: "mlx-community/parakeet-tdt-0.6b-v3" },
    json: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
});

if (args.help) {
  console.log(`media-use transcribe: better-than-whisper local ASR (Parakeet), whisper.cpp fallback

Usage:
  node transcribe.mjs --input audio.wav [--out audio.transcribe.json] [--engine auto|parakeet|whisper]

Parakeet (default) beats whisper.cpp on accuracy + speed for English/European
languages; whisper.cpp (99 languages) is the fallback. Install Parakeet once:
  uv venv ~/.venvs/parakeet && VIRTUAL_ENV=~/.venvs/parakeet uv pip install parakeet-mlx`);
  process.exit(0);
}

if (!args.input) {
  console.error("error: --input is required");
  process.exit(2);
}
const inputPath = resolve(args.input);
if (!existsSync(inputPath)) {
  console.error(`error: input not found: ${inputPath}`);
  process.exit(2);
}
const outPath = resolve(
  args.out || `${inputPath.slice(0, -extname(inputPath).length)}.transcribe.json`,
);

function hasBin(bin, probeArgs) {
  try {
    execFileSync(bin, probeArgs, { stdio: ["ignore", "ignore", "ignore"], timeout: 20000 });
    return true;
  } catch {
    return false;
  }
}

function report(engine, wordCount) {
  if (args.json) console.log(JSON.stringify({ ok: true, out: outPath, engine, words: wordCount }));
  else
    console.log(
      `transcribed ${basename(inputPath)} -> ${outPath}${wordCount != null ? ` (${wordCount} words,` : " ("}${engine})`,
    );
}

function runParakeet() {
  const workDir = mkdtempSync(join(tmpdir(), "media-use-asr-"));
  try {
    execFileSync(
      "parakeet-mlx",
      [inputPath, "--model", args.model, "--output-format", "json", "--output-dir", workDir],
      { stdio: ["ignore", "pipe", "pipe"], timeout: 1_800_000 },
    );
    const jsonPath = join(workDir, `${basename(inputPath, extname(inputPath))}.json`);
    if (!existsSync(jsonPath)) throw new Error("parakeet produced no JSON");
    const merged = mergeTokensToWords(JSON.parse(readFileSync(jsonPath, "utf8")));
    writeFileSync(outPath, JSON.stringify(merged, null, 2));
    report("parakeet", merged.words.length);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

// whisper.cpp via the packaged CLI: writes transcript.json into --dir; relocate to --out.
function runWhisper() {
  const workDir = mkdtempSync(join(tmpdir(), "media-use-whisper-"));
  try {
    execFileSync("npx", ["hyperframes", "transcribe", inputPath, "--dir", workDir], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 1_800_000,
    });
    const produced = join(workDir, "transcript.json");
    if (!existsSync(produced)) throw new Error("whisper produced no transcript.json");
    copyFileSync(produced, outPath);
    let words;
    try {
      const t = JSON.parse(readFileSync(outPath, "utf8"));
      words = Array.isArray(t?.words) ? t.words.length : undefined;
    } catch {
      /* leave undefined */
    }
    report("whisper", words);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

try {
  const parakeetOk = hasBin("parakeet-mlx", ["--help"]);
  const engine =
    args.engine === "parakeet" || args.engine === "whisper"
      ? args.engine
      : parakeetOk
        ? "parakeet"
        : "whisper";
  if (engine === "parakeet") {
    if (!parakeetOk) {
      throw new Error(
        "parakeet-mlx not installed. Install: uv venv ~/.venvs/parakeet && VIRTUAL_ENV=~/.venvs/parakeet uv pip install parakeet-mlx (or use --engine whisper)",
      );
    }
    runParakeet();
  } else {
    runWhisper();
  }
} catch (err) {
  if (args.json) console.log(JSON.stringify({ ok: false, error: err.message }));
  else console.error(`error: transcription failed: ${err.message}`);
  process.exit(1);
}
