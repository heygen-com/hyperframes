import type { Hono } from "hono";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { StudioApiAdapter } from "../types.js";

/**
 * Run the user's own coding-agent CLI against the open project.
 *
 * Studio already knows how to describe a selected element or timeline clip as a
 * prompt (`buildElementAgentPrompt`); this route hands that prompt to whichever
 * harness CLI the user has installed instead of making them paste it into a
 * terminal. The agent edits files on disk and the existing file watcher
 * (`/api/events`) reloads the preview.
 */

/** Which harness the command belongs to — drives the icon Studio shows. */
export type AgentKind = "claude" | "codex";

export interface AgentCommand {
  kind: AgentKind;
  label: string;
  command: string;
  args: string[];
}

/**
 * Prompts always arrive on stdin — never as an argv or shell string — so a
 * composition's text can't be read as flags or shell syntax.
 */
const AGENT_PRESETS: Record<string, AgentCommand> = {
  claude: {
    kind: "claude",
    label: "Claude Code",
    command: "claude",
    args: ["-p", "--permission-mode", "acceptEdits"],
  },
  codex: {
    kind: "codex",
    label: "Codex",
    command: "codex",
    args: ["exec", "--sandbox", "workspace-write", "--skip-git-repo-check", "-"],
  },
};

const AGENT_TIMEOUT_MS = 10 * 60 * 1000;

function isOnPath(command: string): boolean {
  if (command.includes("/")) return existsSync(command);
  const paths = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  return paths.some((dir) => existsSync(join(dir, command)));
}

/** Env override wins, then an explicit preset name, then whatever is installed. */
export function resolveAgentCommand(env: NodeJS.ProcessEnv = process.env): AgentCommand | null {
  const custom = env.HYPERFRAMES_AGENT_CMD?.trim();
  if (custom) {
    const [command, ...args] = custom.split(/\s+/);
    // A custom command names no harness. Sniff it, and when that is
    // inconclusive show the Claude mark rather than no icon at all.
    if (command) {
      return { kind: /codex/i.test(custom) ? "codex" : "claude", label: command, command, args };
    }
  }

  const named = env.HYPERFRAMES_AGENT?.trim();
  if (named) return AGENT_PRESETS[named] ?? null;

  return Object.values(AGENT_PRESETS).find((preset) => isOnPath(preset.command)) ?? null;
}

function runAgent(
  agent: AgentCommand,
  prompt: string,
  cwd: string,
): Promise<{ output: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(agent.command, agent.args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${agent.label} timed out after ${AGENT_TIMEOUT_MS / 60000} minutes`));
    }, AGENT_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ output: output.trim(), exitCode: code ?? 0 });
    });

    child.stdin.end(prompt);
  });
}

export function registerAgentRoutes(api: Hono, adapter: StudioApiAdapter): void {
  api.get("/projects/:id/agent", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    const agent = resolveAgentCommand();
    return c.json({
      available: agent !== null,
      label: agent?.label ?? null,
      kind: agent?.kind ?? null,
    });
  });

  api.post("/projects/:id/agent", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);

    const body = (await c.req.json().catch(() => null)) as { prompt?: unknown } | null;
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) return c.json({ error: "prompt required" }, 400);

    const agent = resolveAgentCommand();
    if (!agent) {
      return c.json(
        { error: "No agent CLI found. Install claude or codex, or set HYPERFRAMES_AGENT_CMD." },
        501,
      );
    }

    try {
      const { output, exitCode } = await runAgent(agent, prompt, project.dir);
      return c.json({ kind: agent.kind, label: agent.label, output, exitCode });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: `${agent.label} failed: ${msg}` }, 500);
    }
  });
}
