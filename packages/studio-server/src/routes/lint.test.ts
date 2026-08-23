import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("returns project-level findings instead of re-linting files independently", async () => {
    const projectDir = createProjectDir();
    const singleFileLint = vi.fn(async () => ({ findings: [] }));
    const projectLint = vi.fn(async () => ({
      results: [
        {
          file: "index.html",
          result: {
            findings: [
              {
                code: "blank_root_with_standalone_composition",
                severity: "error",
                message: "The default entry is blank.",
                file: join(projectDir, "index.html"),
              },
            ],
          },
        },
      ],
    }));
    const adapter = {
      ...createAdapter(projectDir),
      lint: singleFileLint,
      lintProject: projectLint,
    };
    const app = new Hono();
    registerLintRoutes(app, adapter);

    const response = await app.request("http://localhost/projects/demo/lint");
    const payload = (await response.json()) as {
      findings?: Array<{ code?: string; file?: string }>;
    };

    expect(response.status).toBe(200);
    expect(projectLint).toHaveBeenCalledWith(projectDir);
    expect(singleFileLint).not.toHaveBeenCalled();
    expect(payload.findings).toContainEqual(
      expect.objectContaining({
        code: "blank_root_with_standalone_composition",
        file: "index.html",
      }),
    );
  });

  it("unions project lint with HTML files outside the canonical project graph", async () => {
    const projectDir = createProjectDir();
    const scenesDir = join(projectDir, "scenes");
    mkdirSync(scenesDir);
    writeFileSync(join(scenesDir, "intro.html"), "<html><body>intro</body></html>");
    const singleFileLint = vi.fn(async () => ({
      findings: [
        {
          code: "scene_finding",
          severity: "warning",
          message: "Scene finding.",
          file: join(projectDir, "scenes", "intro.html"),
        },
      ],
    }));
    const projectLint = vi.fn(async () => ({
      results: [
        {
          file: "index.html",
          result: { findings: [] },
        },
      ],
    }));
    const app = new Hono();
    registerLintRoutes(app, {
      ...createAdapter(projectDir),
      lint: singleFileLint,
      lintProject: projectLint,
    });

    const response = await app.request("http://localhost/projects/demo/lint");
    const payload = (await response.json()) as {
      findings?: Array<{ code?: string; file?: string }>;
    };

    expect(singleFileLint).toHaveBeenCalledTimes(1);
    expect(singleFileLint).toHaveBeenCalledWith("<html><body>intro</body></html>", {
      filePath: "scenes/intro.html",
    });
    expect(payload.findings).toContainEqual(
      expect.objectContaining({ code: "scene_finding", file: "scenes/intro.html" }),
    );
  });
});
