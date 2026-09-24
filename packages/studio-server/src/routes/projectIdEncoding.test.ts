import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerFileRoutes } from "./files.js";
import { registerPreviewRoutes } from "./preview.js";
import type { StudioApiAdapter } from "../types.js";

// Project ids come from folder names, so any character a folder allows must survive the URL.
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

// A Home sentence with an @ mention names the project; Hono leaves %40 %25 %23 %26 %3F encoded in c.req.path.
const RESERVED_NAMES = [
  "A @HyperFrames launch",
  "50% off",
  "#2 take",
  "Tom & Jerry",
  "why?",
  "two  spaces",
  "café crème",
  "🎬 film",
];

async function requestProject(projectId: string, route: string, subPath: string) {
  const { dir, cleanup } = projectWithComposition();
  try {
    const app = new Hono();
    registerFileRoutes(app, createAdapter(dir));
    registerPreviewRoutes(app, createAdapter(dir));
    const encodedSubPath = subPath.split("/").map(encodeURIComponent).join("/");
    const response = await app.request(
      `http://localhost/projects/${encodeURIComponent(projectId)}/${route}/${encodedSubPath}`,
    );
    return { status: response.status, text: await response.text() };
  } finally {
    cleanup();
  }
}

describe.each(RESERVED_NAMES)("project id %j", (projectId) => {
  it("reads a project file", async () => {
    const result = await readComposition(projectId, "scenes/scene-1.html");
    expect(result.status).toBe(200);
    expect(result.content).toContain("SCENE ONE");
  });

  it("serves a preview asset", async () => {
    const result = await requestProject(projectId, "preview", "scenes/scene-1.html");
    expect(result.status).toBe(200);
    expect(result.text).toContain("SCENE ONE");
  });

  it("serves a preview sub-composition", async () => {
    const result = await requestProject(projectId, "preview/comp", "scenes/scene-1.html");
    expect(result.status).toBe(200);
    expect(result.text).toContain("SCENE ONE");
  });
});
