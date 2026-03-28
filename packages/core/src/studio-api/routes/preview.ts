import type { Hono } from "hono";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { StudioApiAdapter } from "../types.js";
import { isSafePath } from "../helpers/safePath.js";
import { getMimeType } from "../helpers/mime.js";
import { buildSubCompositionHtml } from "../helpers/subComposition.js";

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

      return c.html(bundled);
    } catch {
      const file = resolve(project.dir, "index.html");
      if (existsSync(file)) return c.html(readFileSync(file, "utf-8"));
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
    return c.html(html);
  });

  // Static asset serving
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
    const content = readFileSync(file, isText ? "utf-8" : undefined);
    return new Response(content, {
      headers: { "Content-Type": contentType },
    });
  });
}
