import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { readPermissionRequest, refusalOption } from "./acp/permissions.js";
import { runAcpSession } from "./acp/session.js";
import {
  loggedRunSchema,
  overlayStateSchema,
  type AgentKind,
  type AgentStatus,
  type AgentTargetRef,
  type OverlayState,
  type PermissionRequest,
} from "./agentSchemas.js";

export { AGENT_KINDS } from "./agentSchemas.js";
export type {
  AgentKind,
  AgentTargetRef,
  OverlayState,
  PermissionOption,
  PermissionRequest,
} from "./agentSchemas.js";

export interface AgentCommand {
  kind: AgentKind;
  label: string;
  command: string;
  args: string[];
  /**
   * How the prompt reaches the harness on stdin.
   *
   * `text` writes it and closes stdin, which ends the conversation with it.
   * `stream-json` writes it as a message envelope and leaves stdin open, so a
   * correction can be sent into the run that is already going instead of
   * stopping it and starting again.
   */
  promptFormat?: "text" | "stream-json";
  /**
   * How Studio talks to the harness.
   *
   * `native` (the default) spawns the CLI and reads whatever it prints, which
   * needs a parser per harness and leaves an agent that wants to ask a question
   * with nobody to ask. `acp` speaks the Agent Client Protocol: the same run,
   * over a published contract, with the session id and the reason the turn
   * ended coming back as data rather than being inferred.
   */
  transport?: "native" | "acp";
}

export interface AgentJob {
  id: string;
  projectId: string;
  kind: AgentKind;
  label: string;
  /** Element or clip the instruction targets, for the run list. */
  target: string;
  targetRef?: AgentTargetRef;
  /** The rest of a multi-selection this run covers. */
  targetRefs?: AgentTargetRef[];
  /** What the target is: one element, or a stretch of the timeline. */
  targetKind?: "element" | "range";
  /** Corrections sent after the run was asked for, oldest first. */
  steers?: string[];
  /** Model the harness ran with, when Studio picked one. */
  model?: string;
  /** Reasoning effort the run asked for, when the harness takes one. */
  effort?: string;
  /** The harness' own session id, so a run can be resumed or found in its logs. */
  sessionId?: string;
  instruction: string;
  status: AgentStatus;
  /** What the run is waiting on the user for, while it is waiting. */
  permission?: PermissionRequest;
  /** Latest thing the agent did — the tool call or line it is on right now. */
  activity: string;
  /** What the agent said the selection overlay should show, if it said anything. */
  overlay?: OverlayState;
  message?: string;
  startedAt: number;
  endedAt?: number;
}

/**
 * Which runs must not overlap: the element a run edits, as a string.
 *
 * Two runs share a lane when they would be rewriting the same thing. A run with
 * no element targets the composition at large, so it gets its own lane rather
 * than blocking every element in the file.
 */
export function laneFor(job: AgentJob): string {
  const ref = job.targetRef;
  if (!ref) return "composition";
  const element = ref.id ?? `${ref.selector ?? "?"}[${ref.selectorIndex ?? 0}]`;
  return `${ref.sourceFile ?? ""}::${element}`;
}

/** Everything needed to start a queued job once its turn comes. */
interface PendingRun {
  job: AgentJob;
  agent: AgentCommand;
  prompt: string;
  cwd: string;
}

/**
 * Runs live on the server, not in the tab: a reload re-reads them from here, so
 * in-flight work is never lost behind a refresh.
 *
 * Queueing is per *element*, not per project. Two runs on the same element must
 * be serial — the second would be editing what the first is still rewriting —
 * but a run on the headline has no reason to wait on a run on the footer, and
 * asking for one edit should never mean waiting out an unrelated one. Each
 * element is a lane; lanes run alongside each other, up to a cap so a burst of
 * asks cannot spawn an unbounded number of agents.
 *
 * The waiting jobs are an explicit array rather than a promise chain, because
 * the queue is editable: entries can be reordered or dropped before they start.
 */
const jobsByProject = new Map<string, AgentJob[]>();
const pendingByProject = new Map<string, PendingRun[]>();
/** Live child processes by job id, so any one of them can be stopped. */
const runningByJob = new Map<string, ChildProcess>();
/** What each live run was started with, so a steer can rebuild it. */
const activeRuns = new Map<string, PendingRun>();
/** Runs whose stdin is still open, and how to say something more to them. */
const openRuns = new Map<string, (text: string) => void>();
/** Runs stopped on a question, and how to settle the one they asked. */
const askedByJob = new Map<string, Asked>();

/** A question a run is stopped on, and the two ways the wait can end. */
interface Asked {
  answer: (optionId: string) => void;
  fail: (error: Error) => void;
}
/** Element lanes currently busy, per project. */
const busyLanes = new Map<string, Set<string>>();

