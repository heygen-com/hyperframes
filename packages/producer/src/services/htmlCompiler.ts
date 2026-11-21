import { decodedUrlPath } from "@hyperframes/parsers/asset-paths";
import {
  cssRuleMatches,
  cssUrlMatches,
  fontFaceBlockMatches,
  hasBackgroundImageDeclaration,
  importRuleMatches,
  localFontFaceUrlMatches,
  remoteBackgroundUrlMatches,
  remoteFontFaceUrlMatches,
  replaceMatches,
  styleBlockMatches,
  stylesheetLinkMatches,
} from "@hyperframes/parsers/css-url-scans";
// fallow-ignore-file code-duplication complexity
/**
 * HTML Compiler for Producer
 *
 * Two-phase compilation that guarantees every media element has data-end:
 * 1. Static pass via core's compileTimingAttrs() (data-start + data-duration → data-end)
 * 2. ffprobe resolution for elements without data-duration
 *
 * Also handles sub-compositions referenced via data-composition-src,
 * recursively extracting nested media from sub-sub-compositions.
 */

import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from "fs";
import { join, dirname, resolve, basename, relative, sep } from "path";
import { parseHTML } from "linkedom";
import { bundledScript } from "./bundledScripts.js";
import {
  inlineScriptBlocks,
  remoteSrcUrls,
  removeDelimitedRuns,
  replaceGsapDistScripts,
  stripCrossoriginAttr,
  stripPreloadNone,
} from "./htmlTagScans.js";
import {
  COMPOSITION_SOURCE_URL,
  compileTimingAttrs,
  injectDurations,
  extractResolvedMedia,
  clampDurations,
  shouldClampResolvedMediaDuration,
  isNonRelativeUrl,
  parseStrictFiniteTimingNumber,
  readMediaStart,
  redactTelemetryString,
  resolveNaturalMediaTimelineDurationFromValues,
  rewriteAssetPath,
  rewriteAssetPaths,
  rewriteCssAssetUrls,
  rewriteInlineStyleAssetUrls,
  type RateSpec,
  type ResolvedDuration,
  type UnresolvedElement,
  terminalText,
} from "@hyperframes/core";
import { MAX_AUDIO_GAIN } from "@hyperframes/core/audio-gain";
import { CAPTURE_CANVAS_SELECTOR } from "@hyperframes/core/html-in-canvas";
import { readPlaybackRate } from "@hyperframes/parsers/media-duration";
import { resolveRateSpec } from "@hyperframes/core/speed-ramp";
import { gsapCdnDist, normalizeGsapBaseUrl } from "@hyperframes/core/gsap-cdn";
import {
  assignBundledRuntimeCompositionIds,
  assignMediaRenderIds,
  type BundledHostCompositionIdentity,
  emitVariablesByCompScript,
  inlineSubCompositions as inlineSubCompositionsShared,
  ensureExternalLinkTag,
  ensureExternalScriptTag,
  deferScriptsUntilFonts,
  emitMountedModuleScripts,
  isJavaScriptType,
  prepareFlattenedInnerRoot,
  emitRootCompositionVariableStyles,
  dropAuthoredSvgReferenceAliases,
  readDeclaredDefaults,
  parseHostVariableValues,
  boundMediaSrc,
  headStyleRuns,
  isAlwaysAppliedStyle,
  dedupeFontFaceRules,
  inlineScriptRuns,
  parsesAsScript,
  styleElementsFor,
  insertBeforeCloseTag,
  isRuntimeFileUrl,
} from "@hyperframes/core/compiler";
import {
  checkSubCompositionUsability,
  type ParsableDocumentLike,
} from "@hyperframes/parsers/sub-composition-validity";
import {
  isUnresolvedAssetPlaceholder,
  namesAnotherNetworkRoot,
  projectAssetExists,
  readProjectFile,
  readTextFile,
  resolveCompositionSrc,
} from "@hyperframes/parsers/asset-resolution";
import { isPrivateFileUnder, isStudioPrivatePath } from "@hyperframes/core/safe-path";
import { linksOutside } from "@hyperframes/studio-server/outside-file";
import { extractMediaMetadata, extractAudioMetadata } from "../utils/ffprobe.js";
import {
  assertCompositionFileSize,
  CompositionExpansionBudget,
  ENTRY_PAGE,
  REMOTE_SCRIPTS,
  REMOTE_STYLESHEETS,
} from "@hyperframes/core/compiler";
import {
  escapesAssetRoot,
  isPathInside,
  leftOutOfRender,
  outsideAssetRefusal,
  type OutsideFilePolicy,
  refusesOutsideLink,
  toExternalAssetKey,
} from "../utils/paths.js";
import { collectHiddenVideoIds, collectRenderMedia } from "./renderMediaCollector.js";
import {
  type VideoElement,
  type ImageElement,
  type AudioElement,
  type AudioVolumeKeyframe,
  type MediaProbeProfile,
  analyzeKeyframeIntervals,
  assertMediaPayload,
  createConcurrencyLimit,
  isPrivateUnderAssetRoots,
  NotMediaPayloadError,
  parseMasterFxChain,
  probeMediaProfile,
} from "@hyperframes/engine";
import {
  downloadToTemp,
  fetchPublicHttpsBytes,
  fetchPublicHttpsText,
  isHttpUrl,
  safeDownloadUrlIdentity,
  type UrlDownloadTelemetry,
} from "../utils/urlDownloader.js";
import type { Page } from "puppeteer-core";
import {
  injectDeterministicFontFaces,
  normalizeSystemFontPrimaryFamilies,
} from "@hyperframes/core/fonts/embed";
import { prepareAnimatedGifInputs } from "./animatedGifPrep.js";
import { prepareHeifImageInputs } from "./heifImagePrep.js";
import {
  createStudioPositionSeekReapplyScript,
  htmlHasStudioPositionEdits,
} from "@hyperframes/studio-server/manual-edits-render-script";
import { getPositionEditsRenderScript } from "@hyperframes/core/runtime/position-edits-render";
import { defaultLogger, type ProducerLogger } from "../logger.js";
import { assertAssetMediaTypeProfile } from "./assetMediaType.js";
import { withMediaProbeSlot } from "../utils/mediaProbeConcurrency.js";

function logRemoteDownloadTelemetry(event: UrlDownloadTelemetry): void {
  defaultLogger.debug("[Compiler] Remote asset download integrity", { ...event });
}

export interface CompiledComposition {
  html: string;
  subCompositions: Map<string, string>;
  videos: VideoElement[];
  audios: AudioElement[];
  images: ImageElement[];
  droppedMediaIds: Set<string>;
  gradedCanvas: boolean;
  masterFxChain?: string;
  unresolvedCompositions: UnresolvedElement[];
  variablesByComp: Record<string, Record<string, unknown>>;
  /** Assets that resolve outside projectDir. Keys are the path used in HTML, values are absolute filesystem paths. */
  externalAssets: Map<string, string>;
  width: number;
  height: number;
  staticDuration: number;
  renderModeHints: RenderModeHints;
  hasShaderTransitions: boolean;
  /** Author HTML/CSS/scripts use a CSS 3D rendering context (pre-CDN-inline scan). */
  usesThreeDTransforms: boolean;
  /** Ancestors of the composition root carry a background-image (gradient/url). */
  hasAncestorBackgroundImage: boolean;
}

const INFERRED_MEDIA_DURATION_ATTR = "data-hf-inferred-duration";

/** Adapts linkedom's `parseHTML` to the `checkSubCompositionUsability` contract. */
function parseSubCompHtmlForValidity(html: string): ParsableDocumentLike {
  return parseHTML(html).document as unknown as ParsableDocumentLike;
}

function endsWithSourceUrl(code: string): boolean {
  const trimmed = code.trimEnd();
  const lastLine = trimmed.slice(trimmed.lastIndexOf("\n") + 1).trimStart();
  return lastLine.startsWith("//# sourceURL=") || lastLine.startsWith("//@ sourceURL=");
}

// One name for the composition's inline code lets a render keep its errors and not a widget's.
function prepareCompositionScripts(html: string): string {
  const { document } = parseHTML(html);
  for (const el of document.querySelectorAll("script:not([src])")) {
    const isModule = (el.getAttribute("type") || "").trim().toLowerCase() === "module";
    const runsAsScript = isModule || isJavaScriptType(el as unknown as Element);
    const code = el.textContent ?? "";
    if (!runsAsScript || endsWithSourceUrl(code)) continue;
    el.textContent = `${code}\n//# sourceURL=${COMPOSITION_SOURCE_URL}`;
  }
  deferScriptsUntilFonts(document as unknown as Document);
  return document.toString();
}

export function injectSdkPositionEditsRenderScript(html: string): string {
  if (!html.includes("data-hf-edit-base-x") && !html.includes("data-hf-edit-base-y")) {
    return html;
  }
  const scriptBody = getPositionEditsRenderScript().replace(/<\/script/gi, "<\\/script");
  const script = `<script>${scriptBody}\n//# sourceURL=hyperframes://position-edits</script>`;
  return insertBeforeCloseTag(html, "body", script) ?? `${html}${script}`;
}

/**
 * Thrown by {@link assertSubCompositionsUsable} when one or more
 * `data-composition-src` references resolve to a missing, empty, or
 * unparsable file. This is the render-path enforcement of the #1 render
 * failure bucket in production telemetry: a scene-authoring step (most
 * commonly an AI agent) writes the `data-composition-src` reference before,
 * or without ever, writing valid content into the scene file.
 *
 * Unlike the tolerant inliner (`packages/core/src/compiler/inlineSubCompositions.ts`,
 * intentionally kept lenient for preview/studio so mid-authoring iteration
 * doesn't break bundling), a render that silently drops a scene produces a
 * materially broken video with no visible error — strictly worse than
 * refusing to render. This check runs before any compilation work starts so
 * the failure is immediate and names every offending file at once, instead
 * of surfacing 45+ seconds later as a `pollSubCompositionTimelines` timeout
 * or a raw `Cannot destructure property 'firstElementChild' of
 * 'documentElement' as it is null` crash deep inside linkedom.
 *
 * Not exported — nothing needs `instanceof` narrowing on this today. Callers
 * catch it generically (`catch (err: unknown)`, matching on `.message`) the
 * same way they handle every other compile-time failure. Kept as a class
 * (not a plain `throw new Error(...)`) so the aggregated multi-file message
 * construction has a single, testable home.
 */
class EmptyCompositionError extends Error {
  readonly code = "EMPTY_COMPOSITION" as const;
  readonly problems: ReadonlyArray<{ srcPath: string; detail: string }>;

  constructor(problems: ReadonlyArray<{ srcPath: string; detail: string }>) {
    const lines = problems.map((p) => `  - ${p.srcPath}: ${p.detail}`);
    super(
      `${problems.length} composition file${problems.length === 1 ? "" : "s"} referenced by ` +
        `data-composition-src cannot be rendered:\n${lines.join("\n")}\n\n` +
        "Check that each file referenced by data-composition-src contains valid HTML with a " +
        "[data-composition-id] element in a <template>, <body>, or bare fragment. If a scene-authoring " +
        "step is still running, wait for it to finish before referencing the file.",
    );
    this.name = "EmptyCompositionError";
    this.problems = problems;
  }
}

