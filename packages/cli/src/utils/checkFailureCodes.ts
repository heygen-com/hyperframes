import type { CheckReport } from "./checkTypes.js";

const MAX_CODES = 3;

/** The error codes of a check report with how often each fired, most frequent first; codes only, never content. */
export function failureCodes(report: CheckReport): Record<string, number> {
  const counts = new Map<string, number>();
  for (const section of [
    report.lint,
    report.runtime,
    report.layout,
    report.motion,
    report.contrast,
    report.craft,
    report.audio,
  ]) {
    for (const finding of section.findings) {
      if (finding.severity === "error")
        counts.set(finding.code, (counts.get(finding.code) ?? 0) + 1);
    }
  }
  const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, MAX_CODES);
  return Object.fromEntries(top);
}
