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

import { readFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname, resolve, basename } from "path";
import { parseHTML } from "linkedom";
import {
  compileTimingAttrs,
  injectDurations,
  extractResolvedMedia,
  clampDurations,
  shouldClampResolvedMediaDuration,
  CSS_URL_RE,
  isNonRelativeUrl,
  type ResolvedDuration,
  type UnresolvedElement,
} from "@hyperframes/core";
import {
  assignBundledRuntimeCompositionIds,
  buildVariablesByCompScript,
  inlineSubCompositions as inlineSubCompositionsShared,
  prepareFlattenedInnerRoot,
  emitRootCompositionVariableStyles,
  readDeclaredDefaults,
  parseHostVariableValues,
} from "@hyperframes/core/compiler";
import {
  checkSubCompositionUsability,
  type ParsableDocumentLike,
} from "@hyperframes/parsers/sub-composition-validity";
import { extractMediaMetadata, extractAudioMetadata } from "../utils/ffprobe.js";
import { isPathInside, toExternalAssetKey } from "../utils/paths.js";
import {
  parseVideoElements,
  parseImageElements,
  type VideoElement,
  type ImageElement,
  parseAudioElements,
  type AudioElement,
  type AudioVolumeKeyframe,
  analyzeKeyframeIntervals,
} from "@hyperframes/engine";
import { assertPublicHttpsUrl, downloadToTemp, isHttpUrl } from "../utils/urlDownloader.js";
import type { Page } from "puppeteer-core";
import {
  injectDeterministicFontFaces,
  normalizeSystemFontPrimaryFamilies,
} from "./deterministicFonts.js";
import { prepareAnimatedGifInputs } from "./animatedGifPrep.js";
import { createStudioPositionSeekReapplyScript } from "@hyperframes/studio-server/manual-edits-render-script";
import { getPositionEditsRenderScript } from "@hyperframes/core/runtime/position-edits-render";
import { defaultLogger, type ProducerLogger } from "../logger.js";

export interface CompiledComposition {
  html: string;
  subCompositions: Map<string, string>;
  videos: VideoElement[];
  audios: AudioElement[];
  images: ImageElement[];
  unresolvedCompositions: UnresolvedElement[];
  /** Assets that resolve outside projectDir. Keys are the path used in HTML, values are absolute filesystem paths. */
  externalAssets: Map<string, string>;
  width: number;
  height: number;
  staticDuration: number;
  renderModeHints: RenderModeHints;
  hasShaderTransitions: boolean;
  /** Author HTML/CSS/scripts use a CSS 3D rendering context (pre-CDN-inline scan). */
  usesThreeDTransforms: boolean;
  /** Author HTML/CSS use mix-blend-mode (pre-CDN-inline scan). */
  usesMixBlendMode: boolean;
  /** Ancestors of the composition root carry a background-image (gradient/url). */
  hasAncestorBackgroundImage: boolean;
}

/** Adapts linkedom's `parseHTML` to the `checkSubCompositionUsability` contract. */
function parseSubCompHtmlForValidity(html: string): ParsableDocumentLike {
  return parseHTML(html).document as unknown as ParsableDocumentLike;
}

export function injectSdkPositionEditsRenderScript(html: string): string {
  if (!html.includes("data-hf-edit-base-x") && !html.includes("data-hf-edit-base-y")) {
    return html;
  }
  const scriptBody = getPositionEditsRenderScript().replace(/<\/script/gi, "<\\/script");
  const script = `<script>${scriptBody}</script>`;
  const bodyClose = html.search(/<\/body\s*>/i);
  if (bodyClose < 0) return `${html}${script}`;
  return `${html.slice(0, bodyClose)}${script}${html.slice(bodyClose)}`;
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
        "<template> or <body> containing a [data-composition-id] element. If a scene-authoring " +
        "step is still running, wait for it to finish before referencing the file.",
    );
    this.name = "EmptyCompositionError";
    this.problems = problems;
  }
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
// fallow-ignore-next-line complexity
function assertSubCompositionsUsable(
  html: string,
  projectDir: string,
  visited: Set<string> = new Set(),
): void {
  const { document } = parseHTML(html);
  const hosts = [...document.querySelectorAll("[data-composition-src]")];
  const problems: Array<{ srcPath: string; detail: string }> = [];

  for (const el of hosts) {
    const srcPath = el.getAttribute("data-composition-src");
    if (!srcPath) continue;
    if (/^__[A-Z_]+__$/.test(srcPath)) continue; // template placeholder, not a real reference — matches lint's skip

    const filePath = resolve(projectDir, srcPath);
    // Circular reference guard. parseSubCompositions (below) silently
    // `continue`s on a repeat visit with no reporting at all — mirror that
    // silence here rather than pretend it surfaces an error somewhere else.
    if (visited.has(filePath)) continue;

    if (!existsSync(filePath)) {
      problems.push({ srcPath, detail: "the file does not exist" });
      continue;
    }

    const fileHtml = readFileSync(filePath, "utf-8");
    const validity = checkSubCompositionUsability(fileHtml, parseSubCompHtmlForValidity);
    if (!validity.ok) {
      problems.push({
        srcPath,
        detail: validity.detail ?? "the file is empty or could not be parsed",
      });
      continue;
    }

    // Recurse into nested sub-compositions so a broken scene three levels
    // deep is still named directly instead of surfacing as a parent-level
    // "no error, just missing content" mystery.
    //
    // Pass `projectDir` unchanged (not dirname(filePath)) — data-composition-src
    // is always resolved root-relative, even from within a nested
    // sub-composition. This must match parseSubCompositions' own recursive
    // call below exactly (it threads the original projectDir through every
    // level too), or this pre-flight check resolves nested references to the
    // wrong path and aborts renders that would have actually succeeded.
    const nestedVisited = new Set(visited);
    nestedVisited.add(filePath);
    try {
      assertSubCompositionsUsable(fileHtml, projectDir, nestedVisited);
    } catch (err) {
      if (err instanceof EmptyCompositionError) {
        problems.push(...err.problems);
      } else {
        throw err;
      }
    }
  }

  if (problems.length > 0) {
    throw new EmptyCompositionError(problems);
  }
}

export type RenderModeHintCode = "iframe" | "requestAnimationFrame" | "htmlInCanvas";

export interface RenderModeHint {
  code: RenderModeHintCode;
  message: string;
}

export interface RenderModeHints {
  recommendScreenshot: boolean;
  reasons: RenderModeHint[];
}

function dedupeElementsById<T extends { id: string }>(elements: T[]): T[] {
  const deduped = new Map<string, T>();
  for (const element of elements) {
    deduped.set(element.id, element);
  }
  return Array.from(deduped.values());
}

const INLINE_SCRIPT_PATTERN = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const COMPILER_MOUNT_BLOCK_START = "/* __HF_COMPILER_MOUNT_START__ */";
const COMPILER_MOUNT_BLOCK_END = "/* __HF_COMPILER_MOUNT_END__ */";

