import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerLintRoutes } from "./lint";
import type { StudioApiAdapter } from "../types";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Project layout for #1384: one real composition plus vendored example HTML
// inside a dot-directory that must not inflate the lint findings.
function createProjectDir(): string {
  const projectDir = mkdtempSync(join(tmpdir(), "hf-lint-test-"));
  tempDirs.push(projectDir);
  writeFileSync(join(projectDir, "index.html"), "<html><body>real</body></html>");
  mkdirSync(join(projectDir, ".hyperframes"));
  writeFileSync(join(projectDir, ".hyperframes", "preset.html"), "<html><body>junk</body></html>");
  return projectDir;
}

// Every linted file reports one finding, so the response reveals exactly
// which files were linted.
function createAdapter(projectDir: string): StudioApiAdapter {
  return {
    listProjects: () => [],
    resolveProject: async (id: string) => ({ id, dir: projectDir }),
    bundle: async () => null,
    lint: async () => ({ findings: [{ severity: "warning", message: "finding" }] }),
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

describe("registerLintRoutes — dot-directory exclusion (#1384)", () => {
  it("does not lint HTML inside dot-directories", async () => {
    const projectDir = createProjectDir();
    const app = new Hono();
    registerLintRoutes(app, createAdapter(projectDir));

    const response = await app.request("http://localhost/projects/demo/lint");
    const payload = (await response.json()) as { findings?: Array<{ file?: string }> };

    expect(response.status).toBe(200);
    const lintedFiles = (payload.findings ?? []).map((f) => f.file);
    expect(lintedFiles).toContain("index.html");
    expect(lintedFiles).not.toContain(".hyperframes/preset.html");
  });
});
