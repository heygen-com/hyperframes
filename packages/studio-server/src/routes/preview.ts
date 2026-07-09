import type { Hono } from "hono";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { injectScriptsIntoHtml, stripEmbeddedRuntimeScripts } from "@hyperframes/core/compiler";
import { classifyAnimationRuntime, type AnimationRuntimeEngine } from "@hyperframes/parsers";
import type { StudioApiAdapter } from "../types.js";
import { resolveWithinProject } from "../helpers/safePath.js";
import { getMimeType } from "../helpers/mime.js";
import { buildSubCompositionHtml } from "../helpers/subComposition.js";
import { createProjectSignature } from "../helpers/projectSignature.js";
import {
  createStudioMotionRenderBodyScript,
  STUDIO_MOTION_PATH,
} from "../helpers/studioMotionRenderScript.js";
import { ensureHfIds } from "@hyperframes/parsers/hf-ids";
import { persistHfIdsIfNeeded, stampFileHfIds } from "../helpers/hfIdPersist.js";

const PROJECT_SIGNATURE_META = "hyperframes-project-signature";
const GSAP_CDN_VERSION = "3.15.0";
const GSAP_CDN_SCRIPT = `<script src="https://cdn.jsdelivr.net/npm/gsap@${GSAP_CDN_VERSION}/dist/gsap.min.js"></script>`;
const GSAP_CUSTOM_EASE_CDN_SCRIPT = `<script src="https://cdn.jsdelivr.net/npm/gsap@${GSAP_CDN_VERSION}/dist/CustomEase.min.js"></script>`;
const GSAP_MOTION_PATH_CDN_SCRIPT = `<script src="https://cdn.jsdelivr.net/npm/gsap@${GSAP_CDN_VERSION}/dist/MotionPathPlugin.min.js"></script>`;

let animeCdnScriptPromise: Promise<string> | null = null;

function loadAnimeCdnScript(): Promise<string> {
  animeCdnScriptPromise ??= import("@hyperframes/core").then(
    ({ ANIME_CDN }) => `<script src="${ANIME_CDN}"></script>`,
  );
  return animeCdnScriptPromise;
}

function resolveProjectSignature(adapter: StudioApiAdapter, projectDir: string): string {
  return adapter.getProjectSignature?.(projectDir) ?? createProjectSignature(projectDir);
}

function injectProjectSignature(html: string, signature: string): string {
  const tag = `<meta name="${PROJECT_SIGNATURE_META}" content="${signature}">`;
  if (html.includes(`name="${PROJECT_SIGNATURE_META}"`)) {
    return html.replace(
      new RegExp(`<meta\\s+name=["']${PROJECT_SIGNATURE_META}["'][^>]*>`, "i"),
      tag,
    );
  }
  if (html.includes("</head>")) return html.replace("</head>", `${tag}\n</head>`);
  return `${tag}\n${html}`;
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

interface StudioMotionManifestSummary {
  hasMotion: boolean;
  hasGsapMotion: boolean;
  hasAnimeMotion: boolean;
  hasCustomEase: boolean;
}

function parseStudioMotionManifestContent(content: string): StudioMotionManifestSummary {
  const empty = {
    hasMotion: false,
    hasGsapMotion: false,
    hasAnimeMotion: false,
    hasCustomEase: false,
  };
  try {
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== "object") return empty;
    const rawMotions = Reflect.get(parsed, "motions");
    const motions = Array.isArray(rawMotions) ? rawMotions : [];
    const isMotionKind = (motion: unknown, kind: string): boolean =>
      Boolean(motion && typeof motion === "object" && Reflect.get(motion, "kind") === kind);
    const motionHasCustomEase = (motion: unknown): boolean =>
      Boolean(motion && typeof motion === "object" && Reflect.get(motion, "customEase"));
    const hasGsapMotion = motions.some((motion) => isMotionKind(motion, "gsap-motion"));
    const hasAnimeMotion = motions.some((motion) => isMotionKind(motion, "anime-motion"));
    return {
      hasMotion: motions.length > 0,
      hasGsapMotion,
      hasAnimeMotion,
      hasCustomEase: hasGsapMotion && motions.some(motionHasCustomEase),
    };
  } catch {
    return empty;
  }
}

function injectScriptTagIntoHead(html: string, scriptTag: string): string {
  if (html.includes("</head>")) return html.replace("</head>", `${scriptTag}\n</head>`);
  return `${scriptTag}\n${html}`;
}

function htmlOutsideTemplates(html: string): string {
  return html.replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, "");
}

function classificationIncludesEngine(html: string, engine: AnimationRuntimeEngine): boolean {
  const verdict = classifyAnimationRuntime(html).verdict;
  return verdict === engine || verdict === "mixed";
}

function htmlHasRuntimeScript(html: string, runtime: "gsap" | "anime"): boolean {
  const outsideTemplates = htmlOutsideTemplates(html);
  return (
    new RegExp(`<script\\b[^>]*src=["'][^"']*${runtime}`, "i").test(outsideTemplates) ||
    new RegExp(`/\\*\\s*inlined:.*${runtime}`, "i").test(outsideTemplates)
  );
}

