import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { registerAgentRoutes } from "../../routes/agent";
import type { StudioApiAdapter } from "../../types";
import { runAcpSession } from "./session";
import { readAcpUpdate } from "./updates";
import {
  answerAgentJob,
  cancelAgentJob,
  steerAgentJob,
  enqueueAgentJob,
  listAgentJobs,
  type AgentCommand,
  type AgentJob,
} from "../agentJobs";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * A stand-in ACP agent: it answers the handshake, opens a session, then plays
 * back whatever updates the test asked for and ends the turn with the reason it
 * was given. Everything Studio reads comes over the protocol, so a script of
 * notifications is a complete fake harness.
 */
function createAcpAgent(
  updates: Array<Record<string, unknown>>,
  stopReason = "end_turn",
  /** How long the turn stays open after the updates, for watching it live. */
  holdMs = 0,
  /** Options to ask about before doing anything, the way a real agent would. */
  ask: Array<Record<string, unknown>> | null = null,
  /** Say back what it was asked, for testing what reaches it and when. */
  echoPrompt = false,
): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-acp-test-"));
  tempDirs.push(dir);
  const script = join(dir, "acp-agent.mjs");
  writeFileSync(
    script,
    [
      `const updates = ${JSON.stringify(updates)};`,
      `const stopReason = ${JSON.stringify(stopReason)};`,
      `const holdMs = ${JSON.stringify(holdMs)};`,
      `const ask = ${JSON.stringify(ask)};`,
      `const echoPrompt = ${JSON.stringify(echoPrompt)};`,
      "const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');",
      "let pending = null;",
      "let timer = null;",
      "const finish = (id) => {",
      "  for (const update of updates) {",
      "    send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'sess-42', update } });",
      "  }",
      "  timer = setTimeout(() => send({ jsonrpc: '2.0', id, result: { stopReason } }), holdMs);",
      "};",
      "let buf = '';",
      "process.stdin.on('data', (chunk) => {",
      "  buf += chunk;",
      "  let i;",
      "  while ((i = buf.indexOf('\\n')) !== -1) {",
      "    const line = buf.slice(0, i).trim();",
      "    buf = buf.slice(i + 1);",
      "    if (!line) continue;",
      "    const msg = JSON.parse(line);",
      "    if (msg.method === 'initialize') {",
      "      send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1, agentCapabilities: {} } });",
      "    } else if (msg.method === 'session/new') {",
      "      send({ jsonrpc: '2.0', id: msg.id, result: { sessionId: 'sess-42' } });",
      "    } else if (msg.method === 'session/cancel') {",
      "      if (timer) clearTimeout(timer);",
      "      send({ jsonrpc: '2.0', id: msg.id, result: {} });",
      "      send({ jsonrpc: '2.0', id: pending, result: { stopReason: 'cancelled' } });",
      "    } else if (msg.method === 'session/prompt') {",
      "      pending = msg.id;",
      "      if (echoPrompt) send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'sess-42', update: {",
      "        sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Asked: ' + msg.params.prompt[0].text + '. ' },",
      "      } } });",
      "      if (ask) {",
      "        send({ jsonrpc: '2.0', id: 900, method: 'session/request_permission', params: {",
      "          sessionId: 'sess-42',",
      "          toolCall: { toolCallId: 'call-1', title: 'Write composition.html', kind: 'edit' },",
      "          options: ask,",
      "        } });",
      "      } else {",
      "        finish(msg.id);",
      "      }",
      "    } else if (msg.id === 900 && msg.result) {",
      "      const chosen = msg.result.outcome && msg.result.outcome.optionId;",
      "      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'sess-42', update: {",
      "        sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'You said ' + chosen + '. ' },",
      "      } } });",
      "      finish(pending);",
      "    }",
      "  }",
      "});",
    ].join("\n"),
    "utf-8",
  );
  return script;
}