/** Agents in flight per project at once. Beyond this, lanes wait their turn. */
const MAX_PARALLEL_RUNS = 4;
const MAX_JOBS_PER_PROJECT = 24;
/** Where a project's run history lives, next to the rest of Studio's state. */
const RUN_LOG_PATH = join(".hyperframes", "agent-runs.jsonl");
const HYDRATED_PROJECTS = new Set<string>();
const AGENT_TIMEOUT_MS = 10 * 60 * 1000;
/**
 * How long a run waits on an answer before deciding for itself.
 *
 * Shorter than the run timeout, because a run that has stopped to ask is not
 * doing anything: leaving it holding its element for the full ten minutes
 * blocks every later edit to that element on a question nobody is looking at.
 * Read per call so a deployment that wants a longer leash can set one.
 */
function permissionTimeoutMs(): number {
  const set = Number(process.env.HYPERFRAMES_AGENT_ASK_TIMEOUT_MS);
  return Number.isFinite(set) && set > 0 ? set : 5 * 60 * 1000;
}

/**
 * Append a settled run to the project's log. The tray only keeps the recent
 * ones in memory; this file is the durable record of what was asked for, on
 * which element, and how it went — one JSON object per line, so it is greppable
 * by hand and re-readable by Studio.
 */
function appendRunLog(projectDir: string, job: AgentJob): void {
  const file = join(projectDir, RUN_LOG_PATH);
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(
      file,
      `${JSON.stringify({
        at: new Date(job.startedAt).toISOString(),
        kind: job.kind,
        model: job.model,
        effort: job.effort,
        target: job.target,
        targetRef: job.targetRef,
        targetRefs: job.targetRefs,
        targetKind: job.targetKind,
        steers: job.steers,
        sessionId: job.sessionId,
        instruction: job.instruction,
        status: job.status,
        seconds: Math.round(((job.endedAt ?? Date.now()) - job.startedAt) / 1000),
        agent: job.label,
        result: job.message ?? "",
      })}\n`,
      "utf-8",
    );
  } catch {
    // A read-only project directory must not take the run down with it.
  }
}

/** Logs written before runs carried a kind still name their harness. */
function kindFromLabel(label: string): AgentKind {
  const known: AgentKind[] = ["claude", "codex", "hermes", "openclaw"];
  return known.find((kind) => label.toLowerCase().includes(kind)) ?? "custom";
}

/** Re-seat past runs after a server restart so the history survives it. */
function hydrateFromRunLog(projectId: string, projectDir: string): void {
  if (HYDRATED_PROJECTS.has(projectId)) return;
  HYDRATED_PROJECTS.add(projectId);

  const file = join(projectDir, RUN_LOG_PATH);
  if (!existsSync(file)) return;
  try {
    const lines = readFileSync(file, "utf-8").trim().split("\n").slice(-MAX_JOBS_PER_PROJECT);
    const restored = lines.flatMap((line): AgentJob[] => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        return [];
      }
      const result = loggedRunSchema.safeParse(parsed);
      if (!result.success) return [];
      const entry = result.data;
      const startedAt = Date.parse(entry.at);
      return [
        {
          id: randomUUID(),
          projectId,
          kind: entry.kind ?? kindFromLabel(entry.agent),
          model: entry.model,
          effort: entry.effort,
          label: entry.agent,
          target: entry.target,
          targetRef: entry.targetRef,
          targetRefs: entry.targetRefs,
          targetKind: entry.targetKind,
          steers: entry.steers,
          sessionId: entry.sessionId,
          instruction: entry.instruction,
          // Anything that was mid-flight when the server stopped is over now.
          status: entry.status === "queued" || entry.status === "running" ? "failed" : entry.status,
          activity: "",
          message: entry.result || undefined,
          startedAt,
          endedAt: startedAt + entry.seconds * 1000,
        },
      ];
    });
    jobsByProject.set(projectId, [...restored, ...(jobsByProject.get(projectId) ?? [])]);
  } catch {
    // A corrupt log is history, not state — start the tray empty instead.
  }
}

/** One run by id, for callers that need to look at it before acting. */
export function findAgentJob(projectId: string, jobId: string): AgentJob | null {
  return (jobsByProject.get(projectId) ?? []).find((job) => job.id === jobId) ?? null;
}

export function listAgentJobs(projectId: string, projectDir?: string): AgentJob[] {
  if (projectDir) hydrateFromRunLog(projectId, projectDir);
  return [...(jobsByProject.get(projectId) ?? [])].reverse();
}

/**
 * Whether this run still holds its place.
 *
 * A run waiting on permission counts: it is holding its element, it can be
 * cancelled, and it has not finished. It is only the tray's "how many are
 * working" count that must tell the two apart, which it does by status.
 */
