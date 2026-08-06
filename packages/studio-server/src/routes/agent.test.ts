import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listAgentCommands,
  registerAgentRoutes,
  resolveAgentCommand,
  resumedAgentCommand,
} from "./agent";
import {
  readActivity,
  readFailureMessage,
  readOverlayState,
  readSessionId,
  type AgentJob,
} from "../helpers/agentJobs";
import type { StudioApiAdapter } from "../types";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.HYPERFRAMES_AGENT_CMD;
  delete process.env.HYPERFRAMES_AGENT;
  delete process.env.HYPERFRAMES_AGENT_ICON;
});

function createProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-agent-test-"));
  tempDirs.push(dir);
  return dir;
}

/** Stands in for a harness CLI: reads the prompt on stdin, edits a file in cwd. */
function createFakeAgent(): string {
  const dir = createProjectDir();
  const script = join(dir, "fake-agent.mjs");
  writeFileSync(
    script,
    [
      "import { appendFileSync } from 'node:fs';",
      "let prompt = '';",
      "process.stdin.on('data', (c) => (prompt += c));",
      "process.stdin.on('end', () => {",
      "  appendFileSync('edited.txt', prompt + '\\n');",
      "  console.log('agent done');",
      "});",
    ].join("\n"),
    "utf-8",
  );
  return script;
}

/** A fake agent that stays alive long enough to reorder or stop the queue. */
function createSlowAgent(): string {
  const dir = createProjectDir();
  const script = join(dir, "slow-agent.mjs");
  writeFileSync(
    script,
    [
      "import { appendFileSync } from 'node:fs';",
      "let prompt = '';",
      "process.stdin.on('data', (c) => (prompt += c));",
      "process.stdin.on('end', () => {",
      "  setTimeout(() => {",
      "    appendFileSync('edited.txt', prompt + '\\n');",
      "    console.log('agent done');",
      "  }, 400);",
      "});",
    ].join("\n"),
    "utf-8",
  );
  return script;
}

/**
 * A stand-in for a harness that reads streaming input: it keeps stdin open,
 * appends every message it is handed, and only reports its turn finished once
 * it has been told to.
 */
function createStreamingAgent(): string {
  const dir = createProjectDir();
  // Named for the harness it stands in for: a wrapper around a known harness
  // inherits that harness' prompt format, which is what puts this run on the
  // streaming path.
  const script = join(dir, "claude-streaming-agent.mjs");
  writeFileSync(
    script,
    [
      "import { appendFileSync } from 'node:fs';",
      "let buf = '';",
      "process.stdin.on('data', (chunk) => {",
      "  buf += chunk;",
      "  let i;",
      "  while ((i = buf.indexOf('\\n')) !== -1) {",
      "    const line = buf.slice(0, i).trim();",
      "    buf = buf.slice(i + 1);",
      "    if (!line) continue;",
      "    const text = JSON.parse(line).message.content[0].text;",
      "    appendFileSync('edited.txt', text + '\\n');",
      "    if (text.includes('finish')) {",
      "      console.log(JSON.stringify({ type: 'result', result: 'done after ' + text }));",
      "    }",
      "  }",
      "});",
    ].join("\n"),
    "utf-8",
  );
  return script;
}

function createAdapter(projectDir: string): StudioApiAdapter {
  return {
    listProjects: () => [],
    resolveProject: async (id: string) => ({ id, dir: projectDir }),
    bundle: async () => null,
    lint: async () => ({ findings: [] }),
    runtimeUrl: "/api/runtime.js",
    rendersDir: () => "/tmp/renders",
    startRender: () => ({
      id: "job-1",
      status: "rendering",
      progress: 0,
      outputPath: "/tmp/out.mp4",
    }),
  };
}

function createApp(projectDir: string): Hono {
  const app = new Hono();
  registerAgentRoutes(app, createAdapter(projectDir));
  return app;
}

