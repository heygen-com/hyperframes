import type { Hono } from "hono";
import { createReadStream, existsSync } from "node:fs";
import { delimiter, extname, join } from "node:path";
import { Readable } from "node:stream";
import type { StudioApiAdapter } from "../types.js";
import {
  cancelAgentJob,
  clearFinishedAgentJobs,
  enqueueAgentJob,
  listAgentJobs,
  moveAgentJob,
  type AgentCommand,
  type AgentTargetRef,
} from "../helpers/agentJobs.js";

/**
 * Run the user's own coding-agent CLI against the open project.
 *
 * Studio already knows how to describe a selected element or timeline clip as a
 * prompt (`buildElementAgentPrompt`); this route hands that prompt to whichever
 * harness CLI the user has installed instead of making them paste it into a
 * terminal. Runs are queued server-side (see helpers/agentJobs), so a browser
 * reload keeps showing in-flight work, and the existing file watcher
 * (`/api/events`) reloads the preview as the agent edits.
 */

export type { AgentCommand, AgentKind, AgentTargetRef } from "../helpers/agentJobs.js";

/**
 * Prompts always arrive on stdin — never as an argv or shell string — so a
 * composition's text can't be read as flags or shell syntax.
 */
const AGENT_PRESETS: Record<string, AgentCommand> = {
  claude: {
    kind: "claude",
    label: "Claude Code",
    command: "claude",
    // stream-json is what makes the run legible while it happens: every tool
    // call arrives as its own event instead of one silent block at exit.
    args: ["-p", "--permission-mode", "acceptEdits", "--output-format", "stream-json", "--verbose"],
  },
  codex: {
    kind: "codex",
    label: "Codex",
    command: "codex",
    args: ["exec", "--sandbox", "workspace-write", "--skip-git-repo-check", "-"],
  },
  hermes: {
    kind: "hermes",
    label: "Hermes",
    command: "hermes",
    // -z is Hermes' headless mode: prompt in on stdin, final text out.
    args: ["-z"],
  },
  openclaw: {
    kind: "openclaw",
    label: "OpenClaw",
    command: "openclaw",
    // exec is already the headless profile; --message-file - is how it takes stdin.
    args: ["agent", "exec", "--message-file", "-"],
  },
};

/** Name a custom command after the harness it points at, so its mark is right. */
function sniffKind(command: string): AgentCommand["kind"] {
  const match = Object.values(AGENT_PRESETS).find((preset) =>
    new RegExp(preset.command, "i").test(command),
  );
  return match?.kind ?? "custom";
}

/**
 * Any harness can supply its own mark: point HYPERFRAMES_AGENT_ICON at an SVG
 * or PNG and Studio shows that instead of a built-in glyph. This is the path
 * for agents we do not ship a preset for (pi, an in-house wrapper, anything).
 */
function resolveAgentIconPath(env: NodeJS.ProcessEnv = process.env): string | null {
  const path = env.HYPERFRAMES_AGENT_ICON?.trim();
  return path && existsSync(path) ? path : null;
}

const ICON_MIME: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function isOnPath(command: string): boolean {
  if (command.includes("/")) return existsSync(command);
  const paths = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  return paths.some((dir) => existsSync(join(dir, command)));
}

/**
 * Every harness Studio knows about, with whether it is actually installed. The
 * picker needs the unavailable ones too, so it can say why they are greyed out.
 */
export function listAgentCommands(
  env: NodeJS.ProcessEnv = process.env,
): Array<AgentCommand & { available: boolean }> {
  const custom = resolveCustomAgentCommand(env);
  return [
    ...(custom ? [{ ...custom, available: true }] : []),
    ...Object.values(AGENT_PRESETS)
      .filter((preset) => preset.command !== custom?.command)
      .map((preset) => ({ ...preset, available: isOnPath(preset.command) })),
  ];
}

function resolveCustomAgentCommand(env: NodeJS.ProcessEnv): AgentCommand | null {
  const custom = env.HYPERFRAMES_AGENT_CMD?.trim();
  if (!custom) return null;
  const [command, ...args] = custom.split(/\s+/);
  // A custom command names no harness of its own: sniff the known ones out of
  // it, else it renders as "custom" (and can supply HYPERFRAMES_AGENT_ICON).
  return command ? { kind: sniffKind(custom), label: command, command, args } : null;
}