function isActive(job: AgentJob): boolean {
  return (
    job.status === "queued" || job.status === "running" || job.status === "awaiting-permission"
  );
}

/** Whether this run is holding an element, so nothing else may edit it. */
function holdsLane(job: AgentJob): boolean {
  return job.status === "running" || job.status === "awaiting-permission";
}

export function clearFinishedAgentJobs(projectId: string): void {
  jobsByProject.set(projectId, (jobsByProject.get(projectId) ?? []).filter(isActive));
}

/**
 * Drop a run. A queued one never starts; a running one is killed, which is the
 * only way to stop an agent that is off doing the wrong thing.
 */
export function cancelAgentJob(projectId: string, jobId: string, dir?: string): AgentJob | null {
  const job = (jobsByProject.get(projectId) ?? []).find((candidate) => candidate.id === jobId);
  if (!job || !isActive(job)) return null;

  if (job.status === "queued") {
    pendingByProject.set(
      projectId,
      (pendingByProject.get(projectId) ?? []).filter((pending) => pending.job.id !== jobId),
    );
    job.status = "cancelled";
    job.message = "Cancelled before it started.";
    job.endedAt = Date.now();
    if (dir) appendRunLog(dir, job);
    // Whatever was waiting behind it on that element can go now.
    pump(projectId);
    return job;
  }

  // Running: mark first so the close handler doesn't overwrite the reason.
  job.status = "cancelled";
  job.message = "Stopped mid-run.";
  stopRun(jobId, "Cancelled while it was waiting for an answer.");
  return job;
}

/**
 * Make a waiting run the one that is happening.
 *
 * Its element is busy — that is why it is waiting — so the run holding that
 * lane is stopped and this one takes it. Anything else in flight elsewhere is
 * left alone: taking over an element is not a reason to interrupt work on the
 * rest of the composition.
 */
export function promoteAgentJob(projectId: string, jobId: string, dir?: string): AgentJob | null {
  const job = findAgentJob(projectId, jobId);
  if (!job || job.status !== "queued") return null;

  const lane = laneFor(job);
  const blocking = (jobsByProject.get(projectId) ?? []).find(
    (candidate) => holdsLane(candidate) && laneFor(candidate) === lane,
  );
  if (blocking) cancelAgentJob(projectId, blocking.id, dir);

  // Front of the queue, so it is the next thing the pump can start.
  moveAgentJob(projectId, jobId, 0);
  pump(projectId);
  return job;
}

/**
 * Stop a run that is under way.
 *
 * A run waiting on permission is asleep inside a promise nothing else will
 * settle, so killing its process alone would leave that promise pending for
 * good. The question is ended first, then the process.
 */
function stopRun(jobId: string, why: string): void {
  askedByJob.get(jobId)?.fail(new Error(why));
  runningByJob.get(jobId)?.kill("SIGTERM");
}

/**
 * Answer the question a run is waiting on.
 *
 * The options are the agent's own, so the id has to be one of them: forwarding
 * anything else would be Studio inventing a choice the agent never offered, and
 * an agent that gets an unknown option id is entitled to do anything with it.
 */
export function answerAgentJob(
  projectId: string,
  jobId: string,
  optionId: string,
): { job: AgentJob } | { refused: "not-waiting" | "not-offered" } {
  const job = findAgentJob(projectId, jobId);
  const asked = askedByJob.get(jobId);
  if (!job || !asked || job.status !== "awaiting-permission") return { refused: "not-waiting" };
  if (!job.permission?.options.some((option) => option.optionId === optionId)) {
    return { refused: "not-offered" };
  }

  asked.answer(optionId);
  return { job };
}

/** How a correction is written into a prompt that was already built. */
function amend(prompt: string, text: string): string {
  return `${prompt}\n\nAmended instruction (this supersedes the request above where they disagree):\n${text}`;
}

/**
 * Change what a run is being asked to do, without losing the element context it
 * was built from.
 *
 * A waiting run is simply amended in place — nothing has happened yet, so the
 * correction rides along with the original prompt. A run already in flight
 * cannot be talked to: every harness takes its prompt on stdin and closes it,
 * and none of them accept input mid-run. So it is stopped and asked again, with
 * `resumed` carrying the harness' own resume flags when Studio knows them —
 * then the second run picks up where the first left off instead of re-reading
 * the composition from scratch.
 */