function acpCommand(script: string): AgentCommand {
  return {
    kind: "custom",
    label: "Stub ACP",
    command: process.execPath,
    args: [script],
    transport: "acp",
  };
}

function said(text: string): Record<string, unknown> {
  return { sessionUpdate: "agent_message_chunk", content: { type: "text", text } };
}

function createProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-acp-project-"));
  tempDirs.push(dir);
  return dir;
}

let nextProject = 0;

/** Queue a job and hand back how to watch it. */
function startJob(opts: {
  agent: AgentCommand;
  projectDir: string;
  instruction?: string;
  /** Which element it edits. Runs sharing one are serial; others are not. */
  element?: string;
  /** Join an existing project, for testing two runs against each other. */
  projectId?: string;
}) {
  const projectId = opts.projectId ?? `acp-project-${nextProject++}`;
  const instruction = opts.instruction ?? "make it blue";
  const queued = enqueueAgentJob({
    projectId,
    projectDir: opts.projectDir,
    agent: opts.agent,
    prompt: `do this: ${instruction}`,
    instruction,
    target: `#${opts.element ?? "title"}`,
    targetRef: opts.element ? { id: opts.element } : undefined,
  });
  const read = () => listAgentJobs(projectId).find((candidate) => candidate.id === queued.id)!;
  return { projectId, jobId: queued.id, read };
}

