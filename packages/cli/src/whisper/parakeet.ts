/**
 * Parakeet-TDT transcription engine (via parakeet-mlx on Apple Silicon).
 *
 * The higher-accuracy alternative to the whisper.cpp engine: NVIDIA Parakeet
 * beats whisper-large-v3 on the Open ASR Leaderboard (~6.05% vs 7.44% avg WER,
 * and 4.73% vs 5.96% on noisy audio where whisper-v3 hallucinates), while being
 * 5-10x faster. Covers English + 25 European languages; whisper stays the
 * multilingual fallback.
 *
 * Like the Kokoro TTS path, this is a user-installed local model: we DETECT it
 * and, if absent, tell the user how to enable it (no auto-install). parakeet-mlx
 * emits sub-word TOKENS; we merge them into the word timestamps the rest of the
 * pipeline consumes.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import type { Word } from "./normalize.js";
import type { TranscribeResult } from "./transcribe.js";

const DEFAULT_MODEL = "mlx-community/parakeet-tdt-0.6b-v3";
const PARAKEET_INSTALL =
  "uv venv ~/.venvs/parakeet && VIRTUAL_ENV=~/.venvs/parakeet uv pip install parakeet-mlx";

/** Verify a candidate binary actually runs (mirrors the --version gate on
 *  HYPERFRAMES_PYTHON) so a stale $HYPERFRAMES_PARAKEET path can't shadow a
 *  working install on PATH. */
function isRunnable(bin: string): boolean {
  try {
    execFileSync(bin, ["--help"], { stdio: ["ignore", "ignore", "ignore"], timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

/** Locate the `parakeet-mlx` runner: env override, the documented venv, then PATH. */
export function findParakeet(): string | undefined {
  const candidates = [
    process.env.HYPERFRAMES_PARAKEET,
    join(homedir(), ".venvs", "parakeet", "bin", "parakeet-mlx"),
  ].filter((p): p is string => Boolean(p));

  for (const path of candidates) {
    if (existsSync(path) && isRunnable(path)) return path;
  }
  try {
    const which = process.platform === "win32" ? "where" : "which";
    const out = execFileSync(which, ["parakeet-mlx"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    });
    const first = out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean);
    if (first && existsSync(first)) return first;
  } catch {
    // not on PATH
  }
  return undefined;
}

interface ParakeetToken {
  text?: string;
  start?: number;
  end?: number;
}
interface ParakeetJson {
  text?: string;
  sentences?: { tokens?: ParakeetToken[] }[];
}

/**
 * Merge Parakeet's sub-word tokens (" H", "ello", ...) into words on the space
 * boundary: a token starting with a space (or the first token) begins a word;
 * the rest append. Produces the { text, start, end } words the pipeline uses.
 */
function tokenBounds(token: ParakeetToken): { text: string; start: number; end: number } {
  const text = typeof token.text === "string" ? token.text : "";
  const start = typeof token.start === "number" ? token.start : 0;
  const end = typeof token.end === "number" ? token.end : start;
  return { text, start, end };
}

export function mergeTokensToWords(parakeet: ParakeetJson): Word[] {
  const words: Word[] = [];
  for (const sentence of parakeet.sentences ?? []) {
    for (const token of sentence.tokens ?? []) {
      const { text, start, end } = tokenBounds(token);
      if (text.startsWith(" ") || words.length === 0) {
        words.push({ text: text.trim(), start, end });
      } else {
        const w = words[words.length - 1]!;
        w.text += text;
        w.end = end;
      }
    }
  }
  return words.filter((w) => w.text.length > 0);
}

interface ParakeetOptions {
  language?: string;
  model?: string;
  onProgress?: (message: string) => void;
}

/** Transcribe with Parakeet and write `transcript.json` (Word[]) into `dir`. */
export function transcribeWithParakeet(
  inputPath: string,
  dir: string,
  options?: ParakeetOptions,
): TranscribeResult {
  const runner = findParakeet();
  if (!runner) {
    throw new Error(
      `parakeet-mlx not found. Enable the Parakeet engine with:\n  ${PARAKEET_INSTALL}\n(or use --engine whisper)`,
    );
  }

  const model = options?.model ?? DEFAULT_MODEL;
  // First run pulls the model from HuggingFace (~600MB) — cue it so the wait
  // doesn't read as a hang. HF caches at ~/.cache/huggingface/hub/models--<slug>.
  const cached = existsSync(
    join(homedir(), ".cache", "huggingface", "hub", `models--${model.replace(/\//g, "--")}`),
  );
  options?.onProgress?.(
    cached ? "Transcribing with Parakeet..." : "Downloading Parakeet model (first run, ~600MB)...",
  );
  const workDir = mkdtempSync(join(tmpdir(), "hyperframes-parakeet-"));
  try {
    const argv = [inputPath, "--model", model, "--output-format", "json", "--output-dir", workDir];
    if (options?.language) argv.push("--language", options.language);
    execFileSync(runner, argv, { stdio: ["ignore", "pipe", "pipe"], timeout: 1_800_000 });

    const produced = join(workDir, `${basename(inputPath, extname(inputPath))}.json`);
    if (!existsSync(produced)) throw new Error("Parakeet did not produce output.");
    const words = mergeTokensToWords(JSON.parse(readFileSync(produced, "utf-8")) as ParakeetJson);

    const transcriptPath = join(dir, "transcript.json");
    writeFileSync(transcriptPath, JSON.stringify(words, null, 2));
    const durationSeconds = words.length > 0 ? words[words.length - 1]!.end : 0;
    return { transcriptPath, wordCount: words.length, durationSeconds, speechOnsetSeconds: null };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
