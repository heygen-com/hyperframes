import { applyFileMutations, fileContentVersion } from "@hyperframes/studio-server";
import type { AppliedFileMutation } from "@hyperframes/studio-server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describeProject, type ProjectTimeline, type TimelineRow } from "./describeProject.js";
import { formatTimeline } from "./formatTimeline.js";
import { resolveRef } from "./resolveRef.js";
import { parseTimeExpression } from "./timeExpr.js";
import { ensureDOMParser } from "../utils/dom.js";
import { resolveProject } from "../utils/project.js";
import { withMeta } from "../utils/updateCheck.js";
import {
  allRows,
  decideMutation,
  declaredFps,
  diff,
  fpsFor,
  isRecord,
  mutationConflict,
  positional,
  refusal,
  rowAt,
  type MutationContext,
  type MutationDecision,
  type MutationVerb,
} from "./a2Shared.js";

export async function runMutation(
  verb: MutationVerb,
  args: Record<string, unknown>,
): Promise<void> {
  const setup = await prepareMutation(args);
  if (!setup.ok) return refusal(setup.reason, setup.fix, setup.json);
  const decision = decideMutation(verb, setup.context, args);
  if (!decision.ok) return refusal(decision.reason, decision.fix, setup.json);
  await finishMutation(setup, verb, decision);
}

interface MutationSetup {
  ok: true;
  project: ReturnType<typeof resolveProject>;
  ref: string;
  json: boolean;
  plan: boolean;
  overwrite: boolean;
  timeline: ProjectTimeline;
  indexSource: string;
  row: TimelineRow;
  resolved: Extract<ReturnType<typeof resolveRef>, { ok: true }>;
  filePath: string;
  before: string;
  expectedVersion: string;
  context: MutationContext;
}

type MutationSetupResult =
  | MutationSetup
  | { ok: false; reason: string; fix: string; json: boolean };

async function prepareMutation(args: Record<string, unknown>): Promise<MutationSetupResult> {
  const project = resolveProject(typeof args.dir === "string" ? args.dir : undefined);
  const ref = typeof args.ref === "string" ? args.ref : "";
  const json = args.json === true;
  const plan = args.plan === true;
  const overwrite = args.overwrite === true;
  const snap = args.snap === true;
  ensureDOMParser();
  const indexSource = readFileSync(project.indexPath, "utf-8");
  const initialTimeline = await describeProject(
    project.indexPath,
    undefined,
    new Map([["index.html", indexSource]]),
  );
  const projectFps = declaredFps(indexSource);
  if (snap && projectFps === null) {
    return {
      ok: false,
      reason: "project fps is unknown",
      fix: "set data-fps on the project, then rerun with --snap",
      json,
    };
  }
  const initialResolved = resolveRef(initialTimeline, ref);
  if (!initialResolved.ok)
    return { ok: false, reason: initialResolved.reason, fix: initialResolved.fix, json };
  const initialRow = initialResolved.row;
  const filePath = join(project.dir, initialRow.file);
  const before = readFileSync(filePath, "utf-8");
  const expectedVersion = fileContentVersion(before);
  const sources = new Map([
    ["index.html", indexSource],
    [initialRow.file, before],
  ]);
  const timeline = await describeProject(project.indexPath, undefined, sources);
  const resolved = resolveRef(timeline, ref);
  if (!resolved.ok) return { ok: false, reason: resolved.reason, fix: resolved.fix, json };
  const row = resolved.row;
  const anchor = (anchorRef: string) => {
    const found = resolveRef(timeline, anchorRef);
    return found.ok ? found.row : undefined;
  };
  const parseTime = (expression: string) => {
    const parsed = parseTimeExpression(expression, {
      row,
      duration: timeline.duration,
      fps: fpsFor(project.indexPath),
      resolveAnchor: anchor,
    });
    if (!parsed.ok || !snap) return parsed;
    return { ok: true as const, seconds: Math.round(parsed.seconds * projectFps!) / projectFps! };
  };
  return {
    ok: true,
    project,
    ref,
    json,
    plan,
    overwrite,
    timeline,
    indexSource,
    row,
    resolved,
    filePath,
    before,
    expectedVersion,
    context: {
      ref,
      row,
      before,
      resolved,
      parseTime,
      // Nested rows use the visible host clip duration as their composition bound.
      duration:
        row.nested && row.hostRow ? rowAt(timeline, row.hostRow).duration : timeline.duration,
    },
  };
}

