import type { Hono } from "hono";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import type { StudioApiAdapter } from "../types.js";
import { isSafePath } from "../helpers/safePath.js";

export function registerFileRoutes(api: Hono, adapter: StudioApiAdapter): void {
  // Read file content
  api.get("/projects/:id/files/*", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    const filePath = decodeURIComponent(c.req.path.replace(`/projects/${project.id}/files/`, ""));
    const file = resolve(project.dir, filePath);
    if (!isSafePath(project.dir, file) || !existsSync(file)) {
      return c.text("not found", 404);
    }
    const content = readFileSync(file, "utf-8");
    return c.json({ filename: filePath, content });
  });

  // Write file content
  api.put("/projects/:id/files/*", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    const filePath = decodeURIComponent(c.req.path.replace(`/projects/${project.id}/files/`, ""));
    const file = resolve(project.dir, filePath);
    if (!isSafePath(project.dir, file)) {
      return c.json({ error: "forbidden" }, 403);
    }
    const dir = dirname(file);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const body = await c.req.text();
    writeFileSync(file, body, "utf-8");
    return c.json({ ok: true });
  });
}
