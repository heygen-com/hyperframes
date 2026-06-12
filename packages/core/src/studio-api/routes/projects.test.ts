import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerProjectRoutes } from "./projects";
import type { StudioApiAdapter } from "../types";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const COMPOSITION_HTML = '<html><body><div data-composition-id="main"></div></body></html>';

// Project layout for #1384: real compositions at the root and under
// compositions/, plus vendored example HTML inside dot-directories that
// must not surface as compositions.
function createProjectDir(): string {
  const projectDir = mkdtempSync(join(tmpdir(), "hf-projects-test-"));
  tempDirs.push(projectDir);
  writeFileSync(join(projectDir, "index.html"), COMPOSITION_HTML);
  mkdirSync(join(projectDir, "compositions"));
  writeFileSync(join(projectDir, "compositions", "scene.html"), COMPOSITION_HTML);
  mkdirSync(join(projectDir, ".hyperframes", "examples"), { recursive: true });
  writeFileSync(join(projectDir, ".hyperframes", "examples", "preset.html"), COMPOSITION_HTML);
  return projectDir;
}

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
  };
}

describe("registerProjectRoutes — composition discovery (#1384)", () => {
  it("excludes HTML inside dot-directories from compositions", async () => {
    const projectDir = createProjectDir();
    const app = new Hono();
    registerProjectRoutes(app, createAdapter(projectDir));

    const response = await app.request("http://localhost/projects/demo");
    const payload = (await response.json()) as { compositions?: string[] };

    expect(response.status).toBe(200);
    expect(payload.compositions).toContain("index.html");
    expect(payload.compositions).toContain("compositions/scene.html");
    expect(payload.compositions).not.toContain(".hyperframes/examples/preset.html");
  });

  it("keeps dot-directory files visible in the file tree", async () => {
    const projectDir = createProjectDir();
    const app = new Hono();
    registerProjectRoutes(app, createAdapter(projectDir));

    const response = await app.request("http://localhost/projects/demo");
    const payload = (await response.json()) as { files?: string[] };

    expect(payload.files).toContain(".hyperframes/examples/preset.html");
  });
});
