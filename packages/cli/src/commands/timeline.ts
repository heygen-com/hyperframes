import {
  applyFileMutations,
  duplicateElementInHtml,
  fileContentVersion,
  patchElementInHtml,
  removeElementFromHtml,
  splitElementInHtml,
} from "@hyperframes/studio-server";
import type { AppliedFileMutation, PatchOperation } from "@hyperframes/studio-server";
import { fpsToNumber, parseFpsWithDefault } from "@hyperframes/core";
import { readCompositionFps } from "../utils/compositionFps.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import {
  describeProject,
  type ProjectTimeline,
  type TimelineRow,
} from "../timeline/describeProject.js";
import { formatTimeline } from "../timeline/formatTimeline.js";
import { resolveRef } from "../timeline/resolveRef.js";
import { parseTimeExpression } from "../timeline/timeExpr.js";
import { ensureDOMParser } from "../utils/dom.js";
import { setCommandExitCode } from "../utils/commandResult.js";
import { resolveProject } from "../utils/project.js";
import { withMeta } from "../utils/updateCheck.js";
import { parseSetAssignments, stampHfIds, type SetAssignment } from "../timeline/a2Mutations.js";

export const examples: Example[] = [
  ["Show every track and clip of the project in the current directory", "hyperframes timeline"],
  ["Move a clip without writing", "hyperframes timeline move '#hero' +2 --plan"],
  ["Delete a clip and return a receipt", "hyperframes timeline delete '#hero' --json"],
];

type MutationVerb = "move" | "trim" | "split" | "delete" | "set" | "duplicate";

type MutationDecision =
  | { ok: true; after: string; nextStart: number; nextDuration: number }
  | { ok: false; reason: string; fix: string };

interface MutationContext {
  ref: string;
  row: TimelineRow;
  before: string;
  resolved: Extract<ReturnType<typeof resolveRef>, { ok: true }>;
  parseTime: (expression: string) => ReturnType<typeof parseTimeExpression>;
  duration: number;
}

type ParsedMutationTime =
  | { ok: true; seconds: number }
  | { ok: false; reason: string; fix: string };

const allRows = (timeline: ProjectTimeline): TimelineRow[] =>
  timeline.tracks.flatMap((track) => track.rows);

function refusal(reason: string, fix: string, json: boolean): void {
  setCommandExitCode(2);
  const payload = { ok: false, reason, fix };
  console.error(json ? JSON.stringify(payload, null, 2) : `${reason}; ${fix}.`);
}

function fpsFor(indexPath: string): number {
  const parsed = parseFpsWithDefault(
    readCompositionFps(readFileSync(indexPath, "utf-8")) ?? undefined,
  );
  return fpsToNumber(parsed.ok ? parsed.value : { num: 30, den: 1 });
}

function declaredFps(source: string): number | null {
  const raw = readCompositionFps(source);
  if (raw === null) return null;
  const parsed = parseFpsWithDefault(raw);
  return parsed.ok ? fpsToNumber(parsed.value) : null;
}

function splitBaseId(row: TimelineRow): string {
  return row.ref.startsWith("hf:") ? row.ref.slice(3) : row.id;
}

function nextFreeSplitId(source: string, base: string): string {
  const document = new DOMParser().parseFromString(source, "text/html");
  const existing = new Set(Array.from(document.querySelectorAll("[id]"), (element) => element.id));
  const match = /^(.*)-(\d+)$/.exec(base);
  const prefix = match && existing.has(match[1]!) ? match[1]! : base;
  let suffix = 2;
  while (existing.has(`${prefix}-${suffix}`)) suffix += 1;
  return `${prefix}-${suffix}`;
}

function parseMutationTime(
  context: MutationContext,
  expression: string,
  fix: string,
): ParsedMutationTime {
  const value = context.parseTime(expression);
  if (!value.ok) return { ok: false, reason: value.reason, fix };
  if (value.seconds < 0 || value.seconds > context.duration) {
    return {
      ok: false,
      reason: `time ${value.seconds} is outside the composition duration`,
      fix: "pass a time between 0 and the composition duration",
    };
  }
  return { ok: true, seconds: value.seconds };
}

