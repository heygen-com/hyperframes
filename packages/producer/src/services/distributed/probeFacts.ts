import { writeFileSync } from "node:fs";
import { extname } from "node:path";
import { buildProbeFactsText } from "@hyperframes/engine";

const PROBE_FACTS_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv"]);

export function wantsProbeFacts(path: string): boolean {
  return PROBE_FACTS_EXTENSIONS.has(extname(path).toLowerCase());
}

/** `unavailable`: no ffprobe on this machine. `none`: the file cannot be probed. */
export type ProbeFactsOutcome = "built" | "none" | "unavailable";

export async function buildProbeFacts(
  inputPath: string,
  outputPath: string,
  signal?: AbortSignal,
): Promise<ProbeFactsOutcome> {
  try {
    writeFileSync(outputPath, await buildProbeFactsText(inputPath, signal));
    return "built";
  } catch (error) {
    if (signal?.aborted) throw error;
    return /ffprobe not found/i.test(String((error as Error).message)) ? "unavailable" : "none";
  }
}
