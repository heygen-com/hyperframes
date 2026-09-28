#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  renameSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { parseArgs, stripVTControlCharacters } from "node:util";
import { mergeTokensToWords } from "./lib/parakeet-words.mjs";
import { track } from "./lib/telemetry.mjs";
import { resolveNpxInvocation } from "./lib/npx-sync.mjs";

// The DEFAULT local transcription path. Prefers NVIDIA Parakeet-TDT via
// parakeet-mlx, which beats whisper.cpp on the Open ASR Leaderboard (~6.05% vs
// 7.44% avg WER, and 4.73% vs 5.96% on noisy test-other) and is 5-10x faster
// with native punctuation. Emits { text, words:[{text,start,end}] } (word
// timestamps merged from Parakeet's sub-word tokens) for transcript-cut /
// captions / the audio engine.
//
// Parakeet v3 covers English + 25 European languages. For other languages, or
// when parakeet-mlx is not installed, it falls back to whisper.cpp via
// `hyperframes transcribe` (99 languages; the CLI resolves/builds whisper.cpp
// on first use — it is not bundled). `--engine` forces one.

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
  npx hyperframes models install parakeet   (macOS, Windows, Linux with glibc 2.32+)
  uv venv ~/.venvs/parakeet && VIRTUAL_ENV=~/.venvs/parakeet uv pip install parakeet-mlx   (Apple Silicon)`);
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

// Locate the parakeet-mlx runner the same way the CLI does: env override, then
// the documented ~/.venvs/parakeet install, then PATH. Checking the venv (not
// just PATH) is what keeps a user who followed the install docs verbatim from
// silently falling through to whisper. Returns the runner path, or null.
function resolveParakeet() {
  for (const p of [
    process.env.HYPERFRAMES_PARAKEET,
    join(homedir(), ".venvs", "parakeet", "bin", "parakeet-mlx"),
  ]) {
    if (p && existsSync(p)) return p;
  }
  try {
    execFileSync("parakeet-mlx", ["--help"], {
      stdio: ["ignore", "ignore", "ignore"],
      timeout: 20000,
    });
    return "parakeet-mlx";
  } catch {
    return null;
  }
}

// Write via a sibling temp + atomic rename so a SIGKILL mid-write can't leave a
// truncated transcript at outPath (downstream reads it as valid JSON).
function atomicWrite(target, data) {
  const tmp = `${target}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  renameSync(tmp, target);
}

function report(engine, wordCount) {
  if (args.json) console.log(JSON.stringify({ ok: true, out: outPath, engine, words: wordCount }));
  else
    console.log(
      `transcribed ${basename(inputPath)} -> ${outPath}${wordCount != null ? ` (${wordCount} words,` : " ("}${engine})`,
    );
}

function runParakeet(runner) {
  const workDir = mkdtempSync(join(tmpdir(), "media-use-asr-"));
  try {
    execFileSync(
      runner,
      [inputPath, "--model", args.model, "--output-format", "json", "--output-dir", workDir],
      { stdio: ["ignore", "pipe", "pipe"], timeout: 1_800_000 },
    );
    const jsonPath = join(workDir, `${basename(inputPath, extname(inputPath))}.json`);
    if (!existsSync(jsonPath)) throw new Error("parakeet produced no JSON");
    const merged = mergeTokensToWords(JSON.parse(readFileSync(jsonPath, "utf8")));
    atomicWrite(outPath, JSON.stringify(merged, null, 2));
    report("parakeet", merged.words.length);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

// The hyperframes CLI (its Parakeet, else whisper.cpp built on first use — see
// SKILL.md): writes transcript.json into --dir; relocate to --out.
function runCli(cliEngine) {
  const workDir = mkdtempSync(join(tmpdir(), "media-use-whisper-"));
  try {
    // On Windows a bare "npx" is npx.cmd, which execFileSync cannot exec
    // (spawnSync npx ENOENT) — resolveNpxInvocation reroutes it through
    // node + npx-cli.js (and throws actionably when it can't), same
    // mechanism as the audio engine's TTS spawns.
    // Under auto or parakeet the CLI may run its own Parakeet; --json says which engine ran.
    const resolved = resolveNpxInvocation(
      ["hyperframes", "transcribe", inputPath, "--dir", workDir, "--engine", cliEngine, "--json"],
      { stdio: ["ignore", "pipe", "pipe"], timeout: 1_800_000 },
    );
    let stdout;
    try {
      stdout = String(execFileSync(resolved.cmd, resolved.args, resolved.opts));
    } catch (e) {
      // stderr holds spinner redraws and --json prints the reason on stdout, so keep the last lines.
      const tail = stripVTControlCharacters(`${e.stderr ?? ""}\n${e.stdout ?? ""}`)
        .split(/[\r\n]+/)
        .map((l) => l.trim())
        .filter((l) => l && l !== "│")
        .slice(-3)
        .join("\n");
      throw new Error(
        `hyperframes transcribe failed (exit ${e.status ?? e.code})${tail ? `:\n${tail}` : ""}`,
      );
    }
    const produced = join(workDir, "transcript.json");
    if (!existsSync(produced))
      throw new Error("hyperframes transcribe produced no transcript.json");
    const tmp = `${outPath}.tmp-${process.pid}`;
    copyFileSync(produced, tmp);
    renameSync(tmp, outPath); // atomic publish
    let words;
    try {
      const t = JSON.parse(readFileSync(outPath, "utf8"));
      // The CLI writes a flat word array, not { words }.
      words = Array.isArray(t) ? t.length : undefined;
    } catch {
      /* leave undefined */
    }
    let ran = "whisper";
    try {
      ran = JSON.parse(stdout.trim().split("\n").at(-1)).engine === "parakeet" ? "parakeet" : ran;
    } catch {
      /* no JSON line: keep whisper */
    }
    report(ran, words);
    return ran;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

try {
  const parakeetBin = resolveParakeet();
  const asked = args.engine === "parakeet" || args.engine === "whisper" ? args.engine : "auto";
  // Without parakeet-mlx, the CLI's own Parakeet (any OS, `hyperframes models install parakeet`).
  let engine = "parakeet";
  if (asked !== "whisper" && parakeetBin) runParakeet(parakeetBin);
  else engine = runCli(asked);
  await track("media_use_transcribe", { engine });
} catch (err) {
  if (args.json) console.log(JSON.stringify({ ok: false, error: err.message }));
  else console.error(`error: transcription failed: ${err.message}`);
  process.exit(1);
}