function diff(before: string, after: string): string {
  if (before === after) return "";
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  let prefix = 0;
  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < beforeLines.length - prefix &&
    suffix < afterLines.length - prefix &&
    beforeLines[beforeLines.length - suffix - 1] === afterLines[afterLines.length - suffix - 1]
  ) {
    suffix += 1;
  }
  const changedBefore = beforeLines.slice(prefix, beforeLines.length - suffix);
  const changedAfter = afterLines.slice(prefix, afterLines.length - suffix);
  const lines = [
    "--- before",
    "+++ after",
    ...changedBefore.map((line) => `-${line}`),
    ...changedAfter.map((line) => `+${line}`),
  ];
  const output = lines.join("\n");
  return output.length <= 8_000 ? output : `${output.slice(0, 7_997)}...`;
}

function overlap(
  row: TimelineRow,
  timeline: ProjectTimeline,
  start: number,
  end: number,
): TimelineRow | undefined {
  return allRows(timeline).find(
    (candidate) =>
      candidate !== row &&
      candidate.file === row.file &&
      candidate.trackIndex === row.trackIndex &&
      Math.max(start, candidate.start) < Math.min(end, candidate.end),
  );
}

function moveMutation(context: MutationContext, args: Record<string, unknown>): MutationDecision {
  const expression = typeof args.time === "string" ? args.time : "";
  const time = parseMutationTime(context, expression, "pass a valid time expression");
  if (!time.ok) return time;
  const end = time.seconds + context.row.duration;
  if (end > context.duration) {
    return {
      ok: false,
      reason: `move would end at ${end}, beyond composition duration ${context.duration}`,
      fix: `choose a start at or before the latest valid start ${context.duration - context.row.duration}`,
    };
  }
  const patched = patchElementInHtml(context.before, context.resolved.target, [
    { type: "html-attribute", property: "data-start", value: String(time.seconds) },
  ]);
  if (!patched.matched) {
    return { ok: false, reason: `${context.ref} was not found`, fix: "choose an existing clip" };
  }
  return {
    ok: true,
    after: patched.html,
    nextStart: time.seconds,
    nextDuration: context.row.duration,
  };
}

function splitMutation(context: MutationContext, args: Record<string, unknown>): MutationDecision {
  const expression = typeof args.time === "string" ? args.time : "";
  const time = parseMutationTime(context, expression, "pass a valid time expression");
  if (!time.ok) return time;
  const split = splitElementInHtml(
    context.before,
    context.resolved.target,
    time.seconds,
    nextFreeSplitId(context.before, splitBaseId(context.row)),
    {
      start: context.row.start,
      duration: context.row.duration,
      track: context.row.trackIndex,
    },
  );
  if (!split.matched || !split.newId) {
    return {
      ok: false,
      reason: `${context.ref} cannot be split at ${time.seconds}`,
      fix: "choose a time inside the clip",
    };
  }
  return {
    ok: true,
    after: split.html,
    nextStart: context.row.start,
    nextDuration: context.row.duration,
  };
}

function trimMutation(context: MutationContext, args: Record<string, unknown>): MutationDecision {
  const bounds = trimBounds(context, args);
  if (!bounds.ok) return bounds;
  const patched = patchElementInHtml(context.before, context.resolved.target, [
    { type: "html-attribute", property: "data-start", value: String(bounds.nextStart) },
    { type: "html-attribute", property: "data-duration", value: String(bounds.nextDuration) },
  ]);
  if (!patched.matched) {
    return { ok: false, reason: `${context.ref} was not found`, fix: "choose an existing clip" };
  }
  return {
    ok: true,
    after: patched.html,
    nextStart: bounds.nextStart,
    nextDuration: bounds.nextDuration,
  };
}

function trimBounds(
  context: MutationContext,
  args: Record<string, unknown>,
): MutationDecision | { ok: true; nextStart: number; nextDuration: number } {
  const input = trimInput(args);
  if (!input.ok) return input;
  const start = trimStart(context, input.start);
  if (!start.ok) return start;
  return finishTrim(
    context,
    start.seconds,
    trimEnd(context, input.end),
    trimDuration(context, input.duration),
  );
}

