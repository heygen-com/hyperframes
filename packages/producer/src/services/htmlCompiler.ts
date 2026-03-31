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
import { join, dirname, resolve } from "path";
import { parseHTML } from "linkedom";
import {
  compileTimingAttrs,
  injectDurations,
  extractResolvedMedia,
  clampDurations,
  type ResolvedDuration,
  type UnresolvedElement,
  rewriteAssetPaths,
} from "@hyperframes/core";
import { extractVideoMetadata, extractAudioMetadata } from "../utils/ffprobe.js";
import {
  parseVideoElements,
  type VideoElement,
  parseAudioElements,
  type AudioElement,
  analyzeKeyframeIntervals,
} from "@hyperframes/engine";
import { downloadToTemp, isHttpUrl } from "../utils/urlDownloader.js";
import type { Page } from "puppeteer-core";
import { injectDeterministicFontFaces } from "./deterministicFonts.js";

export interface CompiledComposition {
  html: string;
  subCompositions: Map<string, string>;
  videos: VideoElement[];
  audios: AudioElement[];
  unresolvedCompositions: UnresolvedElement[];
  width: number;
  height: number;
  staticDuration: number;
}

function dedupeElementsById<T extends { id: string }>(elements: T[]): T[] {
  const deduped = new Map<string, T>();
  for (const element of elements) {
    deduped.set(element.id, element);
  }
  return Array.from(deduped.values());
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

  const metadata =
    tagName === "video"
      ? await extractVideoMetadata(filePath)
      : await extractAudioMetadata(filePath);

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

  // Phase 2: Validate pre-resolved media — clamp data-duration to actual source duration (parallel ffprobe)
  const preResolved = extractResolvedMedia(compiledHtml);
  const clampResults = await Promise.all(
    preResolved
      .filter((el) => !!el.src)
      .map(async (el) => {
        const { duration: maxDuration } = await resolveMediaDuration(
          el.src!,
          el.mediaStart,
          baseDir,
          downloadDir,
          el.tagName,
        );
        return { id: el.id, duration: el.duration, maxDuration, src: el.src! };
      }),
  );
  const clampList: ResolvedDuration[] = [];
  for (const r of clampResults) {
    if (r.maxDuration > 0 && r.duration > r.maxDuration) {
      clampList.push({ id: r.id, duration: r.maxDuration });
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
  subCompositions: Map<string, string>;
}> {
  const videos: VideoElement[] = [];
  const audios: AudioElement[] = [];
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

      return {
        srcPath: item.srcPath,
        compiledSub,
        nested,
        subVideos,
        subAudios,
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

    if (
      r.subVideos.length > 0 ||
      r.subAudios.length > 0 ||
      r.nested.videos.length > 0 ||
      r.nested.audios.length > 0
    ) {
    }
  }

  return { videos, audios, subCompositions };
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

/**
 * Scope CSS rules to a specific composition by prepending each selector
 * with `[data-composition-id="<id>"]`. This prevents class name collisions
 * when multiple sub-compositions use the same class names (e.g. ".content").
 *
 * Handles:
 * - Regular rules: `.foo { }` → `[data-composition-id="x"] .foo { }`
 * - @media and other at-rules: preserved, inner selectors are scoped
 * - @import, @font-face, @keyframes: left unscoped (global by nature)
 */
function scopeCssToComposition(css: string, compositionId: string): string {
  const scope = `[data-composition-id="${compositionId}"]`;
  // Extract @import rules first — they have no {} block and the selector
  // regex corrupts them by treating the text after @ as a selector.
  const importRe = /@import\s+url\([^)]*\)\s*;|@import\s+["'][^"']+["']\s*;/gi;
  const imports: string[] = [];
  const cssWithoutImports = css.replace(importRe, (match) => {
    imports.push(match.trim());
    return "";
  });
  // Split on top-level rule boundaries. Simple regex approach:
  // scope each selector in rule blocks while preserving at-rules.
  const scoped = cssWithoutImports.replace(/([^{}@]+)\{/g, (match, selectors: string) => {
    const trimmed = selectors.trim();
    // Skip @-rule headers (they don't have selectors to scope)
    if (trimmed.startsWith("@")) return match;
    // Skip if already scoped to this composition
    if (trimmed.includes(`data-composition-id="${compositionId}"`)) return match;
    // Scope each comma-separated selector
    const scopedSelectors = trimmed
      .split(",")
      .map((s: string) => {
        const sel = s.trim();
        if (!sel) return sel;
        // Don't scope :root, html, body, or * alone — they're global
        if (/^(html|body|:root|\*)$/i.test(sel)) return sel;
        return `${scope} ${sel}`;
      })
      .join(", ");
    return `${scopedSelectors} {`;
  });
  return imports.length > 0 ? imports.join("\n") + "\n\n" + scoped : scoped;
}

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
 * Inline sub-composition HTML into the main document, mirroring what the
 * bundler's step 6 does.  For each host element with `data-composition-src`:
 *   - Resolve the composition HTML from the pre-compiled map or disk
 *   - Extract <template> (or <body>) content
 *   - Move composition <style> to <head>, <script> to end of <body>
 *   - Replace host innerHTML with composition children
 *   - Remove data-composition-src so the runtime skips async fetching
 */
function inlineSubCompositions(
  html: string,
  subCompositions: Map<string, string>,
  projectDir: string,
): string {
  const { document } = parseHTML(html);
  const head = document.querySelector("head");
  const body = document.querySelector("body");
  const hosts = document.querySelectorAll("[data-composition-src]");

  if (!hosts.length) return html;

  const collectedStyles: string[] = [];
  const collectedScripts: string[] = [];
  const collectedExternalScriptSrcs: string[] = [];

  for (const host of hosts) {
    const srcPath = host.getAttribute("data-composition-src");
    if (!srcPath) continue;

    let compHtml = subCompositions.get(srcPath) || null;
    if (!compHtml) {
      const filePath = resolve(projectDir, srcPath);
      if (existsSync(filePath)) {
        compHtml = readFileSync(filePath, "utf-8");
      }
    }
    if (!compHtml) {
      continue;
    }

    const compDoc = parseHTML(compHtml).document;
    const compId = host.getAttribute("data-composition-id");

    const templateEl = compDoc.querySelector("template");
    const bodyEl = compDoc.querySelector("body");
    const contentHtml = templateEl
      ? templateEl.innerHTML || ""
      : bodyEl
        ? bodyEl.innerHTML || ""
        : compDoc.toString();

    const contentDoc = parseHTML(contentHtml).document;

    const innerRoot = compId
      ? contentDoc.querySelector(`[data-composition-id="${compId}"]`)
      : contentDoc.querySelector("[data-composition-id]");
    const inferredCompId = innerRoot?.getAttribute("data-composition-id")?.trim() || null;

    for (const styleEl of contentDoc.querySelectorAll("style")) {
      const css = styleEl.textContent || "";
      const scopeId = compId || inferredCompId;
      if (scopeId && css.trim()) {
        // Scope sub-composition styles to their composition ID to prevent
        // CSS class collisions when multiple compositions use the same
        // class names (e.g. ".content"). This matches preview behavior
        // where each composition's styles are naturally scoped.
        collectedStyles.push(scopeCssToComposition(css, scopeId));
      } else {
        collectedStyles.push(css);
      }
      styleEl.remove();
    }

    for (const scriptEl of contentDoc.querySelectorAll("script")) {
      const src = (scriptEl.getAttribute("src") || "").trim();
      if (src) {
        // External CDN/remote script — collect for deduped injection into the
        // parent document, mirroring the bundler's hoisting behavior.
        if (!collectedExternalScriptSrcs.includes(src)) {
          collectedExternalScriptSrcs.push(src);
        }
        scriptEl.remove();
        continue;
      }
      const content = (scriptEl.textContent || "").trim();
      if (content) {
        const scriptMountCompId = compId || inferredCompId || "";
        const compIdLiteral = JSON.stringify(scriptMountCompId);
        collectedScripts.push(`(function(){
  var __compId = ${compIdLiteral};
  var __run = function() {
    try {
      ${content}
    } catch (_err) {
      console.error("[Compiler] Composition script failed", __compId, _err);
    }
  };
  if (!__compId) { __run(); return; }
  var __selector = '[data-composition-id="' + (__compId + '').replace(/"/g, '\\\\"') + '"]';
  var __attempt = 0;
  var __tryRun = function() {
    if (document.querySelector(__selector)) { __run(); return; }
    if (++__attempt >= 8) { __run(); return; }
    requestAnimationFrame(__tryRun);
  };
  __tryRun();
})()`);
      }
      scriptEl.remove();
    }

    // Rewrite relative asset paths before inlining so ../foo.svg from
    // compositions/ resolves correctly when the content moves to root.
    const rewriteTarget = innerRoot || contentDoc;
    rewriteAssetPaths(
      rewriteTarget.querySelectorAll("[src], [href]"),
      srcPath,
      (el, attr) => (el.getAttribute(attr) || "").trim(),
      (el, attr, val) => el.setAttribute(attr, val),
    );

    if (innerRoot) {
      const innerW = innerRoot.getAttribute("data-width");
      const innerH = innerRoot.getAttribute("data-height");
      if (innerW && !host.getAttribute("data-width")) host.setAttribute("data-width", innerW);
      if (innerH && !host.getAttribute("data-height")) host.setAttribute("data-height", innerH);
      innerRoot.querySelectorAll("style, script").forEach((el) => el.remove());
      if (!compId && inferredCompId) {
        host.innerHTML = innerRoot.outerHTML || "";
      } else {
        host.innerHTML = innerRoot.innerHTML || "";
      }
    } else {
      contentDoc.querySelectorAll("style, script").forEach((el) => el.remove());
      host.innerHTML = contentDoc.toString();
    }

    host.removeAttribute("data-composition-src");

    // Propagate data-start from the host element to the inserted inner composition
    // node so runtime timeline nesting resolves the correct start offset.
    const hostDataStart = host.getAttribute("data-start");
    if (hostDataStart != null) {
      const innerComp = host.querySelector("[data-composition-id]");
      if (innerComp && !innerComp.getAttribute("data-start")) {
        innerComp.setAttribute("data-start", hostDataStart);
      }
    }

    // Set explicit pixel dimensions on the host element so children using
    // width/height: 100% resolve correctly. The runtime does this
    // automatically but compiled HTML needs it inline.
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

  if (collectedStyles.length && head) {
    const styleEl = document.createElement("style");
    styleEl.textContent = collectedStyles.join("\n\n");
    head.appendChild(styleEl);
  }

  // Inject external CDN scripts before inline scripts so plugins (e.g.
  // TextPlugin, ScrollTrigger) are registered before composition code runs.
  // Deduplicate against scripts already present in the document.
  if (collectedExternalScriptSrcs.length && body) {
    const existingScriptSrcs = new Set(
      Array.from(document.querySelectorAll("script[src]")).map((el) =>
        (el.getAttribute("src") || "").trim(),
      ),
    );
    for (const src of collectedExternalScriptSrcs) {
      if (!existingScriptSrcs.has(src)) {
        const scriptEl = document.createElement("script");
        scriptEl.setAttribute("src", src);
        body.appendChild(scriptEl);
        existingScriptSrcs.add(src);
      }
    }
  }

  if (collectedScripts.length && body) {
    const scriptEl = document.createElement("script");
    scriptEl.textContent = collectedScripts.join("\n;\n");
    body.appendChild(scriptEl);
  }

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
  return `<!DOCTYPE html>\n<html>\n<head>\n  <meta charset="UTF-8">\n  <style>*{margin:0;padding:0;box-sizing:border-box}body{overflow:hidden;background:#000}</style>\n</head>\n<body style="margin:0;overflow:hidden">\n${html}\n</body>\n</html>`;
}

/**
 * Compile an HTML composition project into a single self-contained HTML string
 * with all media metadata resolved.
 */
export async function compileForRender(
  projectDir: string,
  htmlPath: string,
  downloadDir: string,
): Promise<CompiledComposition> {
  const rawHtml = readFileSync(htmlPath, "utf-8");
  const { html: compiledHtml, unresolvedCompositions } = await compileHtmlFile(
    rawHtml,
    projectDir,
    downloadDir,
  );

  // Parse sub-compositions first (extracts media + compiled HTML for each)
  const {
    videos: subVideos,
    audios: subAudios,
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
  const inlinedHtml = inlineSubCompositions(fullHtml, subCompositions, projectDir);

  // Strip preload="none" from media elements — the renderer needs to load all
  // media upfront for frame capture. Users add this to reduce browser memory in
  // preview, but it causes the headless renderer to never load the media, leading
  // to 45s timeout failures.
  const sanitizedHtml = inlinedHtml.replace(
    /(<(?:video|audio)\b[^>]*?)\s+preload\s*=\s*["']none["']/gi,
    "$1",
  );

  const html = injectDeterministicFontFaces(
    coalesceHeadStylesAndBodyScripts(promoteCssImportsToLinkTags(sanitizedHtml)),
  );

  // Parse main HTML elements
  const mainVideos = parseVideoElements(html);
  const mainAudios = parseAudioElements(html);

  const videos = dedupeElementsById([...mainVideos, ...subVideos]);
  const audios = dedupeElementsById([...mainAudios, ...subAudios]);

  // Advisory video checks (sparse keyframes, VFR). Fire-and-forget — these spawn
  // ffprobe subprocesses and should not block compilation since they only produce warnings.
  for (const video of videos) {
    if (isHttpUrl(video.src)) continue;
    const videoPath = resolve(projectDir, video.src);
    const reencode = `ffmpeg -i "${video.src}" -c:v libx264 -r 30 -g 30 -keyint_min 30 -movflags +faststart -c:a copy output.mp4`;
    Promise.all([analyzeKeyframeIntervals(videoPath), extractVideoMetadata(videoPath)])
      .then(([analysis, metadata]) => {
        if (analysis.isProblematic) {
          console.warn(
            `[Compiler] WARNING: Video "${video.id}" has sparse keyframes (max interval: ${analysis.maxIntervalSeconds}s). ` +
              `This causes seek failures and frame freezing. Re-encode with: ${reencode}`,
          );
        }
        if (metadata.isVFR) {
          console.warn(
            `[Compiler] WARNING: Video "${video.id}" is variable frame rate (VFR). ` +
              `Screen recordings and phone videos are often VFR, which causes stuttering and frame skipping in renders. Re-encode with: ${reencode}`,
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
    unresolvedCompositions,
    width,
    height,
    staticDuration,
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
  hasAudio: boolean;
  volume: number;
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
      hasAudio: boolean;
      volume: number;
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
      const hasAudio = htmlEl.getAttribute("data-has-audio") === "true";
      const volume = parseFloat(htmlEl.getAttribute("data-volume") || "1");

      results.push({
        id,
        tagName: htmlEl.tagName.toLowerCase(),
        src,
        start,
        end,
        duration,
        mediaStart,
        hasAudio,
        volume,
      });
    });

    return results;
  });

  return elements as BrowserMediaElement[];
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
    subCompositions,
  } = await parseSubCompositions(html, projectDir, downloadDir);

  const mainVideos = parseVideoElements(html);
  const mainAudios = parseAudioElements(html);

  const videos = dedupeElementsById([...mainVideos, ...subVideos]);
  const audios = dedupeElementsById([...mainAudios, ...subAudios]);

  const remaining = compiled.unresolvedCompositions.filter(
    (c) => !resolutions.some((r) => r.id === c.id),
  );

  return {
    ...compiled,
    html,
    subCompositions,
    videos,
    audios,
    unresolvedCompositions: remaining,
  };
}
