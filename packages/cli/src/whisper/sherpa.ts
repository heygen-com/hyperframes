import { execFile, spawn, type ExecFileException } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { downloadToFile } from "../cloud/download.js";
import { stoppedByCancelSignal } from "../utils/renderCancellation.js";
import {
  CACHE_DIR,
  PINNED_PACKAGES,
  pinnedPackageBesideCli,
  installedPackagePath,
  install,
  isInstalled,
  runNpm,
  sweepStaleStaging,
} from "../utils/optionalPackages.js";
import {
  mergeWindowsToWords,
  SHERPA_ERROR_PREFIX,
  SHERPA_RESULT_PREFIX,
  SHERPA_WINDOW_PREFIX,
  PARAKEET_MODEL_LABEL,
  writeParakeetTranscript,
  type SherpaWindow,
} from "./parakeet.js";
import { emitWords } from "./progress.js";
import {
  getPreparedWavDurationSeconds,
  prepareWav,
  type TranscribeProgress,
  type TranscribeResult,
} from "./transcribe.js";

const RUNTIME = "sherpa-onnx-node";
const RUNTIME_VERSION = PINNED_PACKAGES[RUNTIME];
/** Per platform and arch, like the native package inside, so Rosetta never shadows arm64. */
export const SHERPA_RUNTIME_DIR = join(
  CACHE_DIR,
  `${RUNTIME}@${RUNTIME_VERSION}-${process.platform}-${process.arch}`,
);

const MODEL_REPO = "csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8";
const MODEL_REVISION = "2bda32ec70b097a55adaa07d9a7173915b43cc78";
export const PARAKEET_MODEL_DIR = join(
  homedir(),
  ".cache",
  "hyperframes",
  "parakeet",
  "parakeet-tdt-0.6b-v3-int8",
);

export interface ModelFile {
  name: string;
  bytes: number;
  sha256: string;
}

/** Order matters: encoder, decoder, joiner, tokens (see recognizerConfig). */
const PARAKEET_MODEL_FILES: readonly ModelFile[] = [
  {
    name: "encoder.int8.onnx",
    bytes: 652_184_281,
    sha256: "acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247",
  },
  {
    name: "decoder.int8.onnx",
    bytes: 11_845_275,
    sha256: "179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e",
  },
  {
    name: "joiner.int8.onnx",
    bytes: 6_355_277,
    sha256: "3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3",
  },
  {
    name: "tokens.txt",
    bytes: 93_939,
    sha256: "d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d",
  },
];

/** At least 30 minutes, and twice the audio length for slow CPUs. */
const decodeTimeoutMs = (audioSeconds: number) => Math.max(1_800_000, audioSeconds * 2000);

/** The platforms sherpa-onnx-node publishes a native package for. */
const SUPPORTED_TARGETS = [
  "darwin-arm64",
  "darwin-x64",
  "linux-x64",
  "linux-arm64",
  "win32-x64",
  "win32-ia32",
];

interface Host {
  platform: string;
  arch: string;
  glibc?: string;
}

function currentHost(): Host {
  const report = process.report.getReport() as { header?: { glibcVersionRuntime?: string } };
  return {
    platform: process.platform,
    arch: process.arch,
    glibc: report.header?.glibcVersionRuntime,
  };
}

/** Why sherpa-onnx cannot run here, or null. Its Linux prebuilt needs glibc 2.32 (so no musl). */
export function sherpaUnsupportedReason(host: Host = currentHost()): string | null {
  const target = `${host.platform}-${host.arch}`;
  if (!SUPPORTED_TARGETS.includes(target)) {
    return `Parakeet runs on ${SUPPORTED_TARGETS.join(", ")}; this system is ${target}.`;
  }
  if (host.platform !== "linux") return null;
  if (!host.glibc) return "Parakeet needs glibc 2.32 or newer; this Linux has no glibc (musl?).";
  const [major = 0, minor = 0] = host.glibc.split(".").map(Number);
  if (major > 2 || (major === 2 && minor >= 32)) return null;
  return `Parakeet needs glibc 2.32 or newer; this system has glibc ${host.glibc}.`;
}

const nativePackageName = (platform: string, arch: string) =>
  `sherpa-onnx-${platform === "win32" ? "win" : platform}-${arch}`;

const LOAD_RUNTIME = `try {
  require(process.env.HF_SHERPA_RUNTIME_PATH);
} catch (e) {
  process.stderr.write(String(e && e.message).replace(/\\s+/g, " "));
  process.exitCode = 1;
}`;