export function steerAgentJob(opts: {
  projectId: string;
  jobId: string;
  text: string;
  projectDir: string;
  /** The same harness, told to resume this run's session. Null when it cannot. */
  resumed: AgentCommand | null;
}): AgentJob | null {
  const job = findAgentJob(opts.projectId, opts.jobId);
  const text = opts.text.trim();
  if (!job || !text || !isActive(job)) return null;
  job.steers = [...(job.steers ?? []), text];

  if (job.status === "queued") {
    const waiting = (pendingByProject.get(opts.projectId) ?? []).find(
      (entry) => entry.job.id === opts.jobId,
    );
    if (!waiting) return null;
    waiting.prompt = amend(waiting.prompt, text);
    return job;
  }

  const run = activeRuns.get(opts.jobId);
  if (!run) return null;

  // The run is still listening: say it into the turn that is already going.
  // Nothing is stopped, nothing is resumed, and the agent keeps everything it
  // has read so far — which is the whole point of holding stdin open.
  const speak = openRuns.get(opts.jobId);
  if (speak) {
    job.activity = "Steering…";
    speak(text);
    return job;
  }

  job.status = "cancelled";
  job.message = "Steered mid-run.";
  stopRun(opts.jobId, "Steered while it was waiting for an answer.");

  // Resuming means the session already holds the composition and the original
  // request, so the follow-up is the correction alone.
  return enqueueAgentJob({
    projectId: opts.projectId,
    projectDir: opts.projectDir,
    agent: opts.resumed ?? run.agent,
    prompt: opts.resumed ? text : amend(run.prompt, text),
    instruction: text,
    target: job.target,
    targetRef: job.targetRef,
    targetRefs: job.targetRefs,
    targetKind: job.targetKind,
    model: job.model,
    effort: job.effort,
    steers: job.steers,
  });
}

/**
 * Move a queued run to a new slot. Positions index the queue itself (0 is next
 * up), so the caller never has to reason about finished or running entries.
 */
export function moveAgentJob(projectId: string, jobId: string, toIndex: number): boolean {
  const pending = pendingByProject.get(projectId) ?? [];
  const from = pending.findIndex((entry) => entry.job.id === jobId);
  if (from === -1) return false;

  const to = Math.max(0, Math.min(pending.length - 1, toIndex));
  if (to === from) return true;

  const [entry] = pending.splice(from, 1);
  pending.splice(to, 0, entry!);
  pendingByProject.set(projectId, pending);

  // Re-seat the queued jobs so the list agrees with the order they will run in.
  // Both are oldest-first here — the list is only reversed on its way out to the
  // browser — so the pending order is written in as-is. Reversing it here made
  // the tray report the queue backwards after every move: it would say the last
  // waiting run was next up while the server ran the first.
  const jobs = jobsByProject.get(projectId) ?? [];
  const queuedSlots = jobs.flatMap((job, index) => (job.status === "queued" ? [index] : []));
  queuedSlots.forEach((slot, index) => {
    jobs[slot] = pending[index]!.job;
  });
  return true;
}

/**
 * The harness' own session id, when it announces one.
 *
 * It is what a run can be resumed from, so steering keeps the agent's context
 * instead of starting the conversation again. Each harness says it differently:
 * Claude Code puts it in every stream-json event, Codex prints it once in the
 * header it writes before it starts.
 */
export function readSessionId(kind: AgentKind, line: string): string | null {
  const event = parseEvent(line);
  if (!event) return null;
  // Claude Code repeats it on every event; Codex opens with `thread.started`.
  if (kind === "claude" && typeof event.session_id === "string") return event.session_id;
  if (kind === "codex" && event.type === "thread.started" && typeof event.thread_id === "string") {
    return event.thread_id;
  }
  return null;
}

/** One line of a harness' event stream, when that is what it is. */
function parseEvent(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** The `item` of a Codex `item.started` / `item.completed` event. */
function codexItem(line: string): Record<string, unknown> | null {
  const event = parseEvent(line);
  if (!event || typeof event.type !== "string" || !event.type.startsWith("item.")) return null;
  return isRecord(event.item) ? event.item : null;
}

/** The marker an agent writes to drive the overlay; see OverlayState. */
const OVERLAY_MARKER = "hf:overlay";

/**
 * Pull the JSON object that starts at `from` out of `text`.
 *
 * The marker is written inline in prose (`<!-- hf:overlay {…} -->`), so there is
 * no line to split on: the object ends where its own braces balance. Quoted
 * strings are tracked, or a label containing a brace would cut it short.
 */
function extractJsonObject(text: string, from: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = from; i < text.length; i++) {
    const char = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return text.slice(from, i + 1);
  }
  return null;
}

/**
 * Every line of the agent's own prose in one chunk.
 *
 * The harnesses that speak events escape their text inside JSON, so a marker
 * has to be read after decoding rather than off the raw line. The ones that
 * print prose are already prose.
 */
