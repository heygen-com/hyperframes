import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { lintHyperframeHtml, type HyperframeLintResult } from "@hyperframes/core/lint";
import type { ProjectDir } from "./project.js";

export interface ProjectLintResult {
  results: Array<{ file: string; result: HyperframeLintResult }>;
  totalErrors: number;
  totalWarnings: number;
  totalInfos: number;
}

/**
 * Lint the root index.html and all sub-compositions in the compositions/ directory.
 * Returns aggregated results across all files.
 */
export function lintProject(project: ProjectDir): ProjectLintResult {
  const results: Array<{ file: string; result: HyperframeLintResult }> = [];
  let totalErrors = 0;
  let totalWarnings = 0;
  let totalInfos = 0;

  // Lint root composition
  const rootHtml = readFileSync(project.indexPath, "utf-8");
  const rootResult = lintHyperframeHtml(rootHtml, { filePath: project.indexPath });
  results.push({ file: "index.html", result: rootResult });
  totalErrors += rootResult.errorCount;
  totalWarnings += rootResult.warningCount;
  totalInfos += rootResult.infoCount;

  // Lint sub-compositions in compositions/ directory
  const compositionsDir = resolve(project.dir, "compositions");
  if (existsSync(compositionsDir)) {
    const files = readdirSync(compositionsDir).filter((f) => f.endsWith(".html"));
    for (const file of files) {
      const filePath = join(compositionsDir, file);
      const html = readFileSync(filePath, "utf-8");
      const result = lintHyperframeHtml(html, { filePath });
      results.push({ file: `compositions/${file}`, result });
      totalErrors += result.errorCount;
      totalWarnings += result.warningCount;
      totalInfos += result.infoCount;
    }
  }

  return { results, totalErrors, totalWarnings, totalInfos };
}

/**
 * Determine whether a render should be blocked based on lint results and strict mode.
 * --strict blocks on errors; --strict-all blocks on errors or warnings.
 */
export function shouldBlockRender(
  strictErrors: boolean,
  strictAll: boolean,
  totalErrors: number,
  totalWarnings: number,
): boolean {
  return (strictErrors && totalErrors > 0) || (strictAll && (totalErrors > 0 || totalWarnings > 0));
}