async function until(check: () => boolean): Promise<void> {
  // Generous: stopping a run asks it to stop first and only kills it if it
  // will not, so some of these waits include that grace.
  for (let attempt = 0; attempt < 400; attempt++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("the ACP job never got there");
}

/** Statuses a run can end on. Waiting on permission is not one of them. */
const SETTLED = ["done", "failed", "cancelled"];

/** Run one job to settlement and hand back what the tray would show. */
async function runJob(
  agent: AgentCommand,
  projectDir: string,
  instruction = "make it blue",
): Promise<AgentJob> {
  const { read } = startJob({ agent, projectDir, instruction });
  await until(() => SETTLED.includes(read().status));
  return read();
}

describe("readAcpUpdate", () => {
  it("reads a message chunk as both the answer and the activity", () => {
    expect(readAcpUpdate({ update: said("Widened the hero") })).toEqual({
      message: "Widened the hero",
      activity: "Widened the hero",
    });
  });

  // Reasoning is worth watching live, but it is not what the agent concluded.
  it("shows a thought without letting it become the answer", () => {
    expect(
      readAcpUpdate({
        update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Hmm" } },
      }),
    ).toEqual({ activity: "Hmm" });
  });

  it("names the file a tool call is working on", () => {
    expect(
      readAcpUpdate({
        update: {
          sessionUpdate: "tool_call",
          title: "Edit",
          locations: [{ path: "/tmp/project/composition.html" }],
        },
      }),
    ).toEqual({ activity: "Edit · composition.html" });
  });

  // Agents write both "Read" and "Read composition.html" as titles; only the
  // first needs the file appended.
  it("leaves a title that already names its file alone", () => {
    expect(
      readAcpUpdate({
        update: {
          sessionUpdate: "tool_call_update",
          title: "Read composition.html",
          locations: [{ path: "/tmp/project/composition.html" }],
        },
      }),
    ).toEqual({ activity: "Read composition.html" });
  });

  // The title is remembered so a permission request about the same call can be
  // described in the agent's own words.
  it("reports the id and title of a tool call it saw", () => {
    expect(
      readAcpUpdate({
        update: { sessionUpdate: "tool_call", toolCallId: "exec-1", title: "Run the linter" },
      }),
    ).toEqual({ activity: "Run the linter", tool: { id: "exec-1", title: "Run the linter" } });
  });

  it("ignores updates that describe the session rather than the work", () => {
    expect(readAcpUpdate({ update: { sessionUpdate: "plan", entries: [] } })).toBeNull();
    expect(readAcpUpdate({ update: { sessionUpdate: "current_mode_update" } })).toBeNull();
    expect(readAcpUpdate(null)).toBeNull();
  });
});

describe("runAcpSession", () => {
  it("reports the session id and the reason the turn ended", async () => {
    const seen: string[] = [];
    const outcome = await runAcpSession({
      command: process.execPath,
      args: [createAcpAgent([said("Done")])],
      cwd: createProjectDir(),
      prompt: "make it blue",
      hooks: { onSessionId: (id) => seen.push(id) },
    });

    expect(seen).toEqual(["sess-42"]);
    expect(outcome).toEqual({ stopReason: "end_turn", said: "Done" });
  });
});

describe("a job running over ACP", () => {
  it("goes to done with what the agent said as its result", async () => {
    const job = await runJob(
      acpCommand(createAcpAgent([said("Reading the composition. "), said("Widened the hero.")])),
      createProjectDir(),
    );

    expect(job.status).toBe("done");
    expect(job.message).toBe("Reading the composition. Widened the hero.");
    expect(job.sessionId).toBe("sess-42");
    // Nothing is happening any more, so the row says nothing.
    expect(job.activity).toBe("");
  });

  it("shows the overlay the agent declared, and keeps it out of what it said", async () => {
    const { read } = startJob({
      agent: acpCommand(
        createAcpAgent(
          [said('<!-- hf:overlay {"kind":"editing","scope":"text"} -->\nRewriting the headline.')],
          "end_turn",
          400,
        ),
      ),
      projectDir: createProjectDir(),
    });

    // While the turn is open, the canvas says what the agent said it is doing.
    await until(() => read().overlay?.kind === "editing");
    expect(read().overlay).toEqual({ kind: "editing", scope: "text" });

    await until(() => read().status === "done");
    expect(read().message).toBe("Rewriting the headline.");
    // And it stops the moment the run does: an "editing" badge outliving the
    // edit is worse than no badge at all.
    expect(read().overlay).toBeUndefined();
  });

  it("shows a tool call on the run, the way the tray already draws one", async () => {
    const { read } = startJob({
      agent: acpCommand(
        createAcpAgent(
          [
            {
              sessionUpdate: "tool_call",
              toolCallId: "call-1",
              status: "in_progress",
              kind: "edit",
              title: "Edit",
              locations: [{ path: "/tmp/project/composition.html" }],
            },
          ],
          "end_turn",
          400,
        ),
      ),
      projectDir: createProjectDir(),
    });

    await until(() => read().activity === "Edit · composition.html");
    await until(() => read().status === "done");
  });

  it("settles as cancelled when the agent says the turn was cancelled", async () => {
    const job = await runJob(
      acpCommand(createAcpAgent([said("Half way")], "cancelled")),
      createProjectDir(),
    );

    expect(job.status).toBe("cancelled");
  });

  // A refusal is not a finished edit, and calling it done would put a run in the
  // tray as a success with the refusal as its "result".
  it("fails on a stop reason that is not the end of a turn", async () => {
    const job = await runJob(acpCommand(createAcpAgent([], "max_tokens")), createProjectDir());

    expect(job.status).toBe("failed");
    expect(job.message).toBe("Stub ACP stopped: max tokens");
  });

  it("writes the same run log line a native run does", async () => {
    const projectDir = createProjectDir();
    await runJob(acpCommand(createAcpAgent([said("Widened the hero.")])), projectDir, "widen it");

    const lines = readFileSync(join(projectDir, ".hyperframes", "agent-runs.jsonl"), "utf-8")
      .trim()
      .split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      agent: "Stub ACP",
      instruction: "widen it",
      status: "done",
      target: "#title",
      sessionId: "sess-42",
      result: "Widened the hero.",
    });
  });
});

const ASK_OPTIONS = [
  { optionId: "yes", name: "Allow this once", kind: "allow_once" },
  { optionId: "no", name: "Don't allow", kind: "reject_once" },
];

