import type { Hono } from "hono";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { injectScriptsIntoHtml } from "../../compiler/htmlDocument.js";
import type { StudioApiAdapter } from "../types.js";
import { isSafePath } from "../helpers/safePath.js";
import { getMimeType } from "../helpers/mime.js";
import { buildSubCompositionHtml } from "../helpers/subComposition.js";
import { createProjectSignature } from "../helpers/projectSignature.js";
import {
  createStudioMotionRenderBodyScript,
  STUDIO_MOTION_PATH,
} from "../helpers/studioMotionRenderScript.js";
import { ensureHfIds } from "../../parsers/hfIds.js";
import { persistHfIdsIfNeeded } from "../helpers/hfIdPersist.js";

const PROJECT_SIGNATURE_META = "hyperframes-project-signature";
const GSAP_CDN_VERSION = "3.15.0";
const GSAP_CDN_SCRIPT = `<script src="https://cdn.jsdelivr.net/npm/gsap@${GSAP_CDN_VERSION}/dist/gsap.min.js"></script>`;
const GSAP_CUSTOM_EASE_CDN_SCRIPT = `<script src="https://cdn.jsdelivr.net/npm/gsap@${GSAP_CDN_VERSION}/dist/CustomEase.min.js"></script>`;

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

function parseStudioMotionManifestContent(content: string): {
  hasMotion: boolean;
  hasCustomEase: boolean;
} {
  try {
    const parsed = JSON.parse(content) as { motions?: Array<{ customEase?: unknown }> };
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
  if (html.includes("</head>")) return html.replace("</head>", `${scriptTag}\n</head>`);
  return `${scriptTag}\n${html}`;
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

function injectStudioPreviewAugmentations(
  html: string,
  adapter: StudioApiAdapter,
  projectDir: string,
  activeCompositionPath: string,
): string {
  return injectStudioMotionScript(
    injectGsapCdnFallback(
      injectProjectSignature(html, resolveProjectSignature(adapter, projectDir)),
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
        bundled = normalizedDisk ?? diskMain.html;
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
      bundled = injectStudioPreviewAugmentations(
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
          injectStudioPreviewAugmentations(
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

  // Sub-composition preview
  api.get("/projects/:id/preview/comp/*", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);

    const signature = resolveProjectSignature(adapter, project.dir);
    const compPath = decodeURIComponent(
      c.req.path.replace(`/projects/${project.id}/preview/comp/`, "").split("?")[0] ?? "",
    );
    const compFile = resolve(project.dir, compPath);
    if (
      !isSafePath(project.dir, compFile) ||
      !existsSync(compFile) ||
      !statSync(compFile).isFile()
    ) {
      return c.text("not found", 404);
    }

    const etag = `"comp:${compPath}:${signature}"`;
    const ifNoneMatch = c.req.header("If-None-Match");
    if (ifNoneMatch === etag) {
      return new Response(null, { status: 304, headers: previewCacheHeaders(etag) });
    }

    const baseHref = `/api/projects/${project.id}/preview/`;
    let html = buildSubCompositionHtml(project.dir, compPath, adapter.runtimeUrl, baseHref);
    if (!html) return c.text("not found", 404);
    html = ensureHfIds(await transformPreviewHtml(html, adapter, project, compPath));
    return c.html(
      injectStudioPreviewAugmentations(html, adapter, project.dir, compPath),
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
    const file = resolve(project.dir, subPath);
    const stat = existsSync(file) ? statSync(file) : null;
    if (!isSafePath(project.dir, file) || !stat?.isFile()) {
      return c.text("not found", 404);
    }
    const contentType = getMimeType(subPath);
    const isText = /\.(html|css|js|json|svg|txt|md)$/i.test(subPath);

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
