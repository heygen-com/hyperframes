/**
 * Spawns the `hyperframes-vst carve` verb to analyze a voiceover WAV and
 * returns its recommended PeakFilter carve bands. Mirrors the engine's
 * `vstBounce.ts` spawn/error handling; DSP stays entirely in the GPL sidecar.
 */
import { spawn } from "node:child_process";
import { resolveVstHostCommand } from "./vstSidecar.js";

export interface CarveBand {
  freq: number;
  gainDb: number;
  q: number;
}

const CARVE_TIMEOUT_MS = 2 * 60 * 1000;

export function runCarve(
  voiceWavAbsPath: string,
  maxCutDb: number,
): Promise<{ bands: CarveBand[] }> {
  const parts = resolveVstHostCommand();
  const cmd = parts[0];
  if (!cmd) return Promise.reject(new Error("no VST host command resolved"));
  const args = [
    ...parts.slice(1),
    "carve",
    "--voice",
    voiceWavAbsPath,
    "--max-cut-db",
    String(maxCutDb),
    "--json",
  ];

  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("carve timed out"));
    }, CARVE_TIMEOUT_MS);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`VST sidecar could not be started: ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`carve failed (exit ${code}): ${stderr.trim()}`));
        return;
      }
      try {
        const parsed: unknown = JSON.parse(stdout);
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          Array.isArray((parsed as { bands?: unknown }).bands)
        ) {
          resolvePromise(parsed as { bands: CarveBand[] });
          return;
        }
        reject(new Error(`carve returned malformed JSON: ${stdout.trim()}`));
      } catch {
        reject(new Error(`carve returned invalid JSON: ${stdout.trim()}`));
      }
    });
  });
}
