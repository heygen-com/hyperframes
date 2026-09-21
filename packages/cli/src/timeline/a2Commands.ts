import { applyFileMutations, fileContentVersion } from "@hyperframes/studio-server";
import type { AppliedFileMutation } from "@hyperframes/studio-server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describeProject, type ProjectTimeline, type TimelineRow } from "./describeProject.js";
import { resolveRef } from "./resolveRef.js";
import { parseTimeExpression } from "./timeExpr.js";
import { ensureDOMParser } from "../utils/dom.js";
import { resolveProject } from "../utils/project.js";
import { withMeta } from "../utils/updateCheck.js";
import { stampHfIds } from "./a2Mutations.js";
import {
  allRows,
  decideMutation,
  diff,
  fpsFor,
  isRecord,
  mutationConflict,
  positional,
  refuse,
  rowAt,
  type MutationContext,
  type MutationVerb,
} from "./a2Shared.js";

export async function runIds(args: Record<string, unknown>): Promise<void> {
  const project = resolveProject(typeof args.dir === "string" ? args.dir : undefined);
  const json = args.json === true;
  ensureDOMParser();
  const beforeTimeline = await describeProject(project.indexPath);
  const files = [...new Set(["index.html", ...allRows(beforeTimeline).map((row) => row.file)])];
  const inputs = files.flatMap((file) => {
    const before = readFileSync(join(project.dir, file), "utf-8");
    const after = stampHfIds(before);
    return after === before
      ? []
      : [{ sourceFile: file, absPath: join(project.dir, file), before, after }];
  });
  const receipts = inputs.length > 0 ? applyFileMutations(project.dir, inputs) : [];
  const afterTimeline = await describeProject(project.indexPath);
  const result = {
    ok: true,
    receipt: receipts.map((receipt) => publicReceipt(receipt)),
    file: files,
    before: allRows(beforeTimeline),
    after: allRows(afterTimeline),
    diff: "",
    warnings: [],
  };
  if (json) console.log(JSON.stringify(withMeta(result), null, 2));
  else console.log(`ids: stamped ${receipts.length} file${receipts.length === 1 ? "" : "s"}`);
}
type ApplyEditResult =
  | { ok: true; file: string; after: string }
  | { ok: false; reason: string; fix: string };

const PLAN_VERBS = new Set<MutationVerb>(["move", "trim", "split", "delete", "set", "duplicate"]);

type PreparedPlanEdit = {
  ok: true;
  edit: Record<string, unknown>;
  row: TimelineRow;
  before: string;
  resolved: Extract<ReturnType<typeof resolveRef>, { ok: true }>;
};

function preparePlanEdit(
  edit: unknown,
  timeline: ProjectTimeline,
  sourceByFile: Map<string, string>,
): PreparedPlanEdit | { ok: false; reason: string; fix: string } {
  if (!isRecord(edit) || typeof edit.verb !== "string" || typeof edit.ref !== "string") {
    return {
      ok: false,
      reason: "each edit needs a verb and ref",
      fix: "pass {verb, ref, ...} objects",
    };
  }
  if (!PLAN_VERBS.has(edit.verb as MutationVerb)) {
    return {
      ok: false,
      reason: `unsupported edit verb ${edit.verb}`,
      fix: "use move, trim, split, delete, set, or duplicate",
    };
  }
  const resolved = resolveRef(timeline, edit.ref);
  if (!resolved.ok) return resolved;
  const before = sourceByFile.get(resolved.row.file);
  return before === undefined
    ? { ok: false, reason: `${resolved.row.file} was not found`, fix: "choose an existing clip" }
    : { ok: true, edit, row: resolved.row, before, resolved };
}

function applyPlanEdit(
  edit: unknown,
  timeline: ProjectTimeline,
  project: ReturnType<typeof resolveProject>,
  sourceByFile: Map<string, string>,
): ApplyEditResult {
  const prepared = preparePlanEdit(edit, timeline, sourceByFile);
  if (!prepared.ok) return prepared;
  const { edit: planEdit, row, before, resolved } = prepared;
  const verb = planEdit.verb as MutationVerb;
  const context: MutationContext = {
    ref: planEdit.ref as string,
    row,
    before,
    resolved,
    parseTime: (expression) =>
      parseTimeExpression(expression, {
        row,
        duration: timeline.duration,
        fps: fpsFor(project.indexPath),
        resolveAnchor: (anchorRef) => {
          const anchor = resolveRef(timeline, anchorRef);
          return anchor.ok ? anchor.row : undefined;
        },
      }),
    duration: row.nested && row.hostRow ? rowAt(timeline, row.hostRow).duration : timeline.duration,
  };
  const decision = decideMutation(verb, context, { ...planEdit, _: [planEdit.ref] });
  if (!decision.ok) return { ok: false, reason: decision.reason, fix: decision.fix };
  const conflict = mutationConflict(
    verb as MutationVerb,
    planEdit.overwrite === true,
    row,
    timeline,
    decision.nextStart,
    decision.nextDuration,
  );
  if (conflict) return { ok: false, reason: conflict.reason, fix: conflict.fix };
  return { ok: true, file: row.file, after: decision.after };
}

type EditPlan = { ok: true; edits: unknown[] } | { ok: false; reason: string; fix: string };

