import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerFileRoutes } from "./files.js";
import type { StudioApiAdapter } from "../types.js";

/**
 * Pins the path-resolution contract of the project-file read that Studio's SDK
 * session depends on. If this route fails, `openComposition` never runs and
 * every edit in that project silently falls back to the server path.
 *
 * The shapes here are the ones that looked most likely to break it, because
 * `resolveProjectPath` strips a prefix built from the *decoded* `project.id`
 * out of `c.req.path`, and the CLI derives that id straight from the folder
 * name (`projectId = projectName || basename(projectDir)`). A folder named with
 * a space or non-ASCII character therefore produces an id that percent-encodes,
 * and sub-compositions — the house pattern, one per scene — put a separator in
 * the file path that encodes as %2F.
 *
 * All of them pass today: Hono hands `c.req.path` over already decoded. These
 * are regression tests, not a reproduction — they were written while hunting a
 * production failure (`stage: read`) that turned out to be something else, and
 * they are kept because the decoded/encoded seam is a real latent hazard that a
 * refactor of `resolveProjectPath` could reopen silently.
 */
function createAdapter(projectDir: string): StudioApiAdapter {
  return {
    listProjects: () => [],
    resolveProject: async (id: string) => ({ id, dir: projectDir }),
    bundle: async () => null,
    lint: async () => ({ findings: [] }),
    runtimeUrl: "/api/runtime.js",
    rendersDir: () => "/tmp/renders",
    startRender: () => ({
      id: "job-1",
      status: "rendering",
      progress: 0,
      outputPath: "/tmp/out.mp4",
    }),
  } as unknown as StudioApiAdapter;
}

function projectWithComposition(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "hf-projectid-"));
  writeFileSync(join(dir, "index.html"), "<html><body>COMPOSITION</body></html>");
  mkdirSync(join(dir, "scenes"), { recursive: true });
  writeFileSync(join(dir, "scenes", "scene-1.html"), "<html><body>SCENE ONE</body></html>");
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

async function readComposition(projectId: string, compPath = "index.html") {
  const { dir, cleanup } = projectWithComposition();
  try {
    const app = new Hono();
    registerFileRoutes(app, createAdapter(dir));
    const url = `http://localhost/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(compPath)}?optional=1`;
    const response = await app.request(url);
    const body = (await response.json()) as { content?: string };
    return { status: response.status, content: body.content };
  } finally {
    cleanup();
  }
}

describe("project ids that percent-encode in a URL", () => {
  it("serves a composition from a plain ASCII project id", async () => {
    const result = await readComposition("demo-project");
    expect(result.status).toBe(200);
    expect(result.content).toContain("COMPOSITION");
  });

  it("serves a composition when the project folder name has a space", async () => {
    const result = await readComposition("my video");
    expect(result.status).toBe(200);
    expect(result.content).toContain("COMPOSITION");
  });

  it("serves a composition when the project folder name is non-ASCII", async () => {
    const result = await readComposition("用故事板做视频");
    expect(result.status).toBe(200);
    expect(result.content).toContain("COMPOSITION");
  });

  // Sub-compositions are the house pattern — one per scene — so the active
  // composition is very often in a subdirectory. encodeURIComponent turns the
  // separator into %2F, which is what the client sends.
  it("serves a sub-composition in a subdirectory", async () => {
    const result = await readComposition("demo-project", "scenes/scene-1.html");
    expect(result.status).toBe(200);
    expect(result.content).toContain("SCENE ONE");
  });
});
