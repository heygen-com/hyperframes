import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerAgentRoutes, resolveAgentCommand } from "./agent";
import type { StudioApiAdapter } from "../types";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.HYPERFRAMES_AGENT_CMD;
  delete process.env.HYPERFRAMES_AGENT;
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
      "import { writeFileSync } from 'node:fs';",
      "let prompt = '';",
      "process.stdin.on('data', (c) => (prompt += c));",
      "process.stdin.on('end', () => {",
      "  writeFileSync('edited.txt', prompt);",
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

describe("resolveAgentCommand", () => {
  it("prefers an explicit command over presets", () => {
    expect(resolveAgentCommand({ HYPERFRAMES_AGENT_CMD: "my-agent --run now" })).toEqual({
      kind: "claude",
      label: "my-agent",
      command: "my-agent",
      args: ["--run", "now"],
    });
  });

  it("labels a custom command with the harness it names", () => {
    // An unrecognizable command still gets a mark rather than a blank slot.
    expect(resolveAgentCommand({ HYPERFRAMES_AGENT_CMD: "codex exec -" })?.kind).toBe("codex");
    expect(resolveAgentCommand({ HYPERFRAMES_AGENT_CMD: "my-agent" })?.kind).toBe("claude");
  });

  it("resolves a named preset", () => {
    expect(resolveAgentCommand({ HYPERFRAMES_AGENT: "codex" })?.command).toBe("codex");
    expect(resolveAgentCommand({ HYPERFRAMES_AGENT: "nope" })).toBeNull();
  });
});

describe("registerAgentRoutes", () => {
  it("runs the configured agent in the project dir with the prompt on stdin", async () => {
    const projectDir = createProjectDir();
    process.env.HYPERFRAMES_AGENT_CMD = `${process.execPath} ${createFakeAgent()}`;

    const res = await createApp(projectDir).request("/projects/p1/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "make the title red" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { output: string; exitCode: number };
    expect(body.exitCode).toBe(0);
    expect(body.output).toContain("agent done");
    expect(readFileSync(join(projectDir, "edited.txt"), "utf-8")).toBe("make the title red");
  });

  it("rejects an empty prompt", async () => {
    const res = await createApp(createProjectDir()).request("/projects/p1/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "   " }),
    });
    expect(res.status).toBe(400);
  });

  it("reports availability without running anything", async () => {
    process.env.HYPERFRAMES_AGENT_CMD = "my-agent";
    const res = await createApp(createProjectDir()).request("/projects/p1/agent");
    expect(await res.json()).toEqual({ available: true, label: "my-agent", kind: "claude" });
  });
});