function proseLines(kind: AgentKind, line: string): string[] {
  if (kind === "claude") {
    const event = parseEvent(line);
    if (!event || event.type !== "assistant") return [];
    const message = isRecord(event.message) ? event.message : null;
    const content = Array.isArray(message?.content) ? message.content : [];
    return content.flatMap((part) =>
      isRecord(part) && part.type === "text" && typeof part.text === "string" ? [part.text] : [],
    );
  }
  if (kind === "codex") {
    const item = codexItem(line);
    return item?.type === "agent_message" && typeof item.text === "string" ? [item.text] : [];
  }
  return [line];
}

/**
 * An overlay state the agent declared for itself, if this chunk carries one.
 *
 * The last declaration in a chunk wins: an agent that narrates several steps in
 * one message is describing where it ended up.
 */
export function readOverlayState(kind: AgentKind, line: string): OverlayState | null {
  let latest: OverlayState | null = null;
  for (const text of proseLines(kind, line)) {
    let at = text.indexOf(OVERLAY_MARKER);
    while (at !== -1) {
      const start = text.indexOf("{", at + OVERLAY_MARKER.length);
      const json = start === -1 ? null : extractJsonObject(text, start);
      if (json) {
        try {
          const parsed = overlayStateSchema.safeParse(JSON.parse(json));
          if (parsed.success) latest = parsed.data;
        } catch {
          // A malformed declaration is noise, not a failed run.
        }
      }
      at = text.indexOf(OVERLAY_MARKER, at + OVERLAY_MARKER.length);
    }
  }
  return latest;
}

/**
 * The same text with its overlay declarations taken out.
 *
 * A declaration is addressed to the canvas, not to the reader: left in, it
 * becomes the run's "what is it doing" line and the tray shows raw JSON.
 */
export function stripOverlayMarkers(text: string): string {
  let out = "";
  let cursor = 0;
  for (
    let at = text.indexOf(OVERLAY_MARKER);
    at !== -1;
    at = text.indexOf(OVERLAY_MARKER, cursor)
  ) {
    const start = text.indexOf("{", at + OVERLAY_MARKER.length);
    const json = start === -1 ? null : extractJsonObject(text, start);
    if (!json) break;
    // Swallow the HTML comment the contract wraps it in, when there is one.
    const opens = text.lastIndexOf("<!--", at);
    const from = opens !== -1 && text.slice(opens, at).trim() === "<!--" ? opens : at;
    const after = start + json.length;
    const closes = text.startsWith(" -->", after) ? after + 4 : after;
    out += text.slice(cursor, from);
    cursor = closes;
  }
  return (out + text.slice(cursor)).trim();
}

/** Whether this chunk is the harness reporting its turn finished. */
function isTurnComplete(line: string): boolean {
  return parseEvent(line)?.type === "result";
}

/** Compact "what is it doing right now" line from one stdout chunk. */
export function readActivity(kind: AgentKind, line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  if (kind === "claude") return claudeActivity(trimmed);
  if (kind === "codex") return codexActivity(trimmed);
  // Prose harnesses: the latest line already is the summary, minus any overlay
  // declaration, which is for the canvas rather than for the reader.
  return stripOverlayMarkers(trimmed).slice(0, 90) || null;
}

/** Tool calls and prose out of stream-json; bookkeeping events are skipped. */
function claudeActivity(line: string): string | null {
  const event = parseEvent(line);
  if (!event || event.type !== "assistant") return null;

  const message = isRecord(event.message) ? event.message : null;
  const content = Array.isArray(message?.content) ? message.content : [];
  for (const part of content) {
    if (!isRecord(part)) continue;
    if (part.type === "tool_use" && typeof part.name === "string") {
      const input = isRecord(part.input) ? part.input : {};
      const file = typeof input.file_path === "string" ? basename(input.file_path) : null;
      return file ? `${part.name} · ${file}` : part.name;
    }
    if (part.type === "text" && typeof part.text === "string") {
      const said = stripOverlayMarkers(part.text).split("\n")[0]?.trim();
      if (said) return said.slice(0, 90);
    }
  }
  return null;
}

/**
 * The same, from Codex's own items. `error` items are its warnings channel
 * (a stale hooks file, a trimmed skill description) rather than what the run is
 * doing, so they never become the activity line.
 */
function codexActivity(line: string): string | null {
  const item = codexItem(line);
  if (!item) return null;

  if (item.type === "file_change") {
    const changes = Array.isArray(item.changes) ? item.changes : [];
    const first = changes.find(isRecord);
    const path = typeof first?.path === "string" ? basename(first.path) : null;
    return path ? `Edit · ${path}` : "Edit";
  }
  if (item.type === "command_execution" && typeof item.command === "string") {
    // Codex wraps its shell in `/bin/zsh -lc '…'`; the command is the payload.
    const command = /-lc\s+'([\s\S]*)'\s*$/.exec(item.command)?.[1] ?? item.command;
    return `Shell · ${command.split("\n")[0]!.slice(0, 70)}`;
  }
  if (item.type === "agent_message" && typeof item.text === "string") {
    const said = stripOverlayMarkers(item.text).split("\n")[0]?.trim();
    if (said) return said.slice(0, 90);
  }
  return null;
}

