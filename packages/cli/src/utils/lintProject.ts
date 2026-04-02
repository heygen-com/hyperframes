import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, extname } from "node:path";
import { lintHyperframeHtml, type HyperframeLintResult } from "@hyperframes/core/lint";
import type { HyperframeLintFinding } from "@hyperframes/core/lint";
import type { ProjectDir } from "./project.js";

export interface ProjectLintResult {
  results: Array<{ file: string; result: HyperframeLintResult }>;
  totalErrors: number;
  totalWarnings: number;
  totalInfos: number;
}

const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".aac", ".ogg", ".m4a", ".flac", ".opus"]);

/**
 * Lint the root index.html and all sub-compositions in the compositions/ directory.
 * Returns aggregated results across all files.
 */
export function lintProject(project: ProjectDir): ProjectLintResult {
  const results: Array<{ file: string; result: HyperframeLintResult }> = [];
  let totalErrors = 0;
  let totalWarnings = 0;
  let totalInfos = 0;

  // Lint root composition
  const rootHtml = readFileSync(project.indexPath, "utf-8");
  const rootResult = lintHyperframeHtml(rootHtml, { filePath: project.indexPath });
  results.push({ file: "index.html", result: rootResult });
  totalErrors += rootResult.errorCount;
  totalWarnings += rootResult.warningCount;
  totalInfos += rootResult.infoCount;

  // Lint sub-compositions in compositions/ directory, collecting HTML for project-level checks
  const allHtmlSources = [rootHtml];
  const compositionsDir = resolve(project.dir, "compositions");
  if (existsSync(compositionsDir)) {
    const files = readdirSync(compositionsDir).filter((f) => f.endsWith(".html"));
    for (const file of files) {
      const filePath = join(compositionsDir, file);
      const html = readFileSync(filePath, "utf-8");
      allHtmlSources.push(html);
      const result = lintHyperframeHtml(html, { filePath });
      results.push({ file: `compositions/${file}`, result });
      totalErrors += result.errorCount;
      totalWarnings += result.warningCount;
      totalInfos += result.infoCount;
    }
  }

  // ── Project-level checks ──────────────────────────────────────────────

  const projectFindings = [
    ...lintProjectAudioFiles(project.dir, allHtmlSources),
    ...lintAudioSrcNotFound(project.dir, allHtmlSources),
  ];
  if (projectFindings.length > 0) {
    // Append project-level findings to the root index.html result
    for (const finding of projectFindings) {
      rootResult.findings.push(finding);
      if (finding.severity === "error") {
        rootResult.errorCount++;
        rootResult.ok = false;
        totalErrors++;
      } else if (finding.severity === "warning") {
        rootResult.warningCount++;
        totalWarnings++;
      } else {
        rootResult.infoCount++;
        totalInfos++;
      }
    }
  }

  return { results, totalErrors, totalWarnings, totalInfos };
}

/**
 * Check for audio files in the project directory that have no corresponding
 * <audio> element in any composition HTML. This catches the common mistake of
 * placing an audio file in the project but forgetting the <audio> tag, which
 * results in a silent render.
 */
function lintProjectAudioFiles(projectDir: string, htmlSources: string[]): HyperframeLintFinding[] {
  const findings: HyperframeLintFinding[] = [];

  // Scan project root for audio files (non-recursive — only top-level)
  let audioFiles: string[];
  try {
    audioFiles = readdirSync(projectDir).filter((f) =>
      AUDIO_EXTENSIONS.has(extname(f).toLowerCase()),
    );
  } catch {
    return findings;
  }

  if (audioFiles.length === 0) return findings;

  // Check if any HTML source contains an <audio> element
  const hasAudioElement = htmlSources.some((html) => /<audio\b/i.test(html));

  if (!hasAudioElement) {
    findings.push({
      code: "audio_file_without_element",
      severity: "warning",
      message: `Found audio file(s) in project (${audioFiles.join(", ")}) but no <audio> element in any composition. The rendered video will be silent.`,
      fixHint:
        'Add an <audio id="my-audio" src="' +
        audioFiles[0] +
        '" data-start="0" data-track-index="0" data-volume="1"></audio> element inside the composition root.',
    });
  }

  return findings;
}

/**
 * Check for <audio> elements whose src points to a file that doesn't exist
 * in the project directory. The renderer will silently skip missing audio,
 * producing a silent video with no indication of what went wrong.
 */
function lintAudioSrcNotFound(projectDir: string, htmlSources: string[]): HyperframeLintFinding[] {
  const findings: HyperframeLintFinding[] = [];

  const audioSrcRe = /<audio\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;

  const missingSrcs: string[] = [];
  for (const html of htmlSources) {
    let match: RegExpExecArray | null;
    while ((match = audioSrcRe.exec(html)) !== null) {
      const src = match[1]!;
      if (/^(https?:|data:|blob:)/i.test(src)) continue;
      if (/^__[A-Z_]+__$/.test(src)) continue; // Skip template placeholders
      const resolved = resolve(projectDir, src);
      if (!existsSync(resolved)) {
        missingSrcs.push(src);
      }
    }
  }

  if (missingSrcs.length > 0) {
    const unique = [...new Set(missingSrcs)];
    findings.push({
      code: "audio_src_not_found",
      severity: "error",
      message: `<audio> element references file(s) not found in the project: ${unique.join(", ")}. The rendered video will be silent.`,
      fixHint:
        unique.length === 1
          ? `Add the file "${unique[0]}" to the project directory, or update the src attribute to point to an existing file.`
          : `Add the missing files to the project directory, or update the src attributes to point to existing files.`,
    });
  }

  return findings;
}

/**
 * Determine whether a render should be blocked based on lint results and strict mode.
 * --strict blocks on errors; --strict-all blocks on errors or warnings.
 */
export function shouldBlockRender(
  strictErrors: boolean,
  strictAll: boolean,
  totalErrors: number,
  totalWarnings: number,
): boolean {
  return (strictErrors && totalErrors > 0) || (strictAll && (totalErrors > 0 || totalWarnings > 0));
}