function trimInput(args: Record<string, unknown>) {
  const input = {
    start: typeof args.start === "string" ? args.start : undefined,
    end: typeof args.end === "string" ? args.end : undefined,
    duration: typeof args.duration === "string" ? args.duration : undefined,
  };
  if (input.start || input.end || input.duration) return { ok: true as const, ...input };
  return {
    ok: false as const,
    reason: "trim requires --start, --end, or --duration",
    fix: "pass one trim option",
  };
}

function finishTrim(
  context: MutationContext,
  nextStart: number,
  end: ReturnType<typeof trimEnd>,
  duration: ReturnType<typeof trimDuration>,
): MutationDecision | { ok: true; nextStart: number; nextDuration: number } {
  if (end && !end.ok) return end;
  if (duration && !duration.ok) return duration;
  const nextDuration = duration?.seconds ?? (end ? end.seconds - nextStart : context.row.duration);
  if (nextDuration <= 0) {
    return {
      ok: false,
      reason: "trim duration must be positive",
      fix: "choose a later end or positive duration",
    };
  }
  return { ok: true, nextStart, nextDuration };
}

function trimStart(context: MutationContext, expression: string | undefined) {
  if (!expression) return { ok: true as const, seconds: context.row.start };
  return parseMutationTime(context, expression, "pass a valid time expression");
}

function trimEnd(context: MutationContext, expression: string | undefined) {
  if (!expression) return undefined;
  return parseMutationTime(context, expression, "pass a valid time expression");
}

function trimDuration(context: MutationContext, expression: string | undefined) {
  if (!expression) return undefined;
  return parseMutationTime(context, expression, "pass a valid duration");
}

function deleteMutation(context: MutationContext): MutationDecision {
  return {
    ok: true,
    after: removeElementFromHtml(context.before, context.resolved.target),
    nextStart: context.row.start,
    nextDuration: context.row.duration,
  };
}

function setOperation(assignment: SetAssignment): PatchOperation {
  const property =
    assignment.field === "volume"
      ? "data-volume"
      : assignment.field === "rate"
        ? "data-playback-rate"
        : "data-track-index";
  return { type: "html-attribute", property, value: assignment.value };
}

function setMutation(context: MutationContext, args: Record<string, unknown>): MutationDecision {
  const positionalAssignments = positional(args)
    .slice(1)
    .filter((value): value is string => typeof value === "string");
  const namedAssignments = ["volume", "rate", "track"].flatMap((field) => {
    const value = args[field];
    return typeof value === "string" ? [`${field}=${value}`] : [];
  });
  const assignments = parseSetAssignments([...positionalAssignments, ...namedAssignments]);
  if (!assignments.ok) return assignments;
  const patched = patchElementInHtml(
    context.before,
    context.resolved.target,
    assignments.assignments.map(setOperation),
  );
  if (!patched.matched) {
    return { ok: false, reason: `${context.ref} was not found`, fix: "choose an existing clip" };
  }
  return {
    ok: true,
    after: patched.html,
    nextStart: context.row.start,
    nextDuration: context.row.duration,
  };
}

function duplicateMutation(
  context: MutationContext,
  args: Record<string, unknown>,
): MutationDecision {
  const expression = typeof args.at === "string" ? args.at : String(context.row.end);
  const time = parseMutationTime(context, expression, "pass a valid insertion time");
  if (!time.ok) return time;
  const duplicate = duplicateElementInHtml(
    context.before,
    context.resolved.target,
    `${splitBaseId(context.row)}-copy`,
    time.seconds,
  );
  if (!duplicate.matched) {
    return { ok: false, reason: `${context.ref} was not found`, fix: "choose an existing clip" };
  }
  return {
    ok: true,
    after: duplicate.html,
    nextStart: time.seconds,
    nextDuration: context.row.duration,
  };
}

