export { shouldBlockRender } from "./shouldBlockRender.js";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { rewriteAssetPath } from "@hyperframes/parsers/asset-paths";
import { spansOverlap } from "@hyperframes/parsers/time-spans";
import {
  compositionOriginSeconds,
  cutToHostSlots,
  MEDIA_START_BASIS_ATTR,
  resolveMediaStartSeconds,
  type HostSlot,
} from "@hyperframes/parsers/media-timing";
import { parseNumeric } from "@hyperframes/parsers/composition-contract";
import {
  resolveReferencedDuration,
  resolveReferencedStart,
  type RefResolverDoc,
  type RefResolverEl,
} from "@hyperframes/parsers/reference-resolver";
import { checkSubCompositionUsability } from "@hyperframes/parsers/sub-composition-validity";
import { parseHTML } from "linkedom";
import postcss from "postcss";
import {
  cleanAssetUrl,
  collectSubCompositionSrcs,
  isRemoteOrInlineUrl,
  isUnresolvedAssetPlaceholder,
  isWithinProjectRoot,
  maskNonScannableRanges,
  readProjectFile,
  resolveExistingLocalAsset,
  resolveLocalAssetCandidates,
  resolveProjectRelativeSrc,
} from "@hyperframes/parsers/asset-resolution";
import { encodeUrlPath } from "@hyperframes/parsers";
import {
  collectLocalVideoCandidates,
  lintHevcPreviewCodec,
  lintVideoMediaStartPastEof,
} from "./hevcPreviewLint.js";
import { lintHyperframeHtml } from "./hyperframeLinter.js";
import { collectGoogleFontFamilies, extractFontFaceFamilies } from "./rules/fonts.js";
import { lintProjectShaderScripts } from "./projectShaders.js";
import type {
  HyperframeLintFinding,
  HyperframeLintResult,
  HyperframeLinterOptions,
} from "./types.js";
import type { ParsableDocumentLike } from "@hyperframes/parsers/sub-composition-validity";
import { isAudibleVideo, isAudibleVideoTag, mediaSrcOf, mediaSrcTagRe } from "./utils";

/** Adapts linkedom's `parseHTML` to the `checkSubCompositionUsability` contract. */
function parseSubCompHtml(html: string): ParsableDocumentLike {
  return parseHTML(html).document as unknown as ParsableDocumentLike;
}

/** The file a source was read from, as per-file findings carry it. */
const sourceFile = (projectDir: string, compSrcPath?: string) =>
  resolve(projectDir, compSrcPath ?? "index.html");

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
  results: Array<{ file: string; result: HyperframeLintResult; contentHash: string }>;
  totalErrors: number;
  totalWarnings: number;
  totalInfos: number;
}

/**
 * Short content digest of a linted file. Callers use it to tell "the author
 * edited this file and the finding survived" (an iteration that did not
 * converge) from "the same file was linted twice" (no attempt was made).
 * Truncated because it is only ever compared against the previous run's digest
 * for the same file, never used as a security boundary.
 */
function contentDigest(html: string): string {
  return createHash("sha256").update(html).digest("hex").slice(0, 16);
}

const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".aac", ".ogg", ".m4a", ".flac", ".opus"]);
const CSS_URL_RE = /\burl\(\s*(?:"([^"]+)"|'([^']+)'|([^"')\s]+))\s*\)/gi;
const MASK_IMAGE_URL_RE =
  /\b(?:-webkit-)?mask-image\s*:\s*[^;{}]*url\(\s*(?:"([^"]+)"|'([^']+)'|([^"')\s]+))\s*\)/gi;

function isLocalStylesheetHref(href: string): boolean {
  return !!href && !/^(https?:|data:|blob:|\/\/)/i.test(href);
}

function staysInsideProjectRoot(href: string): boolean {
  return !href.startsWith("/") && !href.split("/").includes("..");
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
    const besideFile = compSrcPath ? join(dirname(compSrcPath), href) : href;
    const stylesheet =
      resolveExistingLocalAsset(projectDir, besideFile) ??
      (compSrcPath && staysInsideProjectRoot(href)
        ? resolveExistingLocalAsset(projectDir, href)
        : null);
    if (!stylesheet) continue;
    const read = readProjectFile(stylesheet.resolved);
    if (read.kind !== "file") continue;
    styles.push({ href, content: read.text, rootRelativePath: stylesheet.rootRelativePath });
  }
  return styles;
}