/**
 * Why a run failed, in one line the user can act on.
 *
 * Harnesses print their errors as pretty JSON, so the last line of output is
 * usually `}` — technically the tail, and useless. The message inside it is
 * what the user needs, so a trailing JSON blob is read for one instead.
 */
export function readFailureMessage(output: string): string | null {
  const text = output.trim();
  if (!text) return null;

  // A harness that speaks events reports failures as error items. The last one
  // is the reason the run stopped; the earlier ones are usually config gripes.
  const errors = text
    .split("\n")
    .map((line) => codexItem(line))
    .filter((item) => item?.type === "error" && typeof item.message === "string");
  const last = errors.at(-1)?.message;
  if (typeof last === "string" && last.trim()) return last.trim().slice(0, 200);

  // The blob may be the whole output or just its tail, so every place a line
  // starts an object is tried, outermost first: an inner `{` would parse to
  // nothing, and the reason usually sits at the top level.
  if (text.endsWith("}")) {
    for (const start of objectStarts(text)) {
      try {
        const message = findMessage(JSON.parse(text.slice(start)) as unknown);
        if (message) return message.slice(0, 200);
      } catch {
        // Not an object boundary after all — try the next one.
      }
    }
  }
  // A closing brace or bracket is punctuation, not a reason: walk up past it.
  const lines = text.split("\n").map((line) => line.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (line.length > 1 && !/^[}\]),]+$/.test(line)) return line.slice(0, 200);
  }
  return null;
}

/** Every offset where a line begins an object, outermost first. */
function objectStarts(text: string): number[] {
  const starts: number[] = [];
  if (text.startsWith("{")) starts.push(0);
  for (let i = text.indexOf("\n{"); i !== -1; i = text.indexOf("\n{", i + 1)) starts.push(i + 1);
  return starts;
}

/** First `message` string anywhere in a parsed error blob. */
function findMessage(value: unknown): string | null {
  if (!isRecord(value)) return null;
  if (typeof value.message === "string" && value.message.trim()) return value.message.trim();
  for (const nested of Object.values(value)) {
    const found = findMessage(nested);
    if (found) return found;
  }
  return null;
}

/**
 * How much of the agent's answer is kept.
 *
 * The answer is shown in full, in a surface the user can scroll, so the cap is
 * only here to stop a runaway response from living in memory and in the run
 * log — not to fit a layout. The old 120 characters cut answers mid-sentence.
 */
const MAX_RESULT_CHARS = 4000;