function decideMutation(
  verb: MutationVerb,
  context: MutationContext,
  args: Record<string, unknown>,
): MutationDecision {
  switch (verb) {
    case "move":
      return moveMutation(context, args);
    case "trim":
      return trimMutation(context, args);
    case "split":
      return splitMutation(context, args);
    case "delete":
      return deleteMutation(context);
    case "set":
      return setMutation(context, args);
    case "duplicate":
      return duplicateMutation(context, args);
  }
}

async function runMutation(verb: MutationVerb, args: Record<string, unknown>): Promise<void> {
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

function rowAt(
  timeline: ProjectTimeline,
  pointer: { kind: TimelineRow["trackKind"]; index: number },
): TimelineRow {
  const track = timeline.tracks.find((candidate) => candidate.kind === pointer.kind);
  if (!track) throw new Error(`missing track ${pointer.kind}`);
  const row = track.rows[pointer.index];
  if (!row) throw new Error(`missing row ${pointer.kind}/${pointer.index}`);
  return row;
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

function positional(args: Record<string, unknown>): string[] {
  return Array.isArray(args._)
    ? args._.filter((value): value is string => typeof value === "string")
    : [];
}

async function runIds(args: Record<string, unknown>): Promise<void> {
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

function applyPlanEdit(
  edit: unknown,
  timeline: ProjectTimeline,
  project: ReturnType<typeof resolveProject>,
  sourceByFile: Map<string, string>,
): ApplyEditResult {
  if (!isRecord(edit) || typeof edit.verb !== "string" || typeof edit.ref !== "string") {
    return {
      ok: false,
      reason: "each edit needs a verb and ref",
      fix: "pass {verb, ref, ...} objects",
    };
  }
  const verb = edit.verb;
  const supported = ["move", "trim", "split", "delete", "set", "duplicate"];
  if (!supported.includes(verb)) {
    return {
      ok: false,
      reason: `unsupported edit verb ${verb}`,
      fix: "use move, trim, split, delete, set, or duplicate",
    };
  }
  const resolved = resolveRef(timeline, edit.ref);
  if (!resolved.ok) return { ok: false, reason: resolved.reason, fix: resolved.fix };
  const row = resolved.row;
  const before = sourceByFile.get(row.file);
  if (before === undefined)
    return { ok: false, reason: `${row.file} was not found`, fix: "choose an existing clip" };
  const context: MutationContext = {
    ref: edit.ref,
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
  const decision = decideMutation(verb as MutationVerb, context, { ...edit, _: [edit.ref] });
  if (!decision.ok) return decision;
  const conflict = mutationConflict(
    verb as MutationVerb,
    edit.overwrite === true,
    row,
    timeline,
    decision.nextStart,
    decision.nextDuration,
  );
  if (conflict) return conflict;
  return { ok: true, file: row.file, after: decision.after };
}

async function runApply(args: Record<string, unknown>): Promise<void> {
  const project = resolveProject(typeof args.dir === "string" ? args.dir : undefined);
  const json = args.json === true;
  const plan = args.plan === true;
  const file = typeof args.file === "string" ? args.file : positional(args)[1];
  if (!file) return refusal("an edit plan is required", "pass an edits.json path or -", json);
  const raw = file === "-" ? readFileSync(0, "utf-8") : readFileSync(file, "utf-8");
  let edits: unknown;
  try {
    edits = JSON.parse(raw);
  } catch {
    return refusal("edit plan is not valid JSON", "pass a JSON array of edits", json);
  }
  if (!Array.isArray(edits))
    return refusal("edit plan must be a JSON array", "pass a JSON array of edits", json);
  ensureDOMParser();
  const timeline = await describeProject(project.indexPath);
  const sourceByFile = new Map<string, string>();
  const beforeByFile = new Map<string, string>();
  for (const fileName of new Set(allRows(timeline).map((row) => row.file))) {
    const source = readFileSync(join(project.dir, fileName), "utf-8");
    sourceByFile.set(fileName, source);
    beforeByFile.set(fileName, source);
  }
  for (const edit of edits) {
    const result = applyPlanEdit(edit, timeline, project, sourceByFile);
    if (!result.ok) return refusal(result.reason, result.fix, json);
    sourceByFile.set(result.file, result.after);
  }
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

async function runUndo(args: Record<string, unknown>): Promise<void> {
  const project = resolveProject(typeof args.dir === "string" ? args.dir : undefined);
  const json = args.json === true;
  const input = typeof args.receipt === "string" ? args.receipt : positional(args)[1];
  if (!input)
    return refusal("an undo receipt is required", "pass the receipt JSON or its file", json);
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
    return refusal("undo receipt is not valid JSON", "pass the applied JSON receipt", json);
  }
  const value = isRecord(parsed) && isRecord(parsed.receipt) ? parsed.receipt : parsed;
  if (
    !isRecord(value) ||
    typeof value.file !== "string" ||
    typeof value.version !== "string" ||
    typeof value.backupPath !== "string"
  ) {
    return refusal(
      "undo receipt is missing file, version, or backupPath",
      "pass an applied timeline receipt",
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function mutationConflict(
  verb: MutationVerb,
  overwrite: boolean,
  row: TimelineRow,
  timeline: ProjectTimeline,
  nextStart: number,
  nextDuration: number,
): { reason: string; fix: string } | null {
  if ((verb !== "move" && verb !== "trim") || overwrite) return null;
  const conflict = overlap(row, timeline, nextStart, nextStart + nextDuration);
  if (!conflict) return null;
  return {
    reason: `${row.ref} would overlap ${conflict.ref} at ${nextStart}-${nextStart + nextDuration}`,
    fix: "pass --overwrite or move the named neighbour",
  };
}

function mutationCommand(verb: MutationVerb) {
  return defineCommand({
    meta: { name: verb, description: `${verb} a timeline clip` },
    args: {
      ref: { type: "positional", required: true },
      time: { type: "positional", required: verb === "move" || verb === "split" },
      at: { type: "string" },
      dir: { type: "string" },
      start: { type: "string" },
      end: { type: "string" },
      duration: { type: "string" },
      plan: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      overwrite: { type: "boolean", default: false },
      snap: { type: "boolean", default: false },
    },
    async run({ args }) {
      await runMutation(verb, args);
    },
  });
}

export default defineCommand({
  meta: { name: "timeline", description: "Print and edit the project's tracks and clips" },
  args: {
    dir: { type: "positional", description: "Project directory", required: false },
    json: { type: "boolean", description: "Output as JSON", default: false },
  },
  subCommands: {
    move: () => mutationCommand("move"),
    trim: () => mutationCommand("trim"),
    split: () => mutationCommand("split"),
    delete: () => mutationCommand("delete"),
    set: () => mutationCommand("set"),
    duplicate: () => mutationCommand("duplicate"),
    ids: () =>
      defineCommand({
        meta: { name: "ids", description: "Stamp stable ids on timeline clips" },
        args: { dir: { type: "string" }, json: { type: "boolean", default: false } },
        async run({ args }) {
          await runIds(args);
        },
      }),
    apply: () =>
      defineCommand({
        meta: { name: "apply", description: "Apply an atomic timeline edit plan" },
        args: {
          file: { type: "positional", required: true },
          dir: { type: "string" },
          json: { type: "boolean", default: false },
          plan: { type: "boolean", default: false },
        },
        async run({ args }) {
          await runApply(args);
        },
      }),
    undo: () =>
      defineCommand({
        meta: { name: "undo", description: "Restore a timeline mutation receipt" },
        args: {
          receipt: { type: "positional", required: true },
          dir: { type: "string" },
          json: { type: "boolean", default: false },
        },
        async run({ args }) {
          await runUndo(args);
        },
      }),
  },
  async run({ args }) {
    if (args._?.[0]) return;
    const project = resolveProject(args.dir);
    ensureDOMParser();
    const timeline = await describeProject(project.indexPath);
    console.log(
      args.json ? JSON.stringify(withMeta({ timeline }), null, 2) : formatTimeline(timeline),
    );
  },
});
