// fallow-ignore-file code-duplication complexity
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { findFFmpeg } from "../browser/ffmpeg.js";
import { downloadFile } from "../utils/download.js";
import { stoppableExecFile } from "../utils/stoppableExecFile.js";
import { verifies, type ModelFile } from "./modelFile.js";

const MODELS_DIR = join(homedir(), ".cache", "hyperframes", "whisper", "models");
const DEFAULT_MODEL = "small.en";

export type WhisperSource = "env" | "system" | "brew" | "build";

export interface WhisperResult {
  executablePath: string;
  source: WhisperSource;
}

// A missing/uninstallable whisper-cpp is an environment prerequisite gap (no
// binary, no Homebrew, no compiler toolchain), not a transcription bug. Callers
// that treat captions as optional (init, skill pipelines) skip on this and keep
// going; explicit `transcribe` still fails, but it is reported as a setup
// condition rather than a command crash.
export class WhisperUnavailableError extends Error {
  readonly code = "WHISPER_UNAVAILABLE" as const;
  constructor(message: string) {
    super(message);
    this.name = "WhisperUnavailableError";
  }
}

export function isWhisperUnavailable(err: unknown): err is WhisperUnavailableError {
  if (err instanceof WhisperUnavailableError) return true;
  return err instanceof Error && "code" in err && err.code === "WHISPER_UNAVAILABLE";
}

const MODEL_REVISION = "5359861c739e955e79d9a303bcbc70fb988958b1";

function getModelUrl(model: string): string {
  return `https://huggingface.co/ggerganov/whisper.cpp/resolve/${MODEL_REVISION}/ggml-${model}.bin`;
}

const pinned = (model: string, bytes: number, sha256: string): [string, ModelFile] => [
  model,
  { name: `ggml-${model}.bin`, bytes, sha256 },
];

/** Sizes and sha256 at MODEL_REVISION; a model not listed here is used as downloaded. */
const PINNED_MODELS: ReadonlyMap<string, ModelFile> = new Map([
  pinned("tiny", 77_691_713, "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21"),
  pinned("tiny.en", 77_704_715, "921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f"),
  pinned("base", 147_951_465, "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe"),
  pinned(
    "base.en",
    147_964_211,
    "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002",
  ),
  pinned("small", 487_601_967, "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b"),
  pinned(
    "small.en",
    487_614_201,
    "c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d",
  ),
  pinned(
    "medium",
    1_533_763_059,
    "6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208",
  ),
  pinned(
    "medium.en",
    1_533_774_781,
    "cc37e93478338ec7700281a7ac30a10128929eb8f427dda2e865faa8f6da4356",
  ),
  pinned(
    "large-v1",
    3_094_623_691,
    "7d99f41a10525d0206bddadd86760181fa920438b6b33237e3118ff6c83bb53d",
  ),
  pinned(
    "large-v2",
    3_094_623_691,
    "9a423fe4d40c82774b6af34115b8b935f34152246eb19e80e376071d3f999487",
  ),
  pinned(
    "large-v3",
    3_095_033_483,
    "64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2",
  ),
  pinned(
    "large-v3-turbo",
    1_624_555_275,
    "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69",
  ),
]);

export function pinnedWhisperModel(model: string): ModelFile | undefined {
  return PINNED_MODELS.get(model);
}

// --- Find helpers -----------------------------------------------------------

function whichBinary(name: string): string | undefined {
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    const output = execFileSync(cmd, [name], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    });
    const first = output
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean);
    return first || undefined;
  } catch {
    return undefined;
  }
}

function findFromEnv(): WhisperResult | undefined {
  const envPath = process.env["HYPERFRAMES_WHISPER_PATH"];
  if (envPath && existsSync(envPath)) {
    return { executablePath: envPath, source: "env" };
  }
  return undefined;
}

function findFromSystem(): WhisperResult | undefined {
  // `whisper` is the OpenAI Python CLI; only whisper.cpp's binary accepts our flags.
  const path = whichBinary("whisper-cli");
  if (path) return { executablePath: path, source: "system" };

  // Check brew paths directly on macOS
  if (platform() === "darwin") {
    for (const p of ["/opt/homebrew/bin/whisper-cli", "/usr/local/bin/whisper-cli"]) {
      if (existsSync(p)) return { executablePath: p, source: "system" };
    }
  }

  return undefined;
}

// --- Build from source ------------------------------------------------------

const BUILD_DIR = join(homedir(), ".cache", "hyperframes", "whisper", "whisper.cpp");
const WHISPER_REPO = "https://github.com/ggml-org/whisper.cpp.git";

function findBuiltBinary(): WhisperResult | undefined {
  for (const p of [
    join(BUILD_DIR, "build", "bin", "whisper-cli"),
    join(BUILD_DIR, "build", "whisper-cli"),
  ]) {
    if (existsSync(p)) return { executablePath: p, source: "build" };
  }
  return undefined;
}