function stripJsComments(source: string): string {
  return source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function stripCompilerMountBootstrap(source: string): string {
  return source.replace(
    new RegExp(
      `${COMPILER_MOUNT_BLOCK_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${COMPILER_MOUNT_BLOCK_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      "g",
    ),
    "",
  );
}

export function detectRenderModeHints(html: string): RenderModeHints {
  const reasons: RenderModeHint[] = [];
  const { document } = parseHTML(html);

  if (document.querySelector("canvas[layoutsubtree]")) {
    reasons.push({
      code: "htmlInCanvas",
      message:
        "Detected html-in-canvas API (layoutsubtree canvas). Chrome does not support concurrent drawElementImage across multiple workers; render is pinned to a single worker.",
    });
  }

  if (document.querySelector("iframe")) {
    reasons.push({
      code: "iframe",
      message:
        "Detected <iframe> in the composition DOM. Nested iframe animation is routed through screenshot capture mode for compatibility.",
    });
  }

  let scriptMatch: RegExpExecArray | null;
  const scriptPattern = new RegExp(INLINE_SCRIPT_PATTERN.source, INLINE_SCRIPT_PATTERN.flags);
  while ((scriptMatch = scriptPattern.exec(html)) !== null) {
    const attrs = scriptMatch[1] || "";
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const content = stripJsComments(stripCompilerMountBootstrap(scriptMatch[2] || ""));
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

const MIX_BLEND_MODE_PATTERN = /mix-blend-mode\s*:/i;

function detectMixBlendModeUsage(html: string): boolean {
  return MIX_BLEND_MODE_PATTERN.test(html);
}

/** A background declaration whose value paints an image (gradient or url). */
const BACKGROUND_IMAGE_DECL_PATTERN =
  /(?:^|;|\{)\s*background(?:-image)?\s*:[^;}]*(?:\bgradient\s*\(|url\s*\()/i;

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
    if (style && BACKGROUND_IMAGE_DECL_PATTERN.test(`{${style}}`)) return true;
  }
  // <style> rules: any rule carrying an image-painting background declaration
  // whose selector resolves to an ancestor of the root. Selector matching goes
  // through querySelectorAll so class/id/compound selectors on wrappers are
  // covered, not just literal `body`/`html`.
  for (const styleEl of document.querySelectorAll("style")) {
    const css = styleEl.textContent ?? "";
    for (const rule of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const [, selectorList = "", declarations = ""] = rule;
      if (!BACKGROUND_IMAGE_DECL_PATTERN.test(`{${declarations}}`)) continue;
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
  let scriptMatch: RegExpExecArray | null;
  const scriptPattern = new RegExp(INLINE_SCRIPT_PATTERN.source, INLINE_SCRIPT_PATTERN.flags);
  while ((scriptMatch = scriptPattern.exec(html)) !== null) {
    const attrs = scriptMatch[1] || "";
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const content = stripJsComments(stripCompilerMountBootstrap(scriptMatch[2] || ""));
    if (SHADER_TRANSITION_USAGE_PATTERN.test(content)) return true;
  }

  return false;
}

async function resolveMediaDuration(
  src: string,
  mediaStart: number,
  baseDir: string,
  downloadDir: string,
  tagName: string,
): Promise<{ duration: number; resolvedPath: string }> {
  let filePath = src;

  if (isHttpUrl(src)) {
    if (!existsSync(downloadDir)) mkdirSync(downloadDir, { recursive: true });
    try {
      filePath = await downloadToTemp(src, downloadDir);
    } catch {
      // Download failed (e.g. 404 placeholder URL) — skip gracefully.
      // The element will get duration 0 and be excluded from the render.
      return { duration: 0, resolvedPath: src };
    }
  } else if (!filePath.startsWith("/")) {
    filePath = join(baseDir, filePath);
  }

  if (!existsSync(filePath)) {
    return { duration: 0, resolvedPath: filePath };
  }

  let metadata: { durationSeconds: number };
  if (tagName === "video") {
    metadata = await extractMediaMetadata(filePath);
  } else {
    try {
      metadata = await extractAudioMetadata(filePath);
    } catch {
      // Source file has no audio stream (e.g. a silent video used as an audio src).
      // Return duration 0 so the element is excluded from the composition gracefully,
      // matching how missing files and failed downloads are already handled above.
      return { duration: 0, resolvedPath: filePath };
    }
  }

  const fileDuration = metadata.durationSeconds;
  const effectiveDuration = fileDuration - mediaStart;
  const duration = effectiveDuration > 0 ? effectiveDuration : fileDuration;

  return { duration, resolvedPath: filePath };
}

/**
 * Compile a single HTML file: static pass + ffprobe for unresolved media.
 * Returns compiled HTML and any unresolved composition elements that need browser resolution.
 */
async function compileHtmlFile(
  html: string,
  baseDir: string,
  downloadDir: string,
  log?: ProducerLogger,
): Promise<{ html: string; unresolvedCompositions: UnresolvedElement[] }> {
  const { html: staticCompiled, unresolved } = compileTimingAttrs(html);

  const mediaUnresolved = unresolved.filter(
    (el) => (el.tagName === "video" || el.tagName === "audio") && el.src,
  );

  const unresolvedCompositions = unresolved.filter((el) => el.tagName === "div");

  // Phase 1: Resolve missing durations (parallel ffprobe)
  const resolvedResults = await Promise.all(
    mediaUnresolved.map((el) =>
      resolveMediaDuration(el.src!, el.mediaStart, baseDir, downloadDir, el.tagName).then(
        ({ duration }) => ({ id: el.id, duration }),
      ),
    ),
  );
  const resolutions: ResolvedDuration[] = resolvedResults.filter((r) => r.duration > 0);

  let compiledHtml =
    resolutions.length > 0 ? injectDurations(staticCompiled, resolutions) : staticCompiled;

  // Phase 2: Bound authored audio to playable source (parallel ffprobe).
  // Explicit video slots may outlive their source and hold the final frame.
  const preResolved = extractResolvedMedia(compiledHtml);
  const clampResults = await Promise.all(
    preResolved
      .filter((el) => !!el.src && !el.loop)
      .map(async (el) => {
        const { duration: maxDuration } = await resolveMediaDuration(
          el.src!,
          el.mediaStart,
          baseDir,
          downloadDir,
          el.tagName,
        );
        return { id: el.id, tagName: el.tagName, duration: el.duration, maxDuration, src: el.src! };
      }),
  );
  const clampList: ResolvedDuration[] = [];
  for (const r of clampResults) {
    if (
      r.maxDuration > 0 &&
      shouldClampResolvedMediaDuration(r.tagName, r.duration, r.maxDuration)
    ) {
      clampList.push({ id: r.id, duration: r.maxDuration });
      // This clip's `data-duration` is being silently shortened to its source.
      // Surface it so the author can confirm the longer slot wasn't intended.
      // ponytail: top-level only — sub-composition audio still gets clamped;
      // thread `log` through parseSubCompositions to warn for it too.
      log?.warn(
        `[compile] Audio "${r.id}" (${r.src}) is ${r.maxDuration.toFixed(2)}s but its ` +
          `data-duration is ${r.duration.toFixed(2)}s — the slot is shortened to the media ` +
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
  compiledHtml = compiledHtml.replace(/(<video\b[^>]*)\s+crossorigin(?:=["'][^"']*["'])?/gi, "$1");

  // Strip crossorigin from img elements. The renderer captures DOM frames visually —
  // no canvas readback — so CORS compliance is unnecessary. External images from
  // CORS-restricted origins (e.g. S3) render blank when crossorigin forces a failed
  // CORS request against the renderer's localhost file server.
  compiledHtml = compiledHtml.replace(/(<img\b[^>]*)\s+crossorigin(?:=["'][^"']*["'])?/gi, "$1");

  // Strip crossorigin from audio elements. Audio is processed out-of-band via
  // FFmpeg; the browser's CORS policy for audio elements is irrelevant to
  // rendering. Leaving crossorigin="anonymous" causes the browser to issue a
  // CORS-mode preflight from localhost, which S3 buckets without explicit CORS
  // headers reject — leaving audio elements in a failed network state. The
  // FFmpeg audio path reads the src URL directly and is unaffected by browser
  // CORS, so stripping the attribute has no side effects.
  compiledHtml = compiledHtml.replace(/(<audio\b[^>]*)\s+crossorigin(?:=["'][^"']*["'])?/gi, "$1");

  return { html: compiledHtml, unresolvedCompositions };
}

/**
 * Parse sub-compositions referenced via data-composition-src.
 * Reads each file, compiles it, extracts video/audio, adjusts timing offsets.
 * Recurses into nested sub-compositions with accumulated offsets.
 */
async function parseSubCompositions(
  html: string,
  projectDir: string,
  downloadDir: string,
  parentOffset: number = 0,
  parentEnd: number = Infinity,
  visited: Set<string> = new Set(),
): Promise<{
  videos: VideoElement[];
  audios: AudioElement[];
  images: ImageElement[];
  subCompositions: Map<string, string>;
}> {
  const videos: VideoElement[] = [];
  const audios: AudioElement[] = [];
  const images: ImageElement[] = [];
  const subCompositions = new Map<string, string>();

  const { document } = parseHTML(html);
  const compEls = document.querySelectorAll("[data-composition-src]");

  // Build work items, filtering out invalid/circular entries synchronously
  const workItems: Array<{
    srcPath: string;
    absoluteStart: number;
    absoluteEnd: number;
    filePath: string;
    rawSubHtml: string;
    nestedVisited: Set<string>;
  }> = [];

  for (const el of compEls) {
    const srcPath = el.getAttribute("data-composition-src");
    if (!srcPath) continue;

    const elStart = parseFloat(el.getAttribute("data-start") || "0");
    const elEndRaw = el.getAttribute("data-end");
    const elEnd = elEndRaw ? parseFloat(elEndRaw) : Infinity;

    const absoluteStart = parentOffset + elStart;
    const absoluteEnd = Math.min(parentEnd, isFinite(elEnd) ? parentOffset + elEnd : Infinity);

    const filePath = resolve(projectDir, srcPath);

    // Circular reference guard
    if (visited.has(filePath)) {
      continue;
    }

    if (!existsSync(filePath)) {
      continue;
    }

    const rawSubHtml = readFileSync(filePath, "utf-8");
    const nestedVisited = new Set(visited);
    nestedVisited.add(filePath);

    workItems.push({ srcPath, absoluteStart, absoluteEnd, filePath, rawSubHtml, nestedVisited });
  }

  // Parallelize file compilation + recursive parsing
  const results = await Promise.all(
    workItems.map(async (item) => {
      const { html: compiledSub } = await compileHtmlFile(
        item.rawSubHtml,
        dirname(item.filePath),
        downloadDir,
      );

      const nested = await parseSubCompositions(
        compiledSub,
        projectDir,
        downloadDir,
        item.absoluteStart,
        item.absoluteEnd,
        item.nestedVisited,
      );

      const subVideos = parseVideoElements(compiledSub);
      const subAudios = parseAudioElements(compiledSub);
      const subImages = parseImageElements(compiledSub);

      return {
        srcPath: item.srcPath,
        compiledSub,
        nested,
        subVideos,
        subAudios,
        subImages,
        absoluteStart: item.absoluteStart,
        absoluteEnd: item.absoluteEnd,
      };
    }),
  );

  // Merge results
  for (const r of results) {
    subCompositions.set(r.srcPath, r.compiledSub);

    for (const [key, value] of r.nested.subCompositions) {
      subCompositions.set(key, value);
    }
    videos.push(...r.nested.videos);
    audios.push(...r.nested.audios);
    images.push(...r.nested.images);

    for (const v of r.subVideos) {
      v.start += r.absoluteStart;
      v.end += r.absoluteStart;
      if (v.end > r.absoluteEnd) {
        v.end = r.absoluteEnd;
      }
      if (v.start < r.absoluteEnd) {
        videos.push(v);
      }
    }

    for (const a of r.subAudios) {
      a.start += r.absoluteStart;
      a.end += r.absoluteStart;
      if (a.end > r.absoluteEnd) {
        a.end = r.absoluteEnd;
      }
      if (a.start < r.absoluteEnd) {
        audios.push(a);
      }
    }

    for (const img of r.subImages) {
      img.start += r.absoluteStart;
      img.end += r.absoluteStart;
      if (img.end > r.absoluteEnd) {
        img.end = r.absoluteEnd;
      }
      if (img.start < r.absoluteEnd) {
        images.push(img);
      }
    }

    if (
      r.subVideos.length > 0 ||
      r.subAudios.length > 0 ||
      r.subImages.length > 0 ||
      r.nested.videos.length > 0 ||
      r.nested.audios.length > 0 ||
      r.nested.images.length > 0
    ) {
    }
  }

  return { videos, audios, images, subCompositions };
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

/**
 * Merge all `<head>` `<style>` blocks into a single tag with `@import` rules
 * at the top, and merge all inline `<body>` `<script>` blocks into one at the
 * end of `<body>`.
 *
 * Mirrors the bundler's `coalesceHeadStylesAndBodyScripts` to guarantee
 * identical CSS cascade order and script execution order between preview and
 * export, preventing font-loading and animation-ordering regressions.
 */

function coalesceHeadStylesAndBodyScripts(html: string): string {
  const { document } = parseHTML(html);
  const head = document.querySelector("head");
  const body = document.querySelector("body");
  if (!head) return html;

  const styleEls = Array.from(head.querySelectorAll("style"));
  if (styleEls.length > 1) {
    const importRe = /@import\s+url\([^)]*\)\s*;|@import\s+["'][^"']+["']\s*;/gi;
    const imports: string[] = [];
    const cssParts: string[] = [];
    const seenImports = new Set<string>();

    for (const el of styleEls) {
      const raw = (el.textContent || "").trim();
      if (!raw) continue;
      const nonImportCss = raw.replace(importRe, (match) => {
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
    if (mergedCss) {
      const firstStyleEl = styleEls[0];
      if (firstStyleEl) firstStyleEl.textContent = mergedCss;
      for (let i = 1; i < styleEls.length; i++) {
        const el = styleEls[i];
        if (el) el.remove();
      }
    }
  }

  if (body) {
    const bodyScripts = Array.from(body.querySelectorAll("script")).filter((el) => {
      const src = (el.getAttribute("src") || "").trim();
      if (src) return false;
      const type = (el.getAttribute("type") || "").trim().toLowerCase();
      return !type || type === "text/javascript" || type === "application/javascript";
    });
    if (bodyScripts.length > 0) {
      const mergedJs = bodyScripts
        .map((el) => (el.textContent || "").trim())
        .filter(Boolean)
        .join("\n;\n")
        .trim();
      for (const el of bodyScripts) {
        el.remove();
      }
      if (mergedJs) {
        const script = document.createElement("script");
        script.textContent = mergedJs;
        body.appendChild(script);
      }
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
  variableOverrides: Record<string, unknown> = {},
): string {
  const { document } = parseHTML(html);
  const head = document.querySelector("head");
  const body = document.querySelector("body");
  const hosts = Array.from(document.querySelectorAll("[data-composition-src]"));

  if (!hosts.length) {
    // Even with no sub-compositions, declared composition variables need a
    // compile-time stylesheet so eval-time reads (GSAP .from immediateRender,
    // top-level script getComputedStyle) resolve var(--slug) — the runtime's
    // DOMContentLoaded injection is too late for those.
    const emitted = emitRootCompositionVariableStyles(
      document as unknown as Document,
      {},
      variableOverrides,
    );
    return emitted ? document.toString() : html;
  }

  // Assign per-instance runtime composition ids BEFORE inlining, mirroring the
  // preview bundler. When the same sub-composition (same authored
  // data-composition-id) is mounted more than once — the reusable-template
  // pattern from issue #2064 — each host is rewritten to a unique runtime id
  // (`card__hf1`, `card__hf2`). Without this, every instance shares one
  // `__hfVariablesByComp` key and one scope selector: the last mount's
  // data-variable-values clobbers the earlier ones and all-but-one instance
  // renders blank. #2066 fixed the single-instance case but left this
  // divergence (snapshot/preview correct, render wrong).
  const hostIdentityByElement = assignBundledRuntimeCompositionIds(hosts as unknown as Element[]);

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
      resolveHtml: (srcPath: string) => {
        let compHtml = subCompositions.get(srcPath) || null;
        if (!compHtml) {
          const filePath = resolve(projectDir, srcPath);
          if (existsSync(filePath)) {
            compHtml = readFileSync(filePath, "utf-8");
          }
        }
        return compHtml;
      },
      parseHtml: (htmlStr: string) => parseHTML(htmlStr).document as unknown as Document,
      scriptErrorLabel: "[Compiler] Composition script failed",
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
          `[Compiler] Skipping sub-composition "${srcPath}": ${reason ?? "the file is missing or empty"}.`,
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

  if (result.externalLinks.length && head) {
    for (const link of result.externalLinks) {
      const escapedHref = link.href.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      if (document.querySelector(`link[href="${escapedHref}"]`)) continue;
      const el = document.createElement("link");
      el.setAttribute("rel", link.rel);
      el.setAttribute("href", link.href);
      if (link.crossorigin != null) el.setAttribute("crossorigin", link.crossorigin);
      head.appendChild(el);
    }
  }

  // Append collected styles to <head>
  if (result.styles.length && head) {
    const styleEl = document.createElement("style");
    styleEl.textContent = result.styles.join("\n\n");
    head.appendChild(styleEl);
  }

  // Inject external CDN scripts before inline scripts so plugins (e.g.
  // TextPlugin, ScrollTrigger) are registered before composition code runs.
  // Deduplicate against scripts already present in the document.
  if (result.externalScriptSrcs.length && body) {
    const existingScriptSrcs = new Set(
      Array.from(document.querySelectorAll("script[src]")).map((el: Element) =>
        (el.getAttribute("src") || "").trim(),
      ),
    );
    for (const src of result.externalScriptSrcs) {
      if (!existingScriptSrcs.has(src)) {
        const scriptEl = document.createElement("script");
        scriptEl.setAttribute("src", src);
        body.appendChild(scriptEl);
        existingScriptSrcs.add(src);
      }
    }
  }

  // Append collected inline scripts to <body>. The per-instance variables
  // table MUST be written before the sub-comp scripts run — their scoped
  // getVariables() reads window.__hfVariablesByComp[compId]. htmlBundler
  // (preview/snapshot) prepends this; the render path emitted only the CSS
  // custom properties (below) and dropped the JS table, so getVariables()
  // returned {} during render and parametrized sub-comps shipped blank/default
  // text (issue #2064). Same shared builder as the bundler so they stay in
  // lockstep.
  const variablesByCompScript = buildVariablesByCompScript(result.variablesByComp);
  const inlineScripts = variablesByCompScript
    ? [variablesByCompScript, ...result.scripts]
    : result.scripts;
  if (inlineScripts.length && body) {
    const scriptEl = document.createElement("script");
    scriptEl.textContent = inlineScripts.join("\n;\n");
    body.appendChild(scriptEl);
  }

  // Compile-time CSS custom properties (mirrors the preview bundler): root
  // declarers plus one scoped rule per sub-composition host, so var(--slug)
  // resolves at script eval time, not just after runtime injection.
  emitRootCompositionVariableStyles(
    document as unknown as Document,
    result.variablesByComp,
    variableOverrides,
  );

  return document.toString();
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

/**
 * Download external CDN scripts and inline them into the HTML so rendering
 * works without network access (Docker, CI, restricted environments).
 */
export async function inlineExternalScripts(html: string): Promise<string> {
  const fullHtml = ensureFullDocument(html);
  const wrappedFragment = fullHtml !== html;
  const { document } = parseHTML(fullHtml);
  const scripts = document.querySelectorAll("script[src]");
  const externalScripts: { el: Element; src: string }[] = [];

  for (const el of scripts) {
    const src = (el.getAttribute("src") || "").trim();
    if (src && isHttpUrl(src)) {
      externalScripts.push({ el: el as unknown as Element, src });
    }
  }

  if (externalScripts.length === 0) return html;

  const downloads = await Promise.allSettled(
    externalScripts.map(async ({ src }) => {
      const response = await fetch(src, {
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${src}`);
      return { src, text: await response.text() };
    }),
  );

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
      inlineScript.textContent = `/* inlined: ${src} */\n${safeText}\n`;
      el.replaceWith(inlineScript);
      defaultLogger.info(`[Compiler] Inlined CDN script: ${src}`);
    } else {
      defaultLogger.warn(
        `[Compiler] WARNING: Failed to download CDN script: ${src} — ${download.reason}. ` +
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
): { html: string; externalAssets: Map<string, string> } {
  const absProjectDir = resolve(projectDir);
  const externalAssets = new Map<string, string>();

  function processPath(rawPath: string): string | null {
    const trimmed = rawPath.trim();
    if (isNonRelativeUrl(trimmed)) return null;
    const absPath = resolve(absProjectDir, trimmed);
    if (isPathInside(absPath, absProjectDir)) {
      return null; // inside projectDir, file server handles this
    }
    if (!existsSync(absPath)) return null;
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
    const rewritten = css.replace(CSS_URL_RE, (full, quote: string, rawUrl: string) => {
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
    const rewritten = style.replace(CSS_URL_RE, (full, quote: string, rawUrl: string) => {
      const result = processPath((rawUrl || "").trim());
      if (!result) return full;
      return `url(${quote || ""}${result}${quote || ""})`;
    });
    if (rewritten !== style) el.setAttribute("style", rewritten);
  }

  if (externalAssets.size > 0) {
    defaultLogger.info(
      `[Compiler] Found ${externalAssets.size} asset(s) outside project directory — will copy to render output`,
    );
  }

  return {
    html: externalAssets.size > 0 ? document.toString() : html,
    externalAssets,
  };
}

const REMOTE_MEDIA_SUBDIR = "_remote_media";
// Match opening tags of <video> or <audio> elements that carry an HTTP(S) src.
// Uses [^>]* to span attributes — safe for composition elements that won't
// have `>` inside quoted attribute values (data-title etc.).
const REMOTE_MEDIA_TAG_RE =
  /<(?:video|audio)\b[^>]*?\bsrc\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*>/gi;
// Match <img> tags (including agent-pipeline-emitted variants where `src` is
// not the first attribute). Producer-side localisation is the primary fix for
// the remote-<img> flicker; frameCapture's `pollImagesReady`/`decodeAllImages`
// are the defense-in-depth layer for any remote URL that bypasses this step.
// The `(?<![\w-])` lookbehind pins the match to a real `src` attribute so we
// don't rewrite `data-src` / `data-*-src` (lazy-loader placeholders whose URL
// is not what Chrome actually paints). `srcset` is excluded by the `\s*=`.
const REMOTE_IMG_TAG_RE = /<img\b[^>]*?(?<![\w-])src\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*>/gi;

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
  extraRewrite?: (html: string, url: string, relPath: string) => string,
): Promise<{ html: string; remoteMediaAssets: Map<string, string> }> {
  if (urlSet.size === 0) return { html, remoteMediaAssets: new Map() };
  if (!existsSync(remoteDir)) mkdirSync(remoteDir, { recursive: true });

  const urlToLocal = new Map<string, string>();
  await Promise.all(
    [...urlSet].map(async (url) => {
      try {
        const localPath = await downloadToTemp(url, remoteDir);
        urlToLocal.set(url, localPath);
      } catch (err) {
        defaultLogger.warn(
          `[Compiler] ${warnLabel} ${url} — using original URL as fallback. ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
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

  defaultLogger.info(`[Compiler] ${logLabel} ${urlToLocal.size} to ${REMOTE_MEDIA_SUBDIR}/`);
  return { html: result, remoteMediaAssets };
}

/**
 * Download any remote `src` URLs on `<video>` and `<audio>` elements into a
 * local subdirectory of `downloadDir`, rewrite the HTML src attributes to
 * relative paths, and return the updated HTML along with a map of
 * `{ relativePath → absoluteLocalPath }` for callers to add to `externalAssets`.
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
): Promise<{ html: string; remoteMediaAssets: Map<string, string> }> {
  // Collect unique HTTP URLs from <video>/<audio> src attributes.
  const urlSet = new Set<string>();
  const re = new RegExp(REMOTE_MEDIA_TAG_RE.source, REMOTE_MEDIA_TAG_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[1]) urlSet.add(m[1]);
  }
  return downloadAndRewriteUrls(
    urlSet,
    html,
    join(downloadDir, REMOTE_MEDIA_SUBDIR),
    "Remote media download failed for",
    "Localized remote media source(s)",
  );
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
): Promise<{ html: string; remoteMediaAssets: Map<string, string> }> {
  const urlSet = new Set<string>();
  const re = new RegExp(REMOTE_IMG_TAG_RE.source, REMOTE_IMG_TAG_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[1]) urlSet.add(m[1]);
  }
  return downloadAndRewriteUrls(
    urlSet,
    html,
    join(downloadDir, REMOTE_MEDIA_SUBDIR),
    "Remote image download failed for",
    "Localized remote image source(s)",
  );
}

// Match a remote url() inside a `background` / `background-image` CSS declaration
// (style blocks or inline style attrs). `[^;}"']*?` lets position/color tokens
// precede the url() in the shorthand while stopping at the declaration boundary.
const REMOTE_BG_URL_RE =
  /background(?:-image)?\s*:\s*[^;}"']*?url\(\s*["']?(https?:\/\/[^"')]+)["']?\s*\)/gi;

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
): Promise<{ html: string; remoteMediaAssets: Map<string, string> }> {
  const urlSet = new Set<string>();
  const re = new RegExp(REMOTE_BG_URL_RE.source, REMOTE_BG_URL_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[1] && !isGoogleFontsUrl(m[1])) urlSet.add(m[1]);
  }
  return downloadAndRewriteUrls(
    urlSet,
    html,
    join(downloadDir, REMOTE_MEDIA_SUBDIR),
    "Remote background-image download failed for",
    "Localized remote background-image(s)",
    // Quoted url('..')/url("..") are rewritten by downloadAndRewriteUrls' default
    // replaceAll; this handles the unquoted url(https://..) form.
    (h, url, rel) => h.replaceAll(`url(${url})`, `url(${rel})`),
  );
}

// Match url("https://...") or url('https://...') inside @font-face blocks.
// We scan the full HTML (which includes <style> blocks) — matching against
// @font-face context precisely would require a CSS parser; instead we match
// any url(https?://...) that appears inside a @font-face rule by looking for
// the surrounding context. Simple pattern: capture all HTTP url() references
// that follow a @font-face opener (before the closing brace). The regex is
// applied to the CSS text extracted from <style> blocks so it can't
// accidentally match JavaScript string literals.
const REMOTE_FONTFACE_URL_RE = /url\(["']?(https?:\/\/[^"')]+)["']?\)/gi;

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

async function fetchExternalStylesheetCss(href: string): Promise<string | null> {
  try {
    assertPublicHttpsUrl(href);
  } catch {
    return null;
  }
  try {
    const response = await fetch(href, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      defaultLogger.warn(
        `[Compiler] External stylesheet fetch failed for ${href} — HTTP ${response.status}`,
      );
      return null;
    }
    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_STYLESHEET_BYTES) {
      defaultLogger.warn(
        `[Compiler] External stylesheet too large (${contentLength} bytes): ${href}`,
      );
      return null;
    }
    const text = await response.text();
    if (text.length > MAX_STYLESHEET_BYTES) {
      defaultLogger.warn(
        `[Compiler] External stylesheet too large (${text.length} bytes): ${href}`,
      );
      return null;
    }
    return text;
  } catch (err) {
    defaultLogger.warn(
      `[Compiler] External stylesheet fetch failed for ${href} — ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
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
 */
function extractFontFaceBlocks(css: string): string[] {
  const blocks: string[] = [];
  const atRule = /@font-face\s*/gi;
  let m: RegExpExecArray | null;
  while ((m = atRule.exec(css)) !== null) {
    const openIdx = css.indexOf("{", m.index + m[0].length);
    if (openIdx === -1) break;
    let depth = 1;
    let i = openIdx + 1;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
    }
    if (depth === 0) {
      blocks.push(css.slice(m.index, i));
      atRule.lastIndex = i;
    }
  }
  return blocks;
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
// fallow-ignore-next-line complexity
async function inlineExternalFontStylesheets(html: string): Promise<string> {
  const linkRe = /<link\b[^>]*\brel=["']stylesheet["'][^>]*>/gi;
  const hrefRe = /\bhref=["']([^"']+)["']/i;

  const linkMatches: { fullMatch: string; href: string }[] = [];
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = linkRe.exec(html)) !== null) {
    const tag = linkMatch[0];
    const hrefMatch = hrefRe.exec(tag);
    if (!hrefMatch?.[1]) continue;
    const href = hrefMatch[1];
    if (!/^https?:\/\//i.test(href)) continue;
    if (isGoogleFontsUrl(href)) continue;
    linkMatches.push({ fullMatch: tag, href });
  }

  if (linkMatches.length === 0) return html;

  const MAX_CONCURRENT_STYLESHEET_FETCHES = 4;
  const fetches: { fullMatch: string; href: string; css: string | null }[] = [];
  for (let i = 0; i < linkMatches.length; i += MAX_CONCURRENT_STYLESHEET_FETCHES) {
    const batch = linkMatches.slice(i, i + MAX_CONCURRENT_STYLESHEET_FETCHES);
    const results = await Promise.all(
      batch.map(async ({ fullMatch, href }) => {
        const css = await fetchExternalStylesheetCss(href);
        return { fullMatch, href, css };
      }),
    );
    fetches.push(...results);
  }

  let result = html;
  for (const { fullMatch, href, css } of fetches) {
    if (css === null) continue;
    const fontFaceBlocks = extractFontFaceBlocks(css);
    if (fontFaceBlocks.length === 0) continue;
    const inlineStyle = `<style>/* Inlined from ${href} */\n${fontFaceBlocks.join("\n")}\n</style>`;
    result = result.replace(fullMatch, inlineStyle);
    defaultLogger.info(
      `[Compiler] Inlined ${fontFaceBlocks.length} @font-face rule(s) from external stylesheet: ${href}`,
    );
  }
  return result;
}

/**
 * Collect all remote `url(https://...)` references inside `@font-face` blocks
 * found in `<style>` tags.
 */
// fallow-ignore-next-line complexity
function collectFontFaceUrls(html: string): Set<string> {
  const styleBlockRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  const urlSet = new Set<string>();

  let styleMatch: RegExpExecArray | null;
  while ((styleMatch = styleBlockRe.exec(html)) !== null) {
    const cssText = styleMatch[1] ?? "";
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
      const urlRe = new RegExp(REMOTE_FONTFACE_URL_RE.source, REMOTE_FONTFACE_URL_RE.flags);
      let urlMatch: RegExpExecArray | null;
      while ((urlMatch = urlRe.exec(block)) !== null) {
        if (urlMatch[1]) urlSet.add(urlMatch[1]);
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
  // Phase 1: Inline @font-face rules from external <link rel="stylesheet"> tags.
  const processed = await inlineExternalFontStylesheets(html);

  // Phase 2: Download font file URLs from all @font-face blocks (both
  // pre-existing inline blocks and the ones just inlined from external sheets).
  const urlSet = collectFontFaceUrls(processed);

  return downloadAndRewriteUrls(
    urlSet,
    processed,
    join(downloadDir, REMOTE_MEDIA_SUBDIR),
    "Remote font download failed for",
    "Localized remote font face(s)",
    (h, url, relPath) => h.replaceAll(`url(${url})`, `url("${relPath}")`),
  );
}

const LOCAL_FONTFACE_URL_RE = /url\(["']?(?!data:|https?:\/\/)([^"')]+)["']?\)/gi;

// fallow-ignore-next-line complexity
async function embedLocalFontFaces(html: string, projectDir: string): Promise<string> {
  const { fontToDataUri: toDataUri } = await import("./fontCompression.js");
  const styleBlockRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  const fontFaceRe = /@font-face\s*\{([^}]*)\}/gi;
  let result = html;
  const embeddedPaths = new Set<string>();
  const dataUriByAbsolutePath = new Map<string, string>();

  let styleMatch: RegExpExecArray | null;
  while ((styleMatch = styleBlockRe.exec(html)) !== null) {
    const cssText = styleMatch[1] ?? "";
    const ffRe = new RegExp(fontFaceRe.source, fontFaceRe.flags);
    let ffMatch: RegExpExecArray | null;
    while ((ffMatch = ffRe.exec(cssText)) !== null) {
      const block = ffMatch[1] ?? "";
      const urlRe = new RegExp(LOCAL_FONTFACE_URL_RE.source, LOCAL_FONTFACE_URL_RE.flags);
      let urlMatch: RegExpExecArray | null;
      while ((urlMatch = urlRe.exec(block)) !== null) {
        const localPath = urlMatch[1];
        if (!localPath || embeddedPaths.has(localPath)) continue;
        const absPath = localPath.startsWith("/") ? localPath : resolve(projectDir, localPath);
        if (!isPathInside(absPath, projectDir)) continue;
        if (!existsSync(absPath)) continue;
        const ext = absPath.match(/\.(woff2?|ttf|otf|ttc)$/i)?.[1]?.toLowerCase() ?? "ttf";
        try {
          let dataUri = dataUriByAbsolutePath.get(absPath);
          if (!dataUri) {
            const buffer = readFileSync(absPath);
            dataUri = await toDataUri(buffer, ext);
            dataUriByAbsolutePath.set(absPath, dataUri);
            defaultLogger.info(
              `[Compiler] Embedded local font file: ${localPath} (${(buffer.length / 1024).toFixed(0)} KB → data URI)`,
            );
          }
          result = result.replaceAll(localPath, dataUri);
          embeddedPaths.add(localPath);
        } catch {
          // File read or compression failed — keep the original path
        }
      }
    }
  }
  return result;
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
  /**
   * Threaded through to {@link injectDeterministicFontFaces}. When `true`,
   * any external font fetch failure throws `FontFetchError` instead of
   * silently falling back to system fonts. Distributed `plan()` sets this
   * to `true` so font availability is part of the planDir's content-addressed
   * hash and fetch failures surface as typed non-retryable errors. Default
   * `false` preserves the in-process behavior.
   */
  failClosedFontFetch?: boolean;
  /**
   * When `true`, fonts not resolved by the bundled alias map or Google Fonts
   * are located on the local filesystem, compressed to woff2, and embedded.
   * Default `true` for local renders. Distributed callers pass `false` to
   * prevent host-specific font capture from leaking into the planDir.
   */
  allowSystemFontCapture?: boolean;
  /**
   * Optional persistent cache directory for prep-time animated GIF → WebM
   * transcodes. When omitted, the render's downloadDir is used.
   */
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
}

const GSAP_CDN_BASE = "https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/";

function rewriteUnresolvableGsapToCdn(html: string, projectDir: string): string {
  return html.replace(
    /(<script\b[^>]*\bsrc=["'])([^"']*gsap[^"']*\/dist\/([^"']+))(["'][^>]*>)/gi,
    (full, prefix, src, file, suffix) => {
      if (/^https?:\/\//i.test(src)) return full;
      const absPath = resolve(projectDir, src);
      if (existsSync(absPath)) return full;
      defaultLogger.info(
        `[Compiler] Rewriting missing gsap script to CDN: ${src} → ${GSAP_CDN_BASE}${file}`,
      );
      return `${prefix}${GSAP_CDN_BASE}${file}${suffix}`;
    },
  );
}

/**
 * Compile an HTML composition project into a single self-contained HTML string
 * with all media metadata resolved.
 */
// fallow-ignore-next-line complexity
export async function compileForRender(
  projectDir: string,
  htmlPath: string,
  downloadDir: string,
  options: CompileForRenderOptions = {},
): Promise<CompiledComposition> {
  const rawHtml = rewriteUnresolvableGsapToCdn(readFileSync(htmlPath, "utf-8"), projectDir);

  // Pre-flight: every data-composition-src reference must resolve to a
  // usable file before we spend any time compiling, launching a browser, or
  // waiting out a capture timeout. See EmptyCompositionError for why this is
  // unconditional (not gated behind --strict like lint warnings) — a render
  // that silently drops a scene is strictly worse than one that refuses to
  // start.
  assertSubCompositionsUsable(rawHtml, projectDir);

  const { html: compiledHtml, unresolvedCompositions } = await compileHtmlFile(
    rawHtml,
    projectDir,
    downloadDir,
    options.log,
  );

  // Parse sub-compositions first (extracts media + compiled HTML for each)
  const {
    videos: subVideos,
    audios: subAudios,
    images: subImages,
    subCompositions,
  } = await parseSubCompositions(compiledHtml, projectDir, downloadDir);

  // Ensure the HTML is a full document before inlining sub-compositions.
  // When index.html is a fragment (no <html>/<head>/<body>), linkedom.parseHTML()
  // returns a document with null head/body, which causes inlineSubCompositions to
  // silently discard all collected composition styles and scripts.
  const fullHtml = ensureFullDocument(compiledHtml);

  // Inline sub-compositions into the main HTML so the runtime takes the same
  // synchronous code path as the bundled preview (no async fetch of
  // data-composition-src). This mirrors what htmlBundler.ts does for preview.
  const inlinedHtml = inlineSubCompositions(
    fullHtml,
    subCompositions,
    projectDir,
    options.variables ?? {},
  );

  // Strip preload="none" from media elements — the renderer needs to load all
  // media upfront for frame capture. Users add this to reduce browser memory in
  // preview, but it causes the headless renderer to never load the media, leading
  // to 45s timeout failures.
  const sanitizedHtml = inlinedHtml.replace(
    /(<(?:video|audio)\b[^>]*?)\s+preload\s*=\s*["']none["']/gi,
    "$1",
  );
  const renderModeHints = detectRenderModeHints(sanitizedHtml);
  const hasShaderTransitions = detectShaderTransitionUsage(sanitizedHtml);
  // Detected BEFORE inlineExternalScripts: GSAP's own source contains
  // `transformPerspective`, so scanning post-inline HTML would flag every
  // composition that loads GSAP from a CDN.
  const usesThreeDTransforms = detectThreeDTransformUsage(sanitizedHtml);
  const usesMixBlendMode = detectMixBlendModeUsage(sanitizedHtml);
  const hasAncestorBackgroundImage = detectAncestorBackgroundImage(sanitizedHtml);

  const normalizedFontHtml = normalizeSystemFontPrimaryFamilies(
    injectTextRenderingRule(
      coalesceHeadStylesAndBodyScripts(promoteCssImportsToLinkTags(sanitizedHtml)),
    ),
  );

  const coalescedHtml = await injectDeterministicFontFaces(normalizedFontHtml, {
    failClosedFontFetch: options.failClosedFontFetch === true,
    allowSystemFontCapture: options.allowSystemFontCapture,
  });

  // Download CDN scripts and inline them AFTER coalescing. This order matters:
  // coalesceHeadStylesAndBodyScripts merges inline scripts and appends them at
  // the end of <body>. If we inlined CDN scripts first, the GSAP library would
  // become an inline script that gets moved after local <script src="script.js">
  // tags that depend on it, causing "gsap is not defined" errors.
  const assembledHtml = await inlineExternalScripts(coalescedHtml);

  // Inject studio position seek re-apply script when positions are baked into HTML.
  // GSAP overwrites the `translate` CSS property on every frame seek; this script
  // re-asserts the CSS custom property var() form after each seek so dragged
  // positions survive frame-by-frame rendering without a JSON sidecar.
  const HF_POSITION_ATTRS = [
    'data-hf-studio-path-offset="true"',
    'data-hf-studio-box-size="true"',
    'data-hf-studio-rotation="true"',
    'data-hf-studio-motion="',
  ];
  const hasPositionEdits = HF_POSITION_ATTRS.some((attr) => assembledHtml.includes(attr));
  const htmlWithPositionScript = hasPositionEdits
    ? assembledHtml.replace(
        /<\/body>/i,
        `<script>${createStudioPositionSeekReapplyScript()}</script></body>`,
      )
    : assembledHtml;
  const htmlWithSdkPositionScript = injectSdkPositionEditsRenderScript(htmlWithPositionScript);

  // Download remote <video> and <audio> sources to compiledDir and rewrite the
  // src attributes so the renderer reads from localhost. Remote S3 URLs cause
  // Chrome to spend the entire pageReadyTimeout buffering 10+ large video files
  // over the network; any that don't reach readyState >= 2 in time render as
  // blank black frames. Localising them eliminates the race.
  const { html: htmlWithLocalMedia, remoteMediaAssets } = await localizeRemoteMediaSources(
    htmlWithSdkPositionScript,
    downloadDir,
  );

  // Download remote <img> sources. Same race shape as video/audio: the
  // readiness gate can pass before Chrome decodes the pixels, and Chrome can
  // evict decoded pixels mid-render and re-fetch, producing intermittent
  // blank-frame flicker. Localising to disk removes both races.
  const { html: htmlWithLocalImages, remoteMediaAssets: remoteImageAssets } =
    await localizeRemoteImageSources(htmlWithLocalMedia, downloadDir);

  // Download remote CSS background-image url() references. drawElementImage omits
  // cross-origin content, so remote backgrounds render black on the fast path;
  // localising them to same-origin closes that gap.
  const { html: htmlWithLocalBg, remoteMediaAssets: remoteBgAssets } =
    await localizeRemoteBackgroundImages(htmlWithLocalImages, downloadDir);

  // Download remote @font-face src URLs and rewrite to local paths.
  // Remote font URLs fail with a CORS rejection at render time (S3 does not
  // allow http://localhost:PORT as origin), causing Chrome to silently fall
  // back to the next font in the stack.
  const { html: htmlWithLocalizedFonts, remoteMediaAssets: remoteFontAssets } =
    await localizeRemoteFontFaces(htmlWithLocalBg, downloadDir);

  const gifSourceAssets = new Map<string, string>(remoteImageAssets);
  const {
    html: htmlWithPreparedGifs,
    preparedAssets: preparedGifAssets,
    preparedGifs,
  } = await prepareAnimatedGifInputs(htmlWithLocalizedFonts, {
    projectDir,
    downloadDir,
    cacheDir: options.animatedGifCacheDir,
    sourceAssets: gifSourceAssets,
    timeoutMs: options.ffmpegProcessTimeout,
  });
  if (preparedGifs.length > 0) {
    defaultLogger.info(`[Compiler] Prepared ${preparedGifs.length} animated GIF input(s) as WebM`);
  }

  const embeddedHtml = await embedLocalFontFaces(htmlWithPreparedGifs, projectDir);

  // Collect assets that resolve outside projectDir (e.g. ../shared-assets/hero.png).
  // These can't be served by the file server, so we map them to paths the
  // orchestrator will copy into the compiled output directory.
  const { html, externalAssets } = collectExternalAssets(embeddedHtml, projectDir);

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

  // Parse main HTML elements
  const mainVideos = parseVideoElements(html);
  const mainAudios = parseAudioElements(html);
  const mainImages = parseImageElements(html);

  // Keep inlined sub-composition media authoritative on ID collisions.
  // inlineSubCompositions() hoists those nodes into the final HTML, so the
  // producer should follow the same precedence the runtime sees in the merged DOM.
  const videos = dedupeElementsById([...mainVideos, ...subVideos]);
  const audios = dedupeElementsById([...mainAudios, ...subAudios]);
  const images = dedupeElementsById([...mainImages, ...subImages]);

  // Advisory video checks (sparse keyframes, VFR). Fire-and-forget — these spawn
  // ffprobe subprocesses and should not block compilation since they only produce warnings.
  for (const video of videos) {
    if (isHttpUrl(video.src)) continue;
    const videoPath = resolve(projectDir, video.src);
    const reencode = `ffmpeg -i "${video.src}" -c:v libx264 -r 30 -g 30 -keyint_min 30 -movflags +faststart -c:a copy output.mp4`;
    Promise.all([analyzeKeyframeIntervals(videoPath), extractMediaMetadata(videoPath)])
      .then(([analysis, metadata]) => {
        if (analysis.isProblematic) {
          defaultLogger.warn(
            `[Compiler] WARNING: Video "${video.id}" has sparse keyframes (max interval: ${analysis.maxIntervalSeconds}s). ` +
              `This causes seek failures and frame freezing. Re-encode with: ${reencode}`,
          );
        }
        if (metadata.isVFR) {
          console.info(
            `[Compiler] Video "${video.id}" is variable frame rate (VFR); ` +
              `the engine will normalize it to CFR before frame extraction. ` +
              `If rendering feels slow on this video, pre-encode once with: ${reencode}`,
          );
        }
      })
      .catch(() => {});
  }

  // Read dimensions from root composition element using DOM parser
  const { document } = parseHTML(html);
  const rootEl = document.querySelector("[data-composition-id]");

  const width = rootEl ? parseInt(rootEl.getAttribute("data-width") || "1080", 10) : 1080;
  const height = rootEl ? parseInt(rootEl.getAttribute("data-height") || "1920", 10) : 1920;

  // Static duration (may be 0 if set at runtime by GSAP)
  const staticDuration = rootEl
    ? parseFloat(
        rootEl.getAttribute("data-duration") ||
          rootEl.getAttribute("data-composition-duration") ||
          "0",
      )
    : 0;

  return {
    html,
    subCompositions,
    videos,
    audios,
    images,
    unresolvedCompositions,
    externalAssets,
    width,
    height,
    staticDuration,
    renderModeHints,
    hasShaderTransitions,
    usesThreeDTransforms,
    usesMixBlendMode,
    hasAncestorBackgroundImage,
  };
}

/**
 * Discover media elements from the browser DOM after JavaScript has run.
 * This catches videos/audios whose `src` is set dynamically via JS
 * (e.g. `document.getElementById("pip-video").src = URL`), which the
 * static regex parsers miss because the HTML has `src=""`.
 */
export interface BrowserMediaElement {
  id: string;
  tagName: "video" | "audio";
  src: string;
  start: number;
  end: number;
  duration: number;
  mediaStart: number;
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
      tagName: string;
      src: string;
      start: number;
      end: number;
      duration: number;
      mediaStart: number;
      loop: boolean;
      hasAudio: boolean;
      volume: number;
      muted: boolean;
    }[] = [];

    const mediaEls = document.querySelectorAll("video[data-start], audio[data-start]");
    mediaEls.forEach((el) => {
      const htmlEl = el as HTMLVideoElement | HTMLAudioElement;
      const id = htmlEl.id;
      if (!id) return;

      const src = htmlEl.src || htmlEl.getAttribute("src") || "";
      const start = parseFloat(htmlEl.getAttribute("data-start") || "0");
      const end = parseFloat(htmlEl.getAttribute("data-end") || "0");
      const duration = parseFloat(htmlEl.getAttribute("data-duration") || "0");
      const mediaStart = parseFloat(htmlEl.getAttribute("data-media-start") || "0");
      const loop = htmlEl.hasAttribute("loop");
      const hasAudio = htmlEl.getAttribute("data-has-audio") === "true";
      const volume = parseFloat(htmlEl.getAttribute("data-volume") || "1");
      const muted = htmlEl.hasAttribute("muted") || htmlEl.muted;

      results.push({
        id,
        tagName: htmlEl.tagName.toLowerCase(),
        src,
        start,
        end,
        duration,
        mediaStart,
        loop,
        hasAudio,
        volume,
        muted,
      });
    });

    return results;
  });

  return elements as BrowserMediaElement[];
}

export async function discoverAudioVolumeAutomationFromTimeline(
  page: Page,
  audioIds: string[],
  compositionDuration: number,
  sampleFps: number,
): Promise<BrowserAudioVolumeAutomation[]> {
  if (audioIds.length === 0 || compositionDuration <= 0) return [];

  const sampleStep = 1 / Math.min(60, Math.max(1, sampleFps));
  return page.evaluate(
    ({ ids, duration, step }) => {
      const results: { id: string; keyframes: { time: number; volume: number }[] }[] = [];
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

      for (const id of ids) {
        const el =
          document.getElementById(id) ?? document.getElementById(id.replace(/-audio$/, ""));
        if (!(el instanceof HTMLAudioElement) && !(el instanceof HTMLVideoElement)) continue;

        const start = Number.parseFloat(el.dataset.start ?? "0") || 0;
        const endAttr = Number.parseFloat(el.dataset.end ?? "");
        const durationAttr = Number.parseFloat(el.dataset.duration ?? "");
        const end =
          Number.isFinite(endAttr) && endAttr > start
            ? endAttr
            : Number.isFinite(durationAttr) && durationAttr > 0
              ? start + durationAttr
              : duration;
        const sampleStart = Math.max(0, start);
        const sampleEnd = Math.min(duration, end);
        const initialVolumeAttr = Number.parseFloat(el.dataset.volume ?? "");
        if (Number.isFinite(initialVolumeAttr)) {
          el.volume = Math.max(0, Math.min(1, initialVolumeAttr));
        }

        const keyframes: { time: number; volume: number }[] = [];
        for (let t = sampleStart; t <= sampleEnd + 0.000001; t += step) {
          const boundedTime = Math.min(sampleEnd, t);
          seekTl(boundedTime);
          const rawVolume = Number(el.volume);
          if (!Number.isFinite(rawVolume)) continue;
          const volume = Math.max(0, Math.min(1, rawVolume));
          const last = keyframes.at(-1);
          if (!last || Math.abs(last.volume - volume) > 0.0001 || boundedTime === sampleEnd) {
            keyframes.push({
              time: Number(boundedTime.toFixed(6)),
              volume: Number(volume.toFixed(6)),
            });
          }
          if (boundedTime === sampleEnd) break;
        }

        const staticAttr = Number.parseFloat(el.dataset.volume ?? "");
        const staticVolume = Number.isFinite(staticAttr) ? Math.max(0, Math.min(1, staticAttr)) : 1;
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
    { ids: audioIds, duration: compositionDuration, step: sampleStep },
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

    for (const videoEl of videos) {
      const id = videoEl.id;
      if (!id) continue;

      const sceneEl = videoEl.closest(".scene") || videoEl;

      let firstVisible: number | null = null;
      let lastVisible: number | null = null;

      for (let t = 0; t <= duration; t += SAMPLE_STEP) {
        seekTl(t);
        const opacity = parseFloat(window.getComputedStyle(sceneEl).opacity);
        if (opacity > 0) {
          if (firstVisible === null) firstVisible = t;
          lastVisible = t;
        }
      }

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
    const resolved: { id: string; duration: number; source: string }[] = [];

    for (const id of compIds) {
      // Try window.__timelines[id].duration() first (GSAP timeline)
      const tl = timelines[id];
      if (tl && typeof tl.duration === "function") {
        const dur = tl.duration();
        if (dur > 0) {
          resolved.push({ id, duration: dur, source: "__timelines" });
          continue;
        }
      }

      // Fallback: check for authored duration on the element itself
      const el = document.getElementById(id);
      if (el) {
        const compDurAttr =
          el.getAttribute("data-duration") || el.getAttribute("data-composition-duration");
        if (compDurAttr) {
          const dur = parseFloat(compDurAttr);
          if (dur > 0) {
            resolved.push({ id, duration: dur, source: "data-duration" });
            continue;
          }
        }
      }

      resolved.push({ id, duration: 0, source: "unresolved" });
    }

    return resolved;
  }, ids);

  const resolutions: ResolvedDuration[] = [];
  for (const r of results) {
    if (r.duration > 0) {
      resolutions.push({ id: r.id, duration: r.duration });
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
): Promise<CompiledComposition> {
  if (resolutions.length === 0) return compiled;

  const html = injectDurations(compiled.html, resolutions);

  // Re-parse sub-compositions with the updated parent bounds
  const {
    videos: subVideos,
    audios: subAudios,
    images: subImages,
    subCompositions,
  } = await parseSubCompositions(html, projectDir, downloadDir);

  const mainVideos = parseVideoElements(html);
  const mainAudios = parseAudioElements(html);
  const mainImages = parseImageElements(html);

  // Keep inlined sub-composition media authoritative on ID collisions.
  const hasSubMedia = subVideos.length > 0 || subAudios.length > 0 || subImages.length > 0;
  const videos = hasSubMedia ? dedupeElementsById([...mainVideos, ...subVideos]) : compiled.videos;
  const audios = hasSubMedia ? dedupeElementsById([...mainAudios, ...subAudios]) : compiled.audios;
  const images = hasSubMedia ? dedupeElementsById([...mainImages, ...subImages]) : compiled.images;

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