function htmlHasGsapRuntime(html: string): boolean {
  const outsideTemplates = htmlOutsideTemplates(html);
  return (
    htmlHasRuntimeScript(html, "gsap") ||
    classificationIncludesEngine(html, "gsap") ||
    /\b(GreenSock|_gsScope)\b/.test(outsideTemplates) ||
    /\bgsap\.(config|defaults|registerPlugin|version)\b/.test(outsideTemplates)
  );
}

function htmlHasAnimeRuntime(html: string): boolean {
  return htmlHasRuntimeScript(html, "anime") || classificationIncludesEngine(html, "animejs");
}

async function injectAnimeCdnIfNeeded(html: string): Promise<string> {
  if (!htmlHasAnimeRuntime(html) || htmlHasRuntimeScript(html, "anime")) return html;
  return injectScriptTagIntoHead(html, await loadAnimeCdnScript());
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

async function injectStudioMotionDependencies(
  html: string,
  manifestContent: string,
  manifest = parseStudioMotionManifestContent(manifestContent),
): Promise<string> {
  if (!manifest.hasMotion) return html;
  let next = html;
  if (manifest.hasGsapMotion && !htmlHasGsapRuntime(next)) {
    next = injectScriptTagIntoHead(next, GSAP_CDN_SCRIPT);
  }
  if (manifest.hasCustomEase && !htmlHasCustomEase(next)) {
    next = injectScriptTagIntoHead(next, GSAP_CUSTOM_EASE_CDN_SCRIPT);
  }
  if (manifest.hasAnimeMotion && !htmlHasAnimeRuntime(next)) {
    next = injectScriptTagIntoHead(next, await loadAnimeCdnScript());
  }
  return next;
}

async function injectStudioMotionScript(
  html: string,
  projectDir: string,
  activeCompositionPath: string,
  manifestContent = readStudioMotionManifestContent(projectDir),
  manifest = parseStudioMotionManifestContent(manifestContent),
): Promise<string> {
  const script = createStudioMotionRenderBodyScript(manifestContent, {
    activeCompositionPath,
  });
  if (!script) return html;
  return injectScriptsIntoHtml(
    await injectStudioMotionDependencies(html, manifestContent, manifest),
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

async function injectStudioPreviewAugmentations(
  html: string,
  adapter: StudioApiAdapter,
  projectDir: string,
  activeCompositionPath: string,
): Promise<string> {
  const manifestContent = readStudioMotionManifestContent(projectDir);
  const manifest = parseStudioMotionManifestContent(manifestContent);
  const withSignature = injectProjectSignature(html, resolveProjectSignature(adapter, projectDir));
  const needsGsapRuntime = htmlHasGsapRuntime(withSignature) || manifest.hasGsapMotion;
  const withGsapFallback = needsGsapRuntime ? injectGsapCdnFallback(withSignature) : withSignature;
  const withMotionPath = needsGsapRuntime
    ? injectMotionPathPluginIfNeeded(withGsapFallback)
    : withGsapFallback;
  const withStudioMotion = await injectStudioMotionScript(
    withMotionPath,
    projectDir,
    activeCompositionPath,
    manifestContent,
    manifest,
  );
  return injectAnimeCdnIfNeeded(withStudioMotion);
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
    return { html: readFileSync(indexPath, "utf-8"), compositionPath: "index.html" };
  }
  const blockHtmlPath = join(projectDir, `${projectId}.html`);
  if (existsSync(blockHtmlPath)) {
    return { html: readFileSync(blockHtmlPath, "utf-8"), compositionPath: `${projectId}.html` };
  }
  return null;
}

export function registerPreviewRoutes(api: Hono, adapter: StudioApiAdapter): void {
  const previewCacheHeaders = (etag: string) => ({
    "Cache-Control": "private, no-cache",
    ETag: etag,
  });

  // Bundled composition preview
  // fallow-ignore-next-line code-duplication
  // fallow-ignore-next-line complexity
  api.get("/projects/:id/preview", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);

    const signature = resolveProjectSignature(adapter, project.dir);
    const etag = `"preview:${signature}"`;
    const ifNoneMatch = c.req.header("If-None-Match");
    if (ifNoneMatch === etag) {
      return new Response(null, { status: 304, headers: previewCacheHeaders(etag) });
    }

    // Normalize + persist data-hf-id to disk before bundle reads it. Idempotent.
    const diskMain = resolveProjectMainHtml(project.dir, project.id);
    const normalizedDisk = diskMain
      ? persistHfIdsIfNeeded(join(project.dir, diskMain.compositionPath), diskMain.html)
      : null;

    try {
      let bundled = await adapter.bundle(project.dir);
      let mainCompositionPath = "index.html";
      if (!bundled) {
        if (!diskMain) return c.text("not found", 404);
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
        bundled = bundled.includes("</body>")
          ? bundled.replace("</body>", `${runtimeTag}\n</body>`)
          : bundled + `\n${runtimeTag}`;
      }

      // Inject <base> for relative asset resolution
      const baseHref = `/api/projects/${project.id}/preview/`;
      if (!bundled.includes("<base")) {
        bundled = bundled.replace(/<head>/i, `<head><base href="${baseHref}">`);
      }

      // ensureHfIds runs after transformPreviewHtml in case the adapter injected
      // new elements. On the no-bundle path bundled=normalizedDisk (already tagged)
      // so this is idempotent. On the bundled path the bundler may return untagged
      // HTML (stale cache); because ids are content-keyed the minted ids will match
      // the ids already written to disk by persistHfIdsIfNeeded above.
      bundled = await injectStudioPreviewAugmentations(
        ensureHfIds(await transformPreviewHtml(bundled, adapter, project, mainCompositionPath)),
        adapter,
        project.dir,
        mainCompositionPath,
      );
      return c.html(bundled, 200, previewCacheHeaders(etag));
    } catch {
      // Re-read disk on bundle failure so we serve the latest file content,
      // not the pre-request snapshot that may have been saved over.
      const fallback = resolveProjectMainHtml(project.dir, project.id);
      if (fallback) {
        const fallbackHtml = persistHfIdsIfNeeded(
          join(project.dir, fallback.compositionPath),
          fallback.html,
        );
        return c.html(
          await injectStudioPreviewAugmentations(
            await transformPreviewHtml(fallbackHtml, adapter, project, fallback.compositionPath),
            adapter,
            project.dir,
            fallback.compositionPath,
          ),
          200,
          previewCacheHeaders(etag),
        );
      }
      return c.text("not found", 404);
    }
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
  // fallow-ignore-next-line code-duplication
  api.get("/projects/:id/preview/comp/*", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);

    const signature = resolveProjectSignature(adapter, project.dir);
    const compPath = decodeURIComponent(
      c.req.path.replace(`/projects/${project.id}/preview/comp/`, "").split("?")[0] ?? "",
    );
    const compFile = resolveWithinProject(project.dir, compPath);
    if (!compFile || !existsSync(compFile) || !statSync(compFile).isFile()) {
      return c.text("not found", 404);
    }

    // "v2" salts the etag for the hf-id-pinning change below: a client holding
    // a pre-pin cached response (preview-only ids, unstamped disk file) must
    // not revalidate to a 304 that skips the pin.
    const etag = `"comp:v2:${compPath}:${signature}"`;
    const ifNoneMatch = c.req.header("If-None-Match");
    if (ifNoneMatch === etag) {
      return new Response(null, { status: 304, headers: previewCacheHeaders(etag) });
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
    return c.html(
      await injectStudioPreviewAugmentations(html, adapter, project.dir, compPath),
      200,
      previewCacheHeaders(etag),
    );
  });

  // Static asset serving (with range request support for audio/video seeking)
  // fallow-ignore-next-line complexity
  api.get("/projects/:id/preview/*", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    const subPath = decodeURIComponent(
      c.req.path.replace(`/projects/${project.id}/preview/`, "").split("?")[0] ?? "",
    );
    const file = resolveWithinProject(project.dir, subPath);
    if (!file) {
      return c.text("not found", 404);
    }
    const stat = existsSync(file) ? statSync(file) : null;
    if (!stat?.isFile()) {
      return c.text("not found", 404);
    }
    const contentType = getMimeType(subPath);
    const isText = /\.(html|css|js|json|svg|txt|md|cube)$/i.test(subPath);

    const etag = `"${stat.mtimeMs.toString(36)}-${stat.size.toString(36)}"`;
    const cacheHeaders: Record<string, string> = isText
      ? { "Cache-Control": "no-store" }
      : { "Cache-Control": "private, max-age=3600, must-revalidate", ETag: etag };

    if (!isText) {
      const ifNoneMatch = c.req.header("If-None-Match");
      if (ifNoneMatch === etag) {
        return new Response(null, { status: 304, headers: cacheHeaders });
      }
    }

    const buffer: Buffer = isText
      ? Buffer.from(readFileSync(file, "utf-8"), "utf-8")
      : readFileSync(file);
    const totalSize = buffer.length;

    // Support byte-range requests so browsers can seek audio/video elements.
    const rangeHeader = c.req.header("Range");
    if (rangeHeader) {
      const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
      if (match) {
        const start = parseInt(match[1]!, 10);
        const end = match[2] ? parseInt(match[2], 10) : totalSize - 1;
        const safeEnd = Math.min(end, totalSize - 1);
        const chunkSize = safeEnd - start + 1;
        return new Response(new Uint8Array(buffer.slice(start, safeEnd + 1)), {
          status: 206,
          headers: {
            ...cacheHeaders,
            "Content-Type": contentType,
            "Content-Range": `bytes ${start}-${safeEnd}/${totalSize}`,
            "Accept-Ranges": "bytes",
            "Content-Length": String(chunkSize),
          },
        });
      }
    }

    return new Response(new Uint8Array(buffer), {
      headers: {
        ...cacheHeaders,
        "Content-Type": contentType,
        "Accept-Ranges": "bytes",
        "Content-Length": String(totalSize),
      },
    });
  });
}