/** A stub that stops to ask before it does anything. */
function askingAgent(options = ASK_OPTIONS): string {
  return createAcpAgent([], "end_turn", 0, options);
}

/** A run already stopped on its question, with the API in front of it. */
async function parkedRun(agent = acpCommand(askingAgent())) {
  const projectDir = createProjectDir();
  const started = startJob({ agent, projectDir, instruction: "write it" });
  await until(() => started.read().status === "awaiting-permission");
  return { app: createApp(projectDir), projectDir, ...started };
}

describe("a run that stops to ask", () => {
  afterEach(() => {
    delete process.env.HYPERFRAMES_AGENT_ASK_TIMEOUT_MS;
  });

  it("parks with the question and the options the agent sent", async () => {
    const { read } = await parkedRun();

    expect(read().permission).toEqual({
      tool: "Write composition.html",
      options: ASK_OPTIONS,
    });
    expect(read().activity).toBe("Waiting on you · Write composition.html");
  });

  it("carries the answer back to the agent and finishes the run", async () => {
    const { projectId, jobId, read } = await parkedRun();

    expect(answerAgentJob(projectId, jobId, "yes")).toEqual({ job: read() });

    await until(() => read().status === "done");
    // The agent says which option it was handed, so this is the round trip.
    expect(read().message).toContain("You said yes.");
    expect(read().permission).toBeUndefined();
  });

  // Studio may only forward what the agent put on the table.
  it("refuses an option the agent never offered", async () => {
    const { projectId, jobId, read } = await parkedRun();

    expect(answerAgentJob(projectId, jobId, "sudo-yes")).toEqual({ refused: "not-offered" });
    expect(read().status).toBe("awaiting-permission");
  });

  // Running out of patience must never mean saying yes.
  it("declines for the user when the wait runs out and the agent offered a no", async () => {
    process.env.HYPERFRAMES_AGENT_ASK_TIMEOUT_MS = "200";
    const job = await runJob(acpCommand(askingAgent()), createProjectDir());

    expect(job.status).toBe("done");
    expect(job.message).toContain("You said no.");
  });

  it("fails naming the tool when the wait runs out and there is no way to say no", async () => {
    process.env.HYPERFRAMES_AGENT_ASK_TIMEOUT_MS = "200";
    const job = await runJob(
      acpCommand(askingAgent([{ optionId: "yes", name: "Allow", kind: "allow_once" }])),
      createProjectDir(),
    );

    expect(job.status).toBe("failed");
    expect(job.message).toContain("No answer to Write composition.html");
  });

  it("lets go of the question and the element when the run is cancelled", async () => {
    const projectDir = createProjectDir();
    const { projectId, jobId, read } = startJob({
      agent: acpCommand(askingAgent()),
      projectDir,
      element: "title",
    });

    await until(() => read().status === "awaiting-permission");
    cancelAgentJob(projectId, jobId, projectDir);
    await until(() => read().status === "cancelled");
    expect(read().permission).toBeUndefined();

    // The element is free again, so the next edit to it runs rather than queues.
    const next = startJob({
      agent: acpCommand(createAcpAgent([said("Done")])),
      projectDir,
      projectId,
      element: "title",
    });
    await until(() => next.read().status === "done");
  });

  it("leaves work on another element running while one waits", async () => {
    const projectDir = createProjectDir();
    const waiting = startJob({ agent: acpCommand(askingAgent()), projectDir, element: "title" });
    const elsewhere = startJob({
      agent: acpCommand(createAcpAgent([said("Done")])),
      projectDir,
      projectId: waiting.projectId,
      element: "footer",
    });

    await until(() => waiting.read().status === "awaiting-permission");
    // The other element never had to wait on the question.
    await until(() => elsewhere.read().status === "done");
    expect(waiting.read().status).toBe("awaiting-permission");
    cancelAgentJob(waiting.projectId, waiting.jobId, projectDir);
  });
});