/** Native bindings are probed only in a child, as they are loaded in the decode worker. */
function runtimeLoadError(
  runtimePath: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string | null> {
  if (signal?.aborted)
    return Promise.reject(new DecodeCancelled("Parakeet runtime check cancelled"));
  return new Promise((resolve, reject) => {
    const probe = spawn(process.execPath, ["-e", LOAD_RUNTIME], {
      env: { ...process.env, HF_SHERPA_RUNTIME_PATH: runtimePath },
      stdio: ["ignore", "ignore", "pipe"],
      timeout: timeoutMs,
      signal,
    });
    let stderr = "";
    probe.stderr.setEncoding("utf8");
    probe.stderr.on("data", (chunk: string) => {
      stderr = bounded(stderr + chunk);
    });
    probe.on("error", (error) => {
      if (signal?.aborted) reject(new DecodeCancelled("Parakeet runtime check cancelled"));
      else resolve(bounded(error.message));
    });
    probe.on("close", (code, childSignal) => {
      if (
        signal?.aborted ||
        stoppedByCancelSignal({ code, signal: childSignal, killed: probe.killed })
      ) {
        reject(new DecodeCancelled("Parakeet runtime check cancelled"));
        return;
      }
      if (code === 0 && !probe.killed) {
        resolve(null);
        return;
      }
      let reason: string;
      if (probe.killed) reason = `loading it timed out after ${timeoutMs / 1000} s`;
      else if (childSignal) reason = `loading it crashed (${childSignal})`;
      else reason = `it exited ${code} with no output`;
      resolve(bounded(stderr.trim() || reason));
    });
  });
}

type RuntimeSelection =
  | { status: "ready"; path: string }
  | { status: "unavailable"; error: string };

async function cachedRuntime(
  dir: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<RuntimeSelection> {
  let path: string | null;
  try {
    path = installedPackagePath(dir, RUNTIME);
  } catch (err) {
    return {
      status: "unavailable",
      error: bounded(err instanceof Error ? err.message : String(err)),
    };
  }
  if (path === null)
    return { status: "unavailable", error: `${RUNTIME} is not installed in ${dir}` };
  const error = await runtimeLoadError(path, timeoutMs, signal);
  return error === null ? { status: "ready", path } : { status: "unavailable", error };
}

async function selectRuntime(
  dir: string,
  cliUrl: string,
  timeoutMs = 60_000,
  signal?: AbortSignal,
): Promise<RuntimeSelection> {
  if (signal?.aborted) throw new DecodeCancelled("Parakeet runtime check cancelled");
  const copy = pinnedPackageBesideCli(RUNTIME, cliUrl);
  if (copy !== null) {
    const path = copy.path;
    const error = await runtimeLoadError(path, timeoutMs, signal);
    if (error === null) return { status: "ready", path };
    console.error(
      `Parakeet runtime at ${path.replace(/\s+/g, " ")} did not load: ${error.replace(/\s+/g, " ")}`,
    );
  }
  return cachedRuntime(dir, timeoutMs, signal);
}

/** Returns the load failure after checking the pinned copy beside the CLI, then its cache. */
export async function sherpaRuntimeLoadError(
  dir = SHERPA_RUNTIME_DIR,
  timeoutMs = 60_000,
  cliUrl = import.meta.url,
  signal?: AbortSignal,
): Promise<string | null> {
  const selected = await selectRuntime(dir, cliUrl, timeoutMs, signal);
  return selected.status === "ready" ? null : selected.error;
}

/** The native package, pinned too: the runtime's own optionalDependencies accept any 1.13.x. */
export function sherpaPlatformPackage(platform = process.platform, arch = process.arch): string {
  return `${nativePackageName(platform, arch)}@${RUNTIME_VERSION}`;
}

/** Installs if needed and returns the healthy entry selected for native child loading. */
export async function installSherpaRuntime({
  run = runNpm,
  signal,
  dir = SHERPA_RUNTIME_DIR,
  cliUrl = import.meta.url,
}: {
  run?: typeof runNpm;
  signal?: AbortSignal;
  dir?: string;
  cliUrl?: string;
} = {}): Promise<{ installed: boolean; runtimePath: string }> {
  const present = await selectRuntime(dir, cliUrl, 60_000, signal);
  if (present.status === "ready") return { installed: false, runtimePath: present.path };
  // install() keeps any dir holding the runtime manifest, so a broken one goes first.
  rmSync(dir, { recursive: true, force: true });
  const native = sherpaPlatformPackage();
  await install(dir, RUNTIME, RUNTIME_VERSION, (args) => run([...args, native], signal));
  const selected = await cachedRuntime(dir, 60_000, signal);
  if (selected.status === "unavailable") {
    throw new Error(
      `The sherpa-onnx runtime was reinstalled but still does not load (${selected.error}). Use --engine whisper for now.`,
    );
  }
  return { installed: true, runtimePath: selected.path };
}

/**
 * Model sizes only (install verified the hashes). The runtime counts once its manifest is there, even
 * if broken: transcribe must then fail with the repair, not quietly pick whisper.
 */
export function sherpaParakeetInstalled(cliUrl = import.meta.url): boolean {
  return (
    (pinnedPackageBesideCli(RUNTIME, cliUrl) !== null ||
      isInstalled(SHERPA_RUNTIME_DIR, RUNTIME)) &&
    PARAKEET_MODEL_FILES.every(
      (f) =>
        statSync(join(PARAKEET_MODEL_DIR, f.name), { throwIfNoEntry: false })?.size === f.bytes,
    )
  );
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function verifies(path: string, file: ModelFile): Promise<boolean> {
  if (statSync(path, { throwIfNoEntry: false })?.size !== file.bytes) return false;
  return (await sha256File(path)) === file.sha256;
}

interface EnsureModelOptions {
  dir?: string;
  files?: readonly ModelFile[];
  download?: typeof downloadToFile;
  onBytes?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

/**
 * Fetches each file that does not verify into a pid-named staging dir, checks size and sha256, then
 * renames it into place. False when all already verified.
 */
export async function ensureParakeetModel({
  dir = PARAKEET_MODEL_DIR,
  files = PARAKEET_MODEL_FILES,
  download = downloadToFile,
  onBytes,
  signal,
}: EnsureModelOptions = {}): Promise<boolean> {
  sweepStaleStaging(dir);
  const missing: ModelFile[] = [];
  for (const file of files) if (!(await verifies(join(dir, file.name), file))) missing.push(file);
  const total = missing.reduce((sum, f) => sum + f.bytes, 0);
  const staging = `${dir}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`;
  let done = 0;
  try {
    for (const file of missing) {
      signal?.throwIfAborted();
      const dest = join(dir, file.name);
      const temp = join(staging, file.name);
      rmSync(dest, { force: true });
      const url = `https://huggingface.co/${MODEL_REPO}/resolve/${MODEL_REVISION}/${file.name}`;
      await download(url, temp, {
        signal,
        onProgress: (bytes) => onBytes?.(done + bytes, total),
      }).catch((err: unknown) => {
        if (signal?.aborted) throw err;
        const why = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Could not download ${file.name} from huggingface.co (${why}). Check your network and re-run.`,
          { cause: err },
        );
      });
      if (!(await verifies(temp, file))) {
        throw new Error(
          `${file.name} did not match its pinned size and sha256, so it was discarded. Re-run to retry.`,
        );
      }
      mkdirSync(dir, { recursive: true });
      renameSync(temp, dest);
      done += file.bytes;
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  return missing.length > 0;
}

function recognizerConfig(): object {
  const [encoder, decoder, joiner, tokens] = PARAKEET_MODEL_FILES.map((f) =>
    join(PARAKEET_MODEL_DIR, f.name),
  );
  return {
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: { encoder, decoder, joiner },
      tokens,
      numThreads: 4,
      provider: "cpu",
      debug: 0,
      modelType: "nemo_transducer",
    },
    decodingMethod: "greedy_search",
  };
}

/** Ctrl-C or a SIGTERM stopped a Parakeet child: the user's cancel, never a reason to fall back. */
export class DecodeCancelled extends Error {}

const MAX_REASON_CHARS = 600;
const bounded = (why: string) =>
  why.length > MAX_REASON_CHARS ? `${why.slice(0, MAX_REASON_CHARS)}…` : why;

function failureReason(err: ExecFileException | null, stderr: string): string {
  const how = !err
    ? "exited without a result"
    : err.killed
      ? "was stopped (timeout or output limit)"
      : err.signal
        ? `crashed (${err.signal})`
        : `exited with code ${err.code}`;
  const lines = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const why =
    lines.find((line) => line.startsWith(SHERPA_ERROR_PREFIX))?.slice(SHERPA_ERROR_PREFIX.length) ??
    lines.at(-1);
  if (!why) return how;
  return `${how}: ${bounded(why)}`;
}

/** Decodes in a child process: onnxruntime aborts the whole process on some inputs, uncatchably. */
function decode(
  wavPath: string,
  runtimePath: string,
  signal: AbortSignal,
  onWindow?: (window: SherpaWindow, through: number) => void,
): Promise<SherpaWindow[]> {
  const sourceMode = import.meta.url.endsWith(".ts");
  const worker = new URL(sourceMode ? "./sherpaWorker.ts" : "./sherpaWorker.js", import.meta.url);
  const args = [...(sourceMode ? ["--import", "tsx"] : []), fileURLToPath(worker)];
  const input = { wavPath, runtimePath, config: recognizerConfig() };
  return new Promise((resolve, reject) => {
    const child = execFile(
      process.execPath,
      args,
      {
        env: { ...process.env, HYPERFRAMES_PARAKEET_INPUT: JSON.stringify(input) },
        maxBuffer: 256 * 1024 * 1024,
        timeout: decodeTimeoutMs(getPreparedWavDurationSeconds(wavPath) ?? 0),
        signal,
      },
      (err, stdout, stderr) => {
        if (signal.aborted || (err && stoppedByCancelSignal(err))) {
          reject(new DecodeCancelled("Transcription cancelled"));
          return;
        }
        const line = stdout.split("\n").find((l) => l.startsWith(SHERPA_RESULT_PREFIX));
        if (!err && line) resolve(JSON.parse(line.slice(SHERPA_RESULT_PREFIX.length)));
        else reject(new Error(`Parakeet decoder ${failureReason(err, stderr)}`));
      },
    );
    if (onWindow && child.stdout) {
      createInterface({ input: child.stdout }).on("line", (l) => {
        if (!l.startsWith(SHERPA_WINDOW_PREFIX)) return;
        let streamed: { window: SherpaWindow; through: number };
        try {
          streamed = JSON.parse(l.slice(SHERPA_WINDOW_PREFIX.length));
        } catch {
          return;
        }
        onWindow(streamed.window, streamed.through);
      });
    }
  });
}

/** Prepares the audio for Parakeet and its fallback alike; ffmpeg stopped by Ctrl-C is a cancel. */
export function prepareSherpaWav(
  inputPath: string,
  onProgress?: (message: string) => void,
): string {
  try {
    return prepareWav(inputPath, onProgress);
  } catch (err) {
    if ((err as { cancelled?: boolean }).cancelled) {
      throw new DecodeCancelled("Transcription cancelled");
    }
    throw err;
  }
}

/** The caller owns the cancellation scope: it must already cover audio preparation. */
export async function transcribeWithSherpa(
  wavPath: string,
  dir: string,
  options: {
    signal: AbortSignal;
    onProgress?: (message: string) => void;
    runtimeDir?: string;
    cliUrl?: string;
    onEvent?: (event: TranscribeProgress) => void;
  },
): Promise<TranscribeResult> {
  options.onProgress?.("Transcribing with Parakeet...");
  options.onEvent?.({
    type: "progress",
    phase: "transcription",
    model: PARAKEET_MODEL_LABEL,
    status: "started",
    durationSeconds: getPreparedWavDurationSeconds(wavPath),
  });
  if (options.signal.aborted) throw new DecodeCancelled("Transcription cancelled");
  const selected = await selectRuntime(
    options.runtimeDir ?? SHERPA_RUNTIME_DIR,
    options.cliUrl ?? import.meta.url,
    60_000,
    options.signal,
  );
  if (selected.status === "unavailable") {
    throw new Error(
      `Parakeet runtime does not load (${selected.error}). Run hyperframes models install parakeet to repair it, or use --engine whisper.`,
    );
  }
  const onEvent = options.onEvent;
  const windows = await decode(
    wavPath,
    selected.path,
    options.signal,
    onEvent &&
      ((window, through) =>
        emitWords(onEvent, PARAKEET_MODEL_LABEL, mergeWindowsToWords([window]), through)),
  );
  const result = writeParakeetTranscript(dir, mergeWindowsToWords(windows));
  options.onEvent?.({
    type: "progress",
    phase: "transcription",
    model: result.model,
    status: "completed",
  });
  return result;
}
