export { shouldBlockRender } from "./shouldBlockRender.js";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { rewriteAssetPath } from "@hyperframes/parsers/asset-paths";
import { checkSubCompositionUsability } from "@hyperframes/parsers/sub-composition-validity";
import { parseHTML } from "linkedom";
import {
  cleanAssetUrl,
  isRemoteOrInlineUrl,
  isWithinProjectRoot,
  maskNonScannableRanges,
  resolveExistingLocalAsset,
  resolveLocalAssetCandidates,
} from "./assetResolution.js";
import { collectLocalVideoCandidates, lintHevcPreviewCodec } from "./hevcPreviewLint.js";
import { lintHyperframeHtml } from "./hyperframeLinter.js";
import type { HyperframeLintFinding, HyperframeLintResult } from "./types.js";
import type { ParsableDocumentLike } from "@hyperframes/parsers/sub-composition-validity";

/** Adapts linkedom's `parseHTML` to the `checkSubCompositionUsability` contract. */
function parseSubCompHtml(html: string): ParsableDocumentLike {
  return parseHTML(html).document as unknown as ParsableDocumentLike;
}

interface HtmlSource {
  html: string;
  compSrcPath?: string;
}

interface CssSource {
  content: string;
  rootRelativePath?: string;
}

/** Linkedom keeps template contents in a DocumentFragment that is not part of
 * the document query tree. Lint rules must still see shell styles and links
 * inside templates, so walk each template's content recursively without
 * falling back to regex parsing. */
function querySelectorAllIncludingTemplates(root: ParentNode, selector: string): Element[] {
  const matches: Element[] = [...root.querySelectorAll(selector)];
  for (const template of root.querySelectorAll("template")) {
    const content = (template as HTMLTemplateElement).content;
    if (content) matches.push(...querySelectorAllIncludingTemplates(content, selector));
  }
  return matches;
}

export interface ProjectLintResult {
  results: Array<{ file: string; result: HyperframeLintResult }>;
  totalErrors: number;
  totalWarnings: number;
  totalInfos: number;
}

const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".aac", ".ogg", ".m4a", ".flac", ".opus"]);
const MASK_IMAGE_URL_RE =
  /\b(?:-webkit-)?mask-image\s*:\s*[^;{}]*url\(\s*(?:"([^"]+)"|'([^']+)'|([^"')\s]+))\s*\)/gi;

function isLocalStylesheetHref(href: string): boolean {
  return !!href && !/^(https?:|data:|blob:|\/\/)/i.test(href);
}

function collectLocalStylesheets(
  projectDir: string,
  document: ParentNode,
  compSrcPath?: string,
): Array<{ href: string; content: string; rootRelativePath: string }> {
  const styles: Array<{ href: string; content: string; rootRelativePath: string }> = [];
  for (const link of querySelectorAllIncludingTemplates(document, "link")) {
    const rel = link.getAttribute("rel") ?? "";
    if (!rel.split(/\s+/).some((part) => part.toLowerCase() === "stylesheet")) continue;
    const href = link.getAttribute("href") ?? "";
    if (!isLocalStylesheetHref(href)) continue;
    const rootRelative = compSrcPath ? join(dirname(compSrcPath), href) : href;
    const stylesheet = resolveExistingLocalAsset(projectDir, rootRelative);
    if (!stylesheet) continue;
    styles.push({
      href,
      content: readFileSync(stylesheet.resolved, "utf-8"),
      rootRelativePath: stylesheet.rootRelativePath,
    });
  }
  return styles;
}

function collectExternalStyles(
  projectDir: string,
  html: string,
  compSrcPath?: string,
): Array<{ href: string; content: string }> {
  const styles: Array<{ href: string; content: string }> = [];
  const { document } = parseHTML(html);
  for (const { href, content } of collectLocalStylesheets(projectDir, document, compSrcPath)) {
    styles.push({ href, content });
  }
  return styles;
}

