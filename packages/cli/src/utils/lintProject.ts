import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, isAbsolute, join, posix, relative, resolve } from "node:path";
import { lintHyperframeHtml, type HyperframeLintResult } from "@hyperframes/core/lint";
import type { HyperframeLintFinding } from "@hyperframes/core/lint";
import { decodeUrlPathVariants, rewriteAssetPath } from "@hyperframes/core";
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

interface CssSource {
  content: string;
  /** Root-relative path to the CSS file. Undefined means inline HTML CSS. */
  rootRelativePath?: string;
}

export interface ProjectLintResult {
  results: Array<{ file: string; result: HyperframeLintResult }>;
  totalErrors: number;
  totalWarnings: number;
  totalInfos: number;
}

const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".aac", ".ogg", ".m4a", ".flac", ".opus"]);
const STYLE_BLOCK_RE = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
const OPEN_TAG_RE = /<([a-z][\w:-]*)(\s[^<>]*?)?>/gi;
const MASK_IMAGE_URL_RE =
  /\b(?:-webkit-)?mask-image\s*:\s*[^;{}]*url\(\s*(?:"([^"]+)"|'([^']+)'|([^"')\s]+))\s*\)/gi;

function readHtmlAttr(tag: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(new RegExp(`\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return match?.[1] ?? match?.[2] ?? null;
}

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
    const stylesheet = resolveExistingLocalAsset(projectDir, rootRelative);
    if (!stylesheet) continue;
    styles.push({ href, content: readFileSync(stylesheet.resolved, "utf-8") });
  }
  return styles;
}

function collectCssSources(projectDir: string, html: string, compSrcPath?: string): CssSource[] {
  const sources: CssSource[] = [];

  let styleMatch: RegExpExecArray | null;
  const stylePattern = new RegExp(STYLE_BLOCK_RE.source, STYLE_BLOCK_RE.flags);
  while ((styleMatch = stylePattern.exec(html)) !== null) {
    sources.push({ content: styleMatch[1] ?? "" });
  }

  const linkRe = /<link\b[^>]*>/gi;
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = linkRe.exec(html)) !== null) {
    const tag = linkMatch[0];
    const rel = readHtmlAttr(tag, "rel") ?? "";
    if (!rel.split(/\s+/).some((part) => part.toLowerCase() === "stylesheet")) continue;
    const href = readHtmlAttr(tag, "href") ?? "";
    if (!isLocalStylesheetHref(href)) continue;

    const rootRelativePath = compSrcPath ? join(dirname(compSrcPath), href) : href;
    const stylesheet = resolveExistingLocalAsset(projectDir, rootRelativePath);
    if (!stylesheet) continue;
    sources.push({
      content: readFileSync(stylesheet.resolved, "utf-8"),
      rootRelativePath: stylesheet.rootRelativePath,
    });
  }

  let tagMatch: RegExpExecArray | null;
  const tagPattern = new RegExp(OPEN_TAG_RE.source, OPEN_TAG_RE.flags);
  while ((tagMatch = tagPattern.exec(html)) !== null) {
    const tag = tagMatch[0];
    const style = readHtmlAttr(tag, "style");
    if (!style) continue;
    sources.push({ content: style });
  }

  return sources;
}

function isRemoteOrInlineUrl(url: string): boolean {
  return /^(https?:|data:|blob:|\/\/|#)/i.test(url);
}

function cleanAssetUrl(url: string): string {
  return url.trim().split(/[?#]/, 1)[0] ?? "";
}

function isWithinProjectRoot(projectDir: string, candidate: string): boolean {
  const projectRoot = resolve(projectDir);
  const relativePath = relative(projectRoot, candidate);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function addCandidate(candidates: string[], candidate: string): void {
  if (!candidates.includes(candidate)) candidates.push(candidate);
}

function resolveLocalAssetCandidates(projectDir: string, url: string): string[] {
  const cleanUrl = cleanAssetUrl(url);
  const projectRoot = resolve(projectDir);
  const candidates: string[] = [];

  for (const variant of decodeUrlPathVariants(cleanUrl)) {
    const projectRelative = variant.startsWith("/") ? variant.slice(1) : variant;
    const resolved = resolve(projectRoot, projectRelative);
    if (isWithinProjectRoot(projectRoot, resolved)) {
      addCandidate(candidates, resolved);
      continue;
    }

    const normalized = posix.normalize(projectRelative.replace(/\\/g, "/"));
    const clamped = normalized.replace(/^(\.\.\/)+/, "");
    if (clamped && !clamped.startsWith("..")) {
      addCandidate(candidates, resolve(projectRoot, clamped));
    }
  }

  return candidates;
}

function resolveExistingLocalAsset(
  projectDir: string,
  url: string,
): { resolved: string; rootRelativePath: string } | null {
  const projectRoot = resolve(projectDir);
  const resolved = resolveLocalAssetCandidates(projectRoot, url).find(existsSync);
  if (!resolved) return null;
  return { resolved, rootRelativePath: relative(projectRoot, resolved) };
}

function resolveCssAssetCandidates(
  projectDir: string,
  url: string,
  htmlCompSrcPath?: string,
  cssRootRelativePath?: string,
): string[] {
  if (url.startsWith("/")) return resolveLocalAssetCandidates(projectDir, url);
  if (cssRootRelativePath) {
    return resolveLocalAssetCandidates(projectDir, join(dirname(cssRootRelativePath), url));
  }
  if (htmlCompSrcPath) {
    return resolveLocalAssetCandidates(projectDir, rewriteAssetPath(htmlCompSrcPath, url));
  }
  return resolveLocalAssetCandidates(projectDir, url);
}

/**
 * Lint the root index.html and all sub-compositions in the compositions/ directory.
 * Returns aggregated results across all files.
 */
export async function lintProject(project: ProjectDir): Promise<ProjectLintResult> {
  const results: Array<{ file: string; result: HyperframeLintResult }> = [];
  let totalErrors = 0;
  let totalWarnings = 0;
  let totalInfos = 0;

  // Lint root composition
  const rootHtml = readFileSync(project.indexPath, "utf-8");
  const rootResult = await lintHyperframeHtml(rootHtml, {
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
    // Recurse: per-frame compositions live in nested dirs (e.g. compositions/frames/*.html).
    // A non-recursive readdir silently skipped them, so sub-composition rules never ran on
    // the frames that make up the video. Walk the whole tree; keep posix-style src paths.
    const collectHtmlFiles = (dir: string, rel: string): string[] => {
      const out: string[] = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const relPath = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) out.push(...collectHtmlFiles(join(dir, entry.name), relPath));
        else if (entry.isFile() && entry.name.endsWith(".html")) out.push(relPath);
      }
      return out;
    };
    const files = collectHtmlFiles(compositionsDir, "").sort();
    for (const file of files) {
      const filePath = join(compositionsDir, file);
      const html = readFileSync(filePath, "utf-8");
      const compSrcPath = `compositions/${file}`;
      allHtmlSources.push({ html, compSrcPath });
      const result = await lintHyperframeHtml(html, {
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
    ...lintMissingLocalAsset(project.dir, allHtmlSources),
    ...lintTextureMaskAssetNotFound(project.dir, allHtmlSources),
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
      if (!resolveLocalAssetCandidates(projectDir, rootRelative).some(existsSync)) {
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

// Same-length whitespace preserves offsets.
function maskRange(src: string, pattern: RegExp): string {
  return src.replace(pattern, (m) => " ".repeat(m.length));
}

// Closing tags allow junk before `>` (`</script foo>` is valid HTML); use `[^>]*` to mask permissively.
function maskNonScannableRanges(html: string): string {
  let out = maskRange(html, /<!--[\s\S]*?-->/g);
  out = maskRange(out, /<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi);
  out = maskRange(out, /<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi);
  return out;
}

// <audio> is handled by lintAudioSrcNotFound — its "silent video" message is tailored.
// fallow-ignore-next-line complexity
function lintMissingLocalAsset(
  projectDir: string,
  htmlSources: HtmlSource[],
): HyperframeLintFinding[] {
  const findings: HyperframeLintFinding[] = [];

  const localAssetSrcRe = /<(video|img|source)\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;

  // Dedup by resolved path: same missing file from root + sub-comp → ONE finding.
  const missingByTag = new Map<string, Map<string, string>>();

  for (const { html, compSrcPath } of htmlSources) {
    const scannable = maskNonScannableRanges(html);
    const re = new RegExp(localAssetSrcRe.source, localAssetSrcRe.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(scannable)) !== null) {
      const tagName = (match[1] ?? "").toLowerCase();
      const rawSrc = match[2] ?? "";
      const src = cleanAssetUrl(rawSrc);
      if (!src) continue;
      if (isRemoteOrInlineUrl(src)) continue;
      if (/^__[A-Z_]+__$/.test(src)) continue; // template placeholder
      const rootRelative = compSrcPath ? rewriteAssetPath(compSrcPath, src) : src;
      // resolveExistingLocalAsset matches the bundler's notion of "resolves" (handles root-absolute, rejects escapes).
      const resolvedAsset = resolveExistingLocalAsset(projectDir, rootRelative);
      if (resolvedAsset) continue;

      const resolvedKey = resolve(projectDir, rootRelative);
      let bucket = missingByTag.get(tagName);
      if (!bucket) {
        bucket = new Map<string, string>();
        missingByTag.set(tagName, bucket);
      }
      if (!bucket.has(resolvedKey)) bucket.set(resolvedKey, src);
    }
  }

  for (const [tagName, byResolved] of missingByTag) {
    const unique = [...byResolved.values()];
    findings.push({
      code: "missing_local_asset",
      severity: "error",
      message:
        `<${tagName}> element references local file(s) not found in the project: ${unique.join(", ")}. ` +
        "The renderer will silently skip these and produce a video with missing visuals.",
      fixHint:
        unique.length === 1
          ? `Add "${unique[0]}" to the project directory, or update the src attribute to point to an existing file. ` +
            "Common cause: captured asset filenames are unreliable (heygen-logo.svg often contains Google, nvidia-logo.svg may contain Autodesk, etc.). " +
            "Open the contact sheets and verify the file actually exists at this path before referencing it."
          : "Add the missing files to the project directory, or update the src attributes to point to existing files. " +
            "Captured asset filenames are unreliable — verify against capture/contact-sheets/ and capture/extracted/asset-descriptions.md.",
    });
  }

  return findings;
}

function lintTextureMaskAssetNotFound(
  projectDir: string,
  htmlSources: HtmlSource[],
): HyperframeLintFinding[] {
  const missing = new Map<string, string>();

  for (const { html, compSrcPath } of htmlSources) {
    for (const cssSource of collectCssSources(projectDir, html, compSrcPath)) {
      let match: RegExpExecArray | null;
      const pattern = new RegExp(MASK_IMAGE_URL_RE.source, MASK_IMAGE_URL_RE.flags);
      while ((match = pattern.exec(cssSource.content)) !== null) {
        const rawUrl = match[1] ?? match[2] ?? match[3] ?? "";
        const url = cleanAssetUrl(rawUrl);
        if (!url || isRemoteOrInlineUrl(url)) continue;
        if (/^__[A-Z_]+__$/.test(url)) continue;

        const candidates = resolveCssAssetCandidates(
          projectDir,
          url,
          compSrcPath,
          cssSource.rootRelativePath,
        );
        if (candidates.some(existsSync)) continue;
        missing.set(url, candidates[0] ?? resolve(projectDir, url));
      }
    }
  }

  if (missing.size === 0) return [];
  const urls = [...missing.keys()];
  return [
    {
      code: "texture_mask_asset_not_found",
      severity: "error",
      message: `CSS mask-image references file(s) not found in the project: ${urls.join(", ")}.`,
      fixHint:
        urls.length === 1
          ? `Add "${urls[0]}" to the project, or update the mask-image URL to point to an existing texture mask.`
          : "Add the missing texture mask files to the project, or update the mask-image URLs to point to existing files.",
    },
  ];
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
      if (file === "caption-skin.html") continue;
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
