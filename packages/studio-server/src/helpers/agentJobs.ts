import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { loggedRunSchema, type AgentKind, type AgentTargetRef } from "./agentSchemas.js";

export { AGENT_KINDS } from "./agentSchemas.js";
export type { AgentKind, AgentTargetRef } from "./agentSchemas.js";

export interface AgentCommand {
  kind: AgentKind;
  label: string;
  command: string;
  args: string[];
}

export interface AgentJob {
  id: string;
  projectId: string;
  kind: AgentKind;
  label: string;
  /** Element or clip the instruction targets, for the run list. */
  target: string;
  targetRef?: AgentTargetRef;
  /** Model the harness ran with, when Studio picked one. */
  model?: string;
  /** The harness' own session id, so a run can be resumed or found in its logs. */
  sessionId?: string;
  instruction: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  /** Latest thing the agent did — the tool call or line it is on right now. */
  activity: string;
  message?: string;
  startedAt: number;
  endedAt?: number;
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
 * in-flight work is never lost behind a refresh. Per project the queue is
 * serial — two agents rewriting the same composition would clobber each other.
 *
 * The waiting jobs are an explicit array rather than a promise chain, because
 * the queue is editable: entries can be reordered or dropped before they start.
 */
const jobsByProject = new Map<string, AgentJob[]>();
const pendingByProject = new Map<string, PendingRun[]>();
const runningByProject = new Map<string, ChildProcess>();

const MAX_JOBS_PER_PROJECT = 24;
/** Where a project's run history lives, next to the rest of Studio's state. */
const RUN_LOG_PATH = join(".hyperframes", "agent-runs.jsonl");
const HYDRATED_PROJECTS = new Set<string>();
const AGENT_TIMEOUT_MS = 10 * 60 * 1000;

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
        target: job.target,
        targetRef: job.targetRef,
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
          label: entry.agent,
          target: entry.target,
          targetRef: entry.targetRef,
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

export function listAgentJobs(projectId: string, projectDir?: string): AgentJob[] {
  if (projectDir) hydrateFromRunLog(projectId, projectDir);
  return [...(jobsByProject.get(projectId) ?? [])].reverse();
}

function isActive(job: AgentJob): boolean {
  return job.status === "queued" || job.status === "running";
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
    return job;
  }

  // Running: mark first so the close handler doesn't overwrite the reason.
  job.status = "cancelled";
  job.message = "Stopped mid-run.";
  runningByProject.get(projectId)?.kill("SIGTERM");
  return job;
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

  // The visible list is newest-first; keep it consistent with the run order by
  // re-seating the queued jobs in their new sequence.
  const jobs = jobsByProject.get(projectId) ?? [];
  const queuedSlots = jobs.flatMap((job, index) => (job.status === "queued" ? [index] : []));
  const reordered = [...pending].reverse().map((item) => item.job);
  queuedSlots.forEach((slot, index) => {
    jobs[slot] = reordered[index]!;
  });
  return true;
}

/** The harness' session id, when it announces one (Claude Code does, per event). */
export function readSessionId(kind: AgentKind, line: string): string | null {
  if (kind !== "claude") return null;
  try {
    const event: unknown = JSON.parse(line.trim());
    if (isRecord(event) && typeof event.session_id === "string") return event.session_id;
  } catch {
    // Not a stream-json line.
  }
  return null;
}

/** Compact "what is it doing right now" line from one stdout chunk. */
export function readActivity(kind: AgentKind, line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Only Claude Code speaks stream-json; every other harness prints prose, so
  // its latest line is already the best "what is it doing" summary.
  if (kind !== "claude") return trimmed.slice(0, 90);

  // Claude Code speaks stream-json: surface tool calls and prose, skip the
  // hook/thinking/rate-limit bookkeeping that would only flicker.
  let event: unknown;
  try {
    event = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!isRecord(event) || event.type !== "assistant") return null;

  const message = isRecord(event.message) ? event.message : null;
  const content = Array.isArray(message?.content) ? message.content : [];
  for (const part of content) {
    if (!isRecord(part)) continue;
    if (part.type === "tool_use" && typeof part.name === "string") {
      const input = isRecord(part.input) ? part.input : {};
      const file = typeof input.file_path === "string" ? basename(input.file_path) : null;
      return file ? `${part.name} · ${file}` : part.name;
    }
    if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
      return part.text.trim().split("\n")[0]!.slice(0, 90);
    }
  }
  return null;
}

/** Final assistant message from a stream-json run, for the run list. */
function readResultMessage(kind: AgentKind, output: string): string | undefined {
  if (kind !== "claude") return output.trim().split("\n").at(-1)?.slice(0, 120);
  for (const line of output.split("\n").reverse()) {
    try {
      const event: unknown = JSON.parse(line);
      if (isRecord(event) && typeof event.result === "string") return event.result.slice(0, 120);
    } catch {
      // Non-JSON noise (a crash trace, for instance) — keep scanning upward.
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function runAgent(projectId: string, { job, agent, prompt, cwd }: PendingRun): Promise<void> {
  const settle = (resolve: () => void) => {
    appendRunLog(cwd, job);
    resolve();
  };
  return new Promise<void>((resolve) => {
    job.status = "running";
    job.activity = "Starting…";
    const child = spawn(agent.command, agent.args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    runningByProject.set(projectId, child);
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
      }
    });
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      runningByProject.delete(projectId);
      job.status = "failed";
      job.message = err.message;
      job.endedAt = Date.now();
      settle(resolve);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      runningByProject.delete(projectId);
      if (job.status === "cancelled") {
        job.activity = "";
        job.endedAt = Date.now();
        settle(resolve);
        return;
      }
      const failed = code !== 0;
      job.status = failed ? "failed" : "done";
      job.message =
        job.message ??
        (failed
          ? (output.trim().split("\n").at(-1)?.slice(0, 200) ?? `Exited with code ${code}`)
          : (readResultMessage(agent.kind, output) ?? `${agent.label} finished.`));
      job.activity = "";
      job.endedAt = Date.now();
      settle(resolve);
    });

    child.stdin.end(prompt);
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
  model?: string;
}): AgentJob {
  const job: AgentJob = {
    id: randomUUID(),
    projectId: opts.projectId,
    kind: opts.agent.kind,
    label: opts.agent.label,
    target: opts.target,
    targetRef: opts.targetRef,
    model: opts.model,
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
  void pump(opts.projectId);

  return job;
}

/** Start the next queued run for a project, one at a time. */
async function pump(projectId: string): Promise<void> {
  if (runningByProject.has(projectId)) return;
  const next = (pendingByProject.get(projectId) ?? []).shift();
  if (!next) return;
  if (next.job.status !== "queued") return pump(projectId);

  await runAgent(projectId, next);
  await pump(projectId);
}
