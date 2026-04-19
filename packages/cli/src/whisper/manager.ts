import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { downloadFile } from "../utils/download.js";

const MODELS_DIR = join(homedir(), ".cache", "hyperframes", "whisper", "models");
const DEFAULT_MODEL = "small.en";

export type WhisperSource = "env" | "system" | "brew" | "build";

export interface WhisperResult {
  executablePath: string;
  source: WhisperSource;
}

function getModelUrl(model: string): string {
  return `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${model}.bin`;
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
  for (const name of ["whisper-cli", "whisper"]) {
    const path = whichBinary(name);
    if (path) return { executablePath: path, source: "system" };
  }

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

function buildFromSource(onProgress?: (msg: string) => void): WhisperResult {
  // Clean stale builds — if BUILD_DIR exists but has no binary, nuke and re-clone
  if (existsSync(BUILD_DIR) && !findBuiltBinary()) {
    rmSync(BUILD_DIR, { recursive: true, force: true });
  }

  if (!existsSync(BUILD_DIR)) {
    onProgress?.("Downloading whisper.cpp...");
    mkdirSync(join(homedir(), ".cache", "hyperframes", "whisper"), {
      recursive: true,
    });
    execFileSync("git", ["clone", "--depth", "1", WHISPER_REPO, BUILD_DIR], {
      stdio: "ignore",
      timeout: 60_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
  }

  onProgress?.("Building whisper.cpp (this may take a minute)...");
  try {
    execFileSync("cmake", ["-B", "build"], {
      cwd: BUILD_DIR,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120_000,
    });
    execFileSync("cmake", ["--build", "build", "--config", "Release", "-j"], {
      cwd: BUILD_DIR,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 300_000,
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

export function getInstallInstructions(): string {
  if (platform() === "darwin") {
    return "brew install whisper-cpp";
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
  onProgress?: (msg: string) => void;
}): Promise<WhisperResult> {
  // 1. Already installed?
  const existing = findWhisper();
  if (existing) return existing;

  // 2. Try brew (macOS, fastest — pre-built bottle)
  if (platform() === "darwin" && hasBrew()) {
    options?.onProgress?.("Installing whisper-cpp via Homebrew...");
    try {
      execFileSync("brew", ["install", "whisper-cpp"], {
        stdio: "ignore",
        timeout: 300_000,
      });
      const installed = findFromSystem();
      if (installed) return { ...installed, source: "brew" };
    } catch {
      // brew failed — fall through
    }
  }

  // 3. Build from source (needs git + cmake + C compiler)
  if (hasGit() && hasCmake()) {
    try {
      return buildFromSource(options?.onProgress);
    } catch {
      // build failed — fall through
    }
  }

  // 4. Give up — tell the user how
  throw new Error(`whisper-cpp not found. Install: ${getInstallInstructions()}`);
}

export async function ensureModel(
  model: string = DEFAULT_MODEL,
  options?: { onProgress?: (message: string) => void },
): Promise<string> {
  const modelPath = join(MODELS_DIR, `ggml-${model}.bin`);
  if (existsSync(modelPath)) return modelPath;

  mkdirSync(MODELS_DIR, { recursive: true });

  options?.onProgress?.(`Downloading model ${model}...`);
  await downloadFile(getModelUrl(model), modelPath);

  if (!existsSync(modelPath)) {
    throw new Error(`Model download failed: ${model}`);
  }

  return modelPath;
}

export function hasFFmpeg(): boolean {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export { MODELS_DIR, DEFAULT_MODEL };
