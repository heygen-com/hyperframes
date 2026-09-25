import type { Hono } from "hono";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  injectScriptsIntoHtml,
  insertBeforeCloseTag,
  stripEmbeddedRuntimeScripts,
  type BundleOptions,
} from "@hyperframes/core/compiler";
import { isWithinProjectRoot } from "@hyperframes/parsers/asset-resolution";
import type { ResolvedProject, StudioApiAdapter } from "../types.js";
import { resolveWithinProject } from "../helpers/safePath.js";
import { getMimeType } from "../helpers/mime.js";
import { buildSubCompositionHtml, hasBaseElement } from "../helpers/subComposition.js";
import {
  resolveProjectAndSignature,
  resolveProjectSignature,
} from "../helpers/projectSignature.js";
import {
  createStudioMotionRenderBodyScript,
  STUDIO_MOTION_PATH,
} from "../helpers/studioMotionRenderScript.js";
import { ensureHfIds } from "@hyperframes/parsers/hf-ids";
import { persistHfIdsIfNeeded, stampFileHfIds } from "../helpers/hfIdPersist.js";
import { settledFileTag } from "../helpers/fileVersion.js";
import { isVariablesPayload, VARIABLES_PAYLOAD_ERROR } from "../helpers/variablesPayload.js";
import { injectPreviewVariables } from "../helpers/previewVariables.js";
import {
  resolveProxy,
  ProxyCapacityError,
  ProxyTranscodeError,
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

const PROJECT_SIGNATURE_META = "hyperframes-project-signature";
const GSAP_CDN_VERSION = "3.15.0";
const GSAP_CDN_SCRIPT = `<script src="https://cdn.jsdelivr.net/npm/gsap@${GSAP_CDN_VERSION}/dist/gsap.min.js"></script>`;
const GSAP_CUSTOM_EASE_CDN_SCRIPT = `<script src="https://cdn.jsdelivr.net/npm/gsap@${GSAP_CDN_VERSION}/dist/CustomEase.min.js"></script>`;
const GSAP_MOTION_PATH_CDN_SCRIPT = `<script src="https://cdn.jsdelivr.net/npm/gsap@${GSAP_CDN_VERSION}/dist/MotionPathPlugin.min.js"></script>`;

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

function injectScriptTagIntoHead(html: string, scriptTag: string): string {
  return insertBeforeCloseTag(html, "head", `${scriptTag}\n`) ?? `${scriptTag}\n${html}`;
}

function htmlHasGsap(html: string): boolean {
  // Only match GSAP references outside <template> elements — scripts inside
  // templates are inert when cloned and don't make GSAP globally available.
  const outsideTemplates = html.replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, "");
  return (
    /<script\b[^>]*src=["'][^"']*gsap/i.test(outsideTemplates) ||
    /\/\*\s*inlined:.*gsap/i.test(outsideTemplates) ||
    /\b(GreenSock|_gsScope)\b/.test(outsideTemplates) ||
    /\bgsap\.(config|defaults|registerPlugin|version)\b/.test(outsideTemplates)
  );
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

function injectMotionPathPluginIfNeeded(html: string): string {
  if (!htmlUsesMotionPath(html) || htmlHasMotionPathPlugin(html)) return html;
  // The plugin registers onto an already-loaded gsap, so it must come AFTER the
  // core gsap script — which often lives at body-end, not <head>. Insert it
  // directly after the gsap script tag; only fall back to <head> if none is found
  // (e.g. gsap is inlined).
  const gsapScript = /<script\b[^>]*\bsrc=["'][^"']*\/gsap(\.min)?\.js["'][^>]*>\s*<\/script>/i;
  const match = html.match(gsapScript);
  if (match) {
    // Match the plugin version to the composition's own gsap so the plugin
    // registers cleanly (a minor-version skew triggers a GSAP compatibility warning).
    const version = match[0].match(/gsap@([\d.]+)/)?.[1] ?? GSAP_CDN_VERSION;
    const pluginTag = `<script src="https://cdn.jsdelivr.net/npm/gsap@${version}/dist/MotionPathPlugin.min.js"></script>`;
    const end = html.indexOf(match[0]) + match[0].length;
    return html.slice(0, end) + "\n" + pluginTag + html.slice(end);
  }
  return injectScriptTagIntoHead(html, GSAP_MOTION_PATH_CDN_SCRIPT);
}

function injectStudioMotionDependencies(html: string, manifestContent: string): string {
  const manifest = parseStudioMotionManifestContent(manifestContent);
  if (!manifest.hasMotion) return html;
  let next = html;
  if (!htmlHasGsap(next)) next = injectScriptTagIntoHead(next, GSAP_CDN_SCRIPT);
  if (manifest.hasCustomEase && !htmlHasCustomEase(next)) {
    next = injectScriptTagIntoHead(next, GSAP_CUSTOM_EASE_CDN_SCRIPT);
  }
  return next;
}

function injectStudioMotionScript(
  html: string,
  projectDir: string,
  activeCompositionPath: string,
): string {
  const manifestContent = readStudioMotionManifestContent(projectDir);
  const script = createStudioMotionRenderBodyScript(manifestContent, {
    activeCompositionPath,
  });
  if (!script) return html;
  return injectScriptsIntoHtml(
    injectStudioMotionDependencies(html, manifestContent),
    [],
    [script],
    false,
  );
}

const GSAP_CDN_FALLBACK_SCRIPT = `<script data-hf-gsap-fallback>
(function(){
  var cdnBase="https://cdn.jsdelivr.net/npm/gsap@${GSAP_CDN_VERSION}/dist/";
  var loaded={};
  function loadFallback(file){
    if(loaded[file])return loaded[file];
    return loaded[file]=new Promise(function(ok,fail){
      var s=document.createElement("script");
      s.src=cdnBase+file;s.onload=ok;s.onerror=fail;
      document.head.appendChild(s);
    });
  }
  document.addEventListener("error",function(e){
    var t=e.target;
    if(!t||t.tagName!=="SCRIPT"||!t.src)return;
    var m=t.src.match(/gsap[^/]*\\/dist\\/(.+\\.js)/);
    if(m)loadFallback(m[1]);
  },true);
})();
</script>`;

function injectGsapCdnFallback(html: string): string {
  if (html.includes("data-hf-gsap-fallback")) return html;
  if (html.includes("<head>")) return html.replace("<head>", "<head>" + GSAP_CDN_FALLBACK_SCRIPT);
  return GSAP_CDN_FALLBACK_SCRIPT + html;
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

function injectStudioPreviewAugmentations(
  html: string,
  adapter: StudioApiAdapter,
  projectDir: string,
  activeCompositionPath: string,
): string {
  return injectStudioMotionScript(
    injectMotionPathPluginIfNeeded(
      injectGsapCdnFallback(
        injectProjectSignature(html, resolveProjectSignature(adapter, projectDir)),
      ),
    ),
    projectDir,
    activeCompositionPath,
  );
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
  if (existsSync(indexPath)) {
    return {
      html: readFileSync(indexPath, "utf-8"),
      compositionPath: "index.html",
    };
  }
  const blockHtmlPath = join(projectDir, `${projectId}.html`);
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
} as const satisfies BundleOptions;

export function registerPreviewRoutes(api: Hono, adapter: PreviewApiAdapter): void {
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
  ): Promise<string | null> {
    // Normalize + persist data-hf-id to disk before bundle reads it. Idempotent.
    const diskMain = resolveProjectMainHtml(project.dir, project.id);
    const normalizedDisk = diskMain
      ? persistHfIdsIfNeeded(join(project.dir, diskMain.compositionPath), diskMain.html)
      : null;

    try {
      let bundled = await adapter.bundle(project.dir);
      let mainCompositionPath = "index.html";
      if (!bundled) {
        if (!diskMain) return null;
        // Disk HTML may carry a baked inline runtime from a prior export; strip
        // it so the preview runtime injected below isn't double-loaded (the
        // bundled path already strips via htmlBundler). Idempotent if absent.
        bundled = stripEmbeddedRuntimeScripts(normalizedDisk ?? diskMain.html);
        mainCompositionPath = diskMain.compositionPath;
      }

      // Inject runtime if not already present (check URL pattern and bundler attribute)
      if (
        !bundled.includes("hyperframe.runtime") &&
        !bundled.includes("hyperframes-preview-runtime")
      ) {
        const runtimeTag = `<script src="${adapter.runtimeUrl}"></script>`;
        bundled =
          insertBeforeCloseTag(bundled, "body", `${runtimeTag}\n`) ?? `${bundled}\n${runtimeTag}`;
      }

      // Inject <base> for relative asset resolution
      const baseHref = `/api/projects/${project.id}/preview/`;
      if (!hasBaseElement(bundled)) {
        bundled = bundled.replace(/<head>/i, `<head><base href="${baseHref}">`);
      }

      // ensureHfIds runs after transformPreviewHtml in case the adapter injected
      // new elements. On the no-bundle path bundled=normalizedDisk (already tagged)
      // so this is idempotent. On the bundled path the bundler may return untagged
      // HTML (stale cache); because ids are content-keyed the minted ids will match
      // the ids already written to disk by persistHfIdsIfNeeded above.
      bundled = injectStudioPreviewAugmentations(
        ensureHfIds(await transformPreviewHtml(bundled, adapter, project, mainCompositionPath)),
        adapter,
        project.dir,
        mainCompositionPath,
      );
      if (previewVariables) bundled = injectPreviewVariables(bundled, previewVariables);
      bundled = await injectMediaCodecMap(
        bundled,
        adapter,
        project.dir,
        mainCompositionPath,
        mediaCodecProbeCache,
      );
      rememberPreview(builtKey, bundled);
      adapter.previewDocuments?.write(builtKey, bundled);
      return bundled;
    } catch {
      // Re-read disk on bundle failure so we serve the latest file content,
      // not the pre-request snapshot that may have been saved over.
      const fallback = resolveProjectMainHtml(project.dir, project.id);
      if (fallback) {
        const fallbackHtml = persistHfIdsIfNeeded(
          join(project.dir, fallback.compositionPath),
          fallback.html,
        );
        let fallbackAugmented = injectStudioPreviewAugmentations(
          await transformPreviewHtml(fallbackHtml, adapter, project, fallback.compositionPath),
          adapter,
          project.dir,
          fallback.compositionPath,
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

    const etag = `"preview:${signature}${variablesEtagSalt(vars.raw)}"`;
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
      pending = buildPreview(project, previewVariables, builtKey).finally(() =>
        previewBuilds.delete(builtKey),
      );
      previewBuilds.set(builtKey, pending);
    }
    const html = await pending;
    if (!html) return c.text("not found", 404);
    return c.html(html, 200, previewCacheHeaders(etag));
  });

  /**
   * Pin hf-ids to the RAW sub-comp file before the build pipeline mutates
   * attributes (rewriteRelativePaths etc.) — minting is content-keyed over
   * attrs, so stamping only AFTER the rewrite mints preview-only ids that
   * exist nowhere in the source. Pinned ids ride through the rewrite
   * unchanged, keeping the served DOM, the disk file, and the studio SDK
   * session in one id space. Mirrors the main-preview route's
   * persistHfIdsIfNeeded call.
   *
   * Gated to composition files: the wildcard route serves any project path,
   * and stamping a non-HTML file (SVG, etc.) would corrupt it on disk.
   *
   * Returns the stamped content to thread into the build (so served ids match
   * the mint even when the disk write is skipped — read-only fs), undefined
   * for non-HTML paths, or null when the file vanished after the caller's
   * stat. stampFileHfIds does its validation, read, and write through one
   * file descriptor, so there is no check/read/write path gap to race.
   */
  function pinSubCompHfIds(compFile: string, compPath: string): string | undefined | null {
    if (!/\.html?$/i.test(compPath)) return undefined;
    return stampFileHfIds(compFile);
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
    if (!compFile || !existsSync(compFile) || !statSync(compFile).isFile()) {
      return c.text("not found", 404);
    }

    // "v2" salts the etag for the hf-id-pinning change below: a client holding
    // a pre-pin cached response (preview-only ids, unstamped disk file) must
    // not revalidate to a 304 that skips the pin.
    const compPathHash = createHash("sha1").update(compPath).digest("hex");
    const etag = `"comp:v2:${compPathHash}:${signature}${variablesEtagSalt(vars.raw)}"`;
    const ifNoneMatch = c.req.header("If-None-Match");
    if (ifNoneMatch === etag) {
      return new Response(null, {
        status: 304,
        headers: previewCacheHeaders(etag),
      });
    }

    const stamped = pinSubCompHfIds(compFile, compPath);
    if (stamped === null) return c.text("not found", 404); // file removed between stat and read

    const baseHref = `/api/projects/${project.id}/preview/`;
    let html = buildSubCompositionHtml(
      project.dir,
      compPath,
      adapter.runtimeUrl,
      baseHref,
      stamped,
    );
    if (!html) return c.text("not found", 404);
    html = ensureHfIds(await transformPreviewHtml(html, adapter, project, compPath));
    html = injectStudioPreviewAugmentations(html, adapter, project.dir, compPath);
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
    // use resolveWithinProject because preview mutates their data-hf-id values.
    const candidate = resolve(project.dir, subPath);
    const file = isWithinProjectRoot(project.dir, candidate) ? candidate : null;
    if (!file) {
      return c.text("not found", 404);
    }
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
    let proxyVariant: ProxyVariant | undefined;
    if (proxyParam !== undefined) {
      if (
        !isProxyVariantRequest(proxyParam) ||
        !contentType.startsWith("video/") ||
        !isAutoProxyEnabled(adapter)
      ) {
        return c.text("not found", 404);
      }
      const facts = await probeAssetCodec(file);
      const eligibility = decideMediaProxyEligibility(facts);
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
    const etag = tag && `"${tag}${proxyEtagSalt(proxyVariant)}"`;
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
      // Here, not at the eligibility gate above: one count per resolved proxy
      // shares a unit with `prewarmsRequested`, and a revalidated repeat that
      // 304s no longer counts as fresh demand.
      recordProxyRequest();
      try {
        servedPath = await resolveProxy(project.dir, file, proxyVariant);
      } catch (err) {
        if (err instanceof ProxyCapacityError) {
          return c.text(err.message, 503, { "Retry-After": "5" });
        }
        const message = err instanceof ProxyTranscodeError ? err.message : "proxy transcode failed";
        return c.text(message, 502);
      }
      servedContentType = PROXY_VARIANT_CONFIG[proxyVariant].contentType;
    }

    // Text is small and keeps its utf-8 round trip in memory. Binary media
    // streams only the requested window: Chrome refills a playing <video> or
    // <audio> with a fresh Range request every few hundred milliseconds, and a
    // 1KB slice of a multi-hundred-MB source must not readFileSync the whole
    // file on each one. The full read also blocked the event loop, so every
    // other Studio request (SSE, saves, the voice track) waited behind it.
    const textBuffer = isText ? Buffer.from(readFileSync(file, "utf-8"), "utf-8") : null;
    const totalSize = textBuffer ? textBuffer.length : statSync(servedPath).size;
    const bodyFor = (start: number, end: number): BodyInit =>
      textBuffer
        ? new Uint8Array(textBuffer.subarray(start, end + 1))
        : // Node's web stream type and the DOM one do not overlap for tsc on
          // every platform's lib set; the double cast is the documented bridge.
          (Readable.toWeb(
            createReadStream(servedPath, { start, end }),
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
