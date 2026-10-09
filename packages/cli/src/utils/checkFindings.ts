import type { CheckFinding } from "./checkTypes.js";

const SEVERITY = { info: 0, warning: 1, error: 2 } satisfies Record<
  CheckFinding["severity"],
  number
>;

/** Element identity is scoped to the source document, not the whole project. */
export function findingElementKey(finding: Pick<CheckFinding, "sourceFile" | "selector">): string {
  return JSON.stringify([finding.sourceFile, finding.selector]);
}

/** Group observations without changing their grading; retain one matching evidence anchor. */
export function groupSampledFindings<T extends CheckFinding>(
  findings: T[],
  compareEvidence: (next: T, current: T) => number = () => 0,
): (T & { times: number[] })[] {
  const groups = new Map<string, { finding: T; times: Set<number> }>();
  for (const finding of findings) {
    const key = JSON.stringify([findingElementKey(finding), finding.code]);
    const times = finding.times ?? [finding.time];
    const group = groups.get(key);
    if (!group) {
      groups.set(key, { finding, times: new Set(times) });
      continue;
    }
    for (const time of times) group.times.add(time);
    const severity = SEVERITY[finding.severity] - SEVERITY[group.finding.severity];
    if (severity > 0 || (severity === 0 && compareEvidence(finding, group.finding) > 0)) {
      group.finding = finding;
    }
  }
  return [...groups.values()].map(({ finding, times }) => ({
    ...finding,
    times: [...times].sort((a, b) => a - b),
  }));
}

export function formatFindingTimes(finding: Pick<CheckFinding, "time" | "times">): string {
  return `t=${(finding.times ?? [finding.time]).join(", ")}s`;
}