/** What the agent said last, for the run list and the answer bubble. */
function readResultMessage(kind: AgentKind, output: string): string | undefined {
  const lines = output.split("\n").reverse();
  if (kind === "claude") {
    for (const line of lines) {
      const event = parseEvent(line);
      if (typeof event?.result === "string") return event.result.slice(0, MAX_RESULT_CHARS);
    }
    return undefined;
  }
  if (kind === "codex") {
    for (const line of lines) {
      const item = codexItem(line);
      if (item?.type === "agent_message" && typeof item.text === "string") {
        return stripOverlayMarkers(item.text).slice(0, MAX_RESULT_CHARS);
      }
    }
    return undefined;
  }
  return output.trim().split("\n").at(-1)?.slice(0, MAX_RESULT_CHARS);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function runAgent(run: PendingRun): Promise<void> {
  return run.agent.transport === "acp" ? runOverAcp(run) : runNatively(run);
}

/**
 * Start the clock on a run.
 *
 * A function rather than two assignments so the status stays a variable to the
 * compiler: cancelling writes it from another call entirely, and code that
 * reads it after an await must not be told it is still whatever it was set to.
 */
function markRunning(job: AgentJob): void {
  job.status = "running";
  job.activity = "Starting…";
}

/**
 * How a run ends once the process is gone, whichever transport it used.
 *
 * A working state the agent declared is over the moment the run is: leaving
 * "editing" on the canvas would outlive the edit itself.
 */
function closeOut(job: AgentJob, cwd: string): void {
  runningByJob.delete(job.id);
  askedByJob.delete(job.id);
  job.permission = undefined;
  activeRuns.delete(job.id);
  openRuns.delete(job.id);
  if (job.overlay && job.overlay.kind !== "done" && job.overlay.kind !== "failed") {
    job.overlay = undefined;
  }
  job.activity = "";
  job.endedAt = Date.now();
  appendRunLog(cwd, job);
}

/** What a finished ACP turn means for the run, by the reason it ended. */
function settleAcpTurn(job: AgentJob, label: string, stopReason: string, said: string): void {
  const answer = stripOverlayMarkers(said).slice(0, MAX_RESULT_CHARS);
  if (stopReason === "cancelled") {
    job.status = "cancelled";
    job.message ??= "Stopped mid-run.";
    return;
  }
  if (stopReason !== "end_turn") {
    job.status = "failed";
    // The agent's own words are the useful half; the reason says which wall it
    // hit — a refusal and a token limit read very differently to the user.
    job.message = answer || `${label} stopped: ${stopReason.replace(/_/g, " ")}`;
    return;
  }
  job.status = "done";
  job.message = answer || `${label} finished.`;
}

/**
 * Stop the run on the agent's question and wait for the user.
 *
 * The wait is bounded: an agent held open forever holds its element with it. On
 * running out, the agent's own refusal is the answer when it offered one, and
 * the run fails naming the tool when it did not — deciding yes on the user's
 * behalf is the one thing this must never do.
 */
function askForPermission(
  job: AgentJob,
  params: Record<string, unknown>,
  toolTitles: Map<string, string>,
): Promise<{ optionId: string }> {
  const request = readPermissionRequest(params, (id) => toolTitles.get(id));
  if (!request) {
    return Promise.reject(
      new Error(`${job.label} asked for permission in a form Studio could not read`),
    );
  }

  job.status = "awaiting-permission";
  job.permission = request;
  job.activity = `Waiting on you · ${request.tool}`;

  return new Promise((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      askedByJob.delete(job.id);
      job.permission = undefined;
    };
    const waitMs = permissionTimeoutMs();
    const timer = setTimeout(() => {
      done();
      const refusal = refusalOption(request);
      if (!refusal) {
        // Nothing on offer means no, so there is no answer left to give: the
        // run is over as far as Studio is concerned, and saying so to the agent
        // is not enough — an agent is free to sit on a refused request, and
        // this one is holding an element while it does.
        job.message = `No answer to ${request.tool} within ${waitMs / 1000}s`;
        reject(new Error(job.message));
        stopRun(job.id, job.message);
        return;
      }
      markRunning(job);
      resolve({ optionId: refusal.optionId });
    }, waitMs);

    askedByJob.set(job.id, {
      answer: (optionId) => {
        done();
        markRunning(job);
        resolve({ optionId });
      },
      fail: (error) => {
        done();
        reject(error);
      },
    });
  });
}

/**
 * Drive a run over ACP.
 *
 * The job's fields are filled from the protocol's own notifications rather than
 * from parsed stdout, but everything downstream — the overlay contract, the
 * activity line, the run log — is the same code the native path uses, because
 * it is the same product behaviour.
 */
async function runOverAcp({ job, agent, prompt, cwd }: PendingRun): Promise<void> {
  markRunning(job);
  activeRuns.set(job.id, { job, agent, prompt, cwd });

  let timer: NodeJS.Timeout | undefined;
  // What the agent called each tool call, for describing the ones it asks about.
  const toolTitles = new Map<string, string>();
  try {
    const outcome = await runAcpSession({
      command: agent.command,
      args: agent.args,
      cwd,
      prompt,
      model: job.model,
      effort: job.effort,
      hooks: {
        onSpawn: (child) => {
          runningByJob.set(job.id, child);
          timer = setTimeout(() => {
            child.kill("SIGTERM");
            job.message = `${agent.label} timed out after ${AGENT_TIMEOUT_MS / 60000} minutes`;
          }, AGENT_TIMEOUT_MS);
        },
        onSessionId: (sessionId) => (job.sessionId ??= sessionId),
        onPermission: (params) => askForPermission(job, params, toolTitles),
        onUpdate: (update) => {
          if (update.tool) toolTitles.set(update.tool.id, update.tool.title);
          if (update.message) {
            const overlay = readOverlayState("custom", update.message);
            if (overlay) job.overlay = overlay;
          }
          // "custom" is the prose reader: an ACP update is already the text,
          // with no harness envelope left to unwrap.
          const activity = update.activity ? readActivity("custom", update.activity) : null;
          if (activity) job.activity = activity;
        },
      },
    });
    settleAcpTurn(job, agent.label, outcome.stopReason, outcome.said);
  } catch (error) {
    // Cancelling kills the process, so the failure it causes is expected and
    // must not overwrite the reason the run was stopped.
    if (job.status !== "cancelled") {
      job.status = "failed";
      // A message already set is the reason we gave up; the error that follows
      // is only the process dying because we did.
      job.message ??= error instanceof Error ? error.message : String(error);
    }
  } finally {
    clearTimeout(timer);
    closeOut(job, cwd);
  }
}

