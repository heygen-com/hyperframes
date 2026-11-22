import type { Hono } from "hono";
import { parseHTML } from "linkedom";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { readFile, stat as statFile } from "node:fs/promises";
import { stripSdrPngColourTags } from "@hyperframes/core/compiler/png-colour-tags";
import { Readable } from "node:stream";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  AFTER_FONTS_SCRIPT_TYPE,
  RUNTIME_BOOTSTRAP_ATTR,
  insertBeforeCloseTag,
  insertRuntimeTag,
  stripEmbeddedRuntimeScripts,
  type BundleOptions,
} from "@hyperframes/core/compiler";
import {
  STUDIO_PREVIEW_CAPTURE_MODE,
  STUDIO_PREVIEW_MARK_META,
  STUDIO_PREVIEW_ERROR_KINDS,
  STUDIO_PREVIEW_ERRORS,
} from "@hyperframes/core/studio-preview-mark";
import {
  PREVIEW_PROXY_BOX_PARAM,
  PREVIEW_PROXY_LIGHT_PARAM,
  PREVIEW_PROXY_PRIORITY_HEADER,
  PREVIEW_PROXY_PROGRESS_HEADER,
  PREVIEW_PROXY_RETRY_PARAM,
  PREVIEW_PROXY_STILL_PARAM,
  parsePreviewProxyBox,
} from "@hyperframes/core";
import {
  GSAP_BASE_URL_META,
  GSAP_PLUGIN_LOAD_ATTR,
  NO_PATH_TWEEN_META,
  gsapCdnDist,
  motionPathPluginUrl,
  namesMotionPath,
  normalizeGsapBaseUrl,
  normalizeGsapLocalRoot,
} from "@hyperframes/core/gsap-cdn";
import { findStartTags, injectTagsAtHeadStart } from "@hyperframes/core/compiler/html-document";
import { hasAuthoredCode } from "../helpers/authoredCode.js";
import { THUMBNAIL_NO_AUTHORED_CODE_META } from "../helpers/screenshotClip.js";
import { isWithinProjectRoot } from "@hyperframes/parsers/asset-resolution";
import type { ResolvedProject, StudioApiAdapter } from "../types.js";
import {
  isPrivateProjectFile,
  isProjectRootMissing,
  projectRelativePath,
  resolveWithinProject,
} from "../helpers/safePath.js";
import {
  isPrivateProjectFileOff,
  resolveExistingProjectFileOff,
  statOrNull,
} from "../helpers/projectDisk.js";
import { getMimeType } from "../helpers/mime.js";
import { serveWhileOpen } from "../helpers/servedFiles.js";
import { openRangeEnd } from "../helpers/mediaRange.js";
import { hasBaseElement } from "../helpers/subComposition.js";
import {
  runOffThread,
  ROOT_PREVIEW_DEADLINE_MS,
  SUB_COMPOSITION_DEADLINE_MS,
  SubCompositionDeadlineError,
  withinDeadline,
} from "../helpers/subCompositionBuild.js";
import { withRootImportMap } from "../helpers/rootImportMap.js";
import { withRootPathsRelative } from "../helpers/rootPaths.js";
import {
  htmlHasGsapCore,
  insertGsapCoreBeforeHeadPlugin,
  isGsapCoreUrl,
} from "../helpers/gsapCoreScript.js";
import {
  createProjectSignatureAsync,
  resolveProjectAndSignature,
} from "../helpers/projectSignature.js";
import {
  createStudioMotionRenderBodyScript,
  STUDIO_MOTION_PATH,
} from "../helpers/studioMotionRenderScript.js";
import { ensureHfIds } from "@hyperframes/parsers/hf-ids";
import { settledFileTag } from "../helpers/fileVersion.js";
import {
  recordPreviewBuilt,
  recordPreviewRead,
  recordPreviewReadsOff,
} from "../helpers/previewReads.js";
import { isVariablesPayload, VARIABLES_PAYLOAD_ERROR } from "../helpers/variablesPayload.js";
import { injectPreviewVariables } from "../helpers/previewVariables.js";
import {
  proxyCopyProgress,
  resolveProxy,
  resolveStill,
  retryProxyCopy,
  waitForProxy,
  ProxyCapacityError,
  ProxyTranscodeError,
  ProxyWaitTimeoutError,
  PROXY_PENDING_RETRY_AFTER_SECONDS,
  StillPastEndError,
} from "../helpers/proxyTranscoder.js";
import {
  decideMediaProxyEligibility,
  isProxyVariantRequest,
  probeAssetCodec,
  recordProxyRequest,
  resolveProxyVariantRequest,
  PROXY_VARIANT_CONFIG,
  type ProxyVariant,
} from "../helpers/mediaCodecMap.js";
import {
  isAutoProxyEnabled,
  injectMediaCodecMap,
  proxyEtagSalt,
  resolvePreviewMediaCodecProbeCache,
  type PreviewApiAdapter,
} from "../helpers/mediaProxyPreview.js";
import { requestSubPath } from "../helpers/requestSubPath.js";
import { previewRefusalPage } from "../helpers/previewErrorPage.js";
import { isCompositionTooLargeError } from "@hyperframes/core/compiler/composition-size-limit";
import { lazyPreviewImages } from "../helpers/lazyPreviewImages.js";
import { corsProjectVideos } from "../helpers/captureVideos.js";
import { createJobSlots, JobAbandonedError, JobQueueFullError } from "../helpers/jobSlots.js";

const PROJECT_SIGNATURE_META = "hyperframes-project-signature";
const runStillJob = createJobSlots(4, 16);

