import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { lintProject } from "@hyperframes/lint";
import {
  AUDIO_META_FILE,
  narrationTimingsOf,
  type NarrationManifest,
} from "@hyperframes/parsers/narration";
import { readManifest } from "./project.js";

export interface NarrationFinding {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  fixHint?: string;
  line?: string;
}

export interface NarrationLineStatus {
  id: string;
  text: string;
  audio: string;
  /** The voice's length from audio_meta.json; null when it doesn't record the line. */
  durationSeconds: number | null;
  /** The narration finding codes on this line; empty when it is in sync. */
  problems: string[];
}

/** The project's narration findings, from the same lint pass `hyperframes lint` runs. */
async function narrationFindings(projectDir: string): Promise<NarrationFinding[]> {
  const { results } = await lintProject(projectDir);
  return results
    .flatMap((entry) => entry.result.findings)
    .filter((finding) => finding.code.startsWith("narration_"))
    .map((finding) => {
      const line = /Narration line (\S+?)[:\s]/.exec(finding.message)?.[1];
      return {
        code: finding.code,
        severity: finding.severity,
        message: finding.message,
        ...(finding.fixHint && { fixHint: finding.fixHint }),
        ...(line && { line }),
      };
    });
}

export async function narrationStatus(projectDir: string): Promise<{
  manifest: NarrationManifest;
  lines: NarrationLineStatus[];
  findings: NarrationFinding[];
}> {
  const manifest = readManifest(projectDir);
  const findings = await narrationFindings(projectDir);
  const metaPath = join(projectDir, AUDIO_META_FILE);
  const timings = existsSync(metaPath) ? narrationTimingsOf(readFileSync(metaPath, "utf8")) : null;
  const lines = manifest.lines.map((line) => ({
    id: line.id,
    text: line.text,
    audio: line.audio,
    durationSeconds: timings?.get(line.id)?.durationSeconds ?? null,
    problems: findings.filter((finding) => finding.line === line.id).map((finding) => finding.code),
  }));
  return { manifest, lines, findings };
}
