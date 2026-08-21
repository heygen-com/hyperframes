// One place that turns a ProjectLintResult into telemetry, so `lint` and
// `check` report identically instead of drifting apart.

import { LINT_RULE_COUNT, LINT_RULE_GROUP_COUNTS, type ProjectLintResult } from "@hyperframes/lint";
import { trackLintReport, trackLintRuleStreak } from "./events.js";
import { recordLintRun } from "./lintStreaks.js";

/**
 * Report one lint pass: aggregate counts and timings, plus any finding that
 * survived an edit to its file.
 *
 * Never throws — a telemetry failure must not fail the command that lints.
 */
export function trackLintRun(
  projectDir: string,
  lintResult: ProjectLintResult,
  options: { command: string; durationMs: number; runId?: string },
): void {
  try {
    const runIdField = options.runId !== undefined ? { runId: options.runId } : {};

    trackLintReport({
      command: options.command,
      durationMs: options.durationMs,
      filesScanned: lintResult.results.length,
      errorCount: lintResult.totalErrors,
      warningCount: lintResult.totalWarnings,
      infoCount: lintResult.totalInfos,
      ruleCount: LINT_RULE_COUNT,
      ruleGroupCounts: LINT_RULE_GROUP_COUNTS,
      ...summarize(lintResult),
      ...runIdField,
    });

    const streaks = recordLintRun(
      projectDir,
      lintResult.results.map(({ file, contentHash, result }) => ({
        file,
        contentHash,
        findings: result.findings,
      })),
    );
    for (const streak of streaks) {
      trackLintRuleStreak({ ...streak, command: options.command, ...runIdField });
    }
  } catch {
    // Telemetry is best-effort. A malformed result, an unwritable home
    // directory, or a transport failure must never turn a green lint red.
  }
}

/** Roll every file's findings and timings up into one run-level summary. */
function summarize(lintResult: ProjectLintResult): {
  codeCounts: Record<string, number>;
  ruleGroupMs: Record<string, number>;
  slowestRule: string;
  slowestRuleMs: number;
} {
  const codeCounts: Record<string, number> = {};
  const ruleGroupMs: Record<string, number> = {};
  let slowestRule = "";
  let slowestRuleMs = 0;

  for (const { result } of lintResult.results) {
    for (const finding of result.findings) {
      codeCounts[finding.code] = (codeCounts[finding.code] ?? 0) + 1;
    }
    const timings = result.timings;
    if (!timings) continue;
    for (const [group, ms] of Object.entries(timings.groupMs)) {
      ruleGroupMs[group] = (ruleGroupMs[group] ?? 0) + ms;
    }
    if (timings.slowestRuleMs > slowestRuleMs) {
      slowestRuleMs = timings.slowestRuleMs;
      slowestRule = timings.slowestRule;
    }
  }

  for (const group of Object.keys(ruleGroupMs)) {
    ruleGroupMs[group] = Math.round(ruleGroupMs[group]!);
  }
  return { codeCounts, ruleGroupMs, slowestRule, slowestRuleMs };
}
