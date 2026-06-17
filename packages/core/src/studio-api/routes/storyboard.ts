import { existsSync, readFileSync } from "node:fs";
import type { Hono } from "hono";
import type { StudioApiAdapter } from "../types.js";
import { resolveWithinProject } from "../helpers/safePath.js";
import {
  parseStoryboard,
  SCRIPT_FILENAME,
  STORYBOARD_FILENAME,
  type StoryboardFrame,
} from "../../storyboard/index.js";

/** A frame enriched with disk-resolution info the Studio needs to render tiles. */
interface ResolvedStoryboardFrame extends StoryboardFrame {
  /** Whether `src` resolves to an existing file inside the project. */
  srcExists: boolean;
}

function resolveFrames(projectDir: string, frames: StoryboardFrame[]): ResolvedStoryboardFrame[] {
  return frames.map((frame) => {
    let srcExists = false;
    if (frame.src) {
      const abs = resolveWithinProject(projectDir, frame.src);
      srcExists = abs ? existsSync(abs) : false;
    }
    return { ...frame, srcExists };
  });
}

/** Read the companion SCRIPT.md narration doc if it exists alongside the storyboard. */
function readScript(projectDir: string): { exists: boolean; path: string; content: string } {
  const abs = resolveWithinProject(projectDir, SCRIPT_FILENAME);
  if (abs && existsSync(abs)) {
    try {
      return { exists: true, path: SCRIPT_FILENAME, content: readFileSync(abs, "utf-8") };
    } catch {
      /* fall through to absent */
    }
  }
  return { exists: false, path: SCRIPT_FILENAME, content: "" };
}

export function registerStoryboardRoutes(api: Hono, adapter: StudioApiAdapter): void {
  // Parsed storyboard manifest for a project. Markdown (STORYBOARD.md) stays
  // canonical on disk; this returns the derived, normalized structure. When the
  // file is absent we return `exists: false` with empty frames rather than 404,
  // so the Studio can render an opt-in empty state.
  api.get("/projects/:id/storyboard", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);

    const abs = resolveWithinProject(project.dir, STORYBOARD_FILENAME);
    if (!abs || !existsSync(abs)) {
      return c.json({
        exists: false,
        path: STORYBOARD_FILENAME,
        globals: { extra: {} },
        frames: [],
        warnings: [],
        script: readScript(project.dir),
      });
    }

    let source: string;
    try {
      source = readFileSync(abs, "utf-8");
    } catch {
      return c.json({ error: "failed to read storyboard" }, 500);
    }

    const manifest = parseStoryboard(source);
    return c.json({
      exists: true,
      path: STORYBOARD_FILENAME,
      globals: manifest.globals,
      frames: resolveFrames(project.dir, manifest.frames),
      warnings: manifest.warnings,
      script: readScript(project.dir),
    });
  });
}
