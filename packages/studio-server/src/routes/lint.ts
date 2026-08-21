import type { Hono } from "hono";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LintResult, StudioApiAdapter } from "../types.js";
import { isInHiddenOrVendorDir, walkDir } from "../helpers/safePath.js";

type LintFinding = LintResult["findings"][number];

async function collectProjectFindings(
  adapter: StudioApiAdapter,
  projectDir: string,
): Promise<{ findings: LintFinding[]; coveredFiles: Set<string> }> {
  const findings: LintFinding[] = [];
  const coveredFiles = new Set<string>();
  if (!adapter.lintProject) return { findings, coveredFiles };

  const result = await adapter.lintProject(projectDir);
  for (const entry of result.results) {
    coveredFiles.add(entry.file);
    for (const finding of entry.result.findings) {
      findings.push({ ...finding, file: entry.file });
    }
  }
  return { findings, coveredFiles };
}

async function lintUncoveredHtml(
  adapter: StudioApiAdapter,
  projectDir: string,
  htmlFiles: string[],
  coveredFiles: Set<string>,
): Promise<LintFinding[]> {
  const findings: LintFinding[] = [];
  for (const file of htmlFiles) {
    if (coveredFiles.has(file)) continue;
    const content = readFileSync(join(projectDir, file), "utf-8");
    const result = await adapter.lint(content, { filePath: file });
    for (const finding of result?.findings ?? []) {
      findings.push({ ...finding, file });
    }
  }
  return findings;
}

export function registerLintRoutes(api: Hono, adapter: StudioApiAdapter): void {
  api.get("/projects/:id/lint", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    try {
      const htmlFiles = walkDir(project.dir).filter(
        (f) => f.endsWith(".html") && !isInHiddenOrVendorDir(f),
      );
      const projectLint = await collectProjectFindings(adapter, project.dir);
      const extraFindings = await lintUncoveredHtml(
        adapter,
        project.dir,
        htmlFiles,
        projectLint.coveredFiles,
      );
      return c.json({ findings: [...projectLint.findings, ...extraFindings] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: `Lint failed: ${msg}` }, 500);
    }
  });
}
