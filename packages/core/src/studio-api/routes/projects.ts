import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Hono } from "hono";
import type { StudioApiAdapter } from "../types.js";
import { isInHiddenOrVendorDir, walkDir } from "../helpers/safePath.js";

const COMPOSITION_ID_RE = /data-composition-id\s*=/;

async function filterCompositionFiles(projectDir: string, files: string[]): Promise<string[]> {
  const htmlFiles = files.filter((f) => f.endsWith(".html") && !isInHiddenOrVendorDir(f));
  const checks = await Promise.all(
    htmlFiles.map(async (f) => {
      try {
        const content = await readFile(join(projectDir, f), "utf-8");
        return COMPOSITION_ID_RE.test(content);
      } catch {
        return false;
      }
    }),
  );
  return htmlFiles.filter((_, i) => checks[i]);
}

export function registerProjectRoutes(api: Hono, adapter: StudioApiAdapter): void {
  // List all projects
  api.get("/projects", async (c) => {
    const projects = await adapter.listProjects();
    return c.json({ projects });
  });

  // Resolve session to project (multi-project mode)
  api.get("/resolve-session/:sessionId", async (c) => {
    if (!adapter.resolveSession) {
      return c.json({ error: "not available" }, 404);
    }
    const { sessionId } = c.req.param();
    const result = await adapter.resolveSession(sessionId);
    if (!result) return c.json({ error: "Session not found" }, 404);
    return c.json(result);
  });

  // Project file tree
  api.get("/projects/:id", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    const files = walkDir(project.dir);
    const compositions = await filterCompositionFiles(project.dir, files);
    return c.json({ id: project.id, dir: project.dir, title: project.title, files, compositions });
  });
}
