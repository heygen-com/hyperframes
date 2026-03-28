import type { Hono } from "hono";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { StudioApiAdapter } from "../types.js";
import { walkDir } from "../helpers/safePath.js";

export function registerLintRoutes(api: Hono, adapter: StudioApiAdapter): void {
  api.get("/projects/:id/lint", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    try {
      const htmlFiles = walkDir(project.dir).filter((f) => f.endsWith(".html"));
      const allFindings: Array<{
        severity: string;
        message: string;
        file?: string;
        fixHint?: string;
      }> = [];
      for (const file of htmlFiles) {
        const content = readFileSync(join(project.dir, file), "utf-8");
        const result = await adapter.lint(content, { filePath: file });
        if (result?.findings) {
          for (const f of result.findings) {
            allFindings.push({ ...f, file });
          }
        }
      }
      return c.json({ findings: allFindings });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: `Lint failed: ${msg}` }, 500);
    }
  });
}
