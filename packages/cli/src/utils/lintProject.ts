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