/** Env override wins, then an explicit preset name, then whatever is installed. */
export function resolveAgentCommand(
  env: NodeJS.ProcessEnv = process.env,
  /** A harness the user picked for this run, overriding the default. */
  requested?: string,
): AgentCommand | null {
  if (requested) {
    return (
      listAgentCommands(env).find((agent) => agent.kind === requested && agent.available) ?? null
    );
  }

  const custom = resolveCustomAgentCommand(env);
  if (custom) return custom;

  const named = env.HYPERFRAMES_AGENT?.trim();
  if (named) return AGENT_PRESETS[named] ?? null;

  return Object.values(AGENT_PRESETS).find((preset) => isOnPath(preset.command)) ?? null;
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
      agents: listAgentCommands().map(({ kind, label, available }) => ({
        kind,
        label,
        available,
      })),
      iconUrl: resolveAgentIconPath() ? `/api/projects/${project.id}/agent/icon` : null,
      jobs: listAgentJobs(project.id, project.dir),
    });
  });

  api.get("/projects/:id/agent/icon", async (c) => {
    const iconPath = resolveAgentIconPath();
    if (!iconPath) return c.json({ error: "not found" }, 404);
    const mime = ICON_MIME[extname(iconPath).toLowerCase()];
    if (!mime) return c.json({ error: "unsupported icon type" }, 415);
    return new Response(Readable.toWeb(createReadStream(iconPath)) as ReadableStream, {
      headers: { "content-type": mime, "cache-control": "no-cache" },
    });
  });

  api.post("/projects/:id/agent", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);

    const body = (await c.req.json().catch(() => null)) as {
      prompt?: unknown;
      instruction?: unknown;
      target?: unknown;
      targetRef?: unknown;
      agent?: unknown;
    } | null;
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) return c.json({ error: "prompt required" }, 400);

    const requested = typeof body?.agent === "string" ? body.agent : undefined;
    const agent = resolveAgentCommand(process.env, requested);
    if (!agent) {
      if (requested) return c.json({ error: `${requested} is not installed.` }, 501);
      return c.json(
        {
          error:
            "No agent CLI found. Install claude, codex, hermes or openclaw, or set HYPERFRAMES_AGENT_CMD.",
        },
        501,
      );
    }

    const job = enqueueAgentJob({
      projectId: project.id,
      projectDir: project.dir,
      agent,
      prompt,
      instruction: typeof body?.instruction === "string" ? body.instruction : prompt.slice(0, 120),
      target: typeof body?.target === "string" ? body.target : "composition",
      // Opaque to the server: Studio hands back its own selection coordinates
      // so the run list can re-select the element it edited.
      targetRef:
        typeof body?.targetRef === "object" && body.targetRef !== null
          ? (body.targetRef as AgentTargetRef)
          : undefined,
    });

    return c.json({ job });
  });

  // Reorder a waiting run. `position` indexes the queue (0 is next up).
  api.patch("/projects/:id/agent/jobs/:jobId", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);

    const body = (await c.req.json().catch(() => null)) as { position?: unknown } | null;
    const position = typeof body?.position === "number" ? Math.trunc(body.position) : null;
    if (position === null) return c.json({ error: "position required" }, 400);

    if (!moveAgentJob(project.id, c.req.param("jobId"), position)) {
      return c.json({ error: "job is not queued" }, 409);
    }
    return c.json({ jobs: listAgentJobs(project.id, project.dir) });
  });

  api.delete("/projects/:id/agent/jobs/:jobId", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    if (!cancelAgentJob(project.id, c.req.param("jobId"), project.dir)) {
      return c.json({ error: "job already finished" }, 409);
    }
    return c.json({ jobs: listAgentJobs(project.id, project.dir) });
  });

  api.delete("/projects/:id/agent/jobs", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    clearFinishedAgentJobs(project.id);
    return c.json({ jobs: listAgentJobs(project.id, project.dir) });
  });
}
