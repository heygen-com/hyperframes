import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAcpSession } from "./session";
import { readAcpUpdate } from "./updates";
import { enqueueAgentJob, listAgentJobs, type AgentCommand, type AgentJob } from "../agentJobs";

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
      "const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');",
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
      "    } else if (msg.method === 'session/prompt') {",
      "      for (const update of updates) {",
      "        send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'sess-42', update } });",
      "      }",
      "      setTimeout(() => send({ jsonrpc: '2.0', id: msg.id, result: { stopReason } }), holdMs);",
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
function startJob(agent: AgentCommand, projectDir: string, instruction = "make it blue") {
  const projectId = `acp-project-${nextProject++}`;
  const queued = enqueueAgentJob({
    projectId,
    projectDir,
    agent,
    prompt: `do this: ${instruction}`,
    instruction,
    target: "#title",
  });
  const read = () => listAgentJobs(projectId).find((candidate) => candidate.id === queued.id)!;
  return { read };
}

async function until(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("the ACP job never got there");
}

/** Run one job to settlement and hand back what the tray would show. */
async function runJob(
  agent: AgentCommand,
  projectDir: string,
  instruction = "make it blue",
): Promise<AgentJob> {
  const { read } = startJob(agent, projectDir, instruction);
  await until(() => read().status !== "queued" && read().status !== "running");
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
    const { read } = startJob(
      acpCommand(
        createAcpAgent(
          [said('<!-- hf:overlay {"kind":"editing","scope":"text"} -->\nRewriting the headline.')],
          "end_turn",
          400,
        ),
      ),
      createProjectDir(),
    );

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
    const { read } = startJob(
      acpCommand(
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
      createProjectDir(),
    );

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
