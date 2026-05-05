import type { Hono } from "hono";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { StudioApiAdapter } from "../types.js";
import { isSafePath } from "../helpers/safePath.js";
import { getMimeType } from "../helpers/mime.js";
import { buildSubCompositionHtml } from "../helpers/subComposition.js";
import { createProjectSignature } from "../helpers/projectSignature.js";

const PROJECT_SIGNATURE_META = "hyperframes-project-signature";

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

export function registerPreviewRoutes(api: Hono, adapter: StudioApiAdapter): void {
  // Bundled composition preview
  api.get("/projects/:id/preview", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);

    try {
      let bundled = await adapter.bundle(project.dir);
      if (!bundled) {
        const indexPath = resolve(project.dir, "index.html");
        if (!existsSync(indexPath)) return c.text("not found", 404);
        bundled = readFileSync(indexPath, "utf-8");
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

      bundled = injectProjectSignature(bundled, resolveProjectSignature(adapter, project.dir));
      return c.html(bundled);
    } catch {
      const file = resolve(project.dir, "index.html");
      if (existsSync(file)) {
        return c.html(
          injectProjectSignature(
            readFileSync(file, "utf-8"),
            resolveProjectSignature(adapter, project.dir),
          ),
        );
      }
      return c.text("not found", 404);
    }
  });

  // Sub-composition preview
  api.get("/projects/:id/preview/comp/*", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
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
    const baseHref = `/api/projects/${project.id}/preview/`;
    const html = buildSubCompositionHtml(project.dir, compPath, adapter.runtimeUrl, baseHref);
    if (!html) return c.text("not found", 404);
    return c.html(injectProjectSignature(html, resolveProjectSignature(adapter, project.dir)));
  });

  // Static asset serving (with range request support for audio/video seeking)
  api.get("/projects/:id/preview/*", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    const subPath = decodeURIComponent(
      c.req.path.replace(`/projects/${project.id}/preview/`, "").split("?")[0] ?? "",
    );
    const file = resolve(project.dir, subPath);
    if (!isSafePath(project.dir, file) || !existsSync(file) || !statSync(file).isFile()) {
      return c.text("not found", 404);
    }
    const contentType = getMimeType(subPath);
    const isText = /\.(html|css|js|json|svg|txt|md)$/i.test(subPath);
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
        "Content-Type": contentType,
        "Accept-Ranges": "bytes",
        "Content-Length": String(totalSize),
      },
    });
  });
}
