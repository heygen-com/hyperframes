import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Hono } from "hono";
import type { StudioApiAdapter } from "../types.js";
import { walkDir } from "../helpers/safePath.js";

function isCompositionFile(projectDir: string, relPath: string): boolean {
  if (!relPath.endsWith(".html")) return false;
  try {
    const content = readFileSync(join(projectDir, relPath), "utf-8");
    return content.includes("data-composition-id");
  } catch {
    return false;
  }
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
    const compositions = files.filter((f) => isCompositionFile(project.dir, f));
    return c.json({ id: project.id, dir: project.dir, title: project.title, files, compositions });
  });
}