function readEditPlan(file: string): EditPlan {
  const raw = file === "-" ? readFileSync(0, "utf-8") : readFileSync(file, "utf-8");
  try {
    const edits: unknown = JSON.parse(raw);
    return Array.isArray(edits)
      ? { ok: true, edits }
      : { ok: false, reason: "edit plan must be a JSON array", fix: "pass a JSON array of edits" };
  } catch {
    return { ok: false, reason: "edit plan is not valid JSON", fix: "pass a JSON array of edits" };
  }
}

function readPlanSources(
  timeline: ProjectTimeline,
  project: ReturnType<typeof resolveProject>,
): { sourceByFile: Map<string, string>; beforeByFile: Map<string, string> } {
  const sourceByFile = new Map<string, string>();
  const beforeByFile = new Map<string, string>();
  for (const fileName of new Set(allRows(timeline).map((row) => row.file))) {
    const source = readFileSync(join(project.dir, fileName), "utf-8");
    sourceByFile.set(fileName, source);
    beforeByFile.set(fileName, source);
  }
  return { sourceByFile, beforeByFile };
}

async function applyPlanEdits(
  edits: unknown[],
  timeline: ProjectTimeline,
  project: ReturnType<typeof resolveProject>,
  sourceByFile: Map<string, string>,
): Promise<{ ok: true } | { ok: false; reason: string; fix: string }> {
  for (const edit of edits) {
    const result = applyPlanEdit(edit, timeline, project, sourceByFile);
    if (!result.ok) return result;
    sourceByFile.set(result.file, result.after);
    timeline = await describeProject(project.indexPath, undefined, sourceByFile);
  }
  return { ok: true };
}

export async function runApply(args: Record<string, unknown>): Promise<void> {
  const project = resolveProject(typeof args.dir === "string" ? args.dir : undefined);
  const json = args.json === true;
  const plan = args.plan === true;
  const file = typeof args.file === "string" ? args.file : positional(args)[1];
  if (!file)
    return refuse(
      "timeline apply",
      { reason: "an edit plan is required", fix: "pass an edits.json path or -" },
      json,
    );
  const planInput = readEditPlan(file);
  if (!planInput.ok) return refuse("timeline apply", planInput, json);
  ensureDOMParser();
  const timeline = await describeProject(project.indexPath);
  const { sourceByFile, beforeByFile } = readPlanSources(timeline, project);
  const editsResult = await applyPlanEdits(planInput.edits, timeline, project, sourceByFile);
  if (!editsResult.ok) return refuse("timeline apply", editsResult, json);
  const inputs = [...sourceByFile].flatMap(([fileName, after]) => {
    const before = beforeByFile.get(fileName)!;
    return after === before
      ? []
      : [
          {
            sourceFile: fileName,
            absPath: join(project.dir, fileName),
            before,
            after,
            expectedVersion: fileContentVersion(before),
          },
        ];
  });
  const afterTimeline = await describeProject(project.indexPath, undefined, sourceByFile);
  const result = {
    ok: true,
    planned: plan,
    receipt: null as unknown,
    file: inputs.map((input) => input.sourceFile),
    before: allRows(timeline),
    after: allRows(afterTimeline),
    diff: inputs
      .map((input) => diff(input.before, input.after))
      .filter(Boolean)
      .join("\n"),
    warnings: [],
  };
  if (!plan) {
    const receipts = inputs.length > 0 ? applyFileMutations(project.dir, inputs) : [];
    result.receipt = receipts.map((receipt) => publicReceipt(receipt));
  }
  if (json) console.log(JSON.stringify(withMeta(result), null, 2));
  else
    console.log(
      `${plan ? "planned" : "applied"} ${inputs.length} file${inputs.length === 1 ? "" : "s"}`,
    );
}

export async function runUndo(args: Record<string, unknown>): Promise<void> {
  const project = resolveProject(typeof args.dir === "string" ? args.dir : undefined);
  const json = args.json === true;
  const input = typeof args.receipt === "string" ? args.receipt : positional(args)[1];
  if (!input)
    return refuse(
      "timeline undo",
      { reason: "an undo receipt is required", fix: "pass the receipt JSON or its file" },
      json,
    );
  let raw: string;
  try {
    raw = readFileSync(input, "utf-8");
  } catch {
    raw = input;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return refuse(
      "timeline undo",
      { reason: "undo receipt is not valid JSON", fix: "pass the applied JSON receipt" },
      json,
    );
  }
  const value = isRecord(parsed) && isRecord(parsed.receipt) ? parsed.receipt : parsed;
  if (
    !isRecord(value) ||
    typeof value.file !== "string" ||
    typeof value.version !== "string" ||
    typeof value.backupPath !== "string"
  ) {
    return refuse(
      "timeline undo",
      {
        reason: "undo receipt is missing file, version, or backupPath",
        fix: "pass an applied timeline receipt",
      },
      json,
    );
  }
  const backup = join(project.dir, value.backupPath);
  const target = join(project.dir, value.file);
  const before = readFileSync(target, "utf-8");
  const after = readFileSync(backup, "utf-8");
  const receipts = applyFileMutations(project.dir, [
    { sourceFile: value.file, absPath: target, before, after, expectedVersion: value.version },
  ]);
  const result = {
    ok: true,
    receipt: receipts.map((receipt) => publicReceipt(receipt)),
    file: value.file,
  };
  if (json) console.log(JSON.stringify(withMeta(result), null, 2));
  else console.log(`undid ${value.file}`);
}

function publicReceipt(receipt: AppliedFileMutation) {
  return {
    file: receipt.sourceFile,
    version: receipt.version,
    writeToken: receipt.writeToken,
    changed: receipt.changed,
    backupPath: receipt.backupPath,
  };
}
