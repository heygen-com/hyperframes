import type { Context, Hono } from "hono";
import { createReadStream, existsSync } from "node:fs";
import { delimiter, extname, join } from "node:path";
import { Readable } from "node:stream";
import type { StudioApiAdapter } from "../types.js";
import {
  listAgentModels,
  resolveDefaultEffort,
  resolveDefaultModel,
  withModelArgs,
} from "../helpers/agentModels.js";
import {
  cancelAgentJob,
  clearFinishedAgentJobs,
  enqueueAgentJob,
  listAgentJobs,
  moveAgentJob,
  type AgentCommand,
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
export type { AgentModel } from "../helpers/agentModels.js";
import {
  agentKindSchema,
  agentQueueMoveSchema,
  agentRunRequestSchema,
  customAgentRequestSchema,
  type CustomAgent,
} from "../helpers/agentSchemas.js";
import { deleteCustomAgent, listCustomAgents, saveCustomAgent } from "../helpers/customAgents.js";

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
    label: "Hermes Agent",
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

/** Stream a harness' own mark from disk, refusing anything that is not an image. */
function sendIconFile(c: Context, iconPath: string): Response {
  if (!existsSync(iconPath)) return c.json({ error: "not found" }, 404);
  const mime = ICON_MIME[extname(iconPath).toLowerCase()];
  if (!mime) return c.json({ error: "unsupported icon type" }, 415);
  return new Response(Readable.toWeb(createReadStream(iconPath)) as ReadableStream, {
    headers: { "content-type": mime, "cache-control": "no-cache" },
  });
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

/** A harness the picker can offer, with whether its CLI is actually installed. */
export interface AgentChoice extends AgentCommand {
  /** Built-in kind, or the custom agent's own id. */
  id: string;
  available: boolean;
  icon?: string;
}

function toChoice(agent: CustomAgent): AgentChoice {
  return {
    id: agent.id,
    kind: "custom",
    label: agent.label,
    command: agent.command,
    args: agent.args,
    icon: agent.icon,
    available: isOnPath(agent.command),
  };
}

/**
 * Every harness Studio knows about: the env override, the built-in presets, and
 * whatever the project registered itself. The picker needs the unavailable ones
 * too, so it can say why they are greyed out.
 */
export function listAgentCommands(
  env: NodeJS.ProcessEnv = process.env,
  projectDir?: string,
): AgentChoice[] {
  const envAgent = resolveCustomAgentCommand(env);
  return [
    ...(envAgent ? [{ ...envAgent, id: envAgent.kind, available: true }] : []),
    ...Object.values(AGENT_PRESETS)
      .filter((preset) => preset.command !== envAgent?.command)
      .map((preset) => ({ ...preset, id: preset.kind, available: isOnPath(preset.command) })),
    ...(projectDir ? listCustomAgents(projectDir).map(toChoice) : []),
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
  projectDir?: string,
): AgentCommand | null {
  if (requested) {
    return (
      listAgentCommands(env, projectDir).find(
        (agent) => agent.id === requested && agent.available,
      ) ?? null
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
      agents: listAgentCommands(process.env, project.dir).map(
        ({ id, kind, label, available, icon }) => ({
          id,
          kind,
          label,
          available,
          iconUrl: icon
            ? `/api/projects/${project.id}/agent/icon?agent=${encodeURIComponent(id)}`
            : null,
        }),
      ),
      iconUrl: resolveAgentIconPath() ? `/api/projects/${project.id}/agent/icon` : null,
      jobs: listAgentJobs(project.id, project.dir),
    });
  });

  api.get("/projects/:id/agent/models", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    const url = new URL(c.req.url, "http://localhost");
    const requestedId = url.searchParams.get("agent") ?? undefined;
    const requestedKind = agentKindSchema.safeParse(requestedId);
    const kind = requestedKind.success
      ? requestedKind.data
      : (resolveAgentCommand(process.env, requestedId, project.dir)?.kind ??
        resolveAgentCommand()?.kind);
    if (!kind) return c.json({ models: [], defaultModel: null });
    const models = await listAgentModels(kind);
    return c.json({ models, defaultModel: models[0]?.id ?? null });
  });

  // Register a harness of your own: same fields the built-in presets carry.
  api.post("/projects/:id/agent/custom", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);

    const parsed = customAgentRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "label and command are required" }, 400);
    }
    const agent = saveCustomAgent(project.dir, parsed.data);
    return c.json({ agent, agents: listCustomAgents(project.dir) });
  });

  api.delete("/projects/:id/agent/custom/:agentId", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    return c.json({ agents: deleteCustomAgent(project.dir, c.req.param("agentId")) });
  });

  api.get("/projects/:id/agent/icon", async (c) => {
    const url = new URL(c.req.url, "http://localhost");
    const requested = url.searchParams.get("agent");
    if (requested) {
      const project = await adapter.resolveProject(c.req.param("id"));
      const custom = project
        ? listCustomAgents(project.dir).find((agent) => agent.id === requested)
        : undefined;
      if (custom?.icon) return sendIconFile(c, custom.icon);
      return c.json({ error: "not found" }, 404);
    }
    const iconPath = resolveAgentIconPath();
    if (!iconPath) return c.json({ error: "not found" }, 404);
    return sendIconFile(c, iconPath);
  });

  api.post("/projects/:id/agent", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);

    const parsed = agentRunRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "prompt required" }, 400);
    const {
      prompt,
      instruction,
      target,
      targetRef,
      agent: requested,
      model: requestedModel,
      effort: requestedEffort,
    } = parsed.data;
    const agent = resolveAgentCommand(process.env, requested, project.dir);
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

    // No model named? Take the cheapest one the catalog says can drive tools —
    // a run should not quietly cost frontier money because nobody chose.
    const model = requestedModel ?? (await resolveDefaultModel(agent.kind)) ?? undefined;
    // Same rule as the model: the cheapest thing that can do the job, unless
    // the user said otherwise. For effort that is the lowest level offered.
    const effort = requestedEffort ?? (await resolveDefaultEffort(agent.kind, model)) ?? undefined;

    const job = enqueueAgentJob({
      projectId: project.id,
      projectDir: project.dir,
      agent: { ...agent, args: withModelArgs(agent.kind, agent.args, model, effort) },
      model,
      effort,
      prompt,
      instruction: instruction ?? prompt.slice(0, 120),
      target: target ?? "composition",
      targetRef,
    });

    return c.json({ job });
  });

  // Reorder a waiting run. `position` indexes the queue (0 is next up).
  api.patch("/projects/:id/agent/jobs/:jobId", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);

    const move = agentQueueMoveSchema.safeParse(await c.req.json().catch(() => null));
    if (!move.success) return c.json({ error: "position required" }, 400);
    const position = Math.trunc(move.data.position);

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
