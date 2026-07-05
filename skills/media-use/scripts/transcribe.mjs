#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { mergeTokensToWords } from "./lib/parakeet-words.mjs";

// Higher-accuracy local transcription than whisper.cpp, using NVIDIA Parakeet
// TDT via parakeet-mlx (a top open-source ASR, Neural-Engine fast on Apple
// Silicon). Emits { text, words:[{text,start,end}] } with word timestamps
// (merged from Parakeet's sub-word tokens) so it feeds transcript-cut, captions,
// and the audio engine directly. When parakeet-mlx is not installed, it points
// at the packaged whisper.cpp path (`hyperframes transcribe`) instead.

const { values: args } = parseArgs({
  options: {
    input: { type: "string", short: "i" },
    out: { type: "string", short: "o" },
    model: { type: "string", default: "mlx-community/parakeet-tdt-0.6b-v3" },
    json: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
});

if (args.help) {
  console.log(`media-use transcribe: better-than-whisper local ASR (Parakeet)

Usage:
  node transcribe.mjs --input audio.wav [--out audio.transcribe.json]

Options:
  --input, -i   Audio/video file to transcribe (required)
  --out, -o     Output JSON (default: <input>.transcribe.json)
  --model       Parakeet HF model (default: mlx-community/parakeet-tdt-0.6b-v3)
  --json        Print the result JSON to stdout
  --help, -h    Show this help

Falls back to \`npx hyperframes transcribe\` (whisper.cpp) when parakeet-mlx is
not installed. Install: uv venv ~/.venvs/parakeet && VIRTUAL_ENV=~/.venvs/parakeet uv pip install parakeet-mlx`);
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

function hasParakeet() {
  try {
    execFileSync("parakeet-mlx", ["--help"], {
      stdio: ["ignore", "ignore", "ignore"],
      timeout: 15000,
    });
    return true;
  } catch {
    return false;
  }
}

if (!hasParakeet()) {
  const msg =
    "parakeet-mlx not installed. Higher-accuracy local ASR needs it: " +
    "`uv venv ~/.venvs/parakeet && VIRTUAL_ENV=~/.venvs/parakeet uv pip install parakeet-mlx`. " +
    "Falling back to whisper.cpp: `npx hyperframes transcribe <audio>`.";
  if (args.json)
    console.log(JSON.stringify({ ok: false, fallback: "hyperframes transcribe", error: msg }));
  else console.error(msg);
  process.exit(1);
}

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
  if (args.json)
    console.log(JSON.stringify({ ok: true, out: outPath, words: merged.words.length }));
  else
    console.log(
      `transcribed ${basename(inputPath)} -> ${outPath} (${merged.words.length} words, parakeet)`,
    );
} catch (err) {
  console.error(
    `error: transcription failed: ${err.stderr?.toString().trim().slice(-200) || err.message}`,
  );
  process.exit(1);
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
