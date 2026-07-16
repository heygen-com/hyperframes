import type { Hono } from "hono";
import { existsSync } from "node:fs";
import type { StudioApiAdapter } from "../types.js";
import { resolveWithinProject } from "../helpers/safePath.js";
import { runCarve } from "../vstCarve.js";

const INSTALL_HINT = "Install the VST host: uv tool install hyperframes-vst-host (requires uv)";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

interface CarveRequestBody {
  projectId: string;
  musicPath: string;
  voicePath: string;
  maxCutDb: number;
}

/** Narrows an unknown JSON body to the shape `/vst/carve` needs, or `null` if malformed. */
function parseCarveRequestBody(body: unknown): CarveRequestBody | null {
  if (!isRecord(body)) return null;
  const { projectId, musicPath, voicePath, maxCutDb } = body;
  if (
    typeof projectId !== "string" ||
    typeof musicPath !== "string" ||
    typeof voicePath !== "string" ||
    typeof maxCutDb !== "number"
  ) {
    return null;
  }
  return { projectId, musicPath, voicePath, maxCutDb };
}

/** Resolves a project-relative path and confirms the file exists on disk, or `null`. */
function resolveExistingProjectFile(projectDir: string, subPath: string): string | null {
  const file = resolveWithinProject(projectDir, subPath);
  return file && existsSync(file) ? file : null;
}

export function registerVstRoutes(api: Hono, adapter: StudioApiAdapter): void {
  /**
   * The VST sidecar is a native Python process on the same host as this
   * server — it reads audio via pedalboard's `AudioFile`, which needs a
   * real filesystem path, not the `/preview/*` HTTP URL the browser plays
   * the dry `<audio>` element from. This resolves a project-relative asset
   * path (the part of that URL after `/preview/`) to its absolute path on
   * disk, the same way the `/preview/*` static route does, so a client that
   * already has a working playback URL can hand the sidecar something it
   * can actually open.
   */
  api.get("/vst/wav-path", async (c) => {
    const projectId = c.req.query("projectId");
    const subPath = c.req.query("path");
    if (!projectId || !subPath) {
      return c.json({ error: "projectId and path query params required" }, 400);
    }
    const project = await adapter.resolveProject(projectId);
    if (!project) return c.json({ error: "not found" }, 404);
    const file = resolveWithinProject(project.dir, subPath);
    if (!file || !existsSync(file)) return c.json({ error: "not found" }, 404);
    return c.json({ path: file });
  });

  /**
   * Analyze a voiceover track and return complementary PeakFilter carve bands
   * for a music track (the "vocal pocket"). Both paths are project-relative
   * (same shape as `/vst/wav-path`'s `path`), resolved against the project dir
   * here so no absolute paths cross the wire. V1 only analyzes the voice; the
   * music path is validated-to-exist for symmetry and future dynamic ducking.
   */
  api.post("/vst/carve", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const parsed = parseCarveRequestBody(body);
    if (!parsed) {
      return c.json({ error: "projectId, musicPath, voicePath, maxCutDb required" }, 400);
    }
    const { projectId, musicPath, voicePath, maxCutDb } = parsed;
    const project = await adapter.resolveProject(projectId);
    if (!project) return c.json({ error: "not found" }, 404);
    const musicFile = resolveExistingProjectFile(project.dir, musicPath);
    const voiceFile = resolveExistingProjectFile(project.dir, voicePath);
    if (!musicFile || !voiceFile) return c.json({ error: "not found" }, 404);
    try {
      const { bands } = await runCarve(voiceFile, maxCutDb);
      return c.json({ bands });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  api.post("/vst/start", async (c) => {
    if (!adapter.startVstSidecar) {
      return c.json(
        { error: "VST host not available in this studio mode", installHint: INSTALL_HINT },
        503,
      );
    }
    try {
      const { port, token } = await adapter.startVstSidecar();
      return c.json({ port, token });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message, installHint: INSTALL_HINT }, 503);
    }
  });

  api.get("/vst/status", (c) => {
    if (!adapter.getVstSidecarStatus) {
      return c.json({ running: false, port: null });
    }
    return c.json(adapter.getVstSidecarStatus());
  });
}