async function buildFromSource(
  onProgress?: (msg: string) => void,
  signal?: AbortSignal,
): Promise<WhisperResult> {
  // Clean stale builds — if BUILD_DIR exists but has no binary, nuke and re-clone
  if (existsSync(BUILD_DIR) && !findBuiltBinary()) {
    rmSync(BUILD_DIR, { recursive: true, force: true });
  }

  if (!existsSync(BUILD_DIR)) {
    onProgress?.("Downloading whisper.cpp...");
    mkdirSync(join(homedir(), ".cache", "hyperframes", "whisper"), {
      recursive: true,
    });
    await stoppableExecFile("git", ["clone", "--depth", "1", WHISPER_REPO, BUILD_DIR], {
      stdio: "ignore",
      timeout: 60_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      signal,
    });
  }

  onProgress?.("Building whisper.cpp (this may take a minute)...");
  try {
    await stoppableExecFile("cmake", ["-B", "build"], {
      cwd: BUILD_DIR,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120_000,
      signal,
    });
    await stoppableExecFile("cmake", ["--build", "build", "--config", "Release", "-j"], {
      cwd: BUILD_DIR,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 300_000,
      signal,
    });
  } catch (err: unknown) {
    // Build failed — capture diagnostics, then clean up so next attempt starts fresh
    let detail = "";
    if (err && typeof err === "object" && "stderr" in err) {
      const stderr = String(err.stderr).trim();
      if (stderr) detail = `\n${stderr.slice(-500)}`;
    }
    rmSync(BUILD_DIR, { recursive: true, force: true });
    throw new Error(
      `whisper-cpp build failed. Ensure cmake and a C compiler are installed.${detail}`,
    );
  }

  const result = findBuiltBinary();
  if (!result) throw new Error("Build completed but whisper-cli not found");
  return result;
}

// --- Public API -------------------------------------------------------------

export function findWhisper(): WhisperResult | undefined {
  return findFromEnv() ?? findFromSystem() ?? findBuiltBinary();
}

export function listWhisperModels(): { model: string; path: string }[] {
  if (!existsSync(MODELS_DIR)) return [];
  return readdirSync(MODELS_DIR)
    .flatMap((file) => {
      const model = /^ggml-(.+)\.bin$/.exec(file)?.[1];
      const path = join(MODELS_DIR, file);
      return model && existsSync(path) ? [{ model, path }] : [];
    })
    .sort((a, b) => a.model.localeCompare(b.model));
}

export function getInstallInstructions(): string {
  if (platform() === "darwin") {
    return "brew install whisper-cpp";
  }
  if (platform() === "linux") {
    return "Build from source: https://github.com/ggml-org/whisper.cpp#building (requires cmake and a C compiler)";
  }
  if (platform() === "win32") {
    return "Build with cmake: https://github.com/ggml-org/whisper.cpp#building";
  }
  return "See https://github.com/ggml-org/whisper.cpp#building";
}

function hasBrew(): boolean {
  return whichBinary("brew") !== undefined;
}

function hasGit(): boolean {
  return whichBinary("git") !== undefined;
}

function hasCmake(): boolean {
  return whichBinary("cmake") !== undefined;
}

export async function ensureWhisper(options?: {
  installRuntime?: boolean;
  onProgress?: (msg: string) => void;
  /** Aborting it stops an install in progress and rejects with the reason, trying nothing else. */
  signal?: AbortSignal;
}): Promise<WhisperResult> {
  const signal = options?.signal;
  // 1. Already installed?
  const existing = findWhisper();
  if (existing) return existing;
  if (options?.installRuntime === false) {
    throw new WhisperUnavailableError(
      "whisper-cpp not found; runtime installation is disabled by --no-runtime-install.",
    );
  }

  // 2. Try brew (macOS, fastest — pre-built bottle)
  if (platform() === "darwin" && hasBrew()) {
    options?.onProgress?.("Installing whisper-cpp via Homebrew...");
    try {
      await stoppableExecFile("brew", ["install", "whisper-cpp"], {
        stdio: "ignore",
        timeout: 300_000,
        signal,
      });
      const installed = findFromSystem();
      if (installed) return { ...installed, source: "brew" };
    } catch {
      // brew failed — fall through
    }
    signal?.throwIfAborted();
  }

  // 3. Build from source (needs git + cmake + C compiler)
  if (hasGit() && hasCmake()) {
    try {
      return await buildFromSource(options?.onProgress, signal);
    } catch {
      // build failed — fall through
    }
    signal?.throwIfAborted();
  }

  // 4. Give up — tell the user how
  throw new WhisperUnavailableError(`whisper-cpp not found. Install: ${getInstallInstructions()}`);
}

export async function ensureModel(
  model: string = DEFAULT_MODEL,
  options?: {
    signal?: AbortSignal;
    onProgress?: (message: string) => void;
    onDownloadProgress?: (receivedBytes: number, totalBytes: number | null) => void;
  },
): Promise<string> {
  const modelPath = join(MODELS_DIR, `ggml-${model}.bin`);
  const pin = PINNED_MODELS.get(model);
  const cachedBytes = statSync(modelPath, { throwIfNoEntry: false })?.size;
  if (cachedBytes !== undefined && (!pin || cachedBytes === pin.bytes)) return modelPath;

  mkdirSync(MODELS_DIR, { recursive: true });
  rmSync(modelPath, { force: true });
  options?.onProgress?.(
    cachedBytes === undefined
      ? `Downloading model ${model}...`
      : `Model ${model} is incomplete; downloading it again...`,
  );
  await downloadFile(getModelUrl(model), modelPath, {
    signal: options?.signal,
    onProgress: options?.onDownloadProgress,
    verify: async (path) => {
      if (pin && !(await verifies(path, pin))) {
        throw new Error(
          `${pin.name} did not match its pinned size and sha256, so it was discarded. Re-run to retry.`,
        );
      }
    },
  });
  return modelPath;
}

export function hasFFmpeg(): boolean {
  return findFFmpeg() !== undefined;
}

export { MODELS_DIR, DEFAULT_MODEL };
