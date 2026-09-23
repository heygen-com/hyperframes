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
    lines.push(`${icon}  ${formatLintCounts(totalErrors, totalWarnings, totalInfos, verbose)}`);
  }

  return lines;
}

function formatLintCounts(
  totalErrors: number,
  totalWarnings: number,
  totalInfos: number,
  verbose: boolean,
): string {
  const parts = [`${totalErrors} error(s)`, `${totalWarnings} warning(s)`];
  if (verbose && totalInfos > 0) parts.push(`${totalInfos} info(s)`);
  return parts.join(", ");
}

/** Full findings in verbose mode, a one-line summary otherwise. `pointer` (summary
 * mode) picks the hint: "cli" names --lint-verbose, "studio" also names the lint
 * command, since preview's stdout may be read by an agent. */
export type LintMessageMode =
  | { kind: "verbose"; options?: LintFormatOptions }
  | { kind: "summary"; pointer?: "cli" | "studio" };

export function formatLintStartupMessage(
  lintResult: ProjectLintResult,
  mode: LintMessageMode,
): string[] {
  if (mode.kind === "verbose") return formatLintFindings(lintResult, mode.options);
  const counts = formatLintCounts(lintResult.totalErrors, lintResult.totalWarnings, 0, false);
  const hint =
    mode.pointer === "studio"
      ? "see the Lint badge in Studio, or run `hyperframes lint` for full output"
      : "run with --lint-verbose for full output";
  return [`  Lint: ${counts} — ${hint}.`];
}