export function collectExternalStyles(
  projectDir: string,
  html: string,
  compSrcPath?: string,
): NonNullable<HyperframeLinterOptions["externalStyles"]> {
  const styles: NonNullable<HyperframeLinterOptions["externalStyles"]> = [];
  const { document } = parseHTML(html);
  for (const { href, content, rootRelativePath } of collectLocalStylesheets(
    projectDir,
    document,
    compSrcPath,
  )) {
    styles.push({ href, content, file: join(projectDir, rootRelativePath), rootRelativePath });
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
    return resolveLocalAssetCandidates(
      projectDir,
      rewriteAssetPath(htmlCompSrcPath, url, (path) => existsSync(join(projectDir, path))),
    );
  }
  return resolveLocalAssetCandidates(projectDir, url);
}

function mountedSources(
  projectDir: string,
  rootHtml: string,
  rootCompSrcPath?: string,
): HtmlSource[] {
  const sources: HtmlSource[] = [{ html: rootHtml, compSrcPath: rootCompSrcPath }];
  const seen = new Set<string>();
  for (const source of sources) {
    const { document } = parseHTML(source.html);
    for (const host of querySelectorAllIncludingTemplates(document, "[data-composition-src]")) {
      const src = host.getAttribute("data-composition-src")?.trim();
      if (!src || isUnresolvedAssetPlaceholder(src) || isRemoteOrInlineUrl(src)) continue;
      const path = resolve(projectDir, src);
      if (seen.has(path) || !isWithinProjectRoot(projectDir, path)) continue;
      seen.add(path);
      const read = readProjectFile(path);
      if (read.kind !== "file") continue;
      sources.push({
        html: read.text,
        compSrcPath: relative(resolve(projectDir), path).replace(/\\/g, "/"),
      });
    }
  }
  return sources;
}

function declaredProjectFontFamilies(projectDir: string, sources: HtmlSource[]): string[] {
  const families = new Set<string>();
  for (const { html, compSrcPath } of sources) {
    const { document } = parseHTML(html);
    const styles = [
      ...querySelectorAllIncludingTemplates(document, "style").map((style) => ({
        content: style.textContent ?? "",
      })),
      ...collectLocalStylesheets(projectDir, document, compSrcPath),
    ];
    for (const family of extractFontFaceFamilies(styles)) families.add(family);
    for (const family of collectGoogleFontFamilies(html, styles)) families.add(family);
  }
  return [...families];
}

export async function lintProject(
  projectDir: string,
  entryFile?: string,
  hostOptions: Pick<HyperframeLinterOptions, "host" | "isSubComposition"> = {},
): Promise<ProjectLintResult> {
  const indexPath = entryFile ? resolve(entryFile) : resolve(projectDir, "index.html");
  if (entryFile && !isWithinProjectRoot(projectDir, indexPath)) {
    throw new Error(`Explicit lint entry is outside the project directory: ${entryFile}`);
  }
  const rootFile = relative(resolve(projectDir), indexPath).replace(/\\/g, "/") || "index.html";
  const rootCompSrcPath = rootFile === "index.html" ? undefined : rootFile;
  const results: ProjectLintResult["results"] = [];
  let totalErrors = 0;
  let totalWarnings = 0;
  let totalInfos = 0;

  const rootHtml = readFileSync(indexPath, "utf-8");
  const projectFontFamilies = declaredProjectFontFamilies(
    projectDir,
    mountedSources(projectDir, rootHtml, rootCompSrcPath),
  );
  const rootResult = await lintHyperframeHtml(rootHtml, {
    ...hostOptions,
    filePath: indexPath,
    compSrcPath: rootFile,
    externalStyles: collectExternalStyles(projectDir, rootHtml, rootCompSrcPath),
    projectFontFamilies,
  });
  results.push({ file: rootFile, result: rootResult, contentHash: contentDigest(rootHtml) });
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
        ...hostOptions,
        filePath,
        isSubComposition: true,
        compSrcPath,
        externalStyles: collectExternalStyles(projectDir, html, compSrcPath),
        projectFontFamilies,
      });
      results.push({
        file: `compositions/${file}`,
        result,
        contentHash: contentDigest(html),
      });
      totalErrors += result.errorCount;
      totalWarnings += result.warningCount;
      totalInfos += result.infoCount;
    }
  }

  const projectFindings = [
    ...lintProjectShaderScripts(projectDir, allHtmlSources),
    ...lintProjectAudioFiles(projectDir, allHtmlSources),
    ...lintAudioSrcNotFound(projectDir, allHtmlSources),
    ...lintMissingLocalAsset(projectDir, allHtmlSources),
    ...lintTextureMaskAssetNotFound(projectDir, allHtmlSources),
    ...(!entryFile ? lintMultipleRootCompositions(projectDir) : []),
    ...(!entryFile ? lintBlankRootWithStandaloneComposition(rootHtml, allHtmlSources) : []),
    ...lintDuplicateAudioTracks(projectDir, rootHtml),
    ...lintMissingOrEmptySubComposition(projectDir, rootHtml),
    ...(await lintVideoMediaStartPastEof(projectDir, allHtmlSources)),
    ...(await lintHevcPreviewCodec(collectLocalVideoCandidates(projectDir, allHtmlSources))),
  ];
  for (const finding of projectFindings) {
    const ownFile = finding.file && resolve(projectDir, finding.file);
    const owner =
      results.find((entry) => resolve(projectDir, entry.file) === ownFile)?.result ?? rootResult;
    owner.findings.push(finding);
    if (finding.severity === "error") {
      owner.errorCount++;
      owner.ok = false;
      totalErrors++;
    } else if (finding.severity === "warning") {
      owner.warningCount++;
      totalWarnings++;
    } else {
      owner.infoCount++;
      totalInfos++;
    }
  }

  return { results, totalErrors, totalWarnings, totalInfos };
}