/** The API in front of the queue, so the answer can be tested the way the tray sends it. */
function createApp(projectDir: string): Hono {
  const adapter: StudioApiAdapter = {
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
  const app = new Hono();
  registerAgentRoutes(app, adapter);
  return app;
}

function answerVia(app: Hono, projectId: string, jobId: string, optionId: string) {
  return app.request(`/projects/${projectId}/agent/jobs/${jobId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ answer: optionId }),
  });
}

describe("answering over the API", () => {
  it("forwards an option the agent offered", async () => {
    const { app, projectId, jobId, read } = await parkedRun();

    expect((await answerVia(app, projectId, jobId, "yes")).status).toBe(200);
    await until(() => read().status === "done");
    expect(read().message).toContain("You said yes.");
  });

  // A tray showing a stale question must not be able to talk the agent into
  // something it never put on the table.
  it("refuses an option the agent never offered with a 409", async () => {
    const { app, projectId, jobId, read } = await parkedRun();

    const res = await answerVia(app, projectId, jobId, "sudo-yes");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "that option is not one the agent offered" });
    expect(read().status).toBe("awaiting-permission");

    cancelAgentJob(projectId, jobId, createProjectDir());
  });

  it("refuses an answer to a run that is not waiting on one", async () => {
    const projectDir = createProjectDir();
    const app = createApp(projectDir);
    const { projectId, jobId, read } = startJob({
      agent: acpCommand(createAcpAgent([said("Done")])),
      projectDir,
      instruction: "write it",
    });

    await until(() => read().status === "done");
    const res = await answerVia(app, projectId, jobId, "yes");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "job is not waiting on an answer" });
  });
});

describe("stopping and correcting an ACP run", () => {
  /** A stub that holds its turn open, and says what it was asked each time. */
  function talkativeAgent(holdMs = 600): string {
    return createAcpAgent([], "end_turn", holdMs, null, true);
  }

  it("asks the agent to stop, and settles the run cancelled", async () => {
    const projectDir = createProjectDir();
    const { projectId, jobId, read } = startJob({
      agent: acpCommand(talkativeAgent()),
      projectDir,
    });

    // Steering and stopping only mean anything once there is a session; the
    // id is how the run says it has one.
    await until(() => read().sessionId === "sess-42");
    cancelAgentJob(projectId, jobId, projectDir);
    await until(() => read().status === "cancelled");
    expect(read().message).toBe("Stopped mid-run.");
  });

  // One run, one session, one job. The agent keeps everything it has read; what
  // it does not keep is the turn, and the run says so while it starts over.
  it("restarts the turn on the same session, and says that is what it did", async () => {
    const projectDir = createProjectDir();
    const { projectId, jobId, read } = startJob({
      agent: acpCommand(talkativeAgent()),
      projectDir,
      instruction: "make it blue",
    });

    await until(() => read().sessionId === "sess-42");
    const before = read();
    expect(
      steerAgentJob({ projectId, jobId, text: "make it green", projectDir, resumed: null }),
    ).toMatchObject({ id: jobId });
    expect(read().activity).toBe("Starting the turn again with your correction…");

    await until(() => read().status === "done");
    const after = read();
    // Same run, not a second one, and the session it was carrying is intact.
    expect(after.id).toBe(before.id);
    expect(after.sessionId).toBe("sess-42");
    expect(after.steers).toEqual(["make it green"]);
    // The correction reached the agent as a prompt of its own, after the first.
    expect(after.message).toContain("do this: make it blue");
    expect(after.message).toContain("Asked: make it green.");
  });

  it("leaves only one run in the list", async () => {
    const projectDir = createProjectDir();
    const { projectId, jobId, read } = startJob({
      agent: acpCommand(talkativeAgent()),
      projectDir,
    });

    await until(() => read().sessionId === "sess-42");
    steerAgentJob({ projectId, jobId, text: "actually, green", projectDir, resumed: null });
    await until(() => read().status === "done");

    expect(listAgentJobs(projectId)).toHaveLength(1);
  });
});
