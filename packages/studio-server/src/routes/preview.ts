import type { Hono } from "hono";
import { parseHTML } from "linkedom";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { stripSdrPngColourTags } from "@hyperframes/core/compiler/png-colour-tags";
import { Readable } from "node:stream";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  AFTER_FONTS_SCRIPT_TYPE,
  addScenePartsManifest,
  RUNTIME_BOOTSTRAP_ATTR,
  insertBeforeCloseTag,
  insertRuntimeTag,
  stripEmbeddedRuntimeScripts,
  type BundleOptions,
} from "@hyperframes/core/compiler";
import {
  STUDIO_PREVIEW_CAPTURE_MODE,
  STUDIO_PREVIEW_MARK_META,
  STUDIO_PREVIEW_ERRORS,
} from "@hyperframes/core/studio-preview-mark";
import {
  PREVIEW_PROXY_BOX_PARAM,
  PREVIEW_PROXY_LIGHT_PARAM,
  PREVIEW_PROXY_PRIORITY_HEADER,
  PREVIEW_PROXY_PROGRESS_HEADER,
  PREVIEW_PROXY_RETRY_PARAM,
  parsePreviewProxyBox,
} from "@hyperframes/core";
import {
  GSAP_BASE_URL_META,
  gsapCdnDist,
  motionPathPluginUrl,
  normalizeGsapBaseUrl,
  normalizeGsapLocalRoot,
} from "@hyperframes/core/gsap-cdn";
import { findStartTags, injectTagsAtHeadStart } from "@hyperframes/core/compiler/html-document";
import { isWithinProjectRoot } from "@hyperframes/parsers/asset-resolution";
import type { ResolvedProject, StudioApiAdapter } from "../types.js";
import {
  isPrivateProjectFile,
  isProjectRootMissing,
  resolveWithinProject,
} from "../helpers/safePath.js";
import { getMimeType } from "../helpers/mime.js";
import { serveWhileOpen } from "../helpers/servedFiles.js";
import { buildSubCompositionHtml, hasBaseElement } from "../helpers/subComposition.js";
import { withRootImportMap } from "../helpers/rootImportMap.js";
import { withRootPathsRelative } from "../helpers/rootPaths.js";
import {
  htmlHasGsapCore,
  insertGsapCoreBeforeHeadPlugin,
  isGsapCoreUrl,
} from "../helpers/gsapCoreScript.js";
import {
  createProjectSignature,
  resolveProjectAndSignature,
  resolveProjectSignature,
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
  recordPreviewReferences,
} from "../helpers/previewReads.js";
import { isVariablesPayload, VARIABLES_PAYLOAD_ERROR } from "../helpers/variablesPayload.js";
import { injectPreviewVariables } from "../helpers/previewVariables.js";
import {
  proxyCopyProgress,
  resolveProxy,
  retryProxyCopy,
  waitForProxy,
  ProxyCapacityError,
  ProxyTranscodeError,
  ProxyWaitTimeoutError,
  PROXY_PENDING_RETRY_AFTER_SECONDS,
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
import { lazyPreviewImages } from "../helpers/lazyPreviewImages.js";

const PROJECT_SIGNATURE_META = "hyperframes-project-signature";
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

/** Swaps any runtime already in the page for the preview runtime, placed as the bundler places it. */
function withPreviewRuntime(html: string, runtimeUrl: string): string {
  const tag = `<script ${RUNTIME_BOOTSTRAP_ATTR}="1" src="${runtimeUrl}"></script>`;
  return insertRuntimeTag(stripEmbeddedRuntimeScripts(html), tag);
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
  return /motionPath\s*[:{]/.test(html);
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
  var cdnBase=${JSON.stringify(gsapCdnDist(undefined, baseUrl)).replace(/</g, "\\u003c")};
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
    if(!t||t.tagName!=="SCRIPT"||!t.src||t.hfGsapFallback)return;
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

// Studio's console capture attaches at the iframe's load; this keeps what was raised before it.
const EARLY_ERRORS_SCRIPT = `<script>(function(){var seen=window.${STUDIO_PREVIEW_ERRORS}=[];
addEventListener("error",function(e){seen.push(e.message||String(e))});})();</script>`;

function injectStudioPreviewAugmentations(
  html: string,
  adapter: StudioApiAdapter,
  projectDir: string,
  activeCompositionPath: string,
  options: { capture: boolean; gsapBaseUrl: string },
): string {
  const marked = options.capture
    ? injectTagsAtHeadStart(
        html,
        `<meta name="${STUDIO_PREVIEW_MARK_META}" content="${STUDIO_PREVIEW_CAPTURE_MODE}">`,
      )
    : injectTagsAtHeadStart(
        lazyPreviewImages(html),
        `<meta name="${STUDIO_PREVIEW_MARK_META}">${EARLY_ERRORS_SCRIPT}`,
      );
  const withFallback = injectGsapCdnFallback(
    injectProjectSignature(
      injectTagsAtHeadStart(
        marked,
        `<meta name="${GSAP_BASE_URL_META}" content="${escapeGsapUrl(options.gsapBaseUrl)}">`,
      ),
      resolveProjectSignature(adapter, projectDir),
    ),
    options.gsapBaseUrl,
  );
  const studioMotion = readStudioMotion(projectDir, activeCompositionPath);
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
  if (existsSync(indexPath)) {
    return {
      html: readFileSync(indexPath, "utf-8"),
      compositionPath: "index.html",
    };
  }
  if (existsSync(blockHtmlPath)) {
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

const withPreviewBase = (html: string, projectId: string) => {
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

export function registerPreviewRoutes(api: Hono, adapter: PreviewApiAdapter): void {
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
      let bundled = await adapter.bundle(project.dir, {
        stampHfIds: true,
        onRead: (filePath) => recordPreviewRead(project.dir, filePath),
      });
      let mainCompositionPath = "index.html";
      if (!bundled) {
        if (!diskMain) return null;
        bundled = ensureHfIds(diskMain.html);
        mainCompositionPath = diskMain.compositionPath;
      }
      // <base> and root paths under it, before the runtime adds the server's own root path
      bundled = withPreviewRuntime(withPreviewBase(bundled, project.id), adapter.runtimeUrl);
      recordPreviewReferences(project.dir, bundled);
      recordPreviewBuilt(project.dir);

      // Also covers elements the adapter injected; ids already present are kept.
      bundled = injectStudioPreviewAugmentations(
        ensureHfIds(await transformPreviewHtml(bundled, adapter, project, mainCompositionPath)),
        adapter,
        project.dir,
        mainCompositionPath,
        { capture, gsapBaseUrl },
      );
      if (previewVariables) bundled = injectPreviewVariables(bundled, previewVariables);
      bundled = await injectMediaCodecMap(
        bundled,
        adapter,
        project.dir,
        mainCompositionPath,
        mediaCodecProbeCache,
      );
      bundled = addScenePartsManifest(bundled, [`meta[name="${PROJECT_SIGNATURE_META}"]`]);
      if (createProjectSignature(project.dir) === signature) {
        rememberPreview(builtKey, bundled);
        if (!capture) adapter.previewDocuments?.write(builtKey, bundled);
      }
      return bundled;
    } catch {
      // Re-read disk on bundle failure so we serve the latest file content,
      // not the pre-request snapshot that may have been saved over.
      const fallback = resolveProjectMainHtml(project.dir, project.id);
      if (fallback) {
        const fallbackHtml = withPreviewRuntime(
          withPreviewBase(ensureHfIds(fallback.html), project.id),
          adapter.runtimeUrl,
        );
        let fallbackAugmented = injectStudioPreviewAugmentations(
          await transformPreviewHtml(fallbackHtml, adapter, project, fallback.compositionPath),
          adapter,
          project.dir,
          fallback.compositionPath,
          { capture, gsapBaseUrl },
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

  /** Ids minted from the raw file before the build rewrites attributes, so they match the source's;
   * in memory only, since a write here reaches the watcher as an outside edit. null: the file vanished. */
  function pinSubCompHfIds(compFile: string, compPath: string): string | undefined | null {
    if (!/\.html?$/i.test(compPath)) return undefined;
    try {
      return ensureHfIds(readFileSync(compFile, "utf-8"));
    } catch {
      return null;
    }
  }

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
    const compPath = requestSubPath(c.req.url, "projects/:id/preview/comp");
    const compFile = resolveWithinProject(project.dir, compPath);
    if (compFile) recordPreviewRead(project.dir, compFile);
    // The sub-composition document takes its head from the root.
    recordPreviewRead(project.dir, "index.html");
    if (!compFile || !existsSync(compFile) || !statSync(compFile).isFile()) {
      return c.text("not found", 404);
    }

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

    const stamped = pinSubCompHfIds(compFile, compPath);
    if (stamped === null) return c.text("not found", 404); // file removed between stat and read

    const baseHref = previewBaseHref(project.id);
    let html = buildSubCompositionHtml(
      project.dir,
      compPath,
      adapter.runtimeUrl,
      baseHref,
      stamped,
      gsapBaseUrl,
    );
    if (!html) return c.text("not found", 404);
    html = withRootImportMap(html, baseHref);
    recordPreviewReferences(project.dir, html);
    html = ensureHfIds(await transformPreviewHtml(html, adapter, project, compPath));
    html = injectStudioPreviewAugmentations(html, adapter, project.dir, compPath, {
      capture,
      gsapBaseUrl,
    });
    if (previewVariables) html = injectPreviewVariables(html, previewVariables);
    html = await injectMediaCodecMap(html, adapter, project.dir, compPath, mediaCodecProbeCache);
    return c.html(html, 200, previewCacheHeaders(etag));
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
    if (!file || isPrivateProjectFile(project.dir, file)) {
      return c.text("not found", 404);
    }
    recordPreviewRead(project.dir, file);
    const stat = existsSync(file) ? statSync(file) : null;
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
    const proxyParam = c.req.query("hf-proxy");
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
        const priority = c.req.header(PREVIEW_PROXY_PRIORITY_HEADER) === "1";
        servedPath = await waitForProxy(
          resolveProxy(project.dir, file, proxyVariant, proxyBox, { priority }),
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
    const textBuffer = isText ? Buffer.from(readFileSync(file, "utf-8"), "utf-8") : null;
    const heldBuffer =
      textBuffer ??
      (contentType === "image/png" ? stripSdrPngColourTags(readFileSync(file)) : null);
    const totalSize = heldBuffer ? heldBuffer.length : statSync(servedPath).size;
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
      const end = match[2] ? parseInt(match[2], 10) : totalSize - 1;
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