function runNatively({ job, agent, prompt, cwd }: PendingRun): Promise<void> {
  return new Promise<void>((resolve) => {
    job.status = "running";
    job.activity = "Starting…";
    const child = spawn(agent.command, agent.args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    runningByJob.set(job.id, child);
    activeRuns.set(job.id, { job, agent, prompt, cwd });

    const streaming = agent.promptFormat === "stream-json";
    /** One user message, in the envelope a streaming harness reads. */
    const sendMessage = (text: string) =>
      child.stdin.write(
        `${JSON.stringify({
          type: "user",
          message: { role: "user", content: [{ type: "text", text }] },
        })}\n`,
      );
    let output = "";
    let pending = "";

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      job.message = `${agent.label} timed out after ${AGENT_TIMEOUT_MS / 60000} minutes`;
    }, AGENT_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      pending += chunk.toString();
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        job.sessionId ??= readSessionId(agent.kind, line) ?? undefined;
        const activity = readActivity(agent.kind, line);
        if (activity) job.activity = activity;
        const overlay = readOverlayState(agent.kind, line);
        if (overlay) job.overlay = overlay;
        // The turn is over; nothing more will be said to it, so let it exit.
        if (streaming && isTurnComplete(line)) {
          openRuns.delete(job.id);
          child.stdin.end();
        }
      }
    });
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      job.status = "failed";
      job.message = err.message;
      closeOut(job, cwd);
      resolve();
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      // Cancelling already wrote the reason; the exit it caused is not news.
      if (job.status !== "cancelled") {
        const failed = code !== 0;
        job.status = failed ? "failed" : "done";
        job.message =
          job.message ??
          (failed
            ? (readFailureMessage(output) ?? `Exited with code ${code}`)
            : (readResultMessage(agent.kind, output) ?? `${agent.label} finished.`));
      }
      closeOut(job, cwd);
      resolve();
    });

    if (streaming) {
      // stdin stays open: the run is a conversation until its turn reports back.
      openRuns.set(job.id, sendMessage);
      sendMessage(prompt);
    } else {
      child.stdin.end(prompt);
    }
  });
}

/**
 * Queue a run. Returns immediately with the job so the composer can accept the
 * next instruction while this one is still in flight.
 */
export function enqueueAgentJob(opts: {
  projectId: string;
  projectDir: string;
  agent: AgentCommand;
  prompt: string;
  instruction: string;
  target: string;
  targetRef?: AgentTargetRef;
  targetRefs?: AgentTargetRef[];
  targetKind?: "element" | "range";
  model?: string;
  effort?: string;
  steers?: string[];
}): AgentJob {
  const job: AgentJob = {
    id: randomUUID(),
    projectId: opts.projectId,
    kind: opts.agent.kind,
    label: opts.agent.label,
    target: opts.target,
    targetRef: opts.targetRef,
    targetRefs: opts.targetRefs,
    targetKind: opts.targetKind,
    steers: opts.steers,
    model: opts.model,
    effort: opts.effort,
    instruction: opts.instruction,
    status: "queued",
    activity: "",
    startedAt: Date.now(),
  };

  const jobs = jobsByProject.get(opts.projectId) ?? [];
  jobs.push(job);
  jobsByProject.set(opts.projectId, jobs.slice(-MAX_JOBS_PER_PROJECT));

  const pending = pendingByProject.get(opts.projectId) ?? [];
  pending.push({ job, agent: opts.agent, prompt: opts.prompt, cwd: opts.projectDir });
  pendingByProject.set(opts.projectId, pending);
  pump(opts.projectId);

  return job;
}

/**
 * Start whatever can start: every waiting run whose element is free, in queue
 * order, up to the parallel cap. Called again whenever a run ends, so a lane
 * that was blocked picks up the moment it clears.
 */
function pump(projectId: string): void {
  const lanes = busyLanes.get(projectId) ?? new Set<string>();
  busyLanes.set(projectId, lanes);
  const pending = pendingByProject.get(projectId) ?? [];

  for (let i = 0; i < pending.length && lanes.size < MAX_PARALLEL_RUNS; ) {
    const next = pending[i]!;
    // Cancelled before it started: drop it without taking a slot.
    if (next.job.status !== "queued") {
      pending.splice(i, 1);
      continue;
    }
    const lane = laneFor(next.job);
    // Its element is busy. Leave it queued and look at the next one, which may
    // be about something else entirely.
    if (lanes.has(lane)) {
      i++;
      continue;
    }

    pending.splice(i, 1);
    lanes.add(lane);
    void runAgent(next).finally(() => {
      lanes.delete(lane);
      pump(projectId);
    });
  }
  pendingByProject.set(projectId, pending);
}