function lintBlankRootWithStandaloneComposition(
  rootHtml: string,
  htmlSources: HtmlSource[],
): HyperframeLintFinding[] {
  const { document: rootDocument } = parseHTML(rootHtml);
  const root = rootDocument.querySelector("body [data-composition-id]");
  // A no-media scaffold has no rendered descendants and can silently mask an authored file below.
  // A scaffold that retained its A-roll <video>/<audio> is visibly non-blank, so this rule leaves it
  // alone even when another composition is unmounted.
  if (!root || root.querySelector("*:not(script):not(style):not(link):not(meta):not(template)")) {
    return [];
  }

  const standaloneCandidates: string[] = [];
  for (const source of htmlSources) {
    if (!source.compSrcPath) continue;
    const { document } = parseHTML(source.html);
    const composition = document.querySelector("body [data-composition-id]");
    if (!composition) continue;
    const authoredTimedContent = Array.from(
      composition.querySelectorAll(
        ".clip, [data-start], [data-end], video, audio, img, svg, canvas",
      ),
    ).some((element) => !element.hasAttribute("data-composition-src"));
    if (authoredTimedContent) standaloneCandidates.push(source.compSrcPath);
  }

  if (standaloneCandidates.length === 0) return [];
  return [
    {
      code: "blank_root_with_standalone_composition",
      severity: "error",
      message: `The default index.html composition has no renderable content, but ${standaloneCandidates.join(", ")} contains a standalone timed composition. Default check, snapshot, preview, render, and publish commands open index.html, so they will capture or publish only its background.`,
      fixHint:
        `Move the authored composition into index.html, or mount it from index.html with data-composition-src and the sub-composition <template> contract. ` +
        `If the separate file is intentional, render it explicitly with --composition ${standaloneCandidates[0]}.`,
      suggestedComposition: standaloneCandidates[0],
    },
  ];
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
  const hasAudibleVideo = htmlSources.some(({ html }) =>
    (html.match(/<video\b[^>]*>/gi) ?? []).some(isAudibleVideoTag),
  );

  if (!hasAudioElement && !hasAudibleVideo) {
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

/** The src that loads a project file whose own name holds `#` or `?`, which a URL cuts the name at; null when the raw
 * src names no such file. */
function urlSafeSrcOf(projectDir: string, rootRelative: string): string | null {
  if (!/[?#]/.test(rootRelative)) return null;
  const literal = resolve(projectDir, rootRelative.replace(/^\//, ""));
  if (!existsSync(literal)) return null;
  return encodeUrlPath(rootRelative);
}

const urlSafeHint = (safe: string) =>
  `The file exists, but a "#" or "?" in a src ends the file name there. Write the src as "${safe}".`;

function lintAudioSrcNotFound(
  projectDir: string,
  htmlSources: HtmlSource[],
): HyperframeLintFinding[] {
  const findings: HyperframeLintFinding[] = [];

  const audioSrcRe = mediaSrcTagRe("audio");

  const missingByFile = new Map<string, Set<string>>();
  const urlSafe = new Map<string, string>();
  for (const { html, compSrcPath } of htmlSources) {
    const scannable = maskNonScannableRanges(html);
    let match: RegExpExecArray | null;
    while ((match = audioSrcRe.exec(scannable)) !== null) {
      const src = mediaSrcOf(match);
      if (/^(https?:|data:|blob:)/i.test(src)) continue;
      if (isUnresolvedAssetPlaceholder(src)) continue;
      const rootRelative = compSrcPath
        ? rewriteAssetPath(compSrcPath, src, (path) => existsSync(join(projectDir, path)))
        : src;
      if (!existsSync(resolveProjectRelativeSrc(rootRelative, projectDir))) {
        const safe = urlSafeSrcOf(projectDir, rootRelative);
        if (safe) urlSafe.set(src, safe);
        const file = sourceFile(projectDir, compSrcPath);
        missingByFile.set(file, (missingByFile.get(file) ?? new Set()).add(src));
      }
    }
  }

  for (const [file, srcs] of missingByFile) {
    const unique = [...srcs];
    findings.push({
      code: "audio_src_not_found",
      severity: "error",
      file,
      message: `<audio> element references file(s) not found in the project: ${unique.join(", ")}. The rendered video will be silent.`,
      fixHint:
        unique.length === 1 && urlSafe.has(unique[0]!)
          ? urlSafeHint(urlSafe.get(unique[0]!)!)
          : unique.length === 1
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

  const localAssetSrcRe = mediaSrcTagRe("video|img|source");

  const missingByTag = new Map<
    string,
    { file: string; tagName: string; byResolved: Map<string, string> }
  >();
  const urlSafe = new Map<string, string>();

  for (const { html, compSrcPath } of htmlSources) {
    const scannable = maskNonScannableRanges(html);
    const re = new RegExp(localAssetSrcRe.source, localAssetSrcRe.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(scannable)) !== null) {
      const tagName = (match[1] ?? "").toLowerCase();
      const rawSrc = mediaSrcOf(match);
      // Placeholder check runs on the RAW value: cleanAssetUrl() splits on ?/# and would chop inside a ${...} token.
      if (isUnresolvedAssetPlaceholder(rawSrc)) continue;
      const src = cleanAssetUrl(rawSrc);
      if (!src) continue;
      if (isRemoteOrInlineUrl(src)) continue;
      const rootRelative = compSrcPath
        ? rewriteAssetPath(compSrcPath, src, (path) => existsSync(join(projectDir, path)))
        : src;
      const resolvedAsset = resolveExistingLocalAsset(projectDir, rootRelative);
      if (resolvedAsset) continue;

      const rawRoot = rawSrc.trim();
      const safe = urlSafeSrcOf(
        projectDir,
        compSrcPath
          ? rewriteAssetPath(compSrcPath, rawRoot, (path) => existsSync(join(projectDir, path)))
          : rawRoot,
      );
      if (safe) urlSafe.set(src, safe);
      const resolvedKey = resolve(projectDir, rootRelative);
      const file = sourceFile(projectDir, compSrcPath);
      const bucketKey = `${file}\0${tagName}`;
      let bucket = missingByTag.get(bucketKey);
      if (!bucket) {
        bucket = { file, tagName, byResolved: new Map<string, string>() };
        missingByTag.set(bucketKey, bucket);
      }
      if (!bucket.byResolved.has(resolvedKey)) bucket.byResolved.set(resolvedKey, src);
    }
  }

  for (const { file, tagName, byResolved } of missingByTag.values()) {
    const unique = [...byResolved.values()];
    findings.push({
      code: "missing_local_asset",
      severity: "error",
      file,
      message:
        `<${tagName}> element references local file(s) not found in the project: ${unique.join(", ")}. ` +
        "The renderer will silently skip these and produce a video with missing visuals.",
      fixHint:
        unique.length === 1 && urlSafe.has(unique[0]!)
          ? urlSafeHint(urlSafe.get(unique[0]!)!)
          : unique.length === 1
            ? `Add "${unique[0]}" to the project directory, or update the src attribute to point to an existing file. ` +
              "Common cause: captured asset filenames are unreliable (heygen-logo.svg often contains Google, nvidia-logo.svg may contain Autodesk, etc.). " +
              "Open the contact sheets and verify the file actually exists at this path before referencing it."
            : "Add the missing files to the project directory, or update the src attributes to point to existing files. " +
              "Captured asset filenames are unreliable. Verify against capture/contact-sheets/ and capture/extracted/asset-descriptions.md.",
    });
  }

  return findings;
}

function lintTextureMaskAssetNotFound(
  projectDir: string,
  htmlSources: HtmlSource[],
): HyperframeLintFinding[] {
  const missingByFile = new Map<string, Set<string>>();

  for (const { html, compSrcPath } of htmlSources) {
    const file = sourceFile(projectDir, compSrcPath);
    for (const cssSource of collectCssSources(projectDir, html, compSrcPath)) {
      let matches: RegExpExecArray[] = [];
      try {
        postcss.parse(cssSource.content).walkDecls(/^(?:-webkit-)?mask-image$/i, (declaration) => {
          matches.push(...declaration.value.matchAll(CSS_URL_RE));
        });
      } catch (error) {
        if (!(error instanceof postcss.CssSyntaxError)) throw error;
        matches = [...cssSource.content.matchAll(MASK_IMAGE_URL_RE)];
      }
      for (const match of matches) {
        const rawUrl = match[1] ?? match[2] ?? match[3] ?? "";
        // Placeholder check runs on the RAW value: cleanAssetUrl() splits on ?/# and would chop inside a ${...} token.
        if (isUnresolvedAssetPlaceholder(rawUrl)) continue;
        const url = cleanAssetUrl(rawUrl);
        if (!url || isRemoteOrInlineUrl(url)) continue;

        const candidates = resolveCssAssetCandidates(
          projectDir,
          url,
          compSrcPath,
          cssSource.rootRelativePath,
        );
        if (candidates.some(existsSync)) continue;
        missingByFile.set(file, (missingByFile.get(file) ?? new Set()).add(url));
      }
    }
  }

  return [...missingByFile].map(([file, found]): HyperframeLintFinding => {
    const urls = [...found];
    return {
      code: "texture_mask_asset_not_found",
      severity: "error",
      file,
      message: `CSS mask-image references file(s) not found in the project: ${urls.join(", ")}.`,
      fixHint:
        urls.length === 1
          ? `Add "${urls[0]}" to the project, or update the mask-image URL to point to an existing texture mask.`
          : "Add the missing texture mask files to the project, or update the mask-image URLs to point to existing files.",
    };
  });
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

interface AudioSpan {
  trackIndex: number;
  start: number;
  end: number;
  src: string;
}

/** One parsed file: reference starts resolve within it, memoised. */
interface TimingFile {
  doc: RefResolverDoc;
  starts: Map<RefResolverEl, number>;
}

const timingFile = (doc: RefResolverDoc): TimingFile => ({ doc, starts: new Map() });
const localStart = (file: TimingFile, el: Element) =>
  resolveReferencedStart(file.doc, el, file.starts, new Set());
const localDuration = (file: TimingFile, el: Element) =>
  resolveReferencedDuration(file.doc, el, file.starts, new Set());

/** Audible media on the main timeline, walked from the root through the scenes it mounts. */
function collectMainTimelineAudio(projectDir: string, rootHtml: string): AudioSpan[] {
  const spans: AudioSpan[] = [];
  type Placement = { file: TimingFile; origin: number; slots: HostSlot[]; mounting: string[] };
  const mount = (html: string, at: Omit<Placement, "file">) => {
    const { document } = parseHTML(html);
    const root = querySelectorAllIncludingTemplates(document, "[data-composition-id]")[0];
    if (root) visit(root, { ...at, file: timingFile(document) });
  };
  const visit = (parent: ParentNode, at: Placement) => {
    for (const el of parent.children) {
      if (el.tagName === "TEMPLATE") {
        visit((el as HTMLTemplateElement).content, at);
        continue;
      }
      const span = audioSpanOf(el, at.file, at.origin, at.slots);
      if (span) spans.push(span);
      const scope = nestedScopeOf(el, at.file, at.origin, at.slots);
      if (!scope) {
        visit(el, at);
        continue;
      }
      const inner = { ...at, ...scope };
      const src = el.getAttribute("data-composition-src")?.trim();
      const file = src && !isUnresolvedAssetPlaceholder(src) && !isRemoteOrInlineUrl(src);
      const filePath = file ? resolve(projectDir, src) : null;
      if (filePath && !at.mounting.includes(filePath)) {
        const read = readProjectFile(filePath);
        if (read.kind === "file")
          mount(read.text, { ...inner, mounting: [...at.mounting, filePath] });
      }
      visit(el, inner);
    }
  };
  const { document } = parseHTML(rootHtml);
  visit(document, { file: timingFile(document), origin: 0, slots: [], mounting: [] });
  return spans;
}

/** A composition or scene host: its children's local t=0 sits at the host's start, cut to its window. */
function nestedScopeOf(
  el: Element,
  file: TimingFile,
  origin: number,
  slots: HostSlot[],
): { origin: number; slots: HostSlot[] } | null {
  if (!el.hasAttribute("data-composition-id") && !el.hasAttribute("data-composition-src")) {
    return null;
  }
  const start = origin + localStart(file, el);
  const duration = localDuration(file, el);
  const window = duration === null ? [] : [{ start, end: start + duration }];
  return { origin: compositionOriginSeconds(start, el), slots: [...slots, ...window] };
}

function audioSpanOf(
  el: Element,
  file: TimingFile,
  origin: number,
  slots: HostSlot[],
): AudioSpan | null {
  const tag = el.tagName.toLowerCase();
  if (tag !== "audio" && !(tag === "video" && isAudibleVideo((name) => el.getAttribute(name)))) {
    return null;
  }
  const trackStr = el.getAttribute("data-track-index");
  if (!trackStr || !el.hasAttribute("data-start")) return null;
  const start = resolveMediaStartSeconds({
    authoredStart: parseNumeric(el.getAttribute("data-start")),
    hostStart: origin,
    hasAutoStart: el.hasAttribute("data-hf-auto-start"),
    basis: el.getAttribute(MEDIA_START_BASIS_ATTR),
    ordinaryStart: () => origin + localStart(file, el),
  });
  const duration = parseNumeric(el.getAttribute("data-duration")) ?? localDuration(file, el);
  const kept = cutToHostSlots({ start, end: start + (duration ?? Infinity) }, slots);
  if (kept.end <= kept.start) return null;
  return { trackIndex: parseInt(trackStr, 10), ...kept, src: el.getAttribute("src") || "unknown" };
}

const formatSeconds = (t: number) => (Number.isFinite(t) ? String(Number(t.toFixed(2))) : "end");

function lintDuplicateAudioTracks(projectDir: string, rootHtml: string): HyperframeLintFinding[] {
  const findings: HyperframeLintFinding[] = [];
  const tracks = collectMainTimelineAudio(projectDir, rootHtml);
  for (let i = 0; i < tracks.length; i++) {
    for (let j = i + 1; j < tracks.length; j++) {
      const a = tracks[i]!;
      const b = tracks[j]!;
      if (a.trackIndex !== b.trackIndex) continue;
      if (spansOverlap(a.start, a.end, b.start, b.end)) {
        findings.push({
          code: "duplicate_audio_track",
          severity: "warning",
          message: `Multiple audible <audio>/<video> elements on track ${a.trackIndex} overlap (${a.src} at ${formatSeconds(a.start)}-${formatSeconds(a.end)}s, ${b.src} at ${formatSeconds(b.start)}-${formatSeconds(b.end)}s). This causes layered audio playback.`,
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
  const checked = new Map<string, { srcPath: string; problem: string; folder?: true }>();
  const visited = new Set<string>();

  // fallow-ignore-next-line complexity
  const walk = (html: string): void => {
    // Shared scanner — see collectSubCompositionSrcs for why this must be a
    // text scan rather than a DOM query (template content is inert).
    for (const srcPath of collectSubCompositionSrcs(html)) {
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

      const read = readProjectFile(filePath);
      if (read.kind === "missing") {
        if (!checked.has(srcPath)) {
          checked.set(srcPath, { srcPath, problem: "the file does not exist" });
        }
        continue;
      }
      if (read.kind === "folder") {
        if (!checked.has(srcPath)) {
          checked.set(srcPath, {
            srcPath,
            problem: "it is a folder, not an HTML file",
            folder: true,
          });
        }
        continue;
      }

      const fileHtml = read.text;
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
  for (const { srcPath, problem, folder } of checked.values()) {
    findings.push({
      code: "missing_or_empty_sub_composition",
      severity: "error",
      message: `data-composition-src references "${srcPath}", but ${problem}.`,
      fixHint: folder
        ? `Point data-composition-src at the HTML file inside the folder, such as "${srcPath}/index.html".`
        : `Fix this before rendering: the render pre-flight rejects unusable sub-compositions. ` +
          `Write valid HTML into "${srcPath}". It needs a <template> or <body> containing an element with ` +
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
