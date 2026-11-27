import type { Hono } from "hono";
import type { StudioApiAdapter } from "../types.js";
import { isPrivateProjectPath, walkDir } from "../helpers/safePath.js";
import { isCompositionPath } from "../helpers/hfIdPersist.js";
import { runOffThread } from "../helpers/subCompositionBuild.js";
import { resolveProjectSignature } from "../helpers/projectSignature.js";

const WHOLE_SCAN_LIMIT_MS = 30_000;
const PAGE_IN_PROGRESS_GRACE_MS = 5_000;

type OneReadingOfAProject = Promise<{ files: string[]; compositions: string[] | undefined }>;

async function scan(projectDir: string, files: string[]): OneReadingOfAProject {
  const htmlFiles = files.filter(isCompositionPath);
  if (htmlFiles.length === 0) return { files, compositions: [] };
  const job = {
    kind: "compositions" as const,
    projectDir,
    files: htmlFiles,
    keptBackForPageInProgressMs: PAGE_IN_PROGRESS_GRACE_MS,
  };
  const deadline = performance.now() + WHOLE_SCAN_LIMIT_MS + PAGE_IN_PROGRESS_GRACE_MS;
  const listing = `[hyperframes] listing ${projectDir}: the compositions are left out of this answer,`;
  try {
    const { compositions, unchecked } = await runOffThread(job, deadline, projectDir);
    if (unchecked === 0) return { files, compositions };
    console.warn(`${listing} ${unchecked} of ${htmlFiles.length} HTML files were not read in time`);
  } catch (error) {
    console.warn(`${listing} the scan did not end:`, error);
  }
  return { files, compositions: undefined };
}

const scans = new Map<
  string,
  { last: OneReadingOfAProject; waiting?: { files: string[]; answer: OneReadingOfAProject } }
>();

/** A project folder has one scan with the worker and at most one waiting behind it. Every listing that arrives
 * meanwhile shares the waiting one and its answer: the files the latest of them saw, and the compositions among those. */
function listingOf(projectDir: string, files: string[]): OneReadingOfAProject {
  const now = scans.get(projectDir);
  if (now?.waiting) {
    now.waiting.files = files;
    return now.waiting.answer;
  }
  const start = (seen: string[]): OneReadingOfAProject => {
    const answer = scan(projectDir, seen).finally(() => {
      if (scans.get(projectDir)?.last === answer) scans.delete(projectDir);
    });
    scans.set(projectDir, { last: answer });
    return answer;
  };
  if (!now) return start(files);
  const waiting: { files: string[]; answer: OneReadingOfAProject } = {
    files,
    answer: now.last.then(() => start(waiting.files)),
  };
  now.waiting = waiting;
  return waiting.answer;
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
    const seen = walkDir(project.dir).filter((file) => !isPrivateProjectPath(file));
    const { files, compositions } = await listingOf(project.dir, seen);
    return c.json({ id: project.id, dir: project.dir, title: project.title, files, compositions });
  });
}