async function finishMutation(
  setup: MutationSetup,
  verb: MutationVerb,
  decision: Extract<MutationDecision, { ok: true }>,
): Promise<void> {
  const { after, nextStart, nextDuration } = decision;
  const { ref, row, timeline, json, overwrite, project, before } = setup;
  const refusalMessage = mutationRefusal(verb, after, before, ref);
  if (refusalMessage) return refusal(refusalMessage.reason, refusalMessage.fix, json);
  const conflict = mutationConflict(verb, overwrite, row, timeline, nextStart, nextDuration);
  if (conflict) return refusal(conflict.reason, conflict.fix, json);
  const describeSource = (source: string): Promise<ProjectTimeline> =>
    describeProject(
      project.indexPath,
      undefined,
      new Map([
        ["index.html", setup.indexSource],
        [row.file, source],
      ]),
    );
  const describedBefore = await describeSource(before);
  const result = mutationResult(row, describedBefore, setup.plan);
  if (setup.plan) return printPlan(result, json, timeline, describeSource, after, before);
  return applyAndPrint({
    setup,
    verb,
    json,
    row,
    nextStart,
    nextDuration,
    after,
    before,
    result,
    describeSource,
  });
}

async function applyAndPrint(args: {
  setup: MutationSetup;
  verb: MutationVerb;
  json: boolean;
  row: TimelineRow;
  nextStart: number;
  nextDuration: number;
  after: string;
  before: string;
  result: ReturnType<typeof mutationResult>;
  describeSource: (source: string) => Promise<ProjectTimeline>;
}): Promise<void> {
  const receipt = applyMutation(args.setup, args.after);
  if (receipt && "error" in receipt)
    return refusal(receipt.error, "re-run hyperframes timeline", args.json);
  if (!receipt && args.after !== args.before) {
    return refusal("mutation produced no receipt", "re-run hyperframes timeline", args.json);
  }
  args.result.after = rowsForFile(await args.describeSource(args.after), args.row.file);
  args.result.receipt = receipt
    ? {
        file: receipt.sourceFile,
        version: receipt.version,
        writeToken: receipt.writeToken,
        changed: receipt.changed,
        backupPath: receipt.backupPath,
      }
    : null;
  if (args.json) {
    console.log(JSON.stringify(withMeta(args.result), null, 2));
    return;
  }
  console.log(
    `${args.verb} ${args.row.ref}: ${args.row.start}-${args.row.end}s -> ${args.nextStart}-${args.nextStart + args.nextDuration}s\nreceipt: ${receipt?.version ?? "unchanged"}`,
  );
}

function rowsForFile(timeline: ProjectTimeline, file: string): TimelineRow[] {
  return allRows(timeline).filter((candidate) => candidate.file === file);
}

function mutationResult(row: TimelineRow, before: ProjectTimeline, planned: boolean) {
  return {
    ok: true,
    receipt: null as unknown,
    file: row.file,
    before: rowsForFile(before, row.file),
    after: [] as TimelineRow[],
    warnings: row.warnings,
    planned,
  };
}

async function printPlan(
  result: ReturnType<typeof mutationResult>,
  json: boolean,
  timeline: ProjectTimeline,
  describeSource: (source: string) => Promise<ProjectTimeline>,
  after: string,
  before: string,
): Promise<void> {
  const plannedTimeline = await describeSource(after);
  result.after = rowsForFile(plannedTimeline, result.file);
  if (json) console.log(JSON.stringify(withMeta(result), null, 2));
  else
    console.log(
      `${formatTimeline(timeline)}\n\nplanned:\n${formatTimeline(plannedTimeline)}\n\ndiff:\n${diff(before, after)}`,
    );
}

function applyMutation(
  setup: MutationSetup,
  after: string,
): AppliedFileMutation | { error: string } | undefined {
  try {
    return applyFileMutations(setup.project.dir, [
      {
        sourceFile: setup.row.file,
        absPath: setup.filePath,
        before: setup.before,
        after,
        expectedVersion: setup.expectedVersion,
      },
    ])[0];
  } catch (error) {
    if (error instanceof Error && error.message === "file changed since the timeline was read") {
      return { error: error.message };
    }
    throw error;
  }
}

function mutationRefusal(
  verb: MutationVerb,
  after: string,
  before: string,
  ref: string,
): { reason: string; fix: string } | null {
  if (verb !== "delete" || after !== before) return null;
  return { reason: `${ref} was not found`, fix: "choose an existing clip" };
}