function escapeGsapUrl(url: string): string {
  return url.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function gsapScriptTag(file: string, baseUrl: string): string {
  return `<script src="${escapeGsapUrl(gsapCdnDist(undefined, baseUrl) + file)}"></script>`;
}

function injectProjectSignature(html: string, signature: string): string {
  const tag = `<meta name="${PROJECT_SIGNATURE_META}" content="${signature}">`;
  if (html.includes(`name="${PROJECT_SIGNATURE_META}"`)) {
    return html.replace(
      new RegExp(`<meta\\s+name=["']${PROJECT_SIGNATURE_META}["'][^>]*>`, "i"),
      tag,
    );
  }
  return insertBeforeCloseTag(html, "head", `${tag}\n`) ?? `${tag}\n${html}`;
}

function readStudioMotionManifestContent(projectDir: string): string {
  const manifestPath = join(projectDir, STUDIO_MOTION_PATH);
  if (!existsSync(manifestPath)) return "";
  try {
    return readFileSync(manifestPath, "utf-8");
  } catch {
    return "";
  }
}

function parseStudioMotionManifestContent(content: string): {
  hasMotion: boolean;
  hasCustomEase: boolean;
} {
  try {
    const parsed = JSON.parse(content) as {
      motions?: Array<{ customEase?: unknown }>;
    };
    const motions = Array.isArray(parsed.motions) ? parsed.motions : [];
    return {
      hasMotion: motions.length > 0,
      hasCustomEase: motions.some((motion) => Boolean(motion?.customEase)),
    };
  } catch {
    return { hasMotion: false, hasCustomEase: false };
  }
}

/** Preview hooks must install before authored head scripts register media consumers. */
export function withPreviewRuntime(html: string, runtimeUrl: string): string {
  const tag = `<script ${RUNTIME_BOOTSTRAP_ATTR}="1" src="${runtimeUrl}"></script>`;
  return insertRuntimeTag(stripEmbeddedRuntimeScripts(html), tag, true);
}

function injectScriptTagIntoHead(html: string, scriptTag: string): string {
  return insertBeforeCloseTag(html, "head", `${scriptTag}\n`) ?? `${scriptTag}\n${html}`;
}

function htmlHasCustomEase(html: string): boolean {
  return (
    /<script\b[^>]*src=["'][^"']*CustomEase/i.test(html) ||
    /\bwindow\.CustomEase\b/.test(html) ||
    /\bCustomEase\s*=\s*/.test(html)
  );
}

// A composition that drives motion via GSAP's `motionPath` (e.g. a studio-created
// motion path written into the single-source timeline) needs MotionPathPlugin
// registered before the timeline first renders — otherwise the initial seek
// throws "Invalid property motionPath ... Missing plugin?". Detect it anywhere in
// the bundle (the plugin registers globally, so sub-composition usage counts too).
function htmlUsesMotionPath(html: string): boolean {
  return namesMotionPath(html);
}

const SCRIPT_SRC_ATTR = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const GSAP_ON_ITS_CDN = /^https:\/\/cdn\.jsdelivr\.net\/npm\/gsap@[\d.]+\/dist\/[\w.-]+\.js$/;
const PROJECT_PREVIEW_BASE =
  /<base\b[^>]*\shref\s*=\s*["']\/api\/projects\/[^/"']+\/preview\/["']/i;

const MAX_READ_SCRIPT_BYTES = 4 * 1024 * 1024;
const SCRIPT_SCAN_MS = 1000;
// A page with more script tags than this is unsure, and unsure already means it preloads the plugin.
const MAX_SCANNED_SCRIPTS = 64;
const SCRIPT_READS_IN_FLIGHT = 8;

/** How the scan reaches a project's files: both off the event loop. */
interface ScriptFiles {
  resolve: (base: string, relativePath: string) => Promise<string | null>;
  read: (file: string, signal: AbortSignal) => Promise<string>;
}
const projectFiles: ScriptFiles = {
  resolve: resolveExistingProjectFileOff,
  read: (file, signal) => readFile(file, { encoding: "utf-8", signal }),
};

async function fileNamesNoPath(file: string, files: ScriptFiles, signal: AbortSignal) {
  const info = await statFile(file);
  if (!info.isFile() || info.size > MAX_READ_SCRIPT_BYTES || signal.aborted) return false;
  return !namesMotionPath(await files.read(file, signal));
}

function scriptTagAnswer(tag: string): boolean | { src: string } {
  if (tag.includes(RUNTIME_BOOTSTRAP_ATTR)) return true;
  if (/\stype\s*=\s*["']?module\b/i.test(tag)) return false;
  const match = SCRIPT_SRC_ATTR.exec(tag);
  if (!match) return true;
  const src = (match[1] ?? match[2] ?? match[3] ?? "").replace(/&amp;/gi, "&");
  if (GSAP_ON_ITS_CDN.test(src)) return true;
  return /^(?:[a-z][\w+.-]*:|\/)/i.test(src) ? false : { src };
}

async function inPool<T>(
  items: Iterable<T>,
  size: number,
  signal: AbortSignal,
  work: (item: T) => Promise<void>,
): Promise<void> {
  const pending = items[Symbol.iterator]();
  const worker = async () => {
    for (let next = pending.next(); !next.done && !signal.aborted; next = pending.next()) {
      await work(next.value);
    }
  };
  await Promise.all(Array.from({ length: size }, worker));
}

/** True only when no script the page loads can tween along a path: the page's text and each project script it loads
 * name no `motionPath`, and any other script is GSAP on its CDN. Unsure or late is false, and the page preloads. The
 * scan takes at most half of the time left before `requestDeadline`, so the preview itself keeps the rest. */
export async function provesNoPathTween(
  html: string,
  projectDir: string,
  requestDeadline = Number.POSITIVE_INFINITY,
  files = projectFiles,
): Promise<boolean> {
  if (namesMotionPath(html) || /\sdata-composition-src\s*=/i.test(html)) return false;
  if ((html.match(/<base\b/gi) ?? []).length !== 1 || !PROJECT_PREVIEW_BASE.test(html))
    return false;
  const now = performance.now();
  const deadline = now + Math.min(SCRIPT_SCAN_MS, (requestDeadline - now) / 2);
  if (deadline <= now) return false;
  const tags = findStartTags(html, "script");
  if (tags.length > MAX_SCANNED_SCRIPTS) return false;
  const srcs = new Set<string>();
  for (const start of tags) {
    const answer = scriptTagAnswer(html.slice(start, html.indexOf(">", start) + 1));
    if (answer === false) return false;
    if (answer !== true) srcs.add(answer.src);
  }
  // Aborted when a script names a path or the scan ends, so it stops every read it started.
  const scan = new AbortController();
  const byFile = new Map<string, Promise<boolean>>();
  const check = async (src: string) => {
    const file = await files.resolve(projectDir, decodeURIComponent(src.split(/[?#]/)[0]!));
    if (file === null) return false;
    let answer = byFile.get(file);
    if (!answer) byFile.set(file, (answer = fileNamesNoPath(file, files, scan.signal)));
    return answer;
  };
  const stopUnlessNoPath = async (src: string) => {
    if (!(await check(src).catch(() => false))) scan.abort();
  };
  try {
    await withinDeadline(
      inPool(srcs, SCRIPT_READS_IN_FLIGHT, scan.signal, stopUnlessNoPath),
      deadline,
      "scripts",
    );
    return !scan.signal.aborted;
  } catch {
    return false;
  } finally {
    scan.abort();
  }
}

function htmlHasMotionPathPlugin(html: string): boolean {
  return (
    /<script\b[^>]*src=["'][^"']*MotionPathPlugin/i.test(html) ||
    /\bwindow\.MotionPathPlugin\b/.test(html) ||
    /\bMotionPathPlugin\s*=\s*/.test(html)
  );
}

function injectMotionPathPluginIfNeeded(html: string, baseUrl: string): string {
  if (!htmlUsesMotionPath(html) || htmlHasMotionPathPlugin(html)) return html;
  // The plugin registers onto an already-loaded gsap, so it must come AFTER the
  // core gsap script — which often lives at body-end, not <head>. Insert it
  // directly after the gsap script tag; only fall back to <head> if none is found
  // (e.g. gsap is inlined).
  const gsap = findGsapCoreScript(html);
  if (gsap) {
    const version = gsap.src.match(/gsap@([\d.]+)/)?.[1];
    const ordering = `${gsap.type ? ` type="${gsap.type}"` : ""}${gsap.defer ? " defer" : ""}`;
    const pluginTag = `<script${ordering} src="${escapeGsapUrl(motionPathPluginUrl(version, baseUrl))}"></script>`;
    return html.slice(0, gsap.end) + "\n" + pluginTag + html.slice(gsap.end);
  }
  return injectScriptTagIntoHead(html, gsapScriptTag("MotionPathPlugin.min.js", baseUrl));
}

type GsapCoreScript = { src: string; type: string | null; defer: boolean; end: number };

function findGsapCoreScript(html: string): GsapCoreScript | null {
  const scripts = [...parseHTML(html).document.querySelectorAll("script")];
  // The scanner skips comments, raw text and templates, so its `<script` offsets line up with the DOM's scripts.
  const starts = findStartTags(html, "script");
  if (starts.length !== scripts.length) return null;
  const at = scripts.findIndex((script) =>
    isGsapCoreUrl(lowerCaseAttributes(script).get("src") ?? ""),
  );
  if (at === -1) return null;
  const attributes = lowerCaseAttributes(scripts[at]!);
  const end = scriptCloseEnd(html, starts[at]!);
  if (end === 0) return null;
  return {
    src: attributes.get("src")!,
    type: attributes.get("type") ?? null,
    defer: attributes.has("defer"),
    end,
  };
}

function lowerCaseAttributes(el: Element): Map<string, string> {
  return new Map([...el.attributes].map((a) => [a.name.toLowerCase(), a.value]));
}

/** Index just past the `</script>` that closes the script starting at `start`; 0 when it never closes. */
function scriptCloseEnd(html: string, start: number): number {
  const close = /<\/script/gi;
  close.lastIndex = start;
  const closeAt = close.exec(html)?.index;
  return closeAt === undefined ? 0 : html.indexOf(">", closeAt) + 1;
}

function injectStudioMotionDependencies(
  html: string,
  manifestContent: string,
  baseUrl: string,
): string {
  const manifest = parseStudioMotionManifestContent(manifestContent);
  if (!manifest.hasMotion) return html;
  let next = html;
  if (!htmlHasGsapCore(next)) {
    const core = gsapScriptTag("gsap.min.js", baseUrl);
    next = insertGsapCoreBeforeHeadPlugin(next, core) ?? injectScriptTagIntoHead(next, core);
  }
  if (manifest.hasCustomEase && !htmlHasCustomEase(next)) {
    next = injectScriptTagIntoHead(next, gsapScriptTag("CustomEase.min.js", baseUrl));
  }
  return next;
}

function readStudioMotion(
  projectDir: string,
  activeCompositionPath: string,
): { manifestContent: string; script: string } | null {
  const manifestContent = readStudioMotionManifestContent(projectDir);
  const script = createStudioMotionRenderBodyScript(manifestContent, {
    activeCompositionPath,
  });
  return script ? { manifestContent, script } : null;
}

function injectStudioMotionScript(html: string, script: string): string {
  const tag = `<script type="${AFTER_FONTS_SCRIPT_TYPE}">${script.replace(/<\/script/gi, "<\\/script")}</script>`;
  return insertBeforeCloseTag(html, "body", tag) ?? `${html}${tag}`;
}

const GSAP_FALLBACK_ATTR = "data-hf-gsap-fallback";
function gsapCdnFallbackScript(baseUrl: string): string {
  return `<script ${GSAP_FALLBACK_ATTR}>
(function(){
  var cdnBase=${scriptJson(gsapCdnDist(undefined, baseUrl))};
  var loaded={};
  function loadFallback(file){
    if(loaded[file])return loaded[file];
    return loaded[file]=new Promise(function(ok,fail){
      var s=document.createElement("script");
      s.src=cdnBase+file;s.hfGsapFallback=true;s.onload=ok;s.onerror=fail;
      document.head.appendChild(s);
    });
  }
  document.addEventListener("error",function(e){
    var t=e.target;
    if(!t||t.tagName!=="SCRIPT"||!t.src||t.hfGsapFallback||(t.hasAttribute&&t.hasAttribute(${scriptJson(GSAP_PLUGIN_LOAD_ATTR)})))return;
    var m=t.src.match(/gsap[^/]*\\/dist\\/(.+\\.js)/);
    if(m)loadFallback(m[1]).catch(function(){
      reportError(new Error("GSAP could not load from "+t.src+" or "+cdnBase+m[1]+", so this preview's animations will not play."));
    });
  },true);
})();
</script>`;
}

function injectGsapCdnFallback(html: string, baseUrl: string): string {
  if (html.includes(GSAP_FALLBACK_ATTR)) return html;
  if (html.includes("<head>"))
    return html.replace("<head>", "<head>" + gsapCdnFallbackScript(baseUrl));
  return gsapCdnFallbackScript(baseUrl) + html;
}

/**
 * Parse the `?variables=` query param. Absent/empty → null (no injection).
 * Invalid JSON or a non-object payload is a caller error — surfaced as a 400
 * by the routes rather than silently previewing with defaults.
 */
function parsePreviewVariablesParam(
  raw: string | undefined,
): { ok: true; values: Record<string, unknown> | null } | { ok: false; error: string } {
  if (raw === undefined || raw === "") return { ok: true, values: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "variables must be valid JSON" };
  }
  if (!isVariablesPayload(parsed)) {
    return { ok: false, error: VARIABLES_PAYLOAD_ERROR };
  }
  return { ok: true, values: parsed };
}

/** ETag salt so cached previews revalidate when the variable values change. */
function variablesEtagSalt(raw: string | undefined): string {
  if (!raw) return "";
  return `:vars:${createHash("sha1").update(raw).digest("hex").slice(0, 12)}`;
}

/**
 * Read + parse `?variables=` for a preview route. `error` present → the
 * route should 400; otherwise `values` is the override object (or null when
 * the param is absent) and `raw` feeds the ETag salt.
 */
function previewVariablesFromRequest(rawVariables: string | undefined):
  | { error: string }
  | {
      error?: undefined;
      raw: string | undefined;
      values: Record<string, unknown> | null;
    } {
  const parse = parsePreviewVariablesParam(rawVariables);
  if (!parse.ok) return { error: parse.error };
  return { raw: rawVariables, values: parse.values };
}

/** Captures screenshot right after a seek, so they get every image eager; media loads near the playhead. */
export const PREVIEW_CAPTURE_PARAM = "hf-capture";
export const PREVIEW_PROXY_PARAM = "hf-proxy";

export function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

// Studio's console capture attaches at the iframe's load; this keeps what was raised before it.
const earlyErrorsScript = (
  runtimeUrl: string,
) => `<script>(function(){var seen=window.${STUDIO_PREVIEW_ERRORS}=[],kinds=window.${STUDIO_PREVIEW_ERROR_KINDS}=[],known={SyntaxError:1,TypeError:1,ReferenceError:1,RangeError:1},runtime=${scriptJson(new URL(runtimeUrl, "http://x").pathname)};
addEventListener("error",function(e){seen.push(e.message||String(e));
var name=e.error&&e.error.constructor&&e.error.constructor.name,path="";
try{var url=e.filename&&new URL(e.filename,window.location.href);if(url&&url.origin===window.location.origin)path=url.pathname}catch(_){}
kinds.push({name:known[name]===1?name:"other",origin:!path?"unknown":path===runtime?"runtime":path.indexOf("/api/projects/")===0?"project":"studio"})});})();</script>`;

export function injectStudioPreviewAugmentations(
  html: string,
  runtimeUrl: string,
  signature: string,
  projectDir: string,
  activeCompositionPath: string,
  options: { capture: boolean; gsapBaseUrl: string; sandboxedCapture: boolean; pathFree?: boolean },
): string {
  const studioMotion = readStudioMotion(projectDir, activeCompositionPath);
  const noTimelineToCome =
    options.capture && !studioMotion && !hasAuthoredCode(html)
      ? `<meta name="${THUMBNAIL_NO_AUTHORED_CODE_META}">`
      : "";
  const marked = options.capture
    ? injectTagsAtHeadStart(
        options.sandboxedCapture ? corsProjectVideos(html) : html,
        `<meta name="${STUDIO_PREVIEW_MARK_META}" content="${STUDIO_PREVIEW_CAPTURE_MODE}">${noTimelineToCome}`,
      )
    : injectTagsAtHeadStart(
        lazyPreviewImages(html),
        `<meta name="${STUDIO_PREVIEW_MARK_META}">${earlyErrorsScript(runtimeUrl)}`,
      );
  const withFallback = injectGsapCdnFallback(
    injectProjectSignature(
      injectTagsAtHeadStart(
        marked,
        `<meta name="${GSAP_BASE_URL_META}" content="${escapeGsapUrl(options.gsapBaseUrl)}">` +
          (!studioMotion && options.pathFree ? `<meta name="${NO_PATH_TWEEN_META}">` : ""),
      ),
      signature,
    ),
    options.gsapBaseUrl,
  );
  // Studio motion's GSAP core goes in first, so a MotionPathPlugin injected next lands after it.
  const withMotionDependencies = studioMotion
    ? injectStudioMotionDependencies(
        withFallback,
        studioMotion.manifestContent,
        options.gsapBaseUrl,
      )
    : withFallback;
  const withPlugin = injectMotionPathPluginIfNeeded(withMotionDependencies, options.gsapBaseUrl);
  return studioMotion ? injectStudioMotionScript(withPlugin, studioMotion.script) : withPlugin;
}

async function transformPreviewHtml(
  html: string,
  adapter: StudioApiAdapter,
  project: { id: string; dir: string; title?: string; sessionId?: string },
  activeCompositionPath: string,
): Promise<string> {
  if (!adapter.transformPreviewHtml) return html;
  try {
    return await adapter.transformPreviewHtml({
      html,
      project,
      activeCompositionPath,
    });
  } catch (err) {
    console.warn("[Studio] preview transform failed, using original HTML:", err);
    return html;
  }
}

function resolveProjectMainHtml(
  projectDir: string,
  projectId: string,
): { html: string; compositionPath: string } | null {
  const indexPath = join(projectDir, "index.html");
  const blockHtmlPath = join(projectDir, `${projectId}.html`);
  recordPreviewRead(projectDir, indexPath);
  recordPreviewRead(projectDir, blockHtmlPath);
  const existsAndNotPrivate = (file: string) =>
    existsSync(file) && !isPrivateProjectFile(projectDir, file);
  if (existsAndNotPrivate(indexPath)) {
    return {
      html: readFileSync(indexPath, "utf-8"),
      compositionPath: "index.html",
    };
  }
  if (existsAndNotPrivate(blockHtmlPath)) {
    return {
      html: readFileSync(blockHtmlPath, "utf-8"),
      compositionPath: `${projectId}.html`,
    };
  }
  return null;
}

/** The bundler options every adapter's `bundle()` uses. This route serves project files under a
 * `<base href>`, so assets keep their URLs: inlined base64 multiplies the document per reference.
 * The lint route owns linting, so the bundle skips its own contract lint. */
export const PREVIEW_BUNDLE_OPTIONS = {
  runtime: "placeholder",
  inlineAssets: false,
  staticGuard: false,
  sceneParts: true,
} as const satisfies BundleOptions;

const previewBaseHref = (projectId: string) =>
  `/api/projects/${encodeURIComponent(projectId)}/preview/`;

export const withPreviewBase = (html: string, projectId: string) => {
  const base = previewBaseHref(projectId);
  const mapped = withRootImportMap(withRootPathsRelative(html, base), base);
  return hasBaseElement(mapped) ? mapped : injectTagsAtHeadStart(mapped, `<base href="${base}">`);
};

function resolvePreviewGsapBaseUrl(adapter: PreviewApiAdapter): string {
  const configured = process.env.HYPERFRAMES_GSAP_BASE_URL;
  if (configured?.trim() || !adapter.gsapLocalRoot) {
    try {
      return normalizeGsapBaseUrl(configured);
    } catch (cause) {
      throw new Error(
        "Invalid HYPERFRAMES_GSAP_BASE_URL: use an absolute HTTPS npm mirror root (plain HTTP only for localhost) without credentials, query, or fragment",
        { cause },
      );
    }
  }
  return normalizeGsapLocalRoot(adapter.gsapLocalRoot);
}

export function registerPreviewRoutes(
  api: Hono,
  adapter: PreviewApiAdapter,
  {
    sandboxThumbnailCaptures = false,
    subCompositionDeadlineMs,
  }: { sandboxThumbnailCaptures?: boolean; subCompositionDeadlineMs?: number } = {},
): void {
  const gsapBaseUrl = resolvePreviewGsapBaseUrl(adapter);
  const gsapEtagSalt = `:gsap:${createHash("sha1").update(gsapBaseUrl).digest("hex").slice(0, 12)}`;
  const previewCacheHeaders = (etag: string) => ({
    "Cache-Control": "private, no-cache",
    ETag: etag,
  });

  // One probe cache per server instance (this function runs once per
  // registered API), reused across every preview request so the mtime-cache
  // benefit in scanProjectMediaCodecMap actually applies.
  const mediaCodecProbeCache = resolvePreviewMediaCodecProbeCache(adapter);

  // A build is a function of the project content its ETag names, so it is served again until the
  // content changes, to a cold browser as well as a revalidating one.
  const builtPreviews = new Map<string, string>();
  const rememberPreview = (key: string, html: string) => {
    builtPreviews.delete(key);
    builtPreviews.set(key, html);
    if (builtPreviews.size > 4) builtPreviews.delete(builtPreviews.keys().next().value!);
  };

  // Concurrent requests for one document (an early prefetch and the player's own load) share a build.
  const previewBuilds = new Map<string, Promise<string | null>>();

  // fallow-ignore-next-line complexity
  async function buildPreview(
    project: ResolvedProject,
    previewVariables: Record<string, unknown> | null,
    builtKey: string,
    capture: boolean,
    signature: string,
  ): Promise<string | null> {
    const diskMain = resolveProjectMainHtml(project.dir, project.id);

    try {
      const reads: string[] = [];
      let bundled = await adapter
        .bundle(project.dir, {
          stampHfIds: true,
          onRead: (filePath) => reads.push(filePath),
          privateFiles: "studio",
        })
        .finally(() => recordPreviewReadsOff(project.dir, reads));
      let mainCompositionPath = "index.html";
      if (!bundled) {
        if (!diskMain) return null;
        bundled = ensureHfIds(diskMain.html);
        mainCompositionPath = diskMain.compositionPath;
      }
      // <base> and root paths under it, before the runtime adds the server's own root path
      const rootDeadline = performance.now() + ROOT_PREVIEW_DEADLINE_MS;
      const based = await runOffThread(
        { kind: "base", html: bundled, projectId: project.id, runtimeUrl: adapter.runtimeUrl },
        rootDeadline,
        mainCompositionPath,
      );
      bundled = based.html;
      await recordPreviewReadsOff(project.dir, based.references);
      recordPreviewBuilt(project.dir);

      // The passes that parse the page run on the build worker (a capture page builds while a film plays); the
      // host's transform and the media probes stay here.
      const transformed = await transformPreviewHtml(
        bundled,
        adapter,
        project,
        mainCompositionPath,
      );
      const options = {
        capture,
        gsapBaseUrl,
        sandboxedCapture: sandboxThumbnailCaptures,
        pathFree: await provesNoPathTween(transformed, project.dir, rootDeadline),
      };
      const job = {
        runtimeUrl: adapter.runtimeUrl,
        signature,
        projectDir: project.dir,
        compPath: mainCompositionPath,
      };
      bundled = await runOffThread(
        {
          kind: "finish",
          html: transformed,
          ...job,
          options,
          ...(previewVariables && { variables: previewVariables }),
        },
        rootDeadline,
        mainCompositionPath,
      );
      bundled = await injectMediaCodecMap(
        bundled,
        adapter,
        project.dir,
        mainCompositionPath,
        mediaCodecProbeCache,
      );
      const ignore = [`meta[name="${PROJECT_SIGNATURE_META}"]`];
      bundled = await runOffThread(
        { kind: "parts", html: bundled, ignore },
        rootDeadline,
        mainCompositionPath,
      );
      if ((await createProjectSignatureAsync(project.dir)) === signature) {
        rememberPreview(builtKey, bundled);
        if (!capture) adapter.previewDocuments?.write(builtKey, bundled);
      }
      return bundled;
    } catch (error) {
      if (isCompositionTooLargeError(error)) return previewRefusalPage(error.message);
      console.warn("[Studio] preview build failed, building from the saved file:", error);
      // Re-read disk on bundle failure so we serve the latest file content,
      // not the pre-request snapshot that may have been saved over.
      const fallback = resolveProjectMainHtml(project.dir, project.id);
      if (fallback) {
        const fallbackHtml = withPreviewRuntime(
          withPreviewBase(ensureHfIds(fallback.html), project.id),
          adapter.runtimeUrl,
        );
        const fallbackPage = await transformPreviewHtml(
          fallbackHtml,
          adapter,
          project,
          fallback.compositionPath,
        );
        let fallbackAugmented = injectStudioPreviewAugmentations(
          fallbackPage,
          adapter.runtimeUrl,
          signature,
          project.dir,
          fallback.compositionPath,
          {
            capture,
            gsapBaseUrl,
            sandboxedCapture: sandboxThumbnailCaptures,
            pathFree: await provesNoPathTween(fallbackPage, project.dir),
          },
        );
        if (previewVariables) {
          fallbackAugmented = injectPreviewVariables(fallbackAugmented, previewVariables);
        }
        fallbackAugmented = await injectMediaCodecMap(
          fallbackAugmented,
          adapter,
          project.dir,
          fallback.compositionPath,
          mediaCodecProbeCache,
        );
        return fallbackAugmented;
      }
      return null;
    }
  }

  // Bundled composition preview
  // fallow-ignore-next-line complexity
  api.get("/projects/:id/preview", async (c) => {
    const resolved = await resolveProjectAndSignature(adapter, c.req.param("id"));
    if (!resolved) return c.json({ error: "not found" }, 404);
    const { project, signature } = resolved;

    // fallow-ignore-next-line code-duplication
    const vars = previewVariablesFromRequest(c.req.query("variables"));
    if (vars.error !== undefined) return c.json({ error: vars.error }, 400);
    const previewVariables = vars.values;
    const capture = c.req.query(PREVIEW_CAPTURE_PARAM) !== undefined;

    const etag = `"preview:${signature}${gsapEtagSalt}${variablesEtagSalt(vars.raw)}${capture ? ":capture" : ""}"`;
    const ifNoneMatch = c.req.header("If-None-Match");
    if (ifNoneMatch === etag) {
      return new Response(null, {
        status: 304,
        headers: previewCacheHeaders(etag),
      });
    }
    const builtKey = `${project.id}\n${etag}`;
    const cached = builtPreviews.get(builtKey) ?? adapter.previewDocuments?.read(builtKey);
    if (cached) {
      rememberPreview(builtKey, cached);
      return c.html(cached, 200, previewCacheHeaders(etag));
    }
    let pending = previewBuilds.get(builtKey);
    if (!pending) {
      pending = buildPreview(project, previewVariables, builtKey, capture, signature).finally(() =>
        previewBuilds.delete(builtKey),
      );
      previewBuilds.set(builtKey, pending);
    }
    const html = await pending;
    if (!html) return c.text("not found", 404);
    return c.html(html, 200, previewCacheHeaders(etag));
  });

  // Sub-composition preview
  // fallow-ignore-next-line complexity
  api.get("/projects/:id/preview/comp/*", async (c) => {
    const resolved = await resolveProjectAndSignature(adapter, c.req.param("id"));
    if (!resolved) return c.json({ error: "not found" }, 404);
    const { project, signature } = resolved;

    // fallow-ignore-next-line code-duplication
    const vars = previewVariablesFromRequest(c.req.query("variables"));
    if (vars.error !== undefined) return c.json({ error: vars.error }, 400);
    const previewVariables = vars.values;
    const compFile = resolveWithinProject(
      project.dir,
      requestSubPath(c.req.url, "projects/:id/preview/comp"),
    );
    // The sub-composition document takes its head from the root.
    await recordPreviewReadsOff(project.dir, compFile ? [compFile, "index.html"] : ["index.html"]);
    if (!compFile || !existsSync(compFile) || !statSync(compFile).isFile()) {
      return c.text("not found", 404);
    }
    const compPath = projectRelativePath(project.dir, compFile);

    // "v2" salts the etag for the hf-id-pinning change below: a client holding
    // a pre-pin cached response (preview-only ids, unstamped disk file) must
    // not revalidate to a 304 that skips the pin.
    const compPathHash = createHash("sha1").update(compPath).digest("hex");
    const capture = c.req.query(PREVIEW_CAPTURE_PARAM) !== undefined;
    const etag = `"comp:v2:${compPathHash}:${signature}${gsapEtagSalt}${variablesEtagSalt(vars.raw)}${capture ? ":capture" : ""}"`;
    const ifNoneMatch = c.req.header("If-None-Match");
    if (ifNoneMatch === etag) {
      return new Response(null, {
        status: 304,
        headers: previewCacheHeaders(etag),
      });
    }

    const baseHref = previewBaseHref(project.id);
    // A shared project's page can be anything: every pass that parses it runs on the build worker, and the request
    // has one deadline, the host's transform and the media probes included.
    const deadline = performance.now() + (subCompositionDeadlineMs ?? SUB_COMPOSITION_DEADLINE_MS);
    const job = { projectDir: project.dir, compPath, runtimeUrl: adapter.runtimeUrl };
    try {
      const built = await runOffThread(
        { kind: "build", ...job, compFile, baseHref, gsapBaseUrl },
        deadline,
        compPath,
      );
      if (!built) return c.text("not found", 404);
      if ("refused" in built) return c.html(previewRefusalPage(built.refused), 200);
      await recordPreviewReadsOff(project.dir, built.references);
      const transformed = await withinDeadline(
        transformPreviewHtml(built.html, adapter, project, compPath),
        deadline,
        compPath,
      );
      const options = {
        capture,
        gsapBaseUrl,
        sandboxedCapture: sandboxThumbnailCaptures,
        pathFree: await provesNoPathTween(transformed, project.dir, deadline),
      };
      const finish = { kind: "finish" as const, ...job, html: transformed, signature, options };
      const html = await runOffThread(
        { ...finish, ...(previewVariables && { variables: previewVariables }) },
        deadline,
        compPath,
      );
      const probed = injectMediaCodecMap(
        html,
        adapter,
        project.dir,
        compPath,
        mediaCodecProbeCache,
      );
      return c.html(
        await withinDeadline(probed, deadline, compPath),
        200,
        previewCacheHeaders(etag),
      );
    } catch (error) {
      if (error instanceof SubCompositionDeadlineError) return c.text(error.message, 503);
      throw error;
    }
  });

  // Static asset serving (with range request support for audio/video seeking)
  // fallow-ignore-next-line complexity
  api.get("/projects/:id/preview/*", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    const subPath = requestSubPath(c.req.url, "projects/:id/preview");
    // Assets are read-only and should mirror the renderer: permit a path that
    // is lexically inside the project even if an explicit project symlink
    // targets a shared directory outside it. Composition source files still
    // use resolveWithinProject because saves write their data-hf-id values.
    const candidate = resolve(project.dir, subPath);
    const file = isWithinProjectRoot(project.dir, candidate) ? candidate : null;
    if (!file || (await isPrivateProjectFileOff(project.dir, file))) {
      return c.text("not found", 404);
    }
    const recorded = await recordPreviewReadsOff(project.dir, [file]).then(
      () => true,
      () => false,
    );
    if (!recorded) return c.text("not found", 404);
    const stat = await statOrNull(file);
    if (!stat?.isFile()) {
      return c.text("not found", 404);
    }
    const contentType = getMimeType(subPath);
    const isText = /\.(html|css|js|json|svg|txt|md|cube)$/i.test(subPath);

    // `?hf-proxy=` follows the asset's alpha-aware proxy variant. The
    // param value must be recognized (matching play/staticProjectServer),
    // only a video asset can be proxied, and only when auto-proxy is enabled
    // for this adapter/project. Checked BEFORE any transcode or 304 shortcut
    // so a bogus/disabled request never spawns ffmpeg.
    const proxyParam = c.req.query(PREVIEW_PROXY_PARAM);
    const boxParam = c.req.query(PREVIEW_PROXY_BOX_PARAM);
    const proxyBox = boxParam === undefined ? undefined : parsePreviewProxyBox(boxParam);
    const lightRequested = c.req.query(PREVIEW_PROXY_LIGHT_PARAM) !== undefined;
    if (
      proxyBox === null ||
      (proxyBox && proxyParam === undefined) ||
      (lightRequested && !proxyBox)
    ) {
      return c.text("not found", 404);
    }
    let proxyVariant: ProxyVariant | undefined;
    if (proxyParam !== undefined) {
      if (
        !isProxyVariantRequest(proxyParam) ||
        !contentType.startsWith("video/") ||
        !isAutoProxyEnabled(adapter)
      ) {
        return c.text("not found", 404);
      }
      const facts = await probeAssetCodec(file, undefined, mediaCodecProbeCache);
      const eligibility = decideMediaProxyEligibility(facts, lightRequested ? proxyBox : undefined);
      if (!eligibility.eligible) {
        return c.text(`media proxy unavailable: ${eligibility.reason}`, 422);
      }
      if (!facts) return c.text("media proxy unavailable: unknown_codec", 422);
      proxyVariant = resolveProxyVariantRequest(proxyParam, facts) ?? undefined;
      if (!proxyVariant) {
        return c.text("media proxy variant does not match asset", 422);
      }
    }

    // One frame of the video stands in for its copy while that is made; same gate as the copy.
    const stillParam = c.req.query(PREVIEW_PROXY_STILL_PARAM);
    if (stillParam !== undefined) {
      const at = Number(stillParam);
      if (stillParam === "" || !Number.isFinite(at) || at < 0 || !proxyVariant) {
        return c.text("not found", 404);
      }
      try {
        const inSlot = (make: () => Promise<string>) => runStillJob(make, c.req.raw.signal);
        const ask = () => resolveStill(project.dir, file, at, proxyBox, inSlot, c.req.raw.signal);
        const still = await ask().catch((err) =>
          err instanceof JobAbandonedError && !c.req.raw.signal.aborted
            ? ask()
            : Promise.reject(err),
        );
        return new Response(await readFile(still), {
          headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" },
        });
      } catch (err) {
        if (err instanceof JobQueueFullError) {
          return c.text(err.message, 503, { "Retry-After": "5" });
        }
        if (err instanceof StillPastEndError) return c.text("not found", 404);
        if (isProjectRootMissing(err)) throw err;
        return c.text("media still failed", 502);
      }
    }

    const tag = settledFileTag(stat);
    const etag = tag && `"${tag}${proxyEtagSalt(proxyVariant, proxyBox)}"`;
    const cacheHeaders: Record<string, string> = isText
      ? { "Cache-Control": "no-store" }
      : { "Cache-Control": "private, no-cache", ...(etag && { ETag: etag }) };

    if (!isText && etag) {
      const ifNoneMatch = c.req.header("If-None-Match");
      if (ifNoneMatch === etag) {
        return new Response(null, { status: 304, headers: cacheHeaders });
      }
    }

    // Resolve to the cached proxy (transcoding on miss) only after the 404/304
    // shortcuts above — the source's own mtime+size already salts the etag,
    // so a 304 never needs to await a transcode at all.
    let servedPath = file;
    let servedContentType = contentType;
    if (proxyVariant !== undefined) {
      try {
        // A cached copy settles before any timer; a transcode never holds one of
        // the browser's few connections to this host. 202 until the copy lands.
        if (c.req.query(PREVIEW_PROXY_RETRY_PARAM) !== undefined) {
          retryProxyCopy(project.dir, file, proxyVariant, proxyBox);
        }
        const asked = c.req.header(PREVIEW_PROXY_PRIORITY_HEADER);
        const urgency = asked === "0" ? { background: true } : { priority: asked === "1" };
        servedPath = await waitForProxy(
          resolveProxy(project.dir, file, proxyVariant, proxyBox, urgency),
          0,
        );
      } catch (err) {
        if (err instanceof ProxyWaitTimeoutError) {
          const progress = proxyCopyProgress(project.dir, file, proxyVariant, proxyBox);
          return c.text("media proxy is being made", 202, {
            "Retry-After": progress === undefined ? String(PROXY_PENDING_RETRY_AFTER_SECONDS) : "1",
            "Cache-Control": "no-store",
            ...(progress !== undefined && { [PREVIEW_PROXY_PROGRESS_HEADER]: progress.toFixed(3) }),
          });
        }
        if (err instanceof ProxyCapacityError) {
          return c.text(err.message, 503, { "Retry-After": "5" });
        }
        if (isProjectRootMissing(err)) throw err;
        const message = err instanceof ProxyTranscodeError ? err.message : "proxy transcode failed";
        return c.text(message, 502);
      }
      // After the wait, not at the eligibility gate: one count per served proxy shares
      // a unit with `prewarmsRequested`; a 304, a 202 or a failure serves none.
      recordProxyRequest();
      servedContentType = PROXY_VARIANT_CONFIG[proxyVariant].contentType;
    }

    // Text is small and keeps its utf-8 round trip in memory. Binary media
    // streams only the requested window: Chrome refills a playing <video> or
    // <audio> with a fresh Range request every few hundred milliseconds, and a
    // 1KB slice of a multi-hundred-MB source must not readFileSync the whole
    // file on each one. The full read also blocked the event loop, so every
    // other Studio request (SSE, saves, the voice track) waited behind it.
    const textBuffer = isText ? Buffer.from(await readFile(file, "utf-8"), "utf-8") : null;
    const heldBuffer =
      textBuffer ??
      (contentType === "image/png" ? stripSdrPngColourTags(await readFile(file)) : null);
    const totalSize = heldBuffer ? heldBuffer.length : (await statFile(servedPath)).size;
    const bodyFor = (start: number, end: number): BodyInit =>
      heldBuffer
        ? new Uint8Array(heldBuffer.subarray(start, end + 1))
        : // Node's web stream type and the DOM one do not overlap for tsc on
          // every platform's lib set; the double cast is the documented bridge.
          (Readable.toWeb(
            serveWhileOpen(servedPath, createReadStream(servedPath, { start, end })),
          ) as unknown as ReadableStream);

    // Support byte-range requests so browsers can seek audio/video elements.
    const rangeHeader = c.req.header("Range");
    const match = rangeHeader ? /bytes=(\d+)-(\d*)/.exec(rangeHeader) : null;
    if (match) {
      const start = parseInt(match[1]!, 10);
      const end = match[2]
        ? parseInt(match[2], 10)
        : openRangeEnd(start, totalSize - 1, servedContentType);
      const safeEnd = Math.min(end, totalSize - 1);
      if (start > safeEnd) {
        return new Response(null, {
          status: 416,
          headers: { ...cacheHeaders, "Content-Range": `bytes */${totalSize}` },
        });
      }
      return new Response(bodyFor(start, safeEnd), {
        status: 206,
        headers: {
          ...cacheHeaders,
          "Content-Type": servedContentType,
          "Content-Range": `bytes ${start}-${safeEnd}/${totalSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(safeEnd - start + 1),
        },
      });
    }

    return new Response(totalSize > 0 ? bodyFor(0, totalSize - 1) : null, {
      headers: {
        ...cacheHeaders,
        "Content-Type": servedContentType,
        "Accept-Ranges": "bytes",
        "Content-Length": String(totalSize),
      },
    });
  });
}