/** The html with each data-composition-src as the project-relative path it names (%xx decoded, no leading /, \ or ./). */
function normalizeCompositionSrcs(html: string, projectDir: string): string {
  return html.replace(/(\bdata-composition-src=)(["'])([^"']*)\2/g, (whole, name, quote, value) => {
    if (!value.includes("%") && !/^\.?[\\/]/.test(value)) return whole;
    const file = resolveCompositionSrc(projectDir, value);
    if (file === null) return whole;
    return `${name}${quote}${relative(projectDir, file).split(sep).join("/")}${quote}`;
  });
}

const COMPOSITION_FILE = /\.html?$/i;
const NOT_A_COMPOSITION_FILE = "it is not an .html file, so it is refused";

function resolveCompositionPath(
  projectDir: string,
  src: string,
  assetRoot: string | undefined,
): string | null {
  const file = resolveCompositionSrc(projectDir, src);
  return file === null || escapesAssetRoot(file, assetRoot) ? null : file;
}

function resolveCompositionFile(
  projectDir: string,
  src: string,
  assetRoot: string | undefined,
): string | null {
  const file = resolveCompositionPath(projectDir, src, assetRoot);
  return file !== null && COMPOSITION_FILE.test(file) ? file : null;
}

const OUTSIDE_COMPOSITION_NEEDS_FLAG =
  "it is outside the project, and any scripts in it would run; move it into the project, or pass --include-outside-files to hyperframes render, to include it";

/** A trusted local render was not told to run markup whose real file is outside the project. */
const runsOutsideMarkupUnasked = (
  projectDir: string,
  filePath: string,
  assetRoot: string | undefined,
  outsideFiles: OutsideFilePolicy,
): boolean =>
  assetRoot === undefined && !outsideFiles.includeScripts && linksOutside(projectDir, filePath);

/** The readers check again, so a file swapped for an outside link after the pre-flight is still refused. */
function assertOutsideMarkupAsked(
  projectDir: string,
  filePath: string,
  srcPath: string,
  assetRoot: string | undefined,
  outsideFiles: OutsideFilePolicy,
): void {
  if (runsOutsideMarkupUnasked(projectDir, filePath, assetRoot, outsideFiles)) {
    throw new EmptyCompositionError([{ srcPath, detail: OUTSIDE_COMPOSITION_NEEDS_FLAG }]);
  }
}

// Git metadata, env files and the app's `.hyperframes/` records are never inlined into a render, as preview refuses them.
const isPrivateCompositionFile = (projectDir: string, filePath: string): boolean =>
  isPrivateFileUnder(projectDir, filePath, isStudioPrivatePath);

type CompositionProblem = { srcPath: string; detail: string };

/** `templated` holds mounts inside templates. Reading `template.content` per level would clone each subtree again. */
function compositionSrcsIn(html: string): { mounts: string[]; templated: string[] } {
  const { document } = parseHTML(html);
  const mounts: string[] = [];
  const templated: string[] = [];
  const stack: Array<[Element, boolean]> = [...document.children]
    .reverse()
    .map((el) => [el, false]);
  for (let next = stack.pop(); next; next = stack.pop()) {
    const [el, inTemplate] = next;
    const srcPath = el.getAttribute("data-composition-src");
    if (srcPath && !isUnresolvedAssetPlaceholder(srcPath)) {
      (inTemplate ? templated : mounts).push(srcPath);
    }
    const childrenInTemplate = inTemplate || el.localName === "template";
    const children = [...el.children];
    for (let i = children.length - 1; i >= 0; i -= 1)
      stack.push([children[i]!, childrenInTemplate]);
  }
  return { mounts, templated };
}

function compositionPathProblem(
  projectDir: string,
  filePath: string,
  assetRoot: string | undefined,
  outsideFiles: OutsideFilePolicy,
): string | null {
  if (outsideAssetRefusal(projectDir, filePath) === "blocklisted") {
    return "it is outside the project in a private location";
  }
  if (runsOutsideMarkupUnasked(projectDir, filePath, assetRoot, outsideFiles)) {
    return OUTSIDE_COMPOSITION_NEEDS_FLAG;
  }
  if (isPrivateCompositionFile(projectDir, filePath)) {
    return "it is git metadata, an env file or a private tool record";
  }
  return COMPOSITION_FILE.test(filePath) ? null : NOT_A_COMPOSITION_FILE;
}

function readSubCompositionFile(
  filePath: string,
  srcPath: string,
): { detail: string } | { bytes: number; mounts: string[]; templated: string[] } {
  assertCompositionFileSize(filePath, srcPath);
  const read = readProjectFile(filePath);
  if (read.kind === "missing") return { detail: "the file does not exist" };
  if (read.kind === "folder") return { detail: "it is a folder, not an HTML file" };
  const validity = checkSubCompositionUsability(read.text, parseSubCompHtmlForValidity);
  if (!validity.ok)
    return { detail: validity.detail ?? "the file is empty or could not be parsed" };
  return { bytes: Buffer.byteLength(read.text), ...compositionSrcsIn(read.text) };
}

/**
 * Recursively walk every `data-composition-src` reference reachable from
 * `html` (including nested sub-compositions) and verify each resolves to a
 * usable file — exists, non-empty, parses to HTML with renderable content.
 * Uses the same `checkSubCompositionUsability` helper the tolerant inliner
 * and `hyperframes lint` use, so all three agree on what counts as usable.
 *
 * Throws {@link EmptyCompositionError} naming every offending file at once
 * (not just the first one hit) if any reference is unusable. Call this
 * before any compilation work starts — it deliberately duplicates a small
 * amount of file-reading work that `parseSubCompositions` also does, in
 * exchange for failing in milliseconds instead of after the browser has
 * already launched and waited out a capture timeout.
 */
function assertSubCompositionsUsable(
  html: string,
  projectDir: string,
  assetRoot: string | undefined,
  outsideFiles: OutsideFilePolicy,
): void {
  const budget = new CompositionExpansionBudget();
  const files = new Map<string, ReturnType<typeof readSubCompositionFile>>();
  const problems = new Map<string, CompositionProblem>();
  const report = (srcPath: string, detail: string) =>
    problems.set(`${srcPath}\0${detail}`, { srcPath, detail });
  // The files on the current mount chain. A repeat is a cycle, which the compiler skips silently too.
  const chain = new Set<string>();
  const paths = new Map<string, { detail: string } | { filePath: string }>();
  const resolveMount = (srcPath: string): { detail: string } | { filePath: string } => {
    const filePath = resolveCompositionPath(projectDir, srcPath, assetRoot);
    if (filePath === null) return { detail: "it is outside the project folder" };
    const detail = compositionPathProblem(projectDir, filePath, assetRoot, outsideFiles);
    return detail ? { detail } : { filePath };
  };

  // data-composition-src resolves root-relative at every level, as parseSubCompositions and the inliner
  // resolve it, so `projectDir` stays unchanged. Each path is checked, and each file read, once.
  // A mount inside a template is charged to the budget but not reported: the inliner skips it with a warning.
  const walk = (srcPaths: readonly string[], quiet: boolean): void => {
    for (const srcPath of srcPaths) {
      let resolved = paths.get(srcPath);
      if (!resolved) {
        resolved = resolveMount(srcPath);
        paths.set(srcPath, resolved);
      }
      if ("detail" in resolved) {
        if (!quiet) report(srcPath, resolved.detail);
        continue;
      }
      const { filePath } = resolved;
      if (chain.has(filePath)) continue;

      let file = files.get(filePath);
      if (!file) {
        file = readSubCompositionFile(filePath, srcPath);
        files.set(filePath, file);
      }
      if ("detail" in file) {
        if (!quiet) report(srcPath, file.detail);
        continue;
      }
      budget.charge(srcPath, file.bytes);
      chain.add(filePath);
      walk(file.mounts, quiet);
      walk(file.templated, true);
      chain.delete(filePath);
    }
  };
  const entry = compositionSrcsIn(html);
  walk(entry.mounts, false);
  walk(entry.templated, true);

  if (problems.size > 0) {
    throw new EmptyCompositionError([...problems.values()]);
  }
}

export type RenderModeHintCode =
  | "iframe"
  | "requestAnimationFrame"
  | "htmlInCanvas"
  | "captureMotionBlur";

export interface RenderModeHint {
  code: RenderModeHintCode;
  message: string;
}

export interface RenderModeHints {
  recommendScreenshot: boolean;
  reasons: RenderModeHint[];
}

const COMPILER_MOUNT_BLOCK_START = "/* __HF_COMPILER_MOUNT_START__ */";
const COMPILER_MOUNT_BLOCK_END = "/* __HF_COMPILER_MOUNT_END__ */";

function stripJsComments(source: string): string {
  return removeDelimitedRuns(source.replace(/\/\/.*$/gm, ""), "/*", "*/");
}

function stripCompilerMountBootstrap(source: string): string {
  return removeDelimitedRuns(source, COMPILER_MOUNT_BLOCK_START, COMPILER_MOUNT_BLOCK_END);
}

/** The composition the runtime reads data-motion-blur from: `data-root="true"`, else the first. */
function runtimeRoot(document: ParentNode): Element | null {
  return (
    document.querySelector('[data-composition-id][data-root="true"]') ??
    document.querySelector("[data-composition-id]")
  );
}

export function detectRenderModeHints(html: string, pageMotionBlur?: "off"): RenderModeHints {
  const reasons: RenderModeHint[] = [];
  const { document } = parseHTML(html);

  if (document.querySelector(CAPTURE_CANVAS_SELECTOR)) {
    reasons.push({
      code: "htmlInCanvas",
      message:
        "Detected html-in-canvas API (layoutsubtree canvas). Chrome does not support concurrent drawElementImage across multiple workers; render is pinned to a single worker.",
    });
  } else if (
    pageMotionBlur !== "off" &&
    runtimeRoot(document)?.getAttribute("data-motion-blur") === "on"
  ) {
    // Not pinned to one worker: k3-promo measured identical across 1 and 4 workers, 2× faster.
    reasons.push({
      code: "captureMotionBlur",
      message:
        'Detected motion blur (data-motion-blur="on"), drawn per frame with an SVG filter or, on the capture tier, html-in-canvas; routed through screenshot capture mode.',
    });
  }

  if (document.querySelector("iframe")) {
    reasons.push({
      code: "iframe",
      message:
        "Detected <iframe> in the composition DOM. Nested iframe animation is routed through screenshot capture mode for compatibility.",
    });
  }

  for (const { attrs, body } of inlineScriptBlocks(html)) {
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const content = stripJsComments(stripCompilerMountBootstrap(body));
    if (!/requestAnimationFrame\s*\(/.test(content)) continue;
    reasons.push({
      code: "requestAnimationFrame",
      message:
        "Detected raw requestAnimationFrame() in an inline script. This render is routed through screenshot capture mode with virtual time enabled.",
    });
    break;
  }

  return {
    recommendScreenshot: reasons.length > 0,
    reasons,
  };
}

/**
 * 3D rendering-context signals. drawElementImage paints elements inside a
 * CSS 3D rendering context incorrectly: backface-visibility:hidden is
 * ignored (mid-flip elements show their mirrored backface), sibling content
 * of the 3D context can drop out of the capture, and the context's
 * background is lost. Observed on real-world gen_os comps (flip-card and
 * rotationX scene-entrance patterns) on macOS hardware GPU — this is a
 * drawElementImage limitation, not a SwiftShader artifact.
 *
 * Only genuine 3D-context signals are matched: `perspective` (property or
 * transform function), `transform-style: preserve-3d`, `backface-visibility`,
 * `matrix3d(` / `rotate3d(`, and GSAP's `transformPerspective`. Flat
 * rotationX/Y tweens without a perspective context render as 2D and are
 * deliberately NOT matched, nor is the ubiquitous `translateZ(0)` promotion
 * hack.
 */
const THREE_D_CONTEXT_PATTERN =
  /transform-style\s*:\s*preserve-3d|backface-visibility\s*:|perspective\s*:\s*[0-9]|perspective\s*\(|matrix3d\s*\(|rotate3d\s*\(|\btransformPerspective\b/i;

export function detectThreeDTransformUsage(html: string): boolean {
  return THREE_D_CONTEXT_PATTERN.test(html);
}

/**
 * Background-image signals on ancestors of the composition root.
 * drawElementImage only paints the captured subtree; drawElementService's
 * per-frame ancestor fill replicates what lies behind it by walking up the
 * DOM for the nearest non-transparent `backgroundColor`. A background-IMAGE
 * (linear-gradient, url) on <body>/<html>/a wrapper reads as transparent in
 * that scan, so a deeper ancestor's solid color paints instead — measured:
 * a body `linear-gradient` replaced by the html background color wherever
 * the subtree left pixels uncovered (30.9 dB min vs baseline), and the
 * damage can set in late enough to slip past the self-verify sample grid.
 * Backgrounds on elements INSIDE the root are painted correctly and are
 * deliberately not matched — this walks only the root's ancestor chain and
 * the style rules that select into it.
 */
export function detectAncestorBackgroundImage(html: string): boolean {
  const { document } = parseHTML(html);
  const root = document.querySelector("[data-composition-id]");
  if (!root) return false;
  const ancestors: Element[] = [];
  for (let el = root.parentElement; el; el = el.parentElement) ancestors.push(el);
  if (document.documentElement && !ancestors.includes(document.documentElement)) {
    ancestors.push(document.documentElement);
  }
  // Inline styles on the ancestor chain.
  for (const el of ancestors) {
    const style = el.getAttribute("style");
    if (style && hasBackgroundImageDeclaration(`{${style}}`)) return true;
  }
  // <style> rules: any rule carrying an image-painting background declaration
  // whose selector resolves to an ancestor of the root. Selector matching goes
  // through querySelectorAll so class/id/compound selectors on wrappers are
  // covered, not just literal `body`/`html`.
  for (const styleEl of document.querySelectorAll("style")) {
    const css = styleEl.textContent ?? "";
    for (const { parts: rule } of cssRuleMatches(css)) {
      const [, selectorList, declarations] = rule;
      if (!hasBackgroundImageDeclaration(`{${declarations}}`)) continue;
      for (const selector of selectorList.split(",")) {
        const sel = selector.trim();
        if (!sel || sel.startsWith("@")) continue;
        if (/^(?:html|:root)$/i.test(sel)) return true;
        try {
          for (const matched of document.querySelectorAll(sel)) {
            if (ancestors.includes(matched)) return true;
          }
        } catch {
          // Selector syntax linkedom can't parse (e.g. vendor pseudo) — skip.
        }
      }
    }
  }
  return false;
}

const SHADER_TRANSITION_USAGE_PATTERN =
  /\b(?:(?:window|globalThis)\s*\.\s*)?HyperShader\s*\.\s*init\s*\(|\b__hf\s*\.\s*transitions\s*=/;

export function detectShaderTransitionUsage(html: string): boolean {
  for (const { attrs, body } of inlineScriptBlocks(html)) {
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const content = stripJsComments(stripCompilerMountBootstrap(body));
    if (SHADER_TRANSITION_USAGE_PATTERN.test(content)) return true;
  }

  return false;
}

type SourceProbe = { profile: MediaProbeProfile; fileDuration: number | null } | { error: unknown };

/** One probe per unique source for a whole compile, whatever number of elements point at it. */
type SourceProbes = Map<string, Promise<SourceProbe>>;

/** At most this many distinct remote media, image and font files download for one compile. */
export const MAX_REMOTE_ASSETS = 1000;
const ASSET_DOWNLOADS_AT_ONCE = 8;

/** One compile's media, image and font downloads: its cancel, a cap on distinct files, a few at a time. */
class AssetDownloads {
  private readonly reserved = new Set<string>();
  private running = 0;
  private readonly queued: (() => void)[] = [];
  private readonly ended = new AbortController();
  readonly signal: AbortSignal;

  constructor(cancel?: AbortSignal) {
    this.signal = cancel ? AbortSignal.any([cancel, this.ended.signal]) : this.ended.signal;
  }

  /** Stops every download still running or queued: the compile that owns them has returned. */
  end(): void {
    this.ended.abort(new Error("The compile that started this download has ended"));
  }

  /** Throws before any of `urls` downloads when they would take the compile past the cap. */
  reserve(urls: Iterable<string>): void {
    this.signal?.throwIfAborted();
    const fresh = new Set([...urls].filter((url) => !this.reserved.has(url)));
    if (this.reserved.size + fresh.size > MAX_REMOTE_ASSETS) {
      throw new Error(
        `The composition links more than ${MAX_REMOTE_ASSETS} remote media, image and font files; at most ${MAX_REMOTE_ASSETS} are downloaded at compile time`,
      );
    }
    for (const url of fresh) this.reserved.add(url);
  }

  async download(url: string, destDir: string): Promise<string> {
    while (this.running >= ASSET_DOWNLOADS_AT_ONCE) {
      await new Promise<void>((resolve) => this.queued.push(resolve));
    }
    if (this.signal?.aborted) {
      this.queued.shift()?.();
      this.signal.throwIfAborted();
    }
    this.running += 1;
    try {
      return await downloadToTemp(url, destDir, undefined, this.signal, undefined, {
        onTelemetry: logRemoteDownloadTelemetry,
      });
    } finally {
      this.running -= 1;
      this.queued.shift()?.();
    }
  }
}

const downloadAsset = (url: string, destDir: string, assets?: AssetDownloads) =>
  assets
    ? assets.download(url, destDir)
    : downloadToTemp(url, destDir, undefined, undefined, undefined, {
        onTelemetry: logRemoteDownloadTelemetry,
      });

/** What one compile shares across the root and every sub-composition it compiles. */
interface CompileRun {
  probes: SourceProbes;
  assets: AssetDownloads;
}

async function resolveMediaDuration(
  src: string,
  mediaStart: number,
  playbackRate: RateSpec,
  projectDir: string,
  baseDir: string,
  downloadDir: string,
  tagName: string,
  elementIdentity: string,
  log?: ProducerLogger,
  urlByAbsentLocalPath?: ReadonlyMap<string, string>,
  run?: CompileRun,
  assetRoot?: string,
): Promise<{ duration: number | null; resolvedPath: string }> {
  let filePath = src;

  if (isHttpUrl(src)) {
    const remoteDir = join(downloadDir, REMOTE_MEDIA_SUBDIR);
    if (!existsSync(remoteDir)) mkdirSync(remoteDir, { recursive: true });
    run?.assets.reserve([src]);
    try {
      filePath = await downloadAsset(src, remoteDir, run?.assets);
    } catch (err) {
      if (run?.assets.signal?.aborted) throw err;
      // Download failed (e.g. 404 placeholder URL) — skip gracefully.
      // The element will get duration 0 and be excluded from the render.
      return { duration: null, resolvedPath: src };
    }
  } else {
    filePath = decodedUrlPath(src);
    if (!filePath.startsWith("/")) filePath = join(baseDir, filePath);
    if (
      escapesAssetRoot(filePath, assetRoot) ||
      isPrivateUnderAssetRoots(filePath, [projectDir, downloadDir])
    ) {
      return { duration: null, resolvedPath: filePath };
    }
    // ffprobe reads only the header of a remote source, so it is probed in place.
    filePath = urlByAbsentLocalPath?.get(filePath) ?? filePath;
    if (!isHttpUrl(filePath) && namesAnotherNetworkRoot(baseDir, filePath)) {
      return { duration: null, resolvedPath: filePath };
    }
  }

  if (!isHttpUrl(filePath) && !existsSync(filePath)) {
    return { duration: null, resolvedPath: filePath };
  }

  // STUDIO-5433: attach the remote `src` to any ffprobe failure surfaced from
  // this branch. `extractMediaMetadata` → `runFfprobe` intentionally redacts
  // its local `filePath` out of the error message (see
  // engine/utils/ffprobe.ts::redactFfprobeInput), so a bare `moov atom not
  // found` in Datadog carries no attribution and requires a Temporal history
  // dump to identify the offending source. Re-throwing with the `src`
  // (query-string redacted via `redactTelemetryString` so pre-signed URL
  // signatures never reach telemetry) makes the next occurrence diagnosable
  // directly from the render error. Fail-fast semantics for the video branch
  // are preserved — only the message is enriched.
  const withSrcContext = (error: unknown): Error => {
    // A NotMediaPayloadError already carries its own attribution AND the
    // routing metadata downstream keys on — `.code = "NOT_MEDIA_PAYLOAD"`,
    // `.owner = "user"`, `.retryable = false`, `.elementFingerprints`. Wrapping
    // it in a bare Error drops all four, flipping a user-input bug to
    // generic/system/retryable: it pages ops and re-runs the render. Pass it
    // through untouched.
    if (error instanceof NotMediaPayloadError) return error;
    const originalMessage = error instanceof Error ? error.message : String(error);
    const safeSrc = redactTelemetryString(src);
    const wrapped = new Error(`${originalMessage} [src=${safeSrc}]`);
    if (error instanceof Error && error.stack) wrapped.stack = error.stack;
    return wrapped;
  };

  const probe = () =>
    withMediaProbeSlot(async (): Promise<SourceProbe> => {
      try {
        // Payload sniff (STUDIO-5433): if an authoring bug hands us a text
        // payload (e.g. an unresolved nested-composition preview URL), fail with
        // a typed NotMediaPayloadError instead of letting ffprobe emit an opaque
        // `[mov,mp4,...] moov atom not found` that routes as a codec bug.
        await assertMediaPayload(filePath, elementIdentity);
        const signal = run?.assets.signal;
        const profile = await probeMediaProfile(filePath, { signal });
        if (tagName === "video") {
          const { durationSeconds } = await extractMediaMetadata(filePath, { signal });
          return { profile, fileDuration: durationSeconds };
        }
        try {
          const { durationSeconds } = await extractAudioMetadata(filePath, { signal });
          return { profile, fileDuration: durationSeconds };
        } catch {
          if (signal?.aborted) throw signal.reason;
          // Source file has no audio stream (e.g. a silent video used as an audio src).
          // Duration 0 excludes the element from the composition, as missing files do.
          return { profile, fileDuration: null };
        }
      } catch (error) {
        return { error };
      }
    });
  const key = `${tagName}\0${filePath}`;
  let probed = run?.probes.get(key);
  if (!probed) {
    probed = probe();
    run?.probes.set(key, probed);
  }
  const outcome = await probed;
  if ("error" in outcome) {
    // Invalid video sources surface their probe failure; invalid or unreadable
    // audio sources resolve to zero duration and are excluded by the compiler.
    if (tagName !== "video") {
      if (outcome.error instanceof NotMediaPayloadError) {
        log?.warn(
          `[compile] Audio "${elementIdentity}" (${src}) is a text document, not a media ` +
            "file, so the element is dropped from the render. Point it at a rendered media file.",
        );
      }
      return { duration: null, resolvedPath: filePath };
    }
    throw withSrcContext(outcome.error);
  }
  assertAssetMediaTypeProfile(
    tagName === "video" ? "video" : "audio",
    outcome.profile,
    elementIdentity,
  );
  if (outcome.fileDuration === null) return { duration: null, resolvedPath: filePath };
  const duration = resolveNaturalMediaTimelineDurationFromValues(
    outcome.fileDuration,
    mediaStart,
    playbackRate,
  );
  return { duration, resolvedPath: filePath };
}

/**
 * Compile a single HTML file: static pass + ffprobe for unresolved media.
 * Returns compiled HTML and any unresolved composition elements that need browser resolution.
 */
function markInferredVariableMediaDurations(
  html: string,
  unresolvedMedia: readonly UnresolvedElement[],
): string {
  const unresolvedIds = new Set(unresolvedMedia.map((element) => element.id));
  if (unresolvedIds.size === 0) return html;

  const { document } = parseHTML(html);
  let changed = false;
  for (const element of document.querySelectorAll("video[data-var-src], audio[data-var-src]")) {
    if (!unresolvedIds.has(element.id)) continue;
    element.setAttribute(INFERRED_MEDIA_DURATION_ATTR, "");
    changed = true;
  }
  return changed ? document.toString() : html;
}

async function compileHtmlFile(
  html: string,
  projectDir: string,
  baseDir: string,
  downloadDir: string,
  log?: ProducerLogger,
  urlByAbsentLocalPath?: ReadonlyMap<string, string>,
  run?: CompileRun,
  assetRoot?: string,
): Promise<{ html: string; unresolvedCompositions: UnresolvedElement[] }> {
  const { html: staticCompiled, unresolved } = compileTimingAttrs(html);

  const mediaUnresolved = unresolved.filter(
    (el) => (el.tagName === "video" || el.tagName === "audio") && el.src,
  );

  const unresolvedCompositions = unresolved.filter((el) => el.tagName === "div");

  // Every remote source of this file counts against the cap before any of them downloads.
  run?.assets.reserve(mediaUnresolved.map((el) => el.src!).filter(isHttpUrl));
  // Phase 1: Resolve missing durations (parallel ffprobe)
  const resolvedResults = await Promise.all(
    mediaUnresolved.map((el) =>
      resolveMediaDuration(
        el.src!,
        el.mediaStart,
        el.playbackRate,
        projectDir,
        baseDir,
        downloadDir,
        el.tagName,
        el.id,
        log,
        urlByAbsentLocalPath,
        run,
        assetRoot,
      ).then(({ duration }) => ({ id: el.id, duration })),
    ),
  );
  const resolutions: ResolvedDuration[] = resolvedResults.filter(
    (r): r is ResolvedDuration => r.duration != null && Number.isFinite(r.duration),
  );

  const markedStaticHtml = markInferredVariableMediaDurations(staticCompiled, mediaUnresolved);
  let compiledHtml =
    resolutions.length > 0 ? injectDurations(markedStaticHtml, resolutions) : markedStaticHtml;

  // Phase 2: Bound authored audio to playable source (parallel ffprobe).
  // Explicit video slots may outlive their source and hold the final frame.
  const preResolved = extractResolvedMedia(compiledHtml);
  const hiddenVideoIds = collectHiddenVideoIds(compiledHtml);
  const clampable = preResolved.filter((el) => !!el.src && !el.loop && !hiddenVideoIds.has(el.id));
  run?.assets.reserve(clampable.map((el) => el.src!).filter(isHttpUrl));
  const clampResults = await Promise.all(
    clampable.map(async (el) => {
      const { duration: maxDuration } = await resolveMediaDuration(
        el.src!,
        el.mediaStart,
        el.playbackRate,
        projectDir,
        baseDir,
        downloadDir,
        el.tagName,
        el.id,
        log,
        undefined,
        run,
        assetRoot,
      );
      return { id: el.id, tagName: el.tagName, duration: el.duration, maxDuration, src: el.src! };
    }),
  );
  const clampList: ResolvedDuration[] = [];
  for (const r of clampResults) {
    if (
      r.maxDuration != null &&
      shouldClampResolvedMediaDuration(r.tagName, r.duration, r.maxDuration)
    ) {
      clampList.push({ id: r.id, duration: r.maxDuration });
      // This clip's `data-duration` is being silently shortened to its source.
      // Surface it so the author can confirm the longer slot wasn't intended.
      // ponytail: top-level only — sub-composition audio still gets clamped;
      // thread `log` through parseSubCompositions to warn for it too.
      log?.warn(
        `[compile] Audio "${r.id}" (${r.src}) is ${r.maxDuration.toFixed(2)}s but its ` +
          `data-duration is ${r.duration.toFixed(2)}s, so the slot is shortened to the media ` +
          `length. Set data-duration to ~${r.maxDuration.toFixed(2)}s, trim data-media-start, ` +
          `or use a longer/looping source if that isn't intended.`,
      );
    }
  }

  if (clampList.length > 0) {
    compiledHtml = clampDurations(compiledHtml, clampList);
  }

  // Strip crossorigin from video elements: the render pipeline replaces them with
  // injected frame images, so the browser never needs to load the source.
  // Without this, videos with crossorigin="anonymous" targeting CORS-restricted
  // origins (e.g. S3 without CORS headers) keep readyState=0, blocking page setup.
  compiledHtml = stripCrossoriginAttr(compiledHtml, "video");

  // Strip crossorigin from img elements. The renderer captures DOM frames visually —
  // no canvas readback — so CORS compliance is unnecessary. External images from
  // CORS-restricted origins (e.g. S3) render blank when crossorigin forces a failed
  // CORS request against the renderer's localhost file server.
  compiledHtml = stripCrossoriginAttr(compiledHtml, "img");

  // Strip crossorigin from audio elements. Audio is processed out-of-band via
  // FFmpeg; the browser's CORS policy for audio elements is irrelevant to
  // rendering. Leaving crossorigin="anonymous" causes the browser to issue a
  // CORS-mode preflight from localhost, which S3 buckets without explicit CORS
  // headers reject — leaving audio elements in a failed network state. The
  // FFmpeg audio path reads the src URL directly and is unaffected by browser
  // CORS, so stripping the attribute has no side effects.
  compiledHtml = stripCrossoriginAttr(compiledHtml, "audio");

  return { html: compiledHtml, unresolvedCompositions };
}

/**
 * Compile every sub-composition referenced via data-composition-src, keyed by
 * its source path for the inliner to hoist into the render document.
 * Recurses so nested references are compiled too.
 *
 * Media used to be extracted here as well, with each file's clips offset onto
 * the parent timeline. That is now read off the inlined document instead
 * (collectRenderMedia): per-file extraction had to merge on element id, which
 * is not unique across files, so colliding clips silently collapsed (#3340).
 */
async function parseSubCompositions(
  html: string,
  projectDir: string,
  downloadDir: string,
  visited: Set<string> = new Set(),
  urlByAbsentLocalPath?: ReadonlyMap<string, string>,
  run?: CompileRun,
  assetRoot?: string,
  outsideFiles: OutsideFilePolicy = {},
  compiledSrcs: Set<string> = new Set(),
): Promise<{ subCompositions: Map<string, string> }> {
  const subCompositions = new Map<string, string>();

  const { document } = parseHTML(html);
  const compEls = document.querySelectorAll("[data-composition-src]");

  // Build work items, filtering out invalid/circular entries synchronously
  const workItems: Array<{
    srcPath: string;
    filePath: string;
    rawSubHtml: string;
    nestedVisited: Set<string>;
  }> = [];

  for (const el of compEls) {
    const srcPath = el.getAttribute("data-composition-src");
    if (!srcPath) continue;

    const filePath = resolveCompositionFile(projectDir, srcPath, assetRoot);
    if (filePath === null || isPrivateCompositionFile(projectDir, filePath)) continue;

    // Circular reference guard
    if (visited.has(filePath)) {
      continue;
    }
    // A path compiles the same wherever it is mounted, so each one is compiled once per render.
    if (compiledSrcs.has(srcPath)) continue;
    compiledSrcs.add(srcPath);

    assertOutsideMarkupAsked(projectDir, filePath, srcPath, assetRoot, outsideFiles);
    assertCompositionFileSize(filePath, srcPath);
    const read = readProjectFile(filePath);
    if (read.kind !== "file") {
      continue;
    }

    const rawSubHtml = normalizeCompositionSrcs(read.text, projectDir);
    const nestedVisited = new Set(visited);
    nestedVisited.add(filePath);

    workItems.push({ srcPath, filePath, rawSubHtml, nestedVisited });
  }

  // Parallelize file compilation + recursive parsing
  const results = await Promise.all(
    workItems.map(async (item) => {
      const { html: compiledSub } = await compileHtmlFile(
        rewriteUnresolvableGsapToCdn(item.rawSubHtml, projectDir, item.srcPath),
        projectDir,
        dirname(item.filePath),
        downloadDir,
        undefined,
        urlByAbsentLocalPath,
        run,
        assetRoot,
      );

      const nested = await parseSubCompositions(
        compiledSub,
        projectDir,
        downloadDir,
        item.nestedVisited,
        urlByAbsentLocalPath,
        run,
        assetRoot,
        outsideFiles,
        compiledSrcs,
      );

      return {
        srcPath: item.srcPath,
        compiledSub,
        nested,
      };
    }),
  );

  // Merge results
  for (const r of results) {
    subCompositions.set(r.srcPath, r.compiledSub);

    for (const [key, value] of r.nested.subCompositions) {
      subCompositions.set(key, value);
    }
  }

  return { subCompositions };
}

/**
 * Extract CSS `@import url(...)` rules that load external stylesheets (e.g. Google Fonts)
 * from inline `<style>` blocks and promote them to `<link rel="stylesheet">` +
 * `<link rel="preload">` in `<head>`.
 *
 * This moves font discovery from the CSS cascade to the document parser level so
 * Chromium's `load` event and `networkidle2` correctly track them, preventing
 * font-swap artifacts during frame capture.
 */
function promoteCssImportsToLinkTags(html: string): string {
  const { document } = parseHTML(html);
  const head = document.querySelector("head");
  if (!head) return html;

  const importRe = /@import\s+url\(\s*['"]?([^'")\s]+)['"]?\s*\)\s*;?/gi;
  const seenUrls = new Set<string>();
  const styleEls = document.querySelectorAll("style");

  for (const styleEl of styleEls) {
    const original = styleEl.textContent || "";
    let modified = original;
    let match: RegExpExecArray | null;
    importRe.lastIndex = 0;
    while ((match = importRe.exec(original)) !== null) {
      const url = match[1] ?? "";
      if (!url.startsWith("http://") && !url.startsWith("https://")) continue;
      if (seenUrls.has(url)) {
        modified = modified.replace(match[0], "");
        continue;
      }
      seenUrls.add(url);
      modified = modified.replace(match[0], "");

      const preload = document.createElement("link");
      preload.setAttribute("rel", "preload");
      preload.setAttribute("href", url);
      preload.setAttribute("as", "style");
      head.appendChild(preload);

      const link = document.createElement("link");
      link.setAttribute("rel", "stylesheet");
      link.setAttribute("href", url);
      head.appendChild(link);
    }
    if (modified !== original) {
      styleEl.textContent = modified;
    }
  }

  return document.toString();
}

class ProducerHostIdentityMap extends Map<Element, BundledHostCompositionIdentity> {
  readonly #lateInstanceByCompositionId = new Map<string, number>();
  /** How many elements carry each composition id: the page once, then each mount's copy once. */
  readonly #idCounts = new Map<string, number>();
  /** Hosts whose copied content has not been counted yet; the inliner fills a host after asking for it. */
  #uncounted: ParentNode[];

  constructor(document: Document, initialHosts: Element[]) {
    super(assignBundledRuntimeCompositionIds(initialHosts));
    this.#uncounted = [document];
  }

  #countUncopied(): void {
    for (const root of this.#uncounted.splice(0)) {
      for (const element of Array.from(root.querySelectorAll("[data-composition-id]"))) {
        this.#adjust(element.getAttribute("data-composition-id"), 1);
      }
    }
  }

  #adjust(id: string | null, by: number): void {
    if (id) this.#idCounts.set(id, (this.#idCounts.get(id) ?? 0) + by);
  }

  override get(host: Element): BundledHostCompositionIdentity | undefined {
    this.#countUncopied();
    this.#uncounted.push(host);
    const existing = super.get(host);
    if (existing) return existing;

    // The shared inliner discovers nested hosts after the producer's initial
    // DOM scan. Assign those late hosts on first use so their scope and
    // variables key are fixed before any content is processed.
    const authoredCompositionId =
      (
        host.getAttribute("data-hf-original-composition-id") ||
        host.getAttribute("data-composition-id") ||
        ""
      ).trim() || null;
    if (!authoredCompositionId) {
      const identity = { authoredCompositionId: null, runtimeCompositionId: null };
      this.set(host, identity);
      return identity;
    }

    const ownId = host.getAttribute("data-composition-id");
    const heldByOthers = (id: string) => (this.#idCounts.get(id) ?? 0) - (id === ownId ? 1 : 0) > 0;
    let instanceIndex = this.#lateInstanceByCompositionId.get(authoredCompositionId) || 0;
    let runtimeCompositionId: string;
    do {
      instanceIndex += 1;
      runtimeCompositionId = `${authoredCompositionId}__hf${instanceIndex}`;
    } while (heldByOthers(runtimeCompositionId));
    this.#lateInstanceByCompositionId.set(authoredCompositionId, instanceIndex);

    host.setAttribute("data-hf-original-composition-id", authoredCompositionId);
    host.setAttribute("data-composition-id", runtimeCompositionId);
    this.#adjust(ownId, -1);
    this.#adjust(runtimeCompositionId, 1);
    const identity = { authoredCompositionId, runtimeCompositionId };
    this.set(host, identity);
    return identity;
  }
}

/**
 * Merge each run of adjacent same-condition `<head>` `<style>` blocks into one, `@import`
 * rules at its top, and merge each run of adjacent inline `<body>` `<script>` blocks
 * into one, without moving any of them past a `<script src>` or module script.
 *
 * Mirrors the bundler's `coalesceHeadStylesAndBodyScripts` to guarantee
 * identical CSS cascade order and script execution order between preview and
 * export, preventing font-loading and animation-ordering regressions.
 */

function coalesceHeadStylesAndBodyScripts(html: string): string {
  const { document } = parseHTML(html);
  const head = document.querySelector("head");
  const body = document.querySelector("body");
  if (!head && !body) return html;

  const liveStyles = [...document.querySelectorAll("style")].filter(isAlwaysAppliedStyle);
  const dedupedStyles = dedupeFontFaceRules(liveStyles.map((el) => el.textContent || ""));
  liveStyles.forEach((el, i) => {
    el.textContent = dedupedStyles[i] ?? "";
  });

  const styleEls = head ? Array.from(head.querySelectorAll("style")) : [];
  for (const run of styleEls.length > 1 ? headStyleRuns(styleEls) : []) {
    const imports: string[] = [];
    const cssParts: string[] = [];
    const seenImports = new Set<string>();

    for (const el of run) {
      const raw = (el.textContent || "").trim();
      if (!raw) continue;
      const nonImportCss = replaceMatches(raw, importRuleMatches(raw), (match) => {
        const cleaned = match.trim();
        if (!seenImports.has(cleaned)) {
          seenImports.add(cleaned);
          imports.push(cleaned);
        }
        return "";
      });
      const trimmedCss = nonImportCss.trim();
      if (trimmedCss) cssParts.push(trimmedCss);
    }

    const mergedCss = [...imports, ...cssParts].join("\n\n").trim();
    if (!mergedCss) continue;
    run[0]!.textContent = mergedCss;
    for (const el of run.slice(1)) el.remove();
  }

  if (body) {
    for (const { members, anchor } of inlineScriptRuns(
      Array.from(body.querySelectorAll("script")),
    )) {
      const mergedJs = members
        .map((el) => (el.textContent || "").trim())
        .filter(Boolean)
        .join("\n;\n")
        .trim();
      if (mergedJs && !parsesAsScript(mergedJs)) continue;
      for (const el of members) el.remove();
      if (!mergedJs) continue;
      const script = document.createElement("script");
      script.textContent = mergedJs;
      if (anchor) anchor.before(script);
      else body.appendChild(script);
    }
  }

  return document.toString();
}

/**
 * Inline sub-composition HTML into the main document using the shared
 * inlining logic from @hyperframes/core. This wrapper handles the
 * producer-specific concerns: parsing HTML via linkedom, resolving
 * compositions from the pre-compiled map or disk, and setting explicit
 * pixel dimensions on host elements for headless rendering.
 */
function inlineSubCompositions(
  html: string,
  subCompositions: Map<string, string>,
  projectDir: string,
  variableOverrides: Record<string, unknown>,
  assetRoot: string | undefined,
  outsideFiles: OutsideFilePolicy,
  budget: CompositionExpansionBudget,
): { html: string; variablesByComp: Record<string, Record<string, unknown>> } {
  const { document } = parseHTML(html);
  budget.chargeElements(ENTRY_PAGE, document.querySelectorAll("*").length);
  const head = document.querySelector("head");
  const body = document.querySelector("body");
  const hosts = Array.from(document.querySelectorAll("[data-composition-src]"));

  if (!hosts.length) {
    const dropped = dropAuthoredSvgReferenceAliases(document as unknown as Document);
    // Even with no sub-compositions, declared composition variables need a
    // compile-time stylesheet so eval-time reads (GSAP .from immediateRender,
    // top-level script getComputedStyle) resolve var(--slug) — the runtime's
    // DOMContentLoaded injection is too late for those.
    const emitted = emitRootCompositionVariableStyles(
      document as unknown as Document,
      {},
      variableOverrides,
      { chargeBytes: (bytes) => budget.chargeGenerated("composition variables", bytes) },
    );
    return { html: emitted || dropped ? document.toString() : html, variablesByComp: {} };
  }

  const readOnce = new Map<string, string | null>();
  const readMountHtml = (srcPath: string): string | null => {
    const filePath = resolveCompositionFile(projectDir, srcPath, assetRoot);
    if (filePath) {
      assertOutsideMarkupAsked(projectDir, filePath, srcPath, assetRoot, outsideFiles);
      assertCompositionFileSize(filePath, srcPath);
    }
    const read =
      filePath && !isPrivateCompositionFile(projectDir, filePath)
        ? readProjectFile(filePath)
        : null;
    return read?.kind === "file"
      ? rewriteUnresolvableGsapToCdn(
          normalizeCompositionSrcs(read.text, projectDir),
          projectDir,
          srcPath,
        )
      : null;
  };
  const resolveMountHtml = (srcPath: string): string | null => {
    const compiled = subCompositions.get(srcPath);
    if (compiled) return compiled;
    if (!readOnce.has(srcPath)) readOnce.set(srcPath, readMountHtml(srcPath));
    return readOnce.get(srcPath) ?? null;
  };

  // Assign per-instance runtime composition ids before each host is inlined,
  // mirroring the preview bundler. Initial hosts are assigned as one pre-pass;
  // hosts discovered by the shared inliner's queue are assigned lazily by the
  // map above. When the same sub-composition (same authored
  // data-composition-id) is mounted more than once — the reusable-template
  // pattern from issue #2064 — each host is rewritten to a unique runtime id
  // (`card__hf1`, `card__hf2`). Without this, every instance shares one
  // `__hfVariablesByComp` key and one scope selector: the last mount's
  // data-variable-values clobbers the earlier ones and all-but-one instance
  // renders blank. #2066 fixed the single-instance case but left this
  // divergence (snapshot/preview correct, render wrong).
  const hostIdentityByElement = new ProducerHostIdentityMap(
    document as unknown as Document,
    hosts as unknown as Element[],
  );

  const result = inlineSubCompositionsShared(
    document as unknown as Document,
    hosts as unknown as Element[],
    {
      // hostIdentityMap gives each repeated mount a unique runtime id; the
      // shared inliner's default buildScopeSelector already scopes by
      // `[data-composition-id="<runtime id>"]`, matching the preview bundler.
      hostIdentityMap: hostIdentityByElement,
      readVariableDefaults: readDeclaredDefaults,
      parseHostVariables: parseHostVariableValues,
      resolveFilePath: (srcPath: string) => {
        const file = resolveCompositionFile(projectDir, srcPath, assetRoot);
        return file && relative(projectDir, file).split(sep).join("/");
      },
      resolveHtml: (srcPath: string) => {
        const compHtml = resolveMountHtml(srcPath);
        if (compHtml) budget.charge(srcPath, Buffer.byteLength(compHtml));
        return compHtml;
      },
      chargeEmitted: (srcPath: string, bytes: number) => budget.chargeGenerated(srcPath, bytes),
      chargeElements: (srcPath: string, count: number) => budget.chargeElements(srcPath, count),
      parseHtml: (htmlStr: string) => parseHTML(htmlStr).document as unknown as Document,
      // Mirrors the preview bundler: a sub-composition's SIBLING assets resolve
      // against its own directory, project-root refs stay as authored.
      assetExists: projectAssetExists(projectDir),
      // Preserve the authored root wrapper as a child of the host, matching
      // the preview bundler's shape (htmlBundler.ts's prepareFlattenedInnerRoot,
      // which the runtime compositionLoader mirrors with its own copy for the
      // live-loaded case). Without this, the wrapper element (and its
      // class/id) is discarded and any CSS anchored on it —
      // `.wrapper-class .title`, `#wrapper-id` — is dead at render time even
      // though it works in preview.
      flattenInnerRoot: prepareFlattenedInnerRoot as (innerRoot: Element) => Element,
      onMissingComposition: (srcPath: string, reason?: string) => {
        // In the render path this is normally unreachable — compileForRender
        // calls assertSubCompositionsUsable() before any of this runs, so a
        // hit here means the file changed on disk between that pre-flight
        // check and this later inline step (e.g. a concurrent scene-writer).
        console.warn(
          terminalText(
            `[Compiler] Skipping sub-composition "${srcPath}": ${reason ?? "the file is missing or empty"}.`,
          ),
        );
      },
    },
  );

  // Producer-specific: set explicit pixel dimensions on host elements so
  // children using width/height: 100% resolve correctly. The runtime does
  // this automatically but compiled HTML needs it inline.
  for (const host of hosts) {
    const hostW = host.getAttribute("data-width");
    const hostH = host.getAttribute("data-height");
    if (hostW && hostH) {
      const existing = host.getAttribute("style") || "";
      const needsWidth = !existing.includes("width");
      const needsHeight = !existing.includes("height");
      const additions = [
        needsWidth ? `width:${hostW}px` : "",
        needsHeight ? `height:${hostH}px` : "",
      ]
        .filter(Boolean)
        .join(";");
      if (additions) {
        host.setAttribute("style", existing ? `${existing};${additions}` : additions);
      }
    }
  }

  if (head) for (const link of result.externalLinks) ensureExternalLinkTag(document, link);

  // Append collected styles to <head>
  if (head) {
    for (const style of styleElementsFor(document, result.styles, (css) => css.join("\n\n"))) {
      head.appendChild(style);
    }
  }

  // CDN and integrity-pinned scripts go first so plugins (e.g. TextPlugin,
  // ScrollTrigger) register before composition code, as in htmlBundler. A local
  // src script keeps its authored place among the inline scripts (see below).
  const isHoisted = (item: { src: string; integrity?: string }) =>
    Boolean(item.integrity?.trim()) || isNonRelativeUrl(item.src);
  if (body) {
    for (const item of result.scriptItems) {
      if (item.kind === "external" && isHoisted(item)) {
        ensureExternalScriptTag(document, item.src, item);
      }
    }
  }

  // The per-instance variables table must exist before the sub-comp scripts run (their scoped getVariables() reads
  // it); the render path once dropped it (issue #2064). Same shared emitter as the bundler so they stay in lockstep.
  emitVariablesByCompScript(document as unknown as Document, result.variablesByComp);
  if (body) {
    let pending: string[] = [];
    const flushInline = () => {
      if (!pending.length) return;
      const joined = pending.join("\n;\n");
      for (const text of parsesAsScript(joined) ? [joined] : pending) {
        const scriptEl = document.createElement("script");
        scriptEl.textContent = text;
        body.appendChild(scriptEl);
      }
      pending = [];
    };
    for (const item of result.scriptItems) {
      if (item.kind === "inline") {
        pending.push(item.content);
      } else if (!isHoisted(item)) {
        flushInline();
        ensureExternalScriptTag(document, item.src, item);
      }
    }
    flushInline();
  }
  if (body) {
    emitMountedModuleScripts(
      document as unknown as Document,
      result.importMaps,
      result.moduleScripts,
    );
  }

  // Compile-time CSS custom properties (mirrors the preview bundler): root
  // declarers plus one scoped rule per sub-composition host, so var(--slug)
  // resolves at script eval time, not just after runtime injection.
  emitRootCompositionVariableStyles(
    document as unknown as Document,
    result.variablesByComp,
    variableOverrides,
    { chargeBytes: (bytes) => budget.chargeGenerated("composition variables", bytes) },
  );

  // Inlining is what makes element ids ambiguous: each composition file is
  // internally consistent, the union of them is not. Hand every media element a
  // document-unique key here, while the merged document is in hand and before
  // anything downstream keys media on an id. See core's mediaRenderIds.ts.
  assignMediaRenderIds(document as unknown as Document);

  return { html: document.toString(), variablesByComp: result.variablesByComp };
}

/**
 * Full compilation pipeline for the producer.
 *
 * Returns everything the orchestrator needs: compiled HTML, all media elements,
 * dimensions, and static duration.
 */
/**
 * Ensure the HTML is a full document (has <html>, <head>, <body>).
 * When index.html is a fragment (e.g. just a <div>), linkedom.parseHTML()
 * returns a document with null head/body, causing inlineSubCompositions to
 * silently discard all collected composition styles and scripts.
 */
function ensureFullDocument(html: string): string {
  const trimmed = html.trim();
  if (/^<!DOCTYPE\s+html/i.test(trimmed) || /^<html/i.test(trimmed)) {
    return html;
  }
  // Wrap fragment with a proper document including margin/padding reset.
  // Without this, Chrome applies default body { margin: 8px } which creates
  // visible white lines at the edges of rendered video.
  return `<!DOCTYPE html>\n<html>\n<head>\n  <meta charset="UTF-8">\n  <style>*{margin:0;padding:0;box-sizing:border-box;text-rendering:geometricPrecision}body{overflow:hidden;background:#000;font-family:"Inter",sans-serif}</style>\n</head>\n<body style="margin:0;overflow:hidden">\n${html}\n</body>\n</html>`;
}

/**
 * Force subpixel glyph positioning so chrome-headless-shell (BeginFrame) and
 * full Chrome (screenshot fallback) lay text out identically. `text-rendering:
 * auto` resolves to `optimizeSpeed` (integer advances) in headless-shell but
 * `geometricPrecision` in full Chrome — that ~1% advance-width gap shifts
 * line-wrap points and any animation that reads `offsetWidth`. The `*`
 * selector has zero specificity, so authored class/id rules still override.
 */
function injectTextRenderingRule(html: string): string {
  const { document } = parseHTML(html);
  const head = document.querySelector("head");
  if (!head) return html;

  if (document.querySelector("style[data-hyperframes-text-rendering]")) {
    return html;
  }

  const styleEl = document.createElement("style");
  styleEl.setAttribute("data-hyperframes-text-rendering", "true");
  styleEl.textContent = "html,body,*{text-rendering:geometricPrecision}";
  head.insertBefore(styleEl, head.firstChild);

  return document.toString();
}

class ScriptIntegrityError extends Error {}

/** Match SRI's strongest supported digest before decoding or rewriting script bytes. */
function matchesScriptIntegrity(bytes: Uint8Array, metadata: string): boolean {
  const hashes = [
    ...metadata.matchAll(
      /(?:^|[\t\n\f\r ])(sha256|sha384|sha512)-([A-Za-z0-9+/_-]+={0,2})(?:\?[\x21-\x7e]*)?(?=$|[\t\n\f\r ])/gi,
    ),
  ];
  const strongest = ["sha512", "sha384", "sha256"].find((alg) =>
    hashes.some((hash) => hash[1]?.toLowerCase() === alg),
  );
  // Browsers ignore metadata containing no supported, syntactically valid hash.
  if (!strongest) return true;
  const actual = createHash(strongest).update(bytes).digest();
  return hashes.some(
    (hash) =>
      hash[1]?.toLowerCase() === strongest && actual.equals(Buffer.from(hash[2]!, "base64")),
  );
}

const MAX_SCRIPT_BYTES = 16 * 1024 * 1024;

/** The operator's `HYPERFRAMES_GSAP_BASE_URL` may be on this machine; a composition's own URLs never are. */
function operatorGsapMirror(): string | undefined {
  const raw = process.env.HYPERFRAMES_GSAP_BASE_URL?.trim();
  if (!raw || raw.startsWith("/")) return undefined;
  try {
    return `${normalizeGsapBaseUrl(raw)}/`;
  } catch {
    return undefined;
  }
}

async function downloadScript(
  src: string,
  mirror: string | undefined,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (mirror && new URL(src).href.startsWith(mirror)) {
    const response = await fetch(src, {
      redirect: "error",
      signal: AbortSignal.any([AbortSignal.timeout(15_000), signal]),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${src}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_SCRIPT_BYTES) throw new Error(`Script over 16 MiB: ${src}`);
    return bytes;
  }
  return fetchPublicHttpsBytes(src, { maxBytes: MAX_SCRIPT_BYTES, timeoutMs: 15_000, signal });
}

const MAX_CONCURRENT_SCRIPT_FETCHES = 4;
/**
 * Distinct remote addresses one compile downloads, per kind: scripts, and non-Google stylesheets (counted before
 * their contents are read, so a stylesheet with no font rules counts too).
 */
export const MAX_REMOTE_FETCHES = 32;
/**
 * The script and stylesheet inliners' downloads share this much time, from the first one; what is still pending then
 * counts as failed. Fonts and other assets keep their own per-request limits.
 */
export const REMOTE_FETCH_DEADLINE_MS = 60_000;
/** A signal, or a getter that starts one when the first download asks for it. */
type FetchSignal = AbortSignal | (() => AbortSignal);
const fetchSignalOf = (signal: FetchSignal | undefined) =>
  typeof signal === "function" ? signal() : signal;

function assertRemoteFetchCount(kind: string, count: number): void {
  if (count > MAX_REMOTE_FETCHES) {
    throw new Error(
      `The composition links ${count} remote ${kind}; at most ${MAX_REMOTE_FETCHES} are downloaded at compile time`,
    );
  }
}

/**
 * Download external CDN scripts and inline them into the HTML so rendering
 * works without network access (Docker, CI, restricted environments). Each URL
 * is fetched once, a few at a time, and every inlined copy is charged to the
 * render's budget as it arrives, so going over stops the downloads still queued.
 * Once `signal` aborts, pending downloads fail and their tags are left as they are.
 */
export async function inlineExternalScripts(
  html: string,
  budget = new CompositionExpansionBudget(),
  signal?: FetchSignal,
): Promise<string> {
  const fullHtml = ensureFullDocument(html);
  const wrappedFragment = fullHtml !== html;
  const { document } = parseHTML(fullHtml);
  const scripts = document.querySelectorAll("script[src]");
  const externalScripts: { el: Element; src: string }[] = [];

  for (const el of scripts) {
    const src = (el.getAttribute("src") || "").trim();
    if (src && isHttpUrl(src) && !isRuntimeFileUrl(src)) {
      externalScripts.push({ el: el as unknown as Element, src });
    }
  }

  if (externalScripts.length === 0) return html;
  // The host's own copy needs no network; one that fails the tag's integrity metadata is downloaded instead.
  // It is read once per address: repeated tags share those bytes, and each is still charged as it is placed.
  const bundled = new Map<string, Uint8Array | null>();
  const local = externalScripts.map(({ el, src }) => {
    if (!bundled.has(src)) bundled.set(src, bundledScript(src));
    const bytes = bundled.get(src);
    return bytes && matchesScriptIntegrity(bytes, el.getAttribute("integrity") || "")
      ? bytes
      : null;
  });
  const remote = new Set(externalScripts.filter((_, i) => !local[i]).map(({ src }) => src));
  assertRemoteFetchCount("scripts", remote.size);

  const mirror = operatorGsapMirror();
  const limit = createConcurrencyLimit(MAX_CONCURRENT_SCRIPT_FETCHES);
  const stop = new AbortController();
  const shared = remote.size > 0 ? fetchSignalOf(signal) : undefined;
  const fetchSignal = shared ? AbortSignal.any([stop.signal, shared]) : stop.signal;
  const fail = (error: unknown): never => {
    stop.abort(error);
    throw error;
  };
  const charge = (bytes: number) => {
    try {
      budget.chargeGenerated(REMOTE_SCRIPTS, bytes);
    } catch (error) {
      fail(error);
    }
  };
  // A download is charged as it arrives, so bodies held for later tags are counted too.
  const fetches = new Map<string, Promise<Uint8Array>>();
  const fetchOnce = (src: string) => {
    let bytes = fetches.get(src);
    if (!bytes) {
      bytes = limit(async () => {
        fetchSignal.throwIfAborted();
        const downloaded = await downloadScript(src, mirror, fetchSignal);
        charge(downloaded.byteLength);
        return downloaded;
      }, fetchSignal);
      fetches.set(src, bytes);
    }
    return bytes;
  };
  const placed = new Set<string>();
  const downloads = await Promise.allSettled(
    externalScripts.map(async ({ el, src }, i) => {
      const integrity = el.getAttribute("integrity") || "";
      let bytes = local[i];
      if (bytes) {
        charge(bytes.byteLength);
      } else {
        bytes = await fetchOnce(src);
        if (!matchesScriptIntegrity(bytes, integrity)) {
          fail(new ScriptIntegrityError(`Subresource integrity mismatch for ${src}`));
        }
        if (placed.has(src)) charge(bytes.byteLength);
        placed.add(src);
      }
      return { src, text: new TextDecoder().decode(bytes) };
    }),
  );
  if (stop.signal.aborted) throw stop.signal.reason;

  for (let i = 0; i < downloads.length; i++) {
    const download = downloads[i]!;
    const { el, src } = externalScripts[i]!;
    if (download.status === "fulfilled") {
      // Escape </script in downloaded content to prevent premature tag closure.
      // <\/script is safe: the HTML parser doesn't recognize it as a close tag,
      // but JS treats \/ as / so the code executes identically.
      const safeText = download.value.text.replace(/<\/script/gi, "<\\/script");
      const inlineScript = document.createElement("script");
      for (const attr of Array.from(el.attributes)) {
        if (attr.name.toLowerCase() === "src") continue;
        inlineScript.setAttribute(attr.name, attr.value);
      }
      inlineScript.textContent = `/* inlined: ${src} */\n${safeText}\n//# sourceURL=${new URL(src).href}\n`;
      el.replaceWith(inlineScript);
      defaultLogger.debug(`[Compiler] Inlined CDN script: ${src}`);
    } else {
      // A verified mismatch must never fall back to an executable external tag:
      // browser support for integrity metadata (including casing) can differ.
      if (download.reason instanceof ScriptIntegrityError) throw download.reason;
      defaultLogger.warn(
        `[Compiler] WARNING: Failed to download CDN script: ${src} (${download.reason}). ` +
          `The render may fail if this script is required (e.g. GSAP). ` +
          `Consider bundling it locally in your project.`,
      );
    }
  }

  return wrappedFragment ? document.body.innerHTML || "" : document.toString();
}

/**
 * Scan compiled HTML for asset references that resolve outside projectDir.
 * For each, map the normalized in-HTML path to the real filesystem path so
 * the orchestrator can copy them into the compiled output directory.
 *
 * Handles: src/href attributes, CSS url(), inline style url().
 */
export function collectExternalAssets(
  html: string,
  projectDir: string,
  log: ProducerLogger = defaultLogger,
  file = "index.html",
  policy: OutsideFilePolicy = {},
): { html: string; externalAssets: Map<string, string> } {
  const absProjectDir = resolve(projectDir);
  const externalAssets = new Map<string, string>();
  const leftOut = new Set<string>();

  function processPath(rawPath: string): string | null {
    const trimmed = rawPath.trim();
    if (isNonRelativeUrl(trimmed)) return null;
    const absPath = resolve(absProjectDir, trimmed);
    if (isPathInside(absPath, absProjectDir)) {
      return null; // inside projectDir, file server handles this
    }
    const onShare = namesAnotherNetworkRoot(absProjectDir, absPath);
    if (!onShare && !existsSync(absPath)) return null;
    const refusal = onShare ? "network_share" : outsideAssetRefusal(absProjectDir, absPath, policy);
    if (refusal) {
      if (!leftOut.has(trimmed)) log.warn(`[Compiler] ${leftOutOfRender(file, trimmed, refusal)}`);
      leftOut.add(trimmed);
      return null;
    }
    // resolve() already canonicalises the path (no .. components remain);
    // toExternalAssetKey() produces a cross-platform relative key that
    // `path.join(compileDir, key)` cannot escape on any OS.
    const safeKey = toExternalAssetKey(absPath);
    externalAssets.set(safeKey, absPath);
    return safeKey;
  }

  const { document } = parseHTML(html);

  // Rewrite src and href attributes
  for (const el of document.querySelectorAll("[src], [href]")) {
    for (const attr of ["src", "href"]) {
      const val = (el.getAttribute(attr) || "").trim();
      if (!val) continue;
      const rewritten = processPath(val);
      if (rewritten) el.setAttribute(attr, rewritten);
    }
  }

  // Rewrite CSS url() in <style> blocks
  for (const styleEl of document.querySelectorAll("style")) {
    const css = styleEl.textContent || "";
    if (!css.includes("url(")) continue;
    const rewritten = replaceMatches(css, cssUrlMatches(css), (full, quote, rawUrl) => {
      const result = processPath((rawUrl || "").trim());
      if (!result) return full;
      return `url(${quote || ""}${result}${quote || ""})`;
    });
    if (rewritten !== css) styleEl.textContent = rewritten;
  }

  // Rewrite inline style url() on elements
  for (const el of document.querySelectorAll("[style]")) {
    const style = el.getAttribute("style") || "";
    if (!style.includes("url(")) continue;
    const rewritten = replaceMatches(style, cssUrlMatches(style), (full, quote, rawUrl) => {
      const result = processPath((rawUrl || "").trim());
      if (!result) return full;
      return `url(${quote || ""}${result}${quote || ""})`;
    });
    if (rewritten !== style) el.setAttribute("style", rewritten);
  }

  if (externalAssets.size > 0) {
    defaultLogger.debug(
      `[Compiler] Found ${externalAssets.size} asset(s) outside project directory, will copy to render output`,
    );
  }

  return {
    html: externalAssets.size > 0 ? document.toString() : html,
    externalAssets,
  };
}

export const REMOTE_MEDIA_SUBDIR = "_remote_media";
/**
 * Download a set of remote URLs in parallel into `remoteDir`, build the
 * `{ relPath → absPath }` asset map, and rewrite every occurrence of each
 * URL inside `html` with its relative local path.
 *
 * The `warnLabel` appears in console.warn messages for download failures.
 * The `logLabel` appears in the success console.log line.
 * `extraRewrite`, if provided, is called per URL pair after the standard
 * double/single-quote rewrite — used for url(...) CSS rewriting.
 */
async function downloadAndRewriteUrls(
  urlSet: Set<string>,
  html: string,
  remoteDir: string,
  warnLabel: string,
  logLabel: string,
  assets: AssetDownloads | undefined,
  extraRewrite?: (html: string, url: string, relPath: string) => string,
): Promise<{ html: string; remoteMediaAssets: Map<string, string> }> {
  assets?.reserve(urlSet);
  if (urlSet.size === 0) return { html, remoteMediaAssets: new Map() };
  if (!existsSync(remoteDir)) mkdirSync(remoteDir, { recursive: true });

  const urlToLocal = new Map<string, string>();
  await Promise.all(
    [...urlSet].map(async (url) => {
      try {
        const localPath = await downloadAsset(url, remoteDir, assets);
        urlToLocal.set(url, localPath);
      } catch (err) {
        if (assets?.signal?.aborted) throw err;
        const identity = safeDownloadUrlIdentity(url);
        defaultLogger.warn(`[Compiler] ${warnLabel}, using original URL as fallback.`, {
          urlFingerprint: identity.urlFingerprint,
          host: identity.host,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );

  if (urlToLocal.size === 0) return { html, remoteMediaAssets: new Map() };

  const remoteMediaAssets = new Map<string, string>();
  const urlToRelPath = new Map<string, string>();
  for (const [url, absPath] of urlToLocal) {
    const relPath = `${REMOTE_MEDIA_SUBDIR}/${basename(absPath)}`;
    remoteMediaAssets.set(relPath, absPath);
    urlToRelPath.set(url, relPath);
  }

  let result = html;
  for (const [url, relPath] of urlToRelPath) {
    result = result.replaceAll(`"${url}"`, `"${relPath}"`).replaceAll(`'${url}'`, `'${relPath}'`);
    if (extraRewrite) result = extraRewrite(result, url, relPath);
  }

  defaultLogger.debug(`[Compiler] ${logLabel} ${urlToLocal.size} to ${REMOTE_MEDIA_SUBDIR}/`);
  return { html: result, remoteMediaAssets };
}

/**
 * Download any remote `src` URLs on `<video>` / `<audio>` elements and their
 * `<source>` children into a local subdirectory of `downloadDir`, rewrite the
 * HTML src attributes to relative paths, and return the updated HTML along with
 * a map of `{ relativePath → absoluteLocalPath }` for callers to add to
 * `externalAssets`.
 *
 * Skips URLs that fail to download (warns and preserves the original URL so
 * the browser can still attempt the remote fetch as a fallback).
 *
 * Why: remote S3 sources require Chrome to buffer every video file over the
 * network before `readyState >= 2` (HAVE_CURRENT_DATA). With 10+ large clips
 * this reliably exhausts `pageReadyTimeout`, producing blank black frames for
 * every clip. Localising the sources before the file server starts eliminates
 * the race entirely and keeps the render hermetic.
 */
/** @internal exported for unit testing only */
export async function localizeRemoteMediaSources(
  html: string,
  downloadDir: string,
  assets?: AssetDownloads,
): Promise<{ html: string; remoteMediaAssets: Map<string, string> }> {
  const urlSet = new Set([...remoteSrcUrls(html, "media"), ...remoteSrcUrls(html, "source")]);
  const localized = await downloadAndRewriteUrls(
    urlSet,
    html,
    join(downloadDir, REMOTE_MEDIA_SUBDIR),
    "Remote media download failed",
    "Localized remote media source(s)",
    assets,
  );
  return { ...localized, html: dropBindingOnLocalizedMedia(localized.html) };
}

/**
 * A bound element now holds the downloaded copy. Its `data-var-src` would make the browser set the
 * link back, giving the clip a second name and its sound a second lane.
 */
function dropBindingOnLocalizedMedia(html: string): string {
  if (!html.includes("data-var-src")) return html;
  const { document } = parseHTML(html);
  let changed = false;
  for (const el of document.querySelectorAll("video[data-var-src], audio[data-var-src]")) {
    if (el.closest("[data-variable-values]")) continue;
    if (!el.getAttribute("src")?.startsWith(`${REMOTE_MEDIA_SUBDIR}/`)) continue;
    el.removeAttribute("data-var-src");
    changed = true;
  }
  return changed ? document.toString() : html;
}

/**
 * Download any remote `src` URLs on `<img>` elements into a local subdirectory
 * of `downloadDir`, rewrite the HTML src attributes to relative paths, and
 * return a `{ relativePath → absoluteLocalPath }` map for the orchestrator.
 *
 * Why: a composition with remote S3 `<img src>` URLs reaches Chrome unchanged;
 * the readiness check can pass before the image is fully decoded, *and* Chrome
 * may evict decoded pixels mid-render under memory pressure and re-fetch from
 * the remote origin. Either path produces blank-frame flicker. Localising the
 * sources before render eliminates both races — once the file is local,
 * Chrome's image cache is bounded by fast disk reads, not S3 latency, so a
 * mid-render re-fetch lands within a frame instead of flickering. This is the
 * primary fix; frameCapture's `pollImagesReady` is the defense-in-depth layer.
 *
 * Scope: only `<img src>` is localised here. Remote `srcset`,
 * `<picture><source>`, SVG `<image href>`, and CSS `background-image: url()`
 * outside `@font-face` are NOT covered — agent-pipeline compositions emit
 * plain `<img src>`, but those are open follow-ups if other shapes appear.
 *
 * This bites agent-pipeline-generated compositions (astral / daphne /
 * hyperion `multi-v2` outputs) which render directly without going through
 * `hyperframes publish`'s archive-time localize step.
 */
/** @internal exported for unit testing only */
export async function localizeRemoteImageSources(
  html: string,
  downloadDir: string,
  assets?: AssetDownloads,
): Promise<{ html: string; remoteMediaAssets: Map<string, string> }> {
  // frameCapture's `pollImagesReady`/`decodeAllImages` cover any remote URL this misses.
  const urlSet = new Set(remoteSrcUrls(html, "img"));
  return downloadAndRewriteUrls(
    urlSet,
    html,
    join(downloadDir, REMOTE_MEDIA_SUBDIR),
    "Remote image download failed",
    "Localized remote image source(s)",
    assets,
  );
}

/**
 * Download remote CSS `background-image: url(https://...)` references and rewrite
 * them to local same-origin paths.
 *
 * Why: `drawElementImage` (fast capture) OMITS cross-origin content, so a remote
 * background image renders BLACK on the drawElement path while the screenshot
 * baseline captures it (origin-agnostic) — a whole-region mismatch (e.g. 10f79c0b
 * picsum.photos backgrounds, 9.3 dB). `<img>`/`<video>`/`@font-face` are localized
 * by their own passes; this closes the background-image gap so the fast path sees
 * the same pixels as the baseline.
 *
 * @internal exported for unit testing only
 */
export async function localizeRemoteBackgroundImages(
  html: string,
  downloadDir: string,
  assets?: AssetDownloads,
): Promise<{ html: string; remoteMediaAssets: Map<string, string> }> {
  const urlSet = new Set<string>();
  for (const { parts } of remoteBackgroundUrlMatches(html)) {
    if (parts[1] && !isGoogleFontsUrl(parts[1])) urlSet.add(parts[1]);
  }
  return downloadAndRewriteUrls(
    urlSet,
    html,
    join(downloadDir, REMOTE_MEDIA_SUBDIR),
    "Remote background-image download failed",
    "Localized remote background-image(s)",
    assets,
    // Quoted url('..')/url("..") are rewritten by downloadAndRewriteUrls' default
    // replaceAll; this handles the unquoted url(https://..) form.
    (h, url, rel) => h.replaceAll(`url(${url})`, `url(${rel})`),
  );
}

/**
 * Download any remote font URLs from `@font-face` src declarations, rewrite
 * the CSS `url(...)` references to local paths, and return a map of assets.
 *
 * Why: `@font-face { src: url("https://s3.../font.ttf") }` fails in the
 * renderer because Chrome makes a CORS-mode fetch from the local file server
 * origin (http://localhost:PORT) and S3 does not echo that origin back in
 * Access-Control-Allow-Origin. The font load is rejected, Chrome falls back
 * to the next font in the stack (e.g. Arial). Downloading the font file
 * before render and rewriting to a local path eliminates the CORS race.
 */
/** Returns true for URLs belonging to Google Fonts (handled by the deterministic font injector). */
function isGoogleFontsUrl(href: string): boolean {
  try {
    const host = new URL(href).hostname.toLowerCase();
    return host === "fonts.googleapis.com" || host === "fonts.gstatic.com";
  } catch {
    return /fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(href);
  }
}

const MAX_STYLESHEET_BYTES = 2 * 1024 * 1024;

async function fetchExternalStylesheetCss(
  href: string,
  signal: AbortSignal,
): Promise<string | null> {
  const identity = safeDownloadUrlIdentity(href);
  try {
    return await fetchPublicHttpsText(href, {
      maxBytes: MAX_STYLESHEET_BYTES,
      timeoutMs: 15_000,
      signal,
    });
  } catch (err) {
    defaultLogger.warn("[Compiler] External stylesheet fetch failed, preserving link tag.", {
      urlFingerprint: identity.urlFingerprint,
      host: identity.host,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Extract all `@font-face { ... }` blocks from a CSS string, preserving the
 * full rule text (including the `@font-face` keyword and braces).
 *
 * Uses a depth-tracking scan instead of `[^}]*` so blocks with nested
 * descriptor values that happen to contain `}` (rare but valid in
 * `format(...)` hints with custom idents) are captured correctly.
 *
 * @internal exported for unit testing only
 */
export function extractFontFaceBlocks(css: string): string[] {
  const blocks: string[] = [];
  const closes = matchingBraces(css);
  const atRule = /@font-face\s*/gi;
  let open = -1;
  for (let m = atRule.exec(css); m; m = atRule.exec(css)) {
    if (open < atRule.lastIndex) open = css.indexOf("{", atRule.lastIndex);
    if (open === -1) break;
    const close = closes.get(open);
    if (close === undefined) continue;
    blocks.push(css.slice(m.index, close + 1));
    atRule.lastIndex = close + 1;
  }
  return blocks;
}

/** The `}` that closes each `{` that has one, as a depth count from that `{` finds it. */
function matchingBraces(css: string): Map<number, number> {
  const closes = new Map<number, number>();
  const unclosed: number[] = [];
  for (let i = 0; i < css.length; i++) {
    if (css[i] === "{") unclosed.push(i);
    else if (css[i] === "}" && unclosed.length > 0) closes.set(unclosed.pop()!, i);
  }
  return closes;
}

/** The address of a stylesheet link this compile inlines the font rules of, if it is one. */
function remoteFontStylesheetHref(tag: string): string | undefined {
  const href = /\bhref=["']([^"']+)["']/i.exec(tag)?.[1];
  if (!href || !/^https?:\/\//i.test(href) || isGoogleFontsUrl(href)) return undefined;
  return href;
}

/**
 * Find all external `<link rel="stylesheet">` tags pointing to non-Google
 * CDNs, fetch their CSS, and replace the `<link>` with an inline `<style>`
 * containing only the `@font-face` rules. This allows Phase 2 (the existing
 * inline scan) to pick up and localise the font file URLs.
 *
 * Google Fonts links are excluded because the deterministic font injector
 * handles those. If a fetch fails or the CSS has no `@font-face` blocks,
 * the original `<link>` tag is preserved (graceful degradation).
 */
async function inlineExternalFontStylesheets(
  html: string,
  budget = new CompositionExpansionBudget(),
  signal?: FetchSignal,
): Promise<string> {
  const hrefs = new Set<string>();
  for (const { parts } of stylesheetLinkMatches(html)) {
    const href = remoteFontStylesheetHref(parts[0]);
    if (href) hrefs.add(href);
  }
  if (hrefs.size === 0) return html;
  assertRemoteFetchCount("stylesheets", hrefs.size);

  // Each sheet is fetched once, a few at a time, and only its font rules are kept, charged as they arrive.
  const limit = createConcurrencyLimit(MAX_CONCURRENT_SCRIPT_FETCHES);
  const stop = new AbortController();
  const shared = fetchSignalOf(signal);
  const fetchSignal = shared ? AbortSignal.any([stop.signal, shared]) : stop.signal;
  const inlineByHref = new Map<string, string>();
  const inlineSheet = async (href: string) => {
    const css = await fetchExternalStylesheetCss(href, fetchSignal);
    const fontFaceBlocks = css ? extractFontFaceBlocks(css) : [];
    if (fontFaceBlocks.length === 0) return;
    const inlineStyle = `<style>/* Inlined external font stylesheet */\n${fontFaceBlocks.join("\n")}\n</style>`;
    try {
      budget.chargeGenerated(REMOTE_STYLESHEETS, inlineStyle.length);
    } catch (error) {
      stop.abort(error);
      throw error;
    }
    inlineByHref.set(href, inlineStyle);
    const identity = safeDownloadUrlIdentity(href);
    defaultLogger.debug("[Compiler] Inlined external @font-face rule(s)", {
      count: fontFaceBlocks.length,
      urlFingerprint: identity.urlFingerprint,
      host: identity.host,
    });
  };
  await Promise.allSettled([...hrefs].map((href) => limit(() => inlineSheet(href), fetchSignal)));
  if (stop.signal.aborted) throw stop.signal.reason;

  const placed = new Set<string>();
  return replaceMatches(html, stylesheetLinkMatches(html), (tag) => {
    const href = remoteFontStylesheetHref(tag);
    const inlineStyle = href ? inlineByHref.get(href) : undefined;
    if (!href || !inlineStyle) return tag;
    // The first copy was charged when it arrived; each repeat adds the whole sheet again.
    if (placed.has(href)) budget.chargeGenerated(REMOTE_STYLESHEETS, inlineStyle.length);
    placed.add(href);
    return inlineStyle;
  });
}

// Families a linked project stylesheet declares with an @font-face file the project ships.
function projectStylesheetFontFamilies(html: string, projectDir: string): string[] {
  const families: string[] = [];
  for (const {
    parts: [tag],
  } of stylesheetLinkMatches(html)) {
    const href = /\bhref=["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) continue;
    const sheet = resolve(projectDir, decodedUrlPath(href).replace(/^(?:\.?\/)+/, ""));
    if (!isPathInside(sheet, projectDir) || !existsSync(sheet)) continue;
    for (const face of extractFontFaceBlocks(readFileSync(sheet, "utf8"))) {
      const family = /font-family\s*:\s*([^;}]+)/i
        .exec(face)?.[1]
        ?.trim()
        .replace(/^['"]|['"]$/g, "");
      const shipsFile = [...localFontFaceUrlMatches(face)].some(({ parts: [, url = ""] }) => {
        const path = decodedUrlPath(url);
        const file = path.startsWith("/")
          ? resolve(projectDir, `.${path}`)
          : resolve(dirname(sheet), path);
        return isPathInside(file, projectDir) && existsSync(file);
      });
      if (family && shipsFile) families.push(family);
    }
  }
  return families;
}

/**
 * Collect all remote `url(https://...)` references inside `@font-face` blocks
 * found in `<style>` tags.
 */
// fallow-ignore-next-line complexity
function collectFontFaceUrls(html: string): Set<string> {
  const urlSet = new Set<string>();

  for (const { parts } of styleBlockMatches(html)) {
    const cssText = parts[1];
    // Depth-tracking scanner to correctly handle @font-face blocks that
    // contain nested braces (e.g. unicode-range fallback rules).
    let i = 0;
    while (i < cssText.length) {
      const atIdx = cssText.indexOf("@font-face", i);
      if (atIdx === -1) break;
      const braceStart = cssText.indexOf("{", atIdx);
      if (braceStart === -1) break;
      let depth = 1;
      let j = braceStart + 1;
      while (j < cssText.length && depth > 0) {
        if (cssText[j] === "{") depth++;
        else if (cssText[j] === "}") depth--;
        j++;
      }
      const block = cssText.slice(braceStart + 1, j - 1);
      for (const { parts } of remoteFontFaceUrlMatches(block)) {
        if (parts[1]) urlSet.add(parts[1]);
      }
      i = j;
    }
  }
  return urlSet;
}

/** @internal exported for unit testing only */
export async function localizeRemoteFontFaces(
  html: string,
  downloadDir: string,
): Promise<{ html: string; remoteMediaAssets: Map<string, string> }> {
  return localizeFontFaceUrls(await inlineExternalFontStylesheets(html), downloadDir);
}

/** Download the remote font files of the page's inline @font-face rules and point the rules at them. */
function localizeFontFaceUrls(
  html: string,
  downloadDir: string,
  assets?: AssetDownloads,
): Promise<{ html: string; remoteMediaAssets: Map<string, string> }> {
  return downloadAndRewriteUrls(
    collectFontFaceUrls(html),
    html,
    join(downloadDir, REMOTE_MEDIA_SUBDIR),
    "Remote font download failed",
    "Localized remote font face(s)",
    assets,
    (h, url, relPath) => h.replaceAll(`url(${url})`, `url("${relPath}")`),
  );
}

// Base64 expands bytes by ~33%, then immutable HTML replacements retain more
// string copies while compiling. Files up to and including 5 MiB remain inline;
// the first byte above that stays file-backed. This conservative ceiling keeps
// verified 19 MiB+ TTC collections out of the V8 heap while both local and
// distributed file servers continue serving project assets at authored paths.
const MAX_LOCAL_FONT_DATA_URI_BYTES = 5 * 1024 * 1024;

type LocalFontRead = { kind: "file-backed" } | { kind: "inline"; buffer: Buffer };

async function readLocalFont(absPath: string): Promise<LocalFontRead> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of createReadStream(absPath)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_LOCAL_FONT_DATA_URI_BYTES) {
      return { kind: "file-backed" };
    }
    chunks.push(buffer);
  }
  return { kind: "inline", buffer: Buffer.concat(chunks, totalBytes) };
}

/** The data URI a project or downloaded font path embeds as, or undefined when it stays a file. */
async function localFontDataUri(
  localPath: string,
  projectDir: string,
  assetRoot: string | undefined,
  dataUriByAbsolutePath: Map<string, string | undefined>,
  log: ProducerLogger,
  downloadedPath: string | undefined,
  reserve: (dataUriBytes: number) => boolean,
): Promise<string | undefined> {
  const absPath =
    downloadedPath ?? (localPath.startsWith("/") ? localPath : resolve(projectDir, localPath));
  if (downloadedPath === undefined) {
    if (!isPathInside(absPath, projectDir) || escapesAssetRoot(absPath, assetRoot)) {
      return undefined;
    }
    // A project font that is a link leading outside obeys the same policy as the file server.
    if (refusesOutsideLink(projectDir, absPath, (line) => log.warn(`[Compiler] ${line}`))) {
      return undefined;
    }
    if (isPrivateCompositionFile(projectDir, absPath)) return undefined;
  }
  if (dataUriByAbsolutePath.has(absPath)) return dataUriByAbsolutePath.get(absPath);
  const ext = absPath.match(/\.(woff2?|ttf|otf|ttc)$/i)?.[1]?.toLowerCase() ?? "ttf";
  try {
    // Base64 plus a short data: prefix; a font that cannot fit is never read.
    if (!reserve(Math.ceil(statSync(absPath).size / 3) * 4 + 64)) {
      dataUriByAbsolutePath.set(absPath, undefined);
      return undefined;
    }
    const font = await readLocalFont(absPath);
    if (font.kind === "file-backed") {
      dataUriByAbsolutePath.set(absPath, undefined);
      defaultLogger.debug(
        `[Compiler] Kept large local font file-backed: ${localPath} (> ${(MAX_LOCAL_FONT_DATA_URI_BYTES / 1024 / 1024).toFixed(1)} MB)`,
      );
      return undefined;
    }
    const { fontToDataUri } = await import("@hyperframes/core/fonts/embed");
    const dataUri = await fontToDataUri(font.buffer, ext, { compressToWoff2: false });
    dataUriByAbsolutePath.set(absPath, dataUri);
    defaultLogger.debug(
      `[Compiler] Embedded local font file: ${localPath} (${(font.buffer.length / 1024).toFixed(0)} KB → data URI)`,
    );
    return dataUri;
  } catch (error) {
    // Keep the original path: a font that cannot be read must not fail the render, but say why
    // it renders in a fallback typeface.
    defaultLogger.warn(
      `[Compiler] Could not embed local font ${localPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return undefined;
  }
}

/** `whole` with its `inner` text, which ends `tail` characters before its end, replaced. */
const replaceInner = (whole: string, inner: string, tail: number, next: string) =>
  whole.slice(0, whole.length - tail - inner.length) + next + whole.slice(whole.length - tail);

/**
 * Inline the project fonts that `<style>` `@font-face` sources name as data URIs. Every copy is
 * charged to the render's budget, so a font named by many rules stops being inlined once the
 * budget is spent and the rest keep loading it from its file.
 */
async function embedLocalFontFaces(
  html: string,
  projectDir: string,
  assetRoot: string | undefined,
  budget: CompositionExpansionBudget,
  log: ProducerLogger = defaultLogger,
  downloadedFonts: ReadonlyMap<string, string> = new Map(),
): Promise<string> {
  const dataUriByPath = new Map<string, string | undefined>();
  const dataUriByAbsolutePath = new Map<string, string | undefined>();
  let warned = false;
  const keptFileBacked = (localPath: string) => {
    if (warned) return;
    warned = true;
    log.warn(
      `[Compiler] Kept local font ${localPath} file-backed: the page reached its inline size limit`,
    );
  };
  // The fonts read here are kept until every copy is placed, so together they fit the budget's room.
  let reserved = 0;
  const reserveFor = (localPath: string) => (bytes: number) => {
    if (reserved + bytes > budget.generatedRoom) {
      keptFileBacked(localPath);
      return false;
    }
    reserved += bytes;
    return true;
  };
  for (const { parts: style } of styleBlockMatches(html)) {
    for (const { parts: face } of fontFaceBlockMatches(style[1])) {
      for (const { parts } of localFontFaceUrlMatches(face[1])) {
        const localPath = parts[1];
        if (!localPath || dataUriByPath.has(localPath)) continue;
        dataUriByPath.set(
          localPath,
          await localFontDataUri(
            localPath,
            projectDir,
            assetRoot,
            dataUriByAbsolutePath,
            log,
            downloadedFonts.get(localPath),
            reserveFor(localPath),
          ),
        );
      }
    }
  }
  if (![...dataUriByPath.values()].some(Boolean)) return html;

  const embed = (source: string, localPath: string) => {
    const dataUri = dataUriByPath.get(localPath);
    if (!dataUri) return source;
    const inlined = `url("${dataUri}")`;
    if (budget.chargeGeneratedIfItFits(inlined.length - source.length)) return inlined;
    keptFileBacked(localPath);
    return source;
  };
  return replaceMatches(html, styleBlockMatches(html), (style, css) =>
    replaceInner(
      style,
      css,
      "</style>".length,
      replaceMatches(css, fontFaceBlockMatches(css), (face, body) =>
        replaceInner(face, body, 1, replaceMatches(body, localFontFaceUrlMatches(body), embed)),
      ),
    ),
  );
}

/**
 * Optional behavior toggles for {@link compileForRender}. All fields are
 * additive; omitting `options` preserves the in-process renderer's defaults.
 */
export interface CompileForRenderOptions {
  /**
   * Logger for compile-time diagnostics (e.g. the data-duration vs. media
   * mismatch warning). Optional so non-render callers can omit it.
   */
  log?: ProducerLogger;
  /** Absolute project paths not on disk, readable at these URLs instead. */
  urlByAbsentLocalPath?: ReadonlyMap<string, string>;
  /**
   * Threaded through to {@link injectDeterministicFontFaces}. When `true`,
   * deterministic font resolution and exhausted transient fetch failures
   * surface as typed errors instead of silently falling back to system fonts.
   * Distributed `plan()` sets this to `true` so font availability is part of
   * the planDir's content-addressed hash. Default `false` preserves the
   * in-process behavior.
   */
  failClosedFontFetch?: boolean;
  /**
   * When `true`, fonts not resolved by the bundled alias map or Google Fonts
   * are located on the local filesystem, compressed to woff2, and embedded.
   * Default `true` for local renders. Distributed callers pass `false` to
   * prevent host-specific font capture from leaking into the planDir.
   */
  allowSystemFontCapture?: boolean;
  /** Caller cancellation propagated through compile-time font, stylesheet and script fetches. */
  abortSignal?: AbortSignal;
  /** Persistent cache directory for the animated GIF and HEIC prep transcodes; defaults to downloadDir. */
  animatedGifCacheDir?: string;
  /** FFmpeg timeout for animated GIF transcodes. */
  ffmpegProcessTimeout?: number;
  /**
   * Render-time variable overrides (`--variables`). Layered over declared
   * defaults in the compile-time CSS custom-property stylesheet so eval-time
   * reads (GSAP .from immediateRender) see the overridden value — the
   * `window.__hfVariables` injection covers script reads, not var() in CSS.
   */
  variables?: Record<string, unknown>;
  pageMotionBlur?: "off";
  /** Trusted local renders only (CLI, Studio): import files markup reaches outside projectDir. */
  allowOutsideProjectAssets?: boolean;
  includeOutsideScripts?: boolean;
}

/** Renders follow the same `HYPERFRAMES_GSAP_BASE_URL` mirror as Studio preview. */
function renderGsapDist(): string {
  try {
    return gsapCdnDist(undefined, normalizeGsapBaseUrl(process.env.HYPERFRAMES_GSAP_BASE_URL));
  } catch (cause) {
    throw new Error(
      "Invalid HYPERFRAMES_GSAP_BASE_URL: use an absolute HTTPS npm mirror root (plain HTTP only for localhost) without credentials, query, or fragment",
      { cause },
    );
  }
}

/** `compSrcPath` resolves a sub-composition's script the way the inliner will hoist it. */
function rewriteUnresolvableGsapToCdn(
  html: string,
  projectDir: string,
  compSrcPath?: string,
): string {
  let gsapDist: string | undefined;
  const exists = (path: string) => {
    const file = resolve(projectDir, path);
    return !namesAnotherNetworkRoot(projectDir, file) && existsSync(file);
  };
  return replaceGsapDistScripts(html, (full, prefix, src, file, suffix) => {
    if (/^https?:\/\//i.test(src)) return full;
    if (exists(compSrcPath ? rewriteAssetPath(compSrcPath, src, exists) : src)) return full;
    gsapDist ??= renderGsapDist();
    defaultLogger.debug(`[Compiler] Rewriting missing gsap script: ${src} → ${gsapDist}${file}`);
    return `${prefix}${gsapDist}${file}${suffix}`;
  });
}

/**
 * Preserve a nested entry document's browser URL base when compilation moves
 * it to compiled/index.html. Use the same sibling-first/project-root-fallback
 * rule as mounted sub-compositions so both supported entry modes agree.
 */
function rebaseDirectEntryAssetPaths(
  html: string,
  projectDir: string,
  htmlPath: string,
  budget: CompositionExpansionBudget,
): string {
  if (!isPathInside(htmlPath, projectDir)) return html;
  const entryPath = relative(projectDir, htmlPath).replace(/\\/g, "/");
  if (!entryPath.includes("/")) return html;

  const { document } = parseHTML(html);
  const assetExists = projectAssetExists(projectDir);
  const charge = (bytes: number) => budget.chargeGenerated(entryPath, bytes);
  rewriteAssetPaths(
    document.querySelectorAll("[src], [href], [srcset]"),
    entryPath,
    (el: Element, attr: string) => el.getAttribute(attr),
    (el: Element, attr: string, value: string) => el.setAttribute(attr, value),
    assetExists,
    charge,
  );
  rewriteInlineStyleAssetUrls(
    document.querySelectorAll("[style]"),
    entryPath,
    (el: Element) => el.getAttribute("style"),
    (el: Element, value: string) => el.setAttribute("style", value),
    assetExists,
    charge,
  );
  for (const style of document.querySelectorAll("style")) {
    style.textContent = rewriteCssAssetUrls(
      style.textContent || "",
      entryPath,
      assetExists,
      charge,
    );
  }
  return document.toString();
}

export const MAX_VARIABLE_MEDIA_SRC_BYTES = 8 * 1024;
// oxlint-disable-next-line no-control-regex
const MEDIA_SRC_CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * Point each `data-var-src` video/audio at the clip its variable names, so the length and sound read below
 * are the bound clip's. Media under a per-instance `data-variable-values` host keeps the browser's answer.
 */
function bindVariableMediaSources(
  html: string,
  variables: Record<string, unknown>,
  budget: CompositionExpansionBudget,
  log?: ProducerLogger,
): string {
  if (!html.includes("data-var-src")) return html;
  const { document } = parseHTML(html);
  const declared: Record<string, unknown> = {};
  for (const el of document.querySelectorAll("[data-composition-variables]")) {
    Object.assign(declared, readDeclaredDefaults(el));
  }
  const values = { ...declared, ...variables };
  let changed = false;
  for (const el of document.querySelectorAll("video[data-var-src], audio[data-var-src]")) {
    if (el.closest("[data-variable-values]")) continue;
    const bound = boundMediaSrc(el, values);
    if (bound === null) continue;
    const src = bound.trim();
    if (src.length > MAX_VARIABLE_MEDIA_SRC_BYTES || MEDIA_SRC_CONTROL_CHARS.test(src)) {
      log?.warn("[Compiler] Refused a variable media source that cannot be a URL", {
        length: src.length,
      });
      continue;
    }
    if (el.getAttribute("src") === src) continue;
    budget.chargeGenerated("variable media sources", src.length);
    el.setAttribute("src", src);
    changed = true;
  }
  return changed ? document.toString() : html;
}

const entryFileName = (projectDir: string, htmlPath: string) =>
  isPathInside(htmlPath, projectDir)
    ? relative(projectDir, htmlPath).split(sep).join("/")
    : basename(htmlPath);

/**
 * Compile an HTML composition project into a single self-contained HTML string
 * with all media metadata resolved.
 */
export async function compileForRender(
  projectDir: string,
  htmlPath: string,
  downloadDir: string,
  options: CompileForRenderOptions = {},
): Promise<CompiledComposition> {
  const assets = new AssetDownloads(options.abortSignal);
  try {
    return await compileWithAssets(projectDir, htmlPath, downloadDir, options, assets);
  } finally {
    assets.end();
  }
}

// fallow-ignore-next-line complexity
async function compileWithAssets(
  projectDir: string,
  htmlPath: string,
  downloadDir: string,
  options: CompileForRenderOptions,
  assets: AssetDownloads,
): Promise<CompiledComposition> {
  const assetRoot = options.allowOutsideProjectAssets ? undefined : projectDir;
  const outsideFiles: OutsideFilePolicy = { includeScripts: options.includeOutsideScripts };
  if (isPathInside(htmlPath, projectDir) && escapesAssetRoot(htmlPath, assetRoot)) {
    throw new Error(`Entry file ${htmlPath} leads outside the project folder`);
  }
  if (
    isPathInside(htmlPath, projectDir) &&
    runsOutsideMarkupUnasked(projectDir, htmlPath, assetRoot, outsideFiles)
  ) {
    throw new Error(`Entry file ${htmlPath} ${OUTSIDE_COMPOSITION_NEEDS_FLAG}`);
  }
  if (!COMPOSITION_FILE.test(htmlPath)) {
    throw new Error(`Entry file ${htmlPath} is not an .html file, so it is refused`);
  }
  assertCompositionFileSize(htmlPath, basename(htmlPath));
  const budget = new CompositionExpansionBudget();
  const entryHtml = rebaseDirectEntryAssetPaths(
    readTextFile(htmlPath),
    projectDir,
    htmlPath,
    budget,
  );
  const rawHtml = bindVariableMediaSources(
    normalizeCompositionSrcs(rewriteUnresolvableGsapToCdn(entryHtml, projectDir), projectDir),
    options.variables ?? {},
    budget,
    options.log,
  );

  // Pre-flight: every data-composition-src reference must resolve to a
  // usable file before we spend any time compiling, launching a browser, or
  // waiting out a capture timeout. See EmptyCompositionError for why this is
  // unconditional (not gated behind --strict like lint warnings) — a render
  // that silently drops a scene is strictly worse than one that refuses to
  // start.
  assertSubCompositionsUsable(rawHtml, projectDir, assetRoot, outsideFiles);

  const run: CompileRun = { probes: new Map(), assets };
  const { html: compiledHtml, unresolvedCompositions } = await compileHtmlFile(
    rawHtml,
    projectDir,
    projectDir,
    downloadDir,
    options.log,
    options.urlByAbsentLocalPath,
    run,
    assetRoot,
  );

  // Compile each referenced sub-composition so the inliner can hoist it.
  const { subCompositions } = await parseSubCompositions(
    compiledHtml,
    projectDir,
    downloadDir,
    undefined,
    options.urlByAbsentLocalPath,
    run,
    assetRoot,
    outsideFiles,
  );

  // Ensure the HTML is a full document before inlining sub-compositions.
  // When index.html is a fragment (no <html>/<head>/<body>), linkedom.parseHTML()
  // returns a document with null head/body, which causes inlineSubCompositions to
  // silently discard all collected composition styles and scripts.
  const fullHtml = ensureFullDocument(compiledHtml);

  // Inline sub-compositions into the main HTML so the runtime takes the same
  // synchronous code path as the bundled preview (no async fetch of
  // data-composition-src). This mirrors what htmlBundler.ts does for preview.
  const { html: inlinedHtml, variablesByComp } = inlineSubCompositions(
    fullHtml,
    subCompositions,
    projectDir,
    options.variables ?? {},
    assetRoot,
    outsideFiles,
    budget,
  );

  // Strip preload="none" from media elements — the renderer needs to load all
  // media upfront for frame capture. Users add this to reduce browser memory in
  // preview, but it causes the headless renderer to never load the media, leading
  // to 45s timeout failures.
  const sanitizedHtml = stripPreloadNone(inlinedHtml);
  const renderModeHints = detectRenderModeHints(sanitizedHtml, options.pageMotionBlur);
  const hasShaderTransitions = detectShaderTransitionUsage(sanitizedHtml);
  // Detected BEFORE inlineExternalScripts: GSAP's own source contains
  // `transformPerspective`, so scanning post-inline HTML would flag every
  // composition that loads GSAP from a CDN.
  const usesThreeDTransforms = detectThreeDTransformUsage(sanitizedHtml);
  const hasAncestorBackgroundImage = detectAncestorBackgroundImage(sanitizedHtml);

  let deadline: AbortSignal | undefined;
  const remoteFetches = () =>
    (deadline ??= AbortSignal.any([
      AbortSignal.timeout(REMOTE_FETCH_DEADLINE_MS),
      ...(options.abortSignal ? [options.abortSignal] : []),
    ]));
  // Remote font stylesheets join the page first, or the font check below cannot see them.
  const fontSheetHtml = await inlineExternalFontStylesheets(
    promoteCssImportsToLinkTags(sanitizedHtml),
    budget,
    remoteFetches,
  );
  options.abortSignal?.throwIfAborted();
  const normalizedFontHtml = normalizeSystemFontPrimaryFamilies(
    injectTextRenderingRule(coalesceHeadStylesAndBodyScripts(fontSheetHtml)),
  );

  const coalescedHtml = await injectDeterministicFontFaces(normalizedFontHtml, {
    logger: defaultLogger,
    failClosedFontFetch: options.failClosedFontFetch === true,
    allowSystemFontCapture: options.allowSystemFontCapture,
    projectFontFamilies: projectStylesheetFontFamilies(fontSheetHtml, projectDir),
    abortSignal: options.abortSignal,
  });

  // CDN scripts are inlined after coalescing so they stay separate from the merged inline runs.
  const assembledHtml = await inlineExternalScripts(coalescedHtml, budget, remoteFetches);
  options.abortSignal?.throwIfAborted();

  // Inject studio position seek re-apply script when positions are baked into HTML.
  // GSAP overwrites the `translate` CSS property on every frame seek; this script
  // re-asserts the CSS custom property var() form after each seek so dragged
  // positions survive frame-by-frame rendering without a JSON sidecar.
  const htmlWithPositionScript = htmlHasStudioPositionEdits(assembledHtml)
    ? (insertBeforeCloseTag(
        assembledHtml,
        "body",
        `<script>${createStudioPositionSeekReapplyScript()}\n//# sourceURL=hyperframes://position-seek-reapply</script>`,
      ) ?? assembledHtml)
    : assembledHtml;
  const htmlWithDeferredScripts = prepareCompositionScripts(
    injectSdkPositionEditsRenderScript(htmlWithPositionScript),
  );

  // Download remote <video> and <audio> sources to compiledDir and rewrite the
  // src attributes so the renderer reads from localhost. Remote S3 URLs cause
  // Chrome to spend the entire pageReadyTimeout buffering 10+ large video files
  // over the network; any that don't reach readyState >= 2 in time render as
  // blank black frames. Localising them eliminates the race.
  const { html: htmlWithLocalMedia, remoteMediaAssets } = await localizeRemoteMediaSources(
    htmlWithDeferredScripts,
    downloadDir,
    run.assets,
  );

  // Download remote <img> sources. Same race shape as video/audio: the
  // readiness gate can pass before Chrome decodes the pixels, and Chrome can
  // evict decoded pixels mid-render and re-fetch, producing intermittent
  // blank-frame flicker. Localising to disk removes both races.
  const { html: htmlWithLocalImages, remoteMediaAssets: remoteImageAssets } =
    await localizeRemoteImageSources(htmlWithLocalMedia, downloadDir, run.assets);

  // Download remote CSS background-image url() references. drawElementImage omits
  // cross-origin content, so remote backgrounds render black on the fast path;
  // localising them to same-origin closes that gap.
  const { html: htmlWithLocalBg, remoteMediaAssets: remoteBgAssets } =
    await localizeRemoteBackgroundImages(htmlWithLocalImages, downloadDir, run.assets);

  // Download remote @font-face src URLs and rewrite to local paths.
  // Remote font URLs fail with a CORS rejection at render time (S3 does not
  // allow http://localhost:PORT as origin), causing Chrome to silently fall
  // back to the next font in the stack.
  const { html: htmlWithLocalizedFonts, remoteMediaAssets: remoteFontAssets } =
    await localizeFontFaceUrls(htmlWithLocalBg, downloadDir, run.assets);

  // Chrome cannot decode HEIC, and ffprobe reads a tiled one as video streams,
  // so convert to JPEG before the media-type preflight sees it.
  const {
    html: htmlWithJpegs,
    preparedAssets: preparedHeifAssets,
    preparedImages: preparedHeifImages,
  } = await prepareHeifImageInputs(htmlWithLocalizedFonts, {
    projectDir,
    downloadDir,
    cacheDir: options.animatedGifCacheDir,
    sourceAssets: remoteImageAssets,
    timeoutMs: options.ffmpegProcessTimeout,
    allowOutsideFiles: assetRoot === undefined,
  });
  if (preparedHeifImages.length > 0) {
    defaultLogger.debug(`[Compiler] Converted ${preparedHeifImages.length} HEIC image(s) to JPEG`);
  }

  const gifSourceAssets = new Map<string, string>(remoteImageAssets);
  const {
    html: htmlWithPreparedGifs,
    preparedAssets: preparedGifAssets,
    preparedGifs,
  } = await prepareAnimatedGifInputs(htmlWithJpegs, {
    projectDir,
    downloadDir,
    cacheDir: options.animatedGifCacheDir,
    sourceAssets: gifSourceAssets,
    timeoutMs: options.ffmpegProcessTimeout,
    allowOutsideFiles: assetRoot === undefined,
  });
  if (preparedGifs.length > 0) {
    defaultLogger.debug(`[Compiler] Prepared ${preparedGifs.length} animated GIF input(s) as WebM`);
  }

  // Remote fonts were downloaded outside the project, so they embed from where they landed.
  const embeddedHtml = await embedLocalFontFaces(
    htmlWithPreparedGifs,
    projectDir,
    assetRoot,
    budget,
    options.log,
    remoteFontAssets,
  );

  // Collect assets that resolve outside projectDir (e.g. ../shared-assets/hero.png).
  // These can't be served by the file server, so we map them to paths the
  // orchestrator will copy into the compiled output directory.
  const { html, externalAssets } = options.allowOutsideProjectAssets
    ? collectExternalAssets(
        embeddedHtml,
        projectDir,
        options.log,
        entryFileName(projectDir, htmlPath),
        { includeScripts: options.includeOutsideScripts },
      )
    : { html: embeddedHtml, externalAssets: new Map<string, string>() };

  for (const [relPath, absPath] of remoteMediaAssets) {
    externalAssets.set(relPath, absPath);
  }
  for (const [relPath, absPath] of remoteImageAssets) {
    externalAssets.set(relPath, absPath);
  }
  for (const [relPath, absPath] of remoteBgAssets) {
    externalAssets.set(relPath, absPath);
  }
  for (const [relPath, absPath] of remoteFontAssets) {
    externalAssets.set(relPath, absPath);
  }
  for (const [relPath, absPath] of preparedGifAssets) {
    externalAssets.set(relPath, absPath);
  }
  for (const [relPath, absPath] of preparedHeifAssets) {
    externalAssets.set(relPath, absPath);
  }

  // Read the media list off the inlined document rather than merging the
  // per-file lists. Merging deduplicated by element id, which is only unique
  // within one composition file: two scenes declaring `<video id="clip">` — or
  // two bare `<video>`s, both auto-numbered `hf-video-0` — collapsed into one
  // entry and injected frames onto whichever element came first. See #3340.
  const { videos, audios, images, droppedMediaIds, gradedCanvas } = collectRenderMedia(html);
  const masterFxChain = parseMasterFxChain(html);

  // Advisory video checks (sparse keyframes, VFR). Fire-and-forget — these spawn
  // ffprobe subprocesses and should not block compilation since they only produce warnings.
  // The two probes run in sequence rather than in parallel: the keyframe analysis needs
  // the video stream's own duration to classify a single-keyframe (single-GOP) file.
  const advised = new Set<string>();
  for (const video of videos) {
    if (isHttpUrl(video.src)) continue;
    const videoPath = resolve(projectDir, video.src);
    if (
      advised.has(videoPath) ||
      namesAnotherNetworkRoot(projectDir, videoPath) ||
      !existsSync(videoPath) ||
      escapesAssetRoot(videoPath, assetRoot) ||
      isPrivateUnderAssetRoots(videoPath, [projectDir, downloadDir])
    )
      continue;
    advised.add(videoPath);
    const reencode = `ffmpeg -i "${video.src}" -c:v libx264 -r 30 -g 30 -keyint_min 30 -movflags +faststart -c:a copy output.mp4`;
    (async () => {
      const metadata = await withMediaProbeSlot(() => extractMediaMetadata(videoPath));
      const analysis = await withMediaProbeSlot(() =>
        analyzeKeyframeIntervals(videoPath, metadata),
      );
      if (analysis.isProblematic) {
        defaultLogger.warn(
          `[Compiler] WARNING: Video "${video.id}" has sparse keyframes (max interval: ${analysis.maxIntervalSeconds}s). ` +
            `Long GOPs can make preview seeking slower; rendering is unaffected. If preview seeking is slow, re-encode with: ${reencode}`,
        );
      }
      if (metadata.isVFR) {
        // defaultLogger (stderr), not console.info (stdout) — matches the sibling
        // warning above; a stdout line here corrupts `check --json` / `validate --json`.
        defaultLogger.warn(
          `[Compiler] Video "${video.id}" is variable frame rate (VFR); ` +
            `the engine will normalize it to CFR before frame extraction. ` +
            `If rendering feels slow on this video, pre-encode once with: ${reencode}`,
        );
      }
    })().catch(() => {});
  }

  // Read dimensions from root composition element using DOM parser
  const { document } = parseHTML(html);
  const rootEl = document.querySelector("[data-composition-id]");

  const width = rootEl ? parseInt(rootEl.getAttribute("data-width") || "1080", 10) : 1080;
  const height = rootEl ? parseInt(rootEl.getAttribute("data-height") || "1920", 10) : 1920;

  // Static duration (may be 0 if set at runtime by GSAP)
  const staticDuration = rootEl
    ? (parseStrictFiniteTimingNumber(rootEl.getAttribute("data-duration")) ??
      parseStrictFiniteTimingNumber(rootEl.getAttribute("data-composition-duration")) ??
      0)
    : 0;

  return {
    html,
    subCompositions,
    videos,
    audios,
    images,
    droppedMediaIds,
    gradedCanvas,
    ...(masterFxChain ? { masterFxChain } : {}),
    unresolvedCompositions,
    variablesByComp,
    externalAssets,
    width,
    height,
    staticDuration,
    renderModeHints,
    hasShaderTransitions,
    usesThreeDTransforms,
    hasAncestorBackgroundImage,
  };
}

/**
 * Discover media elements from the browser DOM after JavaScript has run.
 * This catches videos/audios whose `src` is set dynamically via JS
 * (e.g. `document.getElementById("pip-video").src = URL`), which the
 * static regex parsers miss because the HTML has `src=""`. Clips are keyed
 * by `data-hf-render-id` when present — author ids collide across inlined
 * scenes, and this snapshot is the only identity those empty-src elements get.
 */
export interface BrowserMediaElement {
  id: string;
  tagName: "video" | "audio" | "image";
  src: string;
  start: number;
  end: number;
  duration: number;
  /** True when compilation inferred duration from the fallback source. */
  durationInferred: boolean;
  mediaStart: number;
  playbackRate: RateSpec;
  loop: boolean;
  hasAudio: boolean;
  volume: number;
  /** The `muted` attribute/property. Preview silences muted media; the mix must too. */
  muted: boolean;
}

export interface BrowserAudioVolumeAutomation {
  id: string;
  keyframes: AudioVolumeKeyframe[];
}

export async function discoverMediaFromBrowser(page: Page): Promise<BrowserMediaElement[]> {
  const elements = await page.evaluate(() => {
    const results: {
      id: string;
      tagName: "video" | "audio" | "image";
      src: string;
      start: number;
      endRaw: string | null;
      durationRaw: string | null;
      intrinsicDuration: number;
      durationInferred: boolean;
      playbackStartRaw: string | null;
      mediaStartRaw: string | null;
      playbackRateRaw: string | null;
      automationRaw: string | null;
      defaultPlaybackRate: number;
      loop: boolean;
      hasAudio: boolean;
      volume: number;
      muted: boolean;
    }[] = [];

    const autoImageIds = new Map<Element, string>();
    let autoImageId = 0;
    document.querySelectorAll("img[src]").forEach((image) => {
      if (!image.id) autoImageIds.set(image, `hf-img-${autoImageId++}`);
    });

    const mediaEls = new Set<Element>(
      document.querySelectorAll("video[data-start], audio[data-start], img[data-var-src]"),
    );
    // A variable-bound <picture><source> changes the owning image's currentSrc;
    // the <img> fallback itself does not necessarily carry data-var-src.
    document.querySelectorAll("picture source[data-var-src]").forEach((source) => {
      const image = source.closest("picture")?.querySelector("img");
      if (image) mediaEls.add(image);
    });
    mediaEls.forEach((el) => {
      const htmlEl = el as HTMLVideoElement | HTMLAudioElement | HTMLImageElement;
      const isImage = htmlEl.tagName.toLowerCase() === "img";
      const tagName: "video" | "audio" | "image" = isImage
        ? "image"
        : htmlEl.tagName.toLowerCase() === "video"
          ? "video"
          : "audio";
      // Render id is document-unique after inlining; author id is only unique
      // per composition file. Empty-src media is skipped by the static parse
      // and lives or dies on this snapshot — keying by author id collapses
      // colliding scenes onto one clip (residual of #3340).
      const id =
        htmlEl.getAttribute("data-hf-render-id") ||
        htmlEl.id ||
        (isImage ? autoImageIds.get(htmlEl) : undefined);
      if (!id) return;

      // currentSrc is authoritative for <video>/<audio><source> and responsive images.
      const resolvedSrc = htmlEl.currentSrc || htmlEl.src || htmlEl.getAttribute("src") || "";
      const withoutQueryAndHash = (url: string) => url.replace(/[?#][\s\S]*$/, "");
      const isPageItself = withoutQueryAndHash(resolvedSrc) === withoutQueryAndHash(location.href);
      const src = isPageItself ? "" : resolvedSrc;
      const start = parseFloat(htmlEl.getAttribute("data-start") || "0");
      const endRaw = htmlEl.getAttribute("data-end");
      const durationRaw = htmlEl.getAttribute("data-duration");
      const durationInferred = htmlEl.hasAttribute("data-hf-inferred-duration");
      const intrinsicDuration = isImage
        ? 0
        : (htmlEl as HTMLVideoElement | HTMLAudioElement).duration;
      const playbackStartRaw = htmlEl.getAttribute("data-playback-start");
      const mediaStartRaw = htmlEl.getAttribute("data-media-start");
      const playbackRateRaw = htmlEl.getAttribute("data-playback-rate");
      const automationRaw = htmlEl.getAttribute("data-automation");
      // playbackRate can include the transport speed; defaultPlaybackRate is the clip's own rate.
      const defaultPlaybackRate = isImage
        ? 1
        : (htmlEl as HTMLVideoElement | HTMLAudioElement).defaultPlaybackRate;
      const loop = htmlEl.hasAttribute("loop");
      const hasAudio = htmlEl.getAttribute("data-has-audio") === "true";
      const volume = parseFloat(htmlEl.getAttribute("data-volume") || "1");
      const muted =
        !isImage &&
        (htmlEl.hasAttribute("muted") || (htmlEl as HTMLVideoElement | HTMLAudioElement).muted);

      results.push({
        id,
        tagName,
        src,
        start,
        endRaw,
        durationRaw,
        intrinsicDuration,
        durationInferred,
        playbackStartRaw,
        mediaStartRaw,
        playbackRateRaw,
        automationRaw,
        defaultPlaybackRate,
        loop,
        hasAudio,
        volume,
        muted,
      });
    });

    return results;
  });

  return elements.map(
    ({
      endRaw,
      durationRaw,
      intrinsicDuration,
      playbackStartRaw,
      mediaStartRaw,
      playbackRateRaw,
      automationRaw,
      defaultPlaybackRate,
      ...element
    }) => ({
      ...element,
      end: parseStrictFiniteTimingNumber(endRaw) ?? 0,
      duration:
        element.durationInferred && Number.isFinite(intrinsicDuration) && intrinsicDuration > 0
          ? intrinsicDuration
          : (parseStrictFiniteTimingNumber(durationRaw) ?? 0),
      mediaStart: readMediaStart({
        getAttribute(name: string) {
          if (name === "data-playback-start") return playbackStartRaw;
          if (name === "data-media-start") return mediaStartRaw;
          return null;
        },
      }),
      playbackRate: resolveRateSpec(
        automationRaw,
        readPlaybackRate(
          (name) => (name === "data-playback-rate" ? playbackRateRaw : null),
          defaultPlaybackRate,
        ),
      ),
    }),
  );
}

export async function discoverAudioVolumeAutomationFromTimeline(
  page: Page,
  audioIds: string[],
  compositionDuration: number,
  sampleFps: number,
): Promise<BrowserAudioVolumeAutomation[]> {
  if (audioIds.length === 0 || compositionDuration <= 0) return [];

  const sampleStep = 1 / Math.min(60, Math.max(1, sampleFps));
  const rawWindows = await page.evaluate((ids: string[]) => {
    return ids.flatMap((id) => {
      const el =
        window.__hfMediaEl?.(id) ??
        document.getElementById(id) ??
        document.getElementById(id.replace(/-audio$/, ""));
      if (!(el instanceof HTMLAudioElement) && !(el instanceof HTMLVideoElement)) return [];
      return [
        {
          id,
          startRaw: el.dataset.start ?? null,
          endRaw: el.dataset.end ?? null,
          durationRaw: el.dataset.duration ?? null,
        },
      ];
    });
  }, audioIds);
  const clips = rawWindows.map(({ id, startRaw, endRaw, durationRaw }) => {
    const start = parseStrictFiniteTimingNumber(startRaw) ?? 0;
    const authoredDuration = parseStrictFiniteTimingNumber(durationRaw);
    const authoredEnd = parseStrictFiniteTimingNumber(endRaw);
    const end =
      authoredDuration != null && authoredDuration > 0
        ? start + authoredDuration
        : authoredEnd != null && authoredEnd > start
          ? authoredEnd
          : compositionDuration;
    return { id, start, end };
  });
  return page.evaluate(
    ({ clips, duration, step, maxGain }) => {
      const results: { id: string; keyframes: { time: number; volume: number }[] }[] = [];
      const clampGain = (value: number) =>
        Number.isFinite(value) ? Math.max(0, Math.min(maxGain, value)) : 1;
      // `HTMLMediaElement.volume` is spec-clamped to [0,1], so a clip authored
      // above unity — or a GSAP tween seeded from one — reads back as 0 dB and
      // the whole authored boost is lost from the mix. Shadow the accessor for
      // the probe so the authored value survives; the native setter still gets
      // the clamped value. Mirrors `withUnclampedVolume` in
      // packages/core/src/audioGain.ts, which the preview probe uses; this copy
      // exists only because the probe body is serialized into the page.
      //
      // Guarded because this body is also executed directly by tests that stand
      // in for a Page, where there is no DOM and no HTMLMediaElement.
      const volumeDescriptor =
        typeof HTMLMediaElement === "undefined"
          ? undefined
          : Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "volume");
      const nativeVolumeGet = volumeDescriptor?.get;
      const nativeVolumeSet = volumeDescriptor?.set;
      const withUnclampedVolume = <T>(el: HTMLMediaElement, probe: () => T): T => {
        if (!nativeVolumeGet || !nativeVolumeSet) return probe();
        let authored = Number(nativeVolumeGet.call(el));
        Object.defineProperty(el, "volume", {
          configurable: true,
          get: () => authored,
          set: (value: number) => {
            authored = Number(value);
            nativeVolumeSet.call(el, Math.max(0, Math.min(1, authored)));
          },
        });
        try {
          return probe();
        } finally {
          delete (el as unknown as Record<"volume", unknown>).volume;
          nativeVolumeSet.call(el, Math.max(0, Math.min(1, authored)));
        }
      };
      const timelines = (window as unknown as { __timelines?: Record<string, unknown> })
        .__timelines;
      if (!timelines) return results;

      const rootEl = document.querySelector("[data-composition-id]");
      const compId = rootEl?.getAttribute("data-composition-id");
      if (!compId) return results;

      const tl = timelines[compId] as
        | {
            totalTime?: (t: number, suppressEvents?: boolean) => unknown;
            seek?: (t: number, suppressEvents?: boolean) => unknown;
          }
        | undefined;
      if (!tl) return results;

      const seekTl = (t: number) => {
        if (typeof tl.totalTime === "function") {
          tl.totalTime(t, true);
        } else if (typeof tl.seek === "function") {
          tl.seek(t, true);
        }
      };

      for (const { id, start, end } of clips) {
        const el =
          window.__hfMediaEl?.(id) ??
          document.getElementById(id) ??
          document.getElementById(id.replace(/-audio$/, ""));
        if (!(el instanceof HTMLAudioElement) && !(el instanceof HTMLVideoElement)) continue;

        const sampleStart = Math.max(0, start);
        const sampleEnd = Math.min(duration, end);
        const initialVolumeAttr = Number.parseFloat(el.dataset.volume ?? "");

        const keyframes = withUnclampedVolume(el, () => {
          if (Number.isFinite(initialVolumeAttr)) {
            el.volume = clampGain(initialVolumeAttr);
          }

          const keyframes: { time: number; volume: number }[] = [];
          let previousSample: { time: number; volume: number } | undefined;
          for (let t = sampleStart; t <= sampleEnd + 0.000001; t = Math.min(sampleEnd, t + step)) {
            seekTl(t);
            const rawVolume = Number(el.volume);
            if (!Number.isFinite(rawVolume)) {
              if (t === sampleEnd) break;
              continue;
            }
            const volume = clampGain(rawVolume);
            const sample = {
              time: Number(t.toFixed(6)),
              volume: Number(volume.toFixed(6)),
            };
            const last = keyframes.at(-1);
            if (!last || Math.abs(last.volume - volume) > 0.0001) {
              // Retain the preceding real sample when compression omitted a flat
              // run. Continuous ramps already have that sample as their last
              // keyframe, so their interpolation remains unchanged.
              if (last && previousSample && previousSample.time > last.time) {
                keyframes.push(previousSample);
              }
              keyframes.push(sample);
            } else if (t === sampleEnd && sample.time > last.time) {
              keyframes.push(sample);
            }
            previousSample = sample;
            if (t === sampleEnd) break;
          }
          return keyframes;
        });

        const staticAttr = Number.parseFloat(el.dataset.volume ?? "");
        const staticVolume = Number.isFinite(staticAttr) ? clampGain(staticAttr) : 1;
        const hasAutomation = keyframes.some(
          (keyframe) => Math.abs(keyframe.volume - staticVolume) > 0.0001,
        );
        if (hasAutomation) {
          results.push({ id, keyframes });
        }
      }

      seekTl(0);
      return results;
    },
    { clips, duration: compositionDuration, step: sampleStep, maxGain: MAX_AUDIO_GAIN },
  );
}

export interface VideoVisibilityWindow {
  videoId: string;
  visibleStart: number;
  visibleEnd: number;
}

/**
 * Seek the GSAP timeline to discover when each video's parent scene is visible.
 * Only processes videos with the data-hf-auto-start sentinel (auto-injected timing).
 */
export async function discoverVideoVisibilityFromTimeline(
  page: Page,
  compositionDuration: number,
): Promise<VideoVisibilityWindow[]> {
  if (compositionDuration <= 0) return [];

  return page.evaluate((duration: number) => {
    const results: { videoId: string; visibleStart: number; visibleEnd: number }[] = [];
    const videos = document.querySelectorAll("video[data-hf-auto-start]");
    if (videos.length === 0) return results;

    const timelines = (window as unknown as { __timelines?: Record<string, unknown> }).__timelines;
    if (!timelines) return results;

    const rootEl = document.querySelector("[data-composition-id]");
    const compId = rootEl?.getAttribute("data-composition-id");
    if (!compId) return results;

    const tl = timelines[compId] as
      | {
          totalTime?: (t: number, suppressEvents?: boolean) => unknown;
          seek?: (t: number, suppressEvents?: boolean) => unknown;
        }
      | undefined;
    if (!tl) return results;

    const seekTl = (t: number) => {
      if (typeof tl.totalTime === "function") {
        tl.totalTime(t, true);
      } else if (typeof tl.seek === "function") {
        tl.seek(t, true);
      }
    };

    const SAMPLE_STEP = 0.1;
    const BINARY_PRECISION = 1 / 60;

    // Seek once per timestep and sample every video — seeking dominates and is
    // independent of which element we read.
    const entries: {
      id: string;
      sceneEl: Element;
      firstVisible: number | null;
      lastVisible: number | null;
    }[] = [];
    for (const videoEl of videos) {
      const id = videoEl.getAttribute?.("data-hf-render-id") || videoEl.id;
      if (!id) continue;
      entries.push({
        id,
        sceneEl: videoEl.closest(".scene") || videoEl,
        firstVisible: null,
        lastVisible: null,
      });
    }
    if (entries.length === 0) return results;

    for (let t = 0; t <= duration; t += SAMPLE_STEP) {
      seekTl(t);
      for (const entry of entries) {
        const opacity = parseFloat(window.getComputedStyle(entry.sceneEl).opacity);
        if (opacity > 0) {
          if (entry.firstVisible === null) entry.firstVisible = t;
          entry.lastVisible = t;
        }
      }
    }

    // Per-video boundary refinement (cheap: O(log(step)) seeks each).
    for (const entry of entries) {
      const { id, sceneEl, firstVisible, lastVisible } = entry;
      if (firstVisible === null || lastVisible === null) continue;

      // Binary search left boundary
      let lo = Math.max(0, firstVisible - SAMPLE_STEP);
      let hi = firstVisible;
      while (hi - lo > BINARY_PRECISION) {
        const mid = (lo + hi) / 2;
        seekTl(mid);
        const opacity = parseFloat(window.getComputedStyle(sceneEl).opacity);
        if (opacity > 0) hi = mid;
        else lo = mid;
      }
      const exactStart = hi;

      // Binary search right boundary
      lo = lastVisible;
      hi = Math.min(duration, lastVisible + SAMPLE_STEP);
      while (hi - lo > BINARY_PRECISION) {
        const mid = (lo + hi) / 2;
        seekTl(mid);
        const opacity = parseFloat(window.getComputedStyle(sceneEl).opacity);
        if (opacity > 0) lo = mid;
        else hi = mid;
      }
      const exactEnd = lo;

      results.push({
        videoId: id,
        visibleStart: Math.max(0, exactStart),
        visibleEnd: Math.min(duration, exactEnd),
      });
    }

    seekTl(0);
    return results;
  }, compositionDuration);
}

/**
 * Resolve composition durations via Puppeteer by querying window.__timelines.
 * The page must already have the interceptor loaded and timelines registered.
 */
export async function resolveCompositionDurations(
  page: Page,
  unresolved: UnresolvedElement[],
): Promise<ResolvedDuration[]> {
  if (unresolved.length === 0) return [];

  const ids = unresolved.map((el) => el.id);

  const results = await page.evaluate((compIds: string[]) => {
    const win = window as unknown as { __timelines?: Record<string, { duration(): number }> };
    const timelines = win.__timelines || {};
    const resolved: {
      id: string;
      duration: number;
      source: string;
      durationRaw?: string;
      compositionDurationRaw?: string;
    }[] = [];

    for (const id of compIds) {
      // Try window.__timelines[id].duration() first (GSAP timeline)
      const tl = timelines[id];
      let dur = 0;
      try {
        dur = typeof tl?.duration === "function" ? Number(tl.duration()) : 0;
      } catch {
        dur = 0;
      }
      if (dur > 0) {
        resolved.push({ id, duration: dur, source: "__timelines" });
        continue;
      }

      // Fallback: check for authored duration on the element itself
      const el = document.getElementById(id);
      if (el) {
        const durationRaw = el.getAttribute("data-duration");
        const compositionDurationRaw = el.getAttribute("data-composition-duration");
        if (durationRaw != null || compositionDurationRaw != null) {
          resolved.push({
            id,
            duration: 0,
            source: "data-duration",
            ...(durationRaw != null ? { durationRaw } : {}),
            ...(compositionDurationRaw != null ? { compositionDurationRaw } : {}),
          });
          continue;
        }
      }

      resolved.push({ id, duration: 0, source: "unresolved" });
    }

    return resolved;
  }, ids);

  const resolutions: ResolvedDuration[] = [];
  for (const r of results) {
    const duration =
      parseStrictFiniteTimingNumber(r.durationRaw) ??
      parseStrictFiniteTimingNumber(r.compositionDurationRaw) ??
      r.duration;
    if (duration != null && duration > 0) {
      resolutions.push({ id: r.id, duration });
    }
  }

  return resolutions;
}

/**
 * Re-compile after composition durations are resolved.
 * Injects durations into the HTML and re-parses sub-composition media with proper bounds.
 */
export async function recompileWithResolutions(
  compiled: CompiledComposition,
  resolutions: ResolvedDuration[],
  projectDir: string,
  downloadDir: string,
  assetRoot?: string,
  outsideFiles: OutsideFilePolicy = {},
): Promise<CompiledComposition> {
  if (resolutions.length === 0) return compiled;

  const html = injectDurations(compiled.html, resolutions);

  // Re-resolve the sub-composition map against the updated HTML, but keep the
  // media list from the first pass. Resolving a composition's duration stamps a
  // `data-end` on its host, and re-collecting would newly clamp clips to it —
  // a retiming, not an identity fix. `compiled.videos` was already collected
  // from this same inlined document, so it is complete and correctly keyed.
  const { subCompositions } = await parseSubCompositions(
    html,
    projectDir,
    downloadDir,
    undefined,
    undefined,
    undefined,
    assetRoot,
    outsideFiles,
  );
  const { videos, audios, images } = compiled;

  const remaining = compiled.unresolvedCompositions.filter(
    (c) => !resolutions.some((r) => r.id === c.id),
  );

  return {
    ...compiled,
    html,
    subCompositions,
    videos,
    audios,
    images,
    unresolvedCompositions: remaining,
    renderModeHints: compiled.renderModeHints,
    hasShaderTransitions: compiled.hasShaderTransitions,
  };
}
