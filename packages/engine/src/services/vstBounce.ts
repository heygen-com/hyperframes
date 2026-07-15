/**
 * VST Bounce Service
 *
 * Spawns the `hyperframes-vst` Python sidecar (packages/vst-host) to apply a
 * VST plugin chain to a dry WAV track before it's mixed into the composition.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { trackChildProcess } from "../utils/processTracker.js";

export interface ApplyVstChainOptions {
  signal?: AbortSignal;
}

// Plugin scanning + audio bounce through a DAW-grade chain can be slow,
// especially on first run (plugin validation) or with convolution reverbs.
const BOUNCE_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Resolves the command used to invoke the VST host sidecar.
 *
 * Precedence:
 * 1. `HF_VST_HOST_CMD` env var (space-split) — lets CI/dev machines point at
 *    an arbitrary executable (or, in tests, a fake shell script).
 * 2. `uv run --project <packages/vst-host> hyperframes-vst` when the
 *    monorepo's `packages/vst-host` directory is present relative to this
 *    package (the common case: a source checkout of hyperframes).
 * 3. Bare `hyperframes-vst` on PATH (an installed/published sidecar).
 */
export function resolveVstHostCommand(): string[] {
  const override = process.env.HF_VST_HOST_CMD;
  if (override && override.trim().length > 0) {
    return override.trim().split(/\s+/);
  }

  const servicesDir = fileURLToPath(new URL(".", import.meta.url));
  const monorepoVstHostDir = resolve(servicesDir, "../../../vst-host");
  if (existsSync(join(monorepoVstHostDir, "pyproject.toml"))) {
    return ["uv", "run", "--project", monorepoVstHostDir, "hyperframes-vst"];
  }

  return ["hyperframes-vst"];
}

/**
 * Applies a VST chain to a dry WAV track by spawning the sidecar's `bounce`
 * subcommand. Resolves with the path to the processed WAV on success.
 *
 * Rejects — never falls back to the unprocessed `wavPath` — when the sidecar
 * fails. A missing plugin (sidecar exit code 3 with `PLUGIN_MISSING <name>`
 * on stderr) is reported with the specific plugin name and track id so the
 * failure is actionable rather than a silent swap to dry audio.
 *
 * `options.signal`, when provided, kills the sidecar (SIGTERM) if aborted —
 * e.g. by `processCompositionAudio` when a sibling track's VST chain fails
 * and the whole render is about to be torn down, so this sidecar isn't left
 * running against a `workDir` that's about to be deleted.
 */
export function applyVstChainToWav(
  wavPath: string,
  chainAbsPath: string,
  workDir: string,
  trackId: string,
  options?: ApplyVstChainOptions,
): Promise<string> {
  const outputPath = join(workDir, `${basename(wavPath, ".wav")}_vst.wav`);
  const commandParts = resolveVstHostCommand();
  const cmd = commandParts[0];
  if (!cmd) {
    return Promise.reject(
      new Error(`VST render failed for track "${trackId}": no VST host command resolved`),
    );
  }
  const baseArgs = commandParts.slice(1);
  const args = [
    ...baseArgs,
    "bounce",
    "--input",
    wavPath,
    "--chain",
    chainAbsPath,
    "--output",
    outputPath,
  ];

  const signal = options?.signal;

  return new Promise<string>((resolvePromise, reject) => {
    const child = spawn(cmd, args);
    trackChildProcess(child);
    let stderr = "";
    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    const onAbort = () => {
      child.kill("SIGTERM");
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`VST render timed out for track "${trackId}"`));
    }, BOUNCE_TIMEOUT_MS);

    child.on("error", (err) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      reject(new Error(`VST sidecar could not be started for track "${trackId}": ${err.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      if (signal?.aborted) {
        reject(new Error(`VST render cancelled for track "${trackId}"`));
        return;
      }
      if (code === 0) {
        resolvePromise(outputPath);
        return;
      }
      const missing = stderr.match(/PLUGIN_MISSING (.+)/);
      const missingPlugin = missing ? missing[1] : undefined;
      if (code === 3 && missingPlugin) {
        reject(
          new Error(
            `VST render failed for track "${trackId}": plugin "${missingPlugin.trim()}" is not installed on this machine`,
          ),
        );
        return;
      }
      reject(
        new Error(`VST render failed for track "${trackId}" (exit ${code}): ${stderr.trim()}`),
      );
    });
  });
}
