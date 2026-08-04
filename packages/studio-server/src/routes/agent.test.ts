import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerAgentRoutes, resolveAgentCommand } from "./agent";
import { readActivity, type AgentJob } from "../helpers/agentJobs";
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

async function waitForIdle(app: Hono, projectId: string): Promise<AgentJob[]> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const jobs = await readJobs(app, projectId);
    if (jobs.every((job) => job.status === "done" || job.status === "failed")) return jobs;
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
      label: "Hermes",
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
    expect(job.status).toBe("queued");
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

  it("clears finished jobs only", async () => {
    const projectDir = createProjectDir();
    process.env.HYPERFRAMES_AGENT_CMD = `${process.execPath} ${createFakeAgent()}`;
    const app = createApp(projectDir);

    await enqueue(app, "p3", "one");
    await waitForIdle(app, "p3");
    const res = await app.request("/projects/p3/agent/jobs", { method: "DELETE" });
    expect(((await res.json()) as { jobs: AgentJob[] }).jobs).toEqual([]);
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
