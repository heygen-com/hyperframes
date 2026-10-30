import { basename } from "node:path";
import { longestContiguousRun } from "./layoutAudit.js";
import type {
  CheckBbox,
  CheckFinding,
  CheckFindingFrameRequest,
  CheckFindingFrames,
  CheckInspectTarget,
  CheckReport,
} from "./checkTypes.js";

export const MAX_FINDING_FRAME_TIMES = 60;

type FramedSection = "layout" | "contrast";
const FRAMED_SECTIONS: readonly FramedSection[] = ["layout", "contrast"];

export interface FramedFinding {
  section: FramedSection;
  index: number;
  time: number;
}

export interface FindingFramePlan {
  requests: CheckFindingFrameRequest[];
  findings: FramedFinding[];
  skipped: number;
}

/** Errors then warnings with a real bbox; one frame per distinct time, at most MAX_FINDING_FRAME_TIMES. */
export function selectFindingFrames(report: CheckReport): FindingFramePlan {
  const candidates = FRAMED_SECTIONS.flatMap((section) =>
    report[section].findings.flatMap((finding, index) =>
      (finding.severity === "error" || finding.severity === "warning") && hasRealBbox(finding.bbox)
        ? [{ section, index, finding }]
        : [],
    ),
  ).sort((a, b) => severityRank(a.finding) - severityRank(b.finding));
  const times = new Set<number>();
  const findings: FramedFinding[] = [];
  let skipped = 0;
  for (const { section, index, finding } of candidates) {
    const time = middleOfLongestRun(finding.times ?? [finding.time]);
    if (time === undefined) continue;
    if (!times.has(time) && times.size >= MAX_FINDING_FRAME_TIMES) {
      skipped += 1;
      continue;
    }
    times.add(time);
    findings.push({ section, index, time });
  }
  const requests = [...times]
    .sort((a, b) => a - b)
    .map((time, order) => ({ time, filename: findingFrameFilename(order, time) }));
  return { requests, findings, skipped };
}

function severityRank(finding: CheckFinding): number {
  return finding.severity === "error" ? 0 : 1;
}

function hasRealBbox(bbox: CheckBbox): boolean {
  return bbox.width > 0 && bbox.height > 0;
}

/** The middle sample of the longest held run (the `heldMs` gap rule); the earlier of two middles. */
export function middleOfLongestRun(times: number[]): number | undefined {
  const run = longestContiguousRun(times.filter((time) => Number.isFinite(time) && time >= 0));
  return run[Math.floor((run.length - 1) / 2)];
}

function findingFrameFilename(order: number, time: number): string {
  return `finding-frame-${String(order).padStart(2, "0")}-at-${time.toFixed(3)}s.png`;
}

function inspectTargetOf(finding: CheckFinding): CheckInspectTarget {
  const hfId = finding.dataAttributes["data-hf-id"];
  return hfId ? { hfId } : { selector: finding.selector };
}

const inspectionKey = (time: number, target: CheckInspectTarget) =>
  `${time}\n${JSON.stringify(target)}`;

export function findingFrameRequests(
  report: CheckReport,
  plan: FindingFramePlan,
  inspect: boolean | undefined,
): CheckFindingFrameRequest[] {
  if (!inspect) return plan.requests;
  return plan.requests.map((request) => {
    const targets = new Map<string, CheckInspectTarget>();
    for (const entry of plan.findings) {
      const finding = report[entry.section].findings[entry.index];
      if (entry.time !== request.time || !finding) continue;
      const target = inspectTargetOf(finding);
      targets.set(inspectionKey(entry.time, target), target);
    }
    return { ...request, inspect: [...targets.values()] };
  });
}

/** Copies each framed finding with its frame path, time and any inspection; every other field is untouched. */
export function withFindingFrameFields(
  report: CheckReport,
  plan: FindingFramePlan,
  { written, inspected }: CheckFindingFrames,
): CheckReport {
  const pathOf = new Map(written.map((path) => [basename(path), path]));
  const filenameOf = new Map(plan.requests.map((request) => [request.time, request.filename]));
  const inspectOf = new Map(
    inspected.map((entry) => [inspectionKey(entry.time, entry.target), entry.inspect]),
  );
  const next: CheckReport = { ...report };
  for (const section of FRAMED_SECTIONS) {
    const framed = plan.findings.filter((entry) => entry.section === section);
    if (framed.length === 0) continue;
    const findings: CheckFinding[] = [...report[section].findings];
    for (const entry of framed) {
      const frame = pathOf.get(filenameOf.get(entry.time) ?? "");
      const finding = findings[entry.index];
      if (!frame || !finding) continue;
      const inspect = inspectOf.get(inspectionKey(entry.time, inspectTargetOf(finding)));
      findings[entry.index] = {
        ...finding,
        frame,
        frameTime: entry.time,
        ...(inspect && { inspect }),
      };
    }
    Object.assign(next, { [section]: { ...report[section], findings } });
  }
  return next;
}
