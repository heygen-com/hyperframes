import { c } from "../ui/colors.js";
import type { ProjectLintResult } from "./lintProject.js";

export interface LintFormatOptions {
  /** Show elementId in brackets after the code (default: true) */
  showElementId?: boolean;
  /** Show summary line with error/warning counts (default: false) */
  showSummary?: boolean;
  /** Group errors before warnings per file (default: false — interleaved) */
  errorsFirst?: boolean;
  /** Include info-level findings in output (default: false — only errors/warnings) */
  verbose?: boolean;
}

/**
 * Format lint findings for console output. Used by lint, render, and preview commands.
 */
export function formatLintFindings(
  { results, totalErrors, totalWarnings, totalInfos }: ProjectLintResult,
  options: LintFormatOptions = {},
): string[] {
  const {
    showElementId = true,
    showSummary = false,
    errorsFirst = false,
    verbose = false,
  } = options;
  const lines: string[] = [];
  const multiFile = results.length > 1;

  for (const { file, result } of results) {
    if (result.findings.length === 0) continue;

    const format = (finding: (typeof result.findings)[0]) => {
      if (!verbose && finding.severity === "info") return;
      const prefix =
        finding.severity === "error"
          ? c.error("✗")
          : finding.severity === "warning"
            ? c.warn("⚠")
            : c.dim("ℹ");
      const fileLabel = multiFile ? c.dim(`[${file}] `) : "";
      const loc =
        showElementId && finding.elementId ? ` ${c.accent(`[${finding.elementId}]`)}` : "";
      lines.push(`  ${prefix} ${fileLabel}${c.bold(finding.code)}${loc}: ${finding.message}`);
      if (finding.fixHint) lines.push(`    ${c.dim(`Fix: ${finding.fixHint}`)}`);
    };

    if (errorsFirst) {
      for (const f of result.findings) if (f.severity === "error") format(f);
      for (const f of result.findings) if (f.severity === "warning") format(f);
      if (verbose) for (const f of result.findings) if (f.severity === "info") format(f);
    } else {
      for (const f of result.findings) format(f);
    }
  }

  if (showSummary) {
    const icon = totalErrors > 0 ? c.error("◇") : c.success("◇");
    lines.push("");
    const summaryParts = [`${totalErrors} error(s)`, `${totalWarnings} warning(s)`];
    if (verbose && totalInfos > 0) summaryParts.push(`${totalInfos} info(s)`);
    lines.push(`${icon}  ${summaryParts.join(", ")}`);
  }

  return lines;
}
