import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listAgentCommands, registerAgentRoutes, resolveAgentCommand } from "./agent";
import { readActivity, readSessionId, type AgentJob } from "../helpers/agentJobs";
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

function enqueue(app: Hono, projectId: string, instruction: string) {
  return app.request(`/projects/${projectId}/agent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: `do this: ${instruction}`, instruction, target: "#title" }),
  });
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

describe("readSessionId", () => {
  it("picks up the harness session id from its stream", () => {
    expect(readSessionId("claude", '{"type":"system","session_id":"abc-123"}')).toBe("abc-123");
    expect(readSessionId("claude", "plain text")).toBeNull();
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

  it("uses raw lines for Codex", () => {
    expect(readActivity("codex", "  applying patch to index.html  ")).toBe(
      "applying patch to index.html",
    );
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

  it("runs queued jobs one at a time so two agents never rewrite the same file at once", async () => {
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
    expect(readFileSync(join(projectDir, "edited.txt"), "utf-8").trim().split("\n")).toEqual([
      "do this: first",
      "do this: second",
    ]);
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
