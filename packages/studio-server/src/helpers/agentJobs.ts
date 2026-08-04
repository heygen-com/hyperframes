import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { basename } from "node:path";

/** Which harness the command belongs to — drives the icon Studio shows. */
export type AgentKind = "claude" | "codex" | "hermes" | "openclaw" | "custom";

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
  instruction: string;
  status: "queued" | "running" | "done" | "failed";
  /** Latest thing the agent did — the tool call or line it is on right now. */
  activity: string;
  message?: string;
  startedAt: number;
  endedAt?: number;
}

/**
 * Runs live on the server, not in the tab: a reload re-reads them from here, so
 * in-flight work is never lost behind a refresh. Per project the queue is
 * serial — two agents rewriting the same composition would clobber each other.
 */
const jobsByProject = new Map<string, AgentJob[]>();
const queueByProject = new Map<string, Promise<void>>();

const MAX_JOBS_PER_PROJECT = 24;
const AGENT_TIMEOUT_MS = 10 * 60 * 1000;

export function listAgentJobs(projectId: string): AgentJob[] {
  return [...(jobsByProject.get(projectId) ?? [])].reverse();
}

export function clearFinishedAgentJobs(projectId: string): void {
  const jobs = jobsByProject.get(projectId) ?? [];
  jobsByProject.set(
    projectId,
    jobs.filter((job) => job.status === "queued" || job.status === "running"),
  );
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

function runAgent(job: AgentJob, agent: AgentCommand, prompt: string, cwd: string): Promise<void> {
  return new Promise((resolve) => {
    job.status = "running";
    job.activity = "Starting…";
    const child = spawn(agent.command, agent.args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
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
        const activity = readActivity(agent.kind, line);
        if (activity) job.activity = activity;
      }
    });
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      job.status = "failed";
      job.message = err.message;
      job.endedAt = Date.now();
      resolve();
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const failed = code !== 0;
      job.status = failed ? "failed" : "done";
      job.message =
        job.message ??
        (failed
          ? (output.trim().split("\n").at(-1)?.slice(0, 200) ?? `Exited with code ${code}`)
          : (readResultMessage(agent.kind, output) ?? `${agent.label} finished.`));
      job.activity = "";
      job.endedAt = Date.now();
      resolve();
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
}): AgentJob {
  const job: AgentJob = {
    id: randomUUID(),
    projectId: opts.projectId,
    kind: opts.agent.kind,
    label: opts.agent.label,
    target: opts.target,
    instruction: opts.instruction,
    status: "queued",
    activity: "",
    startedAt: Date.now(),
  };

  const jobs = jobsByProject.get(opts.projectId) ?? [];
  jobs.push(job);
  jobsByProject.set(opts.projectId, jobs.slice(-MAX_JOBS_PER_PROJECT));

  const tail = queueByProject.get(opts.projectId) ?? Promise.resolve();
  queueByProject.set(
    opts.projectId,
    tail.then(() => runAgent(job, opts.agent, opts.prompt, opts.projectDir)),
  );

  return job;
}
