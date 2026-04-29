import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve, extname } from "node:path";
import { lintHyperframeHtml, type HyperframeLintResult } from "@hyperframes/core/lint";
import type { HyperframeLintFinding } from "@hyperframes/core/lint";
import { rewriteAssetPath } from "@hyperframes/core";
import type { ProjectDir } from "./project.js";

/**
 * An HTML source paired with the sub-composition path it came from, if any.
 * Sub-composition relative paths (`../assets/foo.mp3`) need to be resolved
 * against the sub-composition's directory before checking the filesystem —
 * the root index.html is the only source where a bare `resolve(projectDir, src)`
 * is correct.
 */
interface HtmlSource {
  html: string;
  /** `data-composition-src` value (e.g. "compositions/scene.html"); undefined for the root. */
  compSrcPath?: string;
}

export interface ProjectLintResult {
  results: Array<{ file: string; result: HyperframeLintResult }>;
  totalErrors: number;
  totalWarnings: number;
  totalInfos: number;
}

const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".aac", ".ogg", ".m4a", ".flac", ".opus"]);

function isLocalStylesheetHref(href: string): boolean {
  return !!href && !/^(https?:|data:|blob:|\/\/)/i.test(href);
}

function collectExternalStyles(
  projectDir: string,
  html: string,
  compSrcPath?: string,
): Array<{ href: string; content: string }> {
  const styles: Array<{ href: string; content: string }> = [];
  const linkRe = /<link\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(html)) !== null) {
    const tag = match[0];
    const rel = tag.match(/\brel\s*=\s*["']([^"']+)["']/i)?.[1] ?? "";
    if (!rel.split(/\s+/).some((part) => part.toLowerCase() === "stylesheet")) continue;
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1] ?? "";
    if (!isLocalStylesheetHref(href)) continue;
    const rootRelative = compSrcPath ? join(dirname(compSrcPath), href) : href;
    const resolved = resolve(projectDir, rootRelative);
    if (!existsSync(resolved)) continue;
    styles.push({ href, content: readFileSync(resolved, "utf-8") });
  }
  return styles;
}

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
  const rootResult = lintHyperframeHtml(rootHtml, {
    filePath: project.indexPath,
    externalStyles: collectExternalStyles(project.dir, rootHtml),
  });
  results.push({ file: "index.html", result: rootResult });
  totalErrors += rootResult.errorCount;
  totalWarnings += rootResult.warningCount;
  totalInfos += rootResult.infoCount;

  // Lint sub-compositions in compositions/ directory, collecting HTML for project-level checks
  const allHtmlSources: HtmlSource[] = [{ html: rootHtml }];
  const compositionsDir = resolve(project.dir, "compositions");
  if (existsSync(compositionsDir)) {
    const files = readdirSync(compositionsDir).filter((f) => f.endsWith(".html"));
    for (const file of files) {
      const filePath = join(compositionsDir, file);
      const html = readFileSync(filePath, "utf-8");
      const compSrcPath = `compositions/${file}`;
      allHtmlSources.push({ html, compSrcPath });
      const result = lintHyperframeHtml(html, {
        filePath,
        isSubComposition: true,
        externalStyles: collectExternalStyles(project.dir, html, compSrcPath),
      });
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
    ...lintMultipleRootCompositions(project.dir),
    ...lintDuplicateAudioTracks(allHtmlSources),
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
function lintProjectAudioFiles(
  projectDir: string,
  htmlSources: HtmlSource[],
): HyperframeLintFinding[] {
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
  const hasAudioElement = htmlSources.some(({ html }) => /<audio\b/i.test(html));

  if (!hasAudioElement) {
    findings.push({
      code: "audio_file_without_element",
      severity: "warning",
      message: `Found audio file(s) in project (${audioFiles.join(", ")}) but no <audio> element in any composition. The rendered video will be silent.`,
      fixHint:
        'Add an <audio id="my-audio" src="' +
        audioFiles[0] +
        '" data-start="0" data-duration="__DURATION__" data-track-index="0" data-volume="1"></audio> element inside the composition root. Replace __DURATION__ with the audio length in seconds.',
    });
  }

  return findings;
}

/**
 * Check for <audio> elements whose src points to a file that doesn't exist
 * in the project directory. The renderer will silently skip missing audio,
 * producing a silent video with no indication of what went wrong.
 */
function lintAudioSrcNotFound(
  projectDir: string,
  htmlSources: HtmlSource[],
): HyperframeLintFinding[] {
  const findings: HyperframeLintFinding[] = [];

  const audioSrcRe = /<audio\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;

  const missingSrcs: string[] = [];
  for (const { html, compSrcPath } of htmlSources) {
    let match: RegExpExecArray | null;
    while ((match = audioSrcRe.exec(html)) !== null) {
      const src = match[1]!;
      if (/^(https?:|data:|blob:)/i.test(src)) continue;
      if (/^__[A-Z_]+__$/.test(src)) continue; // Skip template placeholders
      // Sub-composition srcs are written relative to the sub-composition file
      // (e.g. "../assets/foo.mp3"); the bundler rewrites them to root-relative
      // before serving. Mirror that rewrite here so the existence check sees
      // the same path the renderer will. Root-html srcs pass through unchanged.
      const rootRelative = compSrcPath ? rewriteAssetPath(compSrcPath, src) : src;
      const resolved = resolve(projectDir, rootRelative);
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
 * Error if multiple root-level HTML files with data-composition-id exist.
 * Scans the project directory filesystem (not just what lintProject chose to read)
 * to catch stray scaffold files, duplicates, or backup copies.
 */
function lintMultipleRootCompositions(projectDir: string): HyperframeLintFinding[] {
  const findings: HyperframeLintFinding[] = [];
  try {
    const rootHtmlFiles = readdirSync(projectDir).filter((f) => f.endsWith(".html"));
    const rootCompositions: string[] = [];
    for (const file of rootHtmlFiles) {
      const content = readFileSync(join(projectDir, file), "utf-8");
      if (/data-composition-id/i.test(content)) {
        rootCompositions.push(file);
      }
    }
    if (rootCompositions.length > 1) {
      findings.push({
        code: "multiple_root_compositions",
        severity: "error",
        message: `Multiple root-level HTML files with data-composition-id: ${rootCompositions.join(", ")}. The runtime may discover both as entry points, causing duplicate audio playback.`,
        fixHint:
          "A project should have exactly one root index.html with data-composition-id. Remove or rename extra files.",
      });
    }
  } catch {
    /* directory read failed — skip */
  }
  return findings;
}

/**
 * Warn if multiple <audio> elements on the same data-track-index overlap in time.
 * Extracts each attribute independently (order-insensitive) to handle any HTML attribute order.
 * Deduplicates by (src, start, duration) to avoid flagging the same audio reached via sub-compositions.
 */
function lintDuplicateAudioTracks(htmlSources: HtmlSource[]): HyperframeLintFinding[] {
  const findings: HyperframeLintFinding[] = [];
  function extractAttr(tag: string, name: string): string | null {
    const re = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i");
    const m = tag.match(re);
    return m?.[1] ?? null;
  }

  const tracks: Array<{ trackIndex: number; start: number; end: number; src: string }> = [];
  const seen = new Set<string>();

  for (const { html } of htmlSources) {
    // Regex with g flag must be created inside the loop — a shared g-regex
    // carries lastIndex across strings, silently skipping matches.
    const audioTagRe = /<audio\b[^>]*>/gi;
    let match: RegExpExecArray | null;
    while ((match = audioTagRe.exec(html)) !== null) {
      const tag = match[0];
      const trackStr = extractAttr(tag, "data-track-index");
      const startStr = extractAttr(tag, "data-start");
      const durStr = extractAttr(tag, "data-duration");
      const src = extractAttr(tag, "src") ?? "unknown";
      if (!trackStr || !startStr) continue;

      const trackIndex = parseInt(trackStr, 10);
      const start = parseFloat(startStr);
      // Runtime falls back to Infinity when data-duration is absent (plays full track).
      // Mirror that here so audio without explicit duration still participates in overlap checks.
      const duration = durStr ? parseFloat(durStr) : Infinity;
      // Deduplicate: same audio reached from multiple HTML sources
      const key = `${src}:${start}:${duration}:${trackIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);

      tracks.push({ trackIndex, start, end: start + duration, src });
    }
  }

  for (let i = 0; i < tracks.length; i++) {
    for (let j = i + 1; j < tracks.length; j++) {
      const a = tracks[i]!;
      const b = tracks[j]!;
      if (a.trackIndex !== b.trackIndex) continue;
      if (a.start < b.end && b.start < a.end) {
        findings.push({
          code: "duplicate_audio_track",
          severity: "warning",
          message: `Multiple <audio> elements on track ${a.trackIndex} overlap (${a.src} at ${a.start}-${Number.isFinite(a.end) ? a.end.toFixed(1) : "end"}s, ${b.src} at ${b.start}-${Number.isFinite(b.end) ? b.end.toFixed(1) : "end"}s). This causes layered audio playback.`,
          fixHint: "Use non-overlapping time windows or different track indices.",
        });
      }
    }
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