function enqueue(
  app: Hono,
  projectId: string,
  instruction: string,
  /** Which element the run edits. Runs sharing one are serial; others are not. */
  targetRef?: Record<string, unknown>,
) {
  return app.request(`/projects/${projectId}/agent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prompt: `do this: ${instruction}`,
      instruction,
      target: "#title",
      targetRef,
    }),
  });
}

/**
 * The instructions the fake agent was handed, in order. It appends each whole
 * prompt it receives, and a prompt is more than its first line — the server
 * adds the installed skills to it — so the marker is what identifies each run.
 */
function promptsSentTo(projectDir: string): string[] {
  return readFileSync(join(projectDir, "edited.txt"), "utf-8")
    .split("do this: ")
    .slice(1)
    .map((chunk) => chunk.split("\n")[0]!.trim());
}

async function readJobs(app: Hono, projectId: string): Promise<AgentJob[]> {
  const res = await app.request(`/projects/${projectId}/agent`);
  return ((await res.json()) as { jobs: AgentJob[] }).jobs;
}

async function waitFor(check: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("condition never met");
}

async function waitForIdle(app: Hono, projectId: string): Promise<AgentJob[]> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const jobs = await readJobs(app, projectId);
    if (jobs.every((job) => job.status !== "queued" && job.status !== "running")) return jobs;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("jobs never settled");
}

describe("resolveAgentCommand", () => {
  it("prefers an explicit command over presets", () => {
    expect(resolveAgentCommand({ HYPERFRAMES_AGENT_CMD: "my-agent --run now" })).toEqual({
      kind: "custom",
      label: "my-agent",
      command: "my-agent",
      args: ["--run", "now"],
    });
  });

  it("labels a custom command with the harness it names", () => {
    expect(resolveAgentCommand({ HYPERFRAMES_AGENT_CMD: "codex exec -" })?.kind).toBe("codex");
    expect(resolveAgentCommand({ HYPERFRAMES_AGENT_CMD: "openclaw agent exec" })?.kind).toBe(
      "openclaw",
    );
  });

  it("resolves a named preset", () => {
    expect(resolveAgentCommand({ HYPERFRAMES_AGENT: "codex" })?.command).toBe("codex");
    expect(resolveAgentCommand({ HYPERFRAMES_AGENT: "nope" })).toBeNull();
  });

  it("ships headless presets for every supported harness", () => {
    // Each preset must take the prompt on stdin — see the module comment.
    expect(resolveAgentCommand({ HYPERFRAMES_AGENT: "hermes" })).toEqual({
      kind: "hermes",
      label: "Hermes Agent",
      command: "hermes",
      args: ["-z"],
    });
    expect(resolveAgentCommand({ HYPERFRAMES_AGENT: "openclaw" })).toEqual({
      kind: "openclaw",
      label: "OpenClaw",
      command: "openclaw",
      args: ["agent", "exec", "--message-file", "-"],
    });
  });

  it("marks an unrecognizable command as custom", () => {
    expect(resolveAgentCommand({ HYPERFRAMES_AGENT_CMD: "pi run" })?.kind).toBe("custom");
    expect(resolveAgentCommand({ HYPERFRAMES_AGENT_CMD: "my-hermes-wrapper" })?.kind).toBe(
      "hermes",
    );
  });
});

describe("listAgentCommands", () => {
  it("lists every harness with whether it is installed", () => {
    const agents = listAgentCommands({});
    expect(agents.map((agent) => agent.id)).toEqual(["claude", "codex", "hermes", "openclaw"]);
    // Availability is a PATH lookup, so it just has to be a boolean here.
    expect(agents.every((agent) => typeof agent.available === "boolean")).toBe(true);
  });

  it("puts a custom command first and never lists it twice", () => {
    const agents = listAgentCommands({ HYPERFRAMES_AGENT_CMD: "codex exec -" });
    expect(agents[0]).toMatchObject({ kind: "codex", label: "codex", available: true });
    expect(agents.filter((agent) => agent.kind === "codex")).toHaveLength(1);
  });
});

describe("resumedAgentCommand", () => {
  it("rebuilds Codex's command as its resume subcommand, flags before the id", () => {
    const codex = resolveAgentCommand({ HYPERFRAMES_AGENT: "codex" })!;
    expect(resumedAgentCommand(codex, "abc-123")?.args).toEqual([
      "exec",
      "resume",
      "--json",
      "--skip-git-repo-check",
      "abc-123",
      "-",
    ]);
  });

  it("only adds a flag for Claude Code, which keeps its own command", () => {
    const claude = resolveAgentCommand({ HYPERFRAMES_AGENT: "claude" })!;
    expect(resumedAgentCommand(claude, "abc-123")?.args).toEqual([
      ...claude.args,
      "--resume",
      "abc-123",
    ]);
  });

  it("cannot resume without a session, or a harness that has no resume", () => {
    const codex = resolveAgentCommand({ HYPERFRAMES_AGENT: "codex" })!;
    const hermes = resolveAgentCommand({ HYPERFRAMES_AGENT: "hermes" })!;
    expect(resumedAgentCommand(codex, undefined)).toBeNull();
    expect(resumedAgentCommand(hermes, "abc-123")).toBeNull();
  });
});

describe("readSessionId", () => {
  it("picks up the harness session id from its stream", () => {
    expect(readSessionId("claude", '{"type":"system","session_id":"abc-123"}')).toBe("abc-123");
    expect(readSessionId("claude", "plain text")).toBeNull();
    // Codex opens its stream with the thread it can be resumed from.
    expect(
      readSessionId("codex", '{"type":"thread.started","thread_id":"019fd00d-df1e-7420"}'),
    ).toBe("019fd00d-df1e-7420");
    expect(readSessionId("codex", '{"type":"turn.started"}')).toBeNull();
    expect(readSessionId("codex", '{"session_id":"abc-123"}')).toBeNull();
  });
});

describe("readActivity", () => {
  it("summarizes a Claude tool call by name and file", () => {
    const event = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Edit", input: { file_path: "/a/b/x.html" } }],
      },
    });
    expect(readActivity("claude", event)).toBe("Edit · x.html");
  });

  it("falls back to the assistant's own words", () => {
    const event = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "Recoloring the title\nsecond line" }] },
    });
    expect(readActivity("claude", event)).toBe("Recoloring the title");
  });

  it("ignores hook, thinking and rate-limit bookkeeping", () => {
    expect(readActivity("claude", '{"type":"system","subtype":"thinking_tokens"}')).toBeNull();
    expect(readActivity("claude", "not json at all")).toBeNull();
    expect(readActivity("claude", "   ")).toBeNull();
  });

  it("reads Codex's own items: a file change, a shell command, its words", () => {
    const item = (payload: object) => JSON.stringify({ type: "item.started", item: payload });
    expect(
      readActivity(
        "codex",
        item({ type: "file_change", changes: [{ path: "/a/b/index.html", kind: "update" }] }),
      ),
    ).toBe("Edit · index.html");
    // The shell is wrapped in `/bin/zsh -lc '…'`; the command is the payload.
    expect(
      readActivity("codex", item({ type: "command_execution", command: "/bin/zsh -lc 'ls -la'" })),
    ).toBe("Shell · ls -la");
    expect(readActivity("codex", item({ type: "agent_message", text: "Widening the chip" }))).toBe(
      "Widening the chip",
    );
    // Its warnings channel is not what the run is doing.
    expect(
      readActivity("codex", item({ type: "error", message: "stale hooks config" })),
    ).toBeNull();
  });

  it("uses raw lines for the harnesses that only print prose", () => {
    expect(readActivity("hermes", "  applying patch to index.html  ")).toBe(
      "applying patch to index.html",
    );
  });
});

describe("readOverlayState", () => {
  it("reads a declaration out of a prose harness' line", () => {
    expect(
      readOverlayState("hermes", '<!-- hf:overlay {"kind":"editing","scope":"text"} -->'),
    ).toEqual({ kind: "editing", scope: "text" });
  });

  it("reads one out of a Codex agent message", () => {
    const line = JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: '<!-- hf:overlay {"kind":"reading"} --> looking' },
    });
    expect(readOverlayState("codex", line)).toEqual({ kind: "reading" });
  });

  it("decodes the marker out of Claude's stream-json before reading it", () => {
    const event = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: 'hf:overlay {"kind":"reading","label":"Checking the timing"}' },
        ],
      },
    });
    expect(readOverlayState("claude", event)).toEqual({
      kind: "reading",
      label: "Checking the timing",
    });
  });

  it("takes the last declaration in a chunk and survives a brace in a label", () => {
    const line =
      'hf:overlay {"kind":"reading"} then hf:overlay {"kind":"editing","label":"fixing {x}"}';
    expect(readOverlayState("hermes", line)).toEqual({ kind: "editing", label: "fixing {x}" });
  });

  it("keeps the declaration out of the activity line", () => {
    const event = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "text",
            text: '<!-- hf:overlay {"kind":"editing"} --> Rewriting the headline',
          },
        ],
      },
    });
    expect(readActivity("claude", event)).toBe("Rewriting the headline");
    // A line that was only a declaration has nothing left to report.
    expect(readActivity("hermes", '<!-- hf:overlay {"kind":"editing"} -->')).toBeNull();
  });

  it("ignores a malformed or unknown declaration rather than failing the run", () => {
    expect(readOverlayState("hermes", "hf:overlay {not json")).toBeNull();
    expect(readOverlayState("hermes", 'hf:overlay {"kind":"vibing"}')).toBeNull();
    expect(readOverlayState("hermes", "no marker here")).toBeNull();
  });
});

describe("readFailureMessage", () => {
  it("digs the reason out of a harness' JSON error instead of reporting a brace", () => {
    const output = [
      "{",
      '  "error": {',
      '    "message": "Unsupported value: \'none\' is not supported with this model.",',
      '    "param": "reasoning.effort"',
      "  },",
      '  "status": 400',
      "}",
    ].join("\n");
    expect(readFailureMessage(output)).toBe(
      "Unsupported value: 'none' is not supported with this model.",
    );
  });

  it("falls back to the last line that says something", () => {
    expect(readFailureMessage("starting\ncommand not found: codex\n}\n)")).toBe(
      "command not found: codex",
    );
    expect(readFailureMessage("   ")).toBeNull();
  });
});

describe("registerAgentRoutes", () => {
  it("queues a run and reports it as a job before it finishes", async () => {
    const projectDir = createProjectDir();
    process.env.HYPERFRAMES_AGENT_CMD = `${process.execPath} ${createFakeAgent()}`;
    const app = createApp(projectDir);

    const res = await enqueue(app, "p1", "make the title red");
    expect(res.status).toBe(200);
    const { job } = (await res.json()) as { job: AgentJob };
    // An idle queue starts the run immediately; a busy one leaves it waiting.
    expect(["queued", "running"]).toContain(job.status);
    expect(job.instruction).toBe("make the title red");
    expect(job.target).toBe("#title");

    const settled = await waitForIdle(app, "p1");
    expect(settled[0]?.status).toBe("done");
    expect(readFileSync(join(projectDir, "edited.txt"), "utf-8")).toContain(
      "do this: make the title red",
    );
  });

  it("tells the agent which HyperFrames skills it can load", async () => {
    const projectDir = createProjectDir();
    // A project with the router installed the way `skills add` leaves it.
    mkdirSync(join(projectDir, ".claude", "skills", "hyperframes"), { recursive: true });
    writeFileSync(
      join(projectDir, ".claude", "skills", "hyperframes", "SKILL.md"),
      "---\nname: hyperframes\n---\n",
      "utf-8",
    );
    process.env.HYPERFRAMES_AGENT_CMD = `${process.execPath} ${createFakeAgent()}`;
    const app = createApp(projectDir);

    await enqueue(app, "skills", "make it red");
    await waitForIdle(app, "skills");

    const sent = readFileSync(join(projectDir, "edited.txt"), "utf-8");
    // A generic edit misses the framework's rules; the skills are what carry them.
    expect(sent).toContain("/hyperframes first");
    expect(sent).toContain("determinism");
  });

  it("runs jobs on one element one at a time, so the second never rewrites what the first is mid-way through", async () => {
    const projectDir = createProjectDir();
    process.env.HYPERFRAMES_AGENT_CMD = `${process.execPath} ${createFakeAgent()}`;
    const app = createApp(projectDir);

    await enqueue(app, "p2", "first");
    await enqueue(app, "p2", "second");
    const inFlight = await readJobs(app, "p2");
    expect(inFlight.filter((job) => job.status === "running").length).toBeLessThanOrEqual(1);

    const settled = await waitForIdle(app, "p2");
    expect(settled.map((job) => job.status)).toEqual(["done", "done"]);
    // Newest first, and both prompts reached the agent in order.
    expect(settled.map((job) => job.instruction)).toEqual(["second", "first"]);
    expect(promptsSentTo(projectDir)).toEqual(["first", "second"]);
  });

  it("runs jobs on different elements at the same time instead of making one wait", async () => {
    const projectDir = createProjectDir();
    process.env.HYPERFRAMES_AGENT_CMD = `${process.execPath} ${createSlowAgent()}`;
    const app = createApp(projectDir);

    const file = "index.html";
    await enqueue(app, "lanes", "headline", { sourceFile: file, id: "headline" });
    await enqueue(app, "lanes", "footer", { sourceFile: file, id: "footer" });
    // Asking about the footer must not mean waiting out the headline's run.
    await waitFor(async () => {
      const jobs = await readJobs(app, "lanes");
      return jobs.filter((job) => job.status === "running").length === 2;
    });

    const settled = await waitForIdle(app, "lanes");
    expect(settled.map((job) => job.status)).toEqual(["done", "done"]);
  });

  it("still queues a second run on the element that is already being edited", async () => {
    const projectDir = createProjectDir();
    process.env.HYPERFRAMES_AGENT_CMD = `${process.execPath} ${createSlowAgent()}`;
    const app = createApp(projectDir);

    const ref = { sourceFile: "index.html", selector: ".card", selectorIndex: 2 };
    await enqueue(app, "same-lane", "bigger", ref);
    await enqueue(app, "same-lane", "then redder", ref);
    const inFlight = await readJobs(app, "same-lane");
    expect(inFlight.filter((job) => job.status === "running").length).toBe(1);

    const settled = await waitForIdle(app, "same-lane");
    expect(settled.map((job) => job.status)).toEqual(["done", "done"]);
    expect(promptsSentTo(projectDir)).toEqual(["bigger", "then redder"]);
  });

  it("takes over: a waiting run stops the one holding its element and starts", async () => {
    const projectDir = createProjectDir();
    process.env.HYPERFRAMES_AGENT_CMD = `${process.execPath} ${createSlowAgent()}`;
    const app = createApp(projectDir);

    const ref = { sourceFile: "index.html", id: "title" };
    const first = (await (await enqueue(app, "promote", "the long one", ref)).json()) as {
      job: AgentJob;
    };
    const second = (await (await enqueue(app, "promote", "the urgent one", ref)).json()) as {
      job: AgentJob;
    };
    await waitFor(async () => {
      const jobs = await readJobs(app, "promote");
      return jobs.some((job) => job.id === first.job.id && job.status === "running");
    });

    const res = await app.request(`/projects/promote/agent/jobs/${second.job.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ promote: true }),
    });
    expect(res.status).toBe(200);

    const settled = await waitForIdle(app, "promote");
    const byId = new Map(settled.map((job) => [job.id, job]));
    expect(byId.get(first.job.id)?.status).toBe("cancelled");
    expect(byId.get(second.job.id)?.status).toBe("done");
  });

  it("leaves work on other elements alone when one takes over", async () => {
    const projectDir = createProjectDir();
    process.env.HYPERFRAMES_AGENT_CMD = `${process.execPath} ${createSlowAgent()}`;
    const app = createApp(projectDir);

    const elsewhere = (await (
      await enqueue(app, "promote2", "on the footer", { sourceFile: "index.html", id: "footer" })
    ).json()) as { job: AgentJob };
    const ref = { sourceFile: "index.html", id: "title" };
    await enqueue(app, "promote2", "the long one", ref);
    const urgent = (await (await enqueue(app, "promote2", "the urgent one", ref)).json()) as {
      job: AgentJob;
    };
    await waitFor(async () => {
      const jobs = await readJobs(app, "promote2");
      return jobs.filter((job) => job.status === "running").length === 2;
    });

    await app.request(`/projects/promote2/agent/jobs/${urgent.job.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ promote: true }),
    });

    const settled = await waitForIdle(app, "promote2");
    // Taking over an element is no reason to interrupt another one.
    expect(settled.find((job) => job.id === elsewhere.job.id)?.status).toBe("done");
  });

  it("reports the queue in the order it will run, after a move", async () => {
    const projectDir = createProjectDir();
    process.env.HYPERFRAMES_AGENT_CMD = `${process.execPath} ${createSlowAgent()}`;
    const app = createApp(projectDir);

    const ref = { sourceFile: "index.html", id: "title" };
    await enqueue(app, "order", "blocker", ref);
    await enqueue(app, "order", "alpha", ref);
    await enqueue(app, "order", "beta", ref);
    const gamma = (await (await enqueue(app, "order", "gamma", ref)).json()) as { job: AgentJob };

    // Send the last waiting run to the front of the line.
    await app.request(`/projects/order/agent/jobs/${gamma.job.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ position: 0 }),
    });

    const jobs = await readJobs(app, "order");
    // The list reads newest-first, so the run order is its reverse.
    const queue = jobs
      .filter((job) => job.status === "queued")
      .map((job) => job.instruction)
      .reverse();
    expect(queue).toEqual(["gamma", "alpha", "beta"]);

    // And the agent is actually handed them in that order.
    await waitForIdle(app, "order");
    expect(promptsSentTo(projectDir)).toEqual(["blocker", "gamma", "alpha", "beta"]);
  });

  it("steers a waiting run in place, keeping the element context it was built from", async () => {
    const projectDir = createProjectDir();
    process.env.HYPERFRAMES_AGENT_CMD = `${process.execPath} ${createSlowAgent()}`;
    const app = createApp(projectDir);

    const ref = { sourceFile: "index.html", id: "title" };
    await enqueue(app, "steer-q", "first", ref);
    const waiting = (await (await enqueue(app, "steer-q", "make it red", ref)).json()) as {
      job: AgentJob;
    };

    const res = await app.request(`/projects/steer-q/agent/jobs/${waiting.job.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ steer: "blue, not red" }),
    });
    expect(res.status).toBe(200);

    await waitForIdle(app, "steer-q");
    const sent = readFileSync(join(projectDir, "edited.txt"), "utf-8");
    // The original request and the correction both reach the agent, in order.
    expect(sent).toContain("do this: make it red");
    expect(sent).toContain("blue, not red");
  });

  it("steers a run that reads streaming input without stopping it", async () => {
    const projectDir = createProjectDir();
    process.env.HYPERFRAMES_AGENT_CMD = `${process.execPath} ${createStreamingAgent()}`;
    const app = createApp(projectDir);
    const started = (await (
      await enqueue(app, "stream", "first ask", { sourceFile: "index.html", id: "title" })
    ).json()) as { job: AgentJob };
    await waitFor(async () => {
      const jobs = await readJobs(app, "stream");
      return jobs.some((job) => job.id === started.job.id && job.status === "running");
    });

    await app.request(`/projects/stream/agent/jobs/${started.job.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ steer: "actually, finish now" }),
    });

    const settled = await waitForIdle(app, "stream");
    // One run, not two: the correction went into the turn already going.
    expect(settled).toHaveLength(1);
    expect(settled[0]?.id).toBe(started.job.id);
    expect(settled[0]?.steers).toEqual(["actually, finish now"]);
    expect(promptsSentTo(projectDir)).toEqual(["first ask"]);
    expect(readFileSync(join(projectDir, "edited.txt"), "utf-8")).toContain("actually, finish now");
  });

  it("steers a running run by stopping it and asking again", async () => {
    const projectDir = createProjectDir();
    process.env.HYPERFRAMES_AGENT_CMD = `${process.execPath} ${createSlowAgent()}`;
    const app = createApp(projectDir);

    const started = (await (
      await enqueue(app, "steer-r", "wrong thing", { sourceFile: "index.html", id: "title" })
    ).json()) as { job: AgentJob };
    await waitFor(async () => {
      const jobs = await readJobs(app, "steer-r");
      return jobs.some((job) => job.status === "running");
    });

    await app.request(`/projects/steer-r/agent/jobs/${started.job.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ steer: "the other one, actually" }),
    });

    const settled = await waitForIdle(app, "steer-r");
    // The first run is stopped and a follow-up carries the correction.
    expect(settled.map((job) => job.status)).toEqual(["done", "cancelled"]);
    expect(settled[1]?.message).toBe("Steered mid-run.");
    expect(settled[0]?.steers).toEqual(["the other one, actually"]);
  });

  it("reorders and removes waiting runs", async () => {
    const projectDir = createProjectDir();
    process.env.HYPERFRAMES_AGENT_CMD = `${process.execPath} ${createSlowAgent()}`;
    const app = createApp(projectDir);

    await enqueue(app, "q1", "first");
    const second = (await (await enqueue(app, "q1", "second")).json()) as { job: AgentJob };
    const third = (await (await enqueue(app, "q1", "third")).json()) as { job: AgentJob };

    // "third" jumps the queue ahead of "second", then "second" is dropped.
    const moved = await app.request(`/projects/q1/agent/jobs/${third.job.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ position: 0 }),
    });
    expect(moved.status).toBe(200);

    const removed = await app.request(`/projects/q1/agent/jobs/${second.job.id}`, {
      method: "DELETE",
    });
    expect(removed.status).toBe(200);
    expect(
      ((await removed.json()) as { jobs: AgentJob[] }).jobs.find((j) => j.id === second.job.id)
        ?.status,
    ).toBe("cancelled");

    const settled = await waitForIdle(app, "q1");
    const ran = settled
      .filter((job) => job.status === "done")
      .map((job) => job.instruction)
      .reverse();
    expect(ran).toEqual(["first", "third"]);
  });

  it("stops a run that is already going", async () => {
    const projectDir = createProjectDir();
    process.env.HYPERFRAMES_AGENT_CMD = `${process.execPath} ${createSlowAgent()}`;
    const app = createApp(projectDir);

    const started = (await (await enqueue(app, "q2", "long one")).json()) as { job: AgentJob };
    await waitFor(async () => (await readJobs(app, "q2"))[0]?.status === "running");

    const res = await app.request(`/projects/q2/agent/jobs/${started.job.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const settled = await waitForIdle(app, "q2");
    expect(settled[0]?.status).toBe("cancelled");
    expect(settled[0]?.message).toBe("Stopped mid-run.");
  });

  it("refuses to touch a run that already finished", async () => {
    const projectDir = createProjectDir();
    process.env.HYPERFRAMES_AGENT_CMD = `${process.execPath} ${createFakeAgent()}`;
    const app = createApp(projectDir);
    const { job } = (await (await enqueue(app, "q3", "quick")).json()) as { job: AgentJob };
    await waitForIdle(app, "q3");

    expect(
      (await app.request(`/projects/q3/agent/jobs/${job.id}`, { method: "DELETE" })).status,
    ).toBe(409);
  });

  it("keeps a readable run log per project and reads it back after a restart", async () => {
    const projectDir = createProjectDir();
    process.env.HYPERFRAMES_AGENT_CMD = `${process.execPath} ${createFakeAgent()}`;
    const app = createApp(projectDir);

    await enqueue(app, "q4", "log this run");
    await waitForIdle(app, "q4");

    const logged = readFileSync(join(projectDir, ".hyperframes", "agent-runs.jsonl"), "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      target: "#title",
      instruction: "log this run",
      status: "done",
      agent: expect.stringContaining("node") as unknown as string,
    });

    // A fresh project id stands in for a restarted server: same directory, no
    // in-memory jobs, history still shows up.
    const restored = await readJobs(createApp(projectDir), "q4-after-restart");
    expect(restored.map((job) => job.instruction)).toEqual(["log this run"]);
    expect(restored[0]?.status).toBe("done");
  });

  it("clears finished jobs only", async () => {
    const projectDir = createProjectDir();
    process.env.HYPERFRAMES_AGENT_CMD = `${process.execPath} ${createFakeAgent()}`;
    const app = createApp(projectDir);

    await enqueue(app, "p3", "one");
    await waitForIdle(app, "p3");
    const res = await app.request("/projects/p3/agent/jobs", { method: "DELETE" });
    expect(((await res.json()) as { jobs: AgentJob[] }).jobs).toEqual([]);
  });

  it("runs the harness the caller picked, and refuses one that is missing", async () => {
    const projectDir = createProjectDir();
    process.env.HYPERFRAMES_AGENT_CMD = `${process.execPath} ${createFakeAgent()}`;
    const app = createApp(projectDir);

    // The custom command is sniffed as "custom"; asking for it by kind works.
    const picked = await app.request("/projects/p8/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "do it", agent: "custom" }),
    });
    expect(picked.status).toBe(200);

    const missing = await app.request("/projects/p8/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "do it", agent: "hermes" }),
    });
    expect(missing.status).toBe(501);
    await waitForIdle(app, "p8");
  });

  it("carries the element reference back out with the job", async () => {
    const projectDir = createProjectDir();
    process.env.HYPERFRAMES_AGENT_CMD = `${process.execPath} ${createFakeAgent()}`;
    const app = createApp(projectDir);

    const res = await app.request("/projects/p9/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "make it red",
        instruction: "make it red",
        target: "Chip",
        targetRef: { selector: "#chip", selectorIndex: 0, sourceFile: "index.html", time: 1.25 },
      }),
    });
    const { job } = (await res.json()) as { job: AgentJob };
    expect(job.targetRef).toEqual({
      selector: "#chip",
      selectorIndex: 0,
      sourceFile: "index.html",
      time: 1.25,
    });
    await waitForIdle(app, "p9");
  });

  it("registers a custom harness and runs it by id", async () => {
    const projectDir = createProjectDir();
    const script = createFakeAgent();
    const app = createApp(projectDir);

    const added = await app.request("/projects/c1/agent/custom", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "Fake", command: process.execPath, args: [script] }),
    });
    expect(added.status).toBe(200);
    const { agent } = (await added.json()) as { agent: { id: string } };
    expect(agent.id).toBe("custom:fake");

    // It shows up in the picker as an available harness…
    const state = (await (await app.request("/projects/c1/agent")).json()) as {
      agents: Array<{ id: string; label: string; available: boolean }>;
    };
    expect(state.agents).toContainEqual(
      expect.objectContaining({ id: "custom:fake", label: "Fake", available: true }),
    );

    // …and a run can name it.
    const res = await app.request("/projects/c1/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "do it", agent: "custom:fake" }),
    });
    expect(res.status).toBe(200);
    const settled = await waitForIdle(app, "c1");
    expect(settled[0]?.status).toBe("done");
    expect(readFileSync(join(projectDir, "edited.txt"), "utf-8")).toContain("do it");

    const removed = await app.request(`/projects/c1/agent/custom/${agent.id}`, {
      method: "DELETE",
    });
    expect(((await removed.json()) as { agents: unknown[] }).agents).toEqual([]);
  });

  it("refuses a custom harness with no command", async () => {
    const res = await createApp(createProjectDir()).request("/projects/c2/agent/custom", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "Nameless" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects an empty prompt", async () => {
    const res = await createApp(createProjectDir()).request("/projects/p4/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "   " }),
    });
    expect(res.status).toBe(400);
  });

  it("serves a custom harness icon when one is configured", async () => {
    const iconDir = createProjectDir();
    const iconPath = join(iconDir, "pi.svg");
    writeFileSync(iconPath, '<svg xmlns="http://www.w3.org/2000/svg" />');
    process.env.HYPERFRAMES_AGENT_CMD = "pi run";
    process.env.HYPERFRAMES_AGENT_ICON = iconPath;
    const app = createApp(createProjectDir());

    const state = (await (await app.request("/projects/p6/agent")).json()) as { iconUrl: string };
    expect(state.iconUrl).toBe("/api/projects/p6/agent/icon");

    const icon = await app.request("/projects/p6/agent/icon");
    expect(icon.headers.get("content-type")).toBe("image/svg+xml");
    expect(await icon.text()).toContain("<svg");
  });

  it("reports no icon when the configured path is missing", async () => {
    process.env.HYPERFRAMES_AGENT_ICON = "/nope/does-not-exist.svg";
    const app = createApp(createProjectDir());
    expect(await (await app.request("/projects/p7/agent")).json()).toMatchObject({ iconUrl: null });
    expect((await app.request("/projects/p7/agent/icon")).status).toBe(404);
  });

  it("reports availability without running anything", async () => {
    process.env.HYPERFRAMES_AGENT_CMD = "my-agent";
    const res = await createApp(createProjectDir()).request("/projects/p5/agent");
    expect(await res.json()).toMatchObject({
      available: true,
      label: "my-agent",
      kind: "custom",
      iconUrl: null,
      jobs: [],
    });
  });
});