function collectCssSources(projectDir: string, html: string, compSrcPath?: string): CssSource[] {
  const sources: CssSource[] = [];
  const { document } = parseHTML(html);

  for (const style of querySelectorAllIncludingTemplates(document, "style")) {
    sources.push({ content: style.textContent ?? "" });
  }

  for (const { content, rootRelativePath } of collectLocalStylesheets(
    projectDir,
    document,
    compSrcPath,
  )) {
    sources.push({ content, rootRelativePath });
  }

  for (const element of querySelectorAllIncludingTemplates(document, "[style]")) {
    const style = element.getAttribute("style");
    if (!style) continue;
    sources.push({ content: style });
  }

  return sources;
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

export async function lintProject(
  projectDir: string,
  entryFile?: string,
): Promise<ProjectLintResult> {
  const indexPath = entryFile ? resolve(entryFile) : resolve(projectDir, "index.html");
  if (entryFile && !isWithinProjectRoot(projectDir, indexPath)) {
    throw new Error(`Explicit lint entry is outside the project directory: ${entryFile}`);
  }
  const rootFile = relative(resolve(projectDir), indexPath).replace(/\\/g, "/") || "index.html";
  const rootCompSrcPath = rootFile === "index.html" ? undefined : rootFile;
  const results: Array<{ file: string; result: HyperframeLintResult }> = [];
  let totalErrors = 0;
  let totalWarnings = 0;
  let totalInfos = 0;

  const rootHtml = readFileSync(indexPath, "utf-8");
  const rootResult = await lintHyperframeHtml(rootHtml, {
    filePath: indexPath,
    externalStyles: collectExternalStyles(projectDir, rootHtml, rootCompSrcPath),
  });
  results.push({ file: rootFile, result: rootResult });
  totalErrors += rootResult.errorCount;
  totalWarnings += rootResult.warningCount;
  totalInfos += rootResult.infoCount;

  const allHtmlSources: HtmlSource[] = [{ html: rootHtml, compSrcPath: rootCompSrcPath }];
  const compositionsDir = resolve(projectDir, "compositions");
  if (!entryFile && existsSync(compositionsDir)) {
    const collectHtmlFiles = (dir: string, rel: string): string[] => {
      const out: string[] = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const relPath = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          // Registry components are source snippets, not independently mounted
          // sub-compositions. Linting every installed template here makes an
          // unused component fail the assembled project check.
          if (!rel && entry.name === "components") continue;
          out.push(...collectHtmlFiles(join(dir, entry.name), relPath));
        } else if (entry.isFile() && entry.name.endsWith(".html") && !entry.name.startsWith("._")) {
          out.push(relPath);
        }
      }
      return out;
    };
    const files = collectHtmlFiles(compositionsDir, "").sort();
    for (const file of files) {
      const filePath = join(compositionsDir, file);
      const html = readFileSync(filePath, "utf-8");
      const compSrcPath = `compositions/${file}`;
      allHtmlSources.push({ html, compSrcPath });
      // Mountable fragments (figma component imports, registry snippets) are
      // not standalone compositions — composition-root rules don't apply.
      // Anchored to the file's ROOT element so a real composition that merely
      // inlines snippet markup (or mentions the token in text) is still linted.
      if (isSnippetFragment(html)) continue;
      const result = await lintHyperframeHtml(html, {
        filePath,
        isSubComposition: true,
        externalStyles: collectExternalStyles(projectDir, html, compSrcPath),
      });
      results.push({ file: `compositions/${file}`, result });
      totalErrors += result.errorCount;
      totalWarnings += result.warningCount;
      totalInfos += result.infoCount;
    }
  }

  const projectFindings = [
    ...lintProjectAudioFiles(projectDir, allHtmlSources),
    ...lintAudioSrcNotFound(projectDir, allHtmlSources),
    ...lintMissingLocalAsset(projectDir, allHtmlSources),
    ...lintTextureMaskAssetNotFound(projectDir, allHtmlSources),
    ...(!entryFile ? lintMultipleRootCompositions(projectDir) : []),
    ...lintDuplicateAudioTracks(allHtmlSources),
    ...lintMissingOrEmptySubComposition(projectDir, rootHtml),
    ...(await lintHevcPreviewCodec(collectLocalVideoCandidates(projectDir, allHtmlSources))),
  ];
  if (projectFindings.length > 0) {
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

function lintProjectAudioFiles(
  projectDir: string,
  htmlSources: HtmlSource[],
): HyperframeLintFinding[] {
  const findings: HyperframeLintFinding[] = [];

  let audioFiles: string[];
  try {
    audioFiles = readdirSync(projectDir).filter((f) =>
      AUDIO_EXTENSIONS.has(extname(f).toLowerCase()),
    );
  } catch {
    return findings;
  }

  if (audioFiles.length === 0) return findings;

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
      if (/^__[A-Z_]+__$/.test(src)) continue;
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

// fallow-ignore-next-line complexity
function lintMissingLocalAsset(
  projectDir: string,
  htmlSources: HtmlSource[],
): HyperframeLintFinding[] {
  const findings: HyperframeLintFinding[] = [];

  const localAssetSrcRe = /<(video|img|source)\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;

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
      if (/^__[A-Z_]+__$/.test(src)) continue;
      const rootRelative = compSrcPath ? rewriteAssetPath(compSrcPath, src) : src;
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

function lintMultipleRootCompositions(projectDir: string): HyperframeLintFinding[] {
  const findings: HyperframeLintFinding[] = [];
  try {
    const rootHtmlFiles = readdirSync(projectDir).filter(
      (file) => file.endsWith(".html") && !file.startsWith("._"),
    );
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
      const duration = durStr ? parseFloat(durStr) : Infinity;
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
 * Error if a `data-composition-src` reference points at a file that is
 * missing, empty, or does not parse to usable HTML. This is the #1 render
 * failure bucket in production telemetry: a scene-authoring step (an AI
 * agent, most commonly) writes the reference before — or without ever —
 * writing valid content into the scene file.
 *
 * The render pre-flight check (`assertSubCompositionsUsable` in
 * `packages/producer/src/services/htmlCompiler.ts`) now aborts the render
 * loudly and immediately when this happens, rather than silently dropping
 * the scene — so catching it here, before the render even starts, means the
 * failure surfaces at lint/validate time with the same message instead of
 * only at render time.
 *
 * Only follows files actually reachable via `data-composition-src` starting
 * from the root composition — mirroring the reachability semantics of
 * `assertSubCompositionsUsable`. A raw filesystem walk of every `.html`
 * under `compositions/` would flag orphaned/unreferenced files that the
 * renderer never visits, producing false-positive lint/validate failures on
 * projects that actually render fine. Lint, render, and the inliner must
 * never disagree about whether a given file would actually render
 * something.
 */
function lintMissingOrEmptySubComposition(
  projectDir: string,
  rootHtml: string,
): HyperframeLintFinding[] {
  // Dedup by src path — the same reference can appear from nested sub-comps.
  const checked = new Map<string, { srcPath: string; problem: string }>();
  const visited = new Set<string>();

  // fallow-ignore-next-line complexity
  const walk = (html: string): void => {
    const compositionSrcRe = /<[^>]*\bdata-composition-src\s*=\s*["']([^"']+)["'][^>]*>/gi;
    const scannable = maskNonScannableRanges(html);
    let match: RegExpExecArray | null;
    while ((match = compositionSrcRe.exec(scannable)) !== null) {
      const srcPath = (match[1] ?? "").trim();
      if (!srcPath) continue;
      if (/^__[A-Z_]+__$/.test(srcPath)) continue; // template placeholder

      // data-composition-src is always written root-relative (even from a
      // nested sub-composition) — matches the resolution the renderer uses
      // in packages/producer/src/services/htmlCompiler.ts (parseSubCompositions
      // / assertSubCompositionsUsable).
      const filePath = resolve(projectDir, srcPath);

      // Circular reference guard — same as assertSubCompositionsUsable.
      // Already-visited files were already checked (or are mid-walk); skip
      // re-checking/re-recursing but still let a later distinct reference to
      // the same broken file surface (checked is keyed by srcPath, not filePath).
      if (visited.has(filePath)) continue;
      visited.add(filePath);

      if (!existsSync(filePath)) {
        if (!checked.has(srcPath)) {
          checked.set(srcPath, { srcPath, problem: "the file does not exist" });
        }
        continue;
      }

      const fileHtml = readFileSync(filePath, "utf-8");
      const validity = checkSubCompositionUsability(fileHtml, parseSubCompHtml);
      if (!validity.ok) {
        if (!checked.has(srcPath)) {
          checked.set(srcPath, {
            srcPath,
            problem: validity.detail ?? "the file is empty or could not be parsed",
          });
        }
        continue;
      }

      // Usable — recurse into it so nested references are validated too,
      // but only because this file is itself reachable from the root.
      walk(fileHtml);
    }
  };

  walk(rootHtml);

  const findings: HyperframeLintFinding[] = [];
  for (const { srcPath, problem } of checked.values()) {
    findings.push({
      code: "missing_or_empty_sub_composition",
      severity: "error",
      message: `data-composition-src references "${srcPath}", but ${problem}.`,
      fixHint:
        `Fix this before rendering — the render pre-flight rejects unusable sub-compositions. ` +
        `Write valid HTML into "${srcPath}" — it needs a <template> or <body> containing an element with ` +
        `data-composition-id, data-width, and data-height. Preview/studio still tolerates and skips the ` +
        "scene while you author it. If a scene-authoring step is still running, wait for it to finish " +
        "before referencing the file, or re-run the step that generates it.",
    });
  }

  return findings;
}

/** True when the file's first element carries data-hf-snippet — i.e. the file
 * IS a mountable fragment, not a composition that merely contains one. */
function isSnippetFragment(html: string): boolean {
  const firstTag = html.match(/<[a-zA-Z][^>]*>/);
  if (!firstTag) return false;
  return /\bdata-hf-snippet\b/.test(firstTag[0]);
}
