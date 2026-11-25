import type { Hono } from "hono";
import type { StudioApiAdapter } from "../types.js";
import { isPrivateProjectPath, walkDir } from "../helpers/safePath.js";
import { isCompositionPath } from "../helpers/hfIdPersist.js";
import { runOffThread } from "../helpers/subCompositionBuild.js";
import { resolveProjectSignature } from "../helpers/projectSignature.js";

const WHOLE_SCAN_LIMIT_MS = 30_000;
const PAGE_IN_PROGRESS_GRACE_MS = 5_000;

async function compositionFiles(
  projectDir: string,
  files: string[],
): Promise<string[] | undefined> {
  const htmlFiles = files.filter(isCompositionPath);
  if (htmlFiles.length === 0) return [];
  const job = {
    kind: "compositions" as const,
    projectDir,
    files: htmlFiles,
    leaveUncheckedAfterMs: WHOLE_SCAN_LIMIT_MS,
  };
  const deadline = performance.now() + WHOLE_SCAN_LIMIT_MS + PAGE_IN_PROGRESS_GRACE_MS;
  const listing = `[hyperframes] listing ${projectDir}: the compositions are left out of this answer,`;
  try {
    const { compositions, unchecked } = await runOffThread(job, deadline, projectDir);
    if (unchecked === 0) return compositions;
    console.warn(`${listing} ${unchecked} of ${htmlFiles.length} HTML files were not read in time`);
  } catch (error) {
    console.warn(`${listing} the scan did not end:`, error);
  }
  return undefined;
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

  // Current content signature for a project: a cheap poll target for clients that refresh when files change on disk.
  api.get("/projects/:id/signature", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    return c.json({ signature: await resolveProjectSignature(adapter, project.dir) });
  });

  // Project file tree
  api.get("/projects/:id", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    const files = walkDir(project.dir).filter((file) => !isPrivateProjectPath(file));
    const compositions = await compositionFiles(project.dir, files);
    return c.json({ id: project.id, dir: project.dir, title: project.title, files, compositions });
  });
}
