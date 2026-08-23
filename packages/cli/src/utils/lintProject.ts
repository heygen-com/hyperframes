// CLI facade: the linter stays reusable without the CLI, while command-specific gates live here.
export { lintProject, shouldBlockRender } from "@hyperframes/lint";
export type { ProjectLintResult } from "@hyperframes/lint";

import type { ProjectLintResult } from "@hyperframes/lint";

export function hasDefinitiveEntryMismatch(result: ProjectLintResult): boolean {
  return result.results.some((entry) =>
    entry.result.findings.some(
      (finding) => finding.code === "blank_root_with_standalone_composition",
    ),
  );
}

export function definitiveEntryMismatchComposition(result: ProjectLintResult): string | undefined {
  for (const entry of result.results) {
    const finding = entry.result.findings.find(
      (candidate) => candidate.code === "blank_root_with_standalone_composition",
    );
    if (finding) return finding.suggestedComposition;
  }
  return undefined;
}
