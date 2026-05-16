import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerFileRoutes } from "./files";
import type { StudioApiAdapter } from "../types";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createProjectDir(): string {
  const projectDir = mkdtempSync(join(tmpdir(), "hf-files-test-"));
  tempDirs.push(projectDir);
  writeFileSync(join(projectDir, "index.html"), "<html><body>Preview</body></html>");
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

describe("registerFileRoutes", () => {
  it("returns empty content for missing files when caller marks the read optional", async () => {
    const projectDir = createProjectDir();
    const app = new Hono();
    registerFileRoutes(app, createAdapter(projectDir));

    const response = await app.request(
      "http://localhost/projects/demo/files/missing-file.txt?optional=1",
    );
    const payload = (await response.json()) as { filename?: string; content?: string };

    expect(response.status).toBe(200);
    expect(payload.filename).toBe("missing-file.txt");
    expect(payload.content).toBe("");
  });

  it("still returns 404 for other missing files", async () => {
    const projectDir = createProjectDir();
    const app = new Hono();
    registerFileRoutes(app, createAdapter(projectDir));

    const response = await app.request("http://localhost/projects/demo/files/missing-file.txt");

    expect(response.status).toBe(404);
  });
});
