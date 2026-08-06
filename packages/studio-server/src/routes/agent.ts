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
  answerAgentJob,
  cancelAgentJob,
  clearFinishedAgentJobs,
  enqueueAgentJob,
  findAgentJob,
  listAgentJobs,
  moveAgentJob,
  promoteAgentJob,
  steerAgentJob,
  type AgentCommand,
  type AgentKind,
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
  agentJobPatchSchema,
  agentKindSchema,
  agentRunRequestSchema,
  customAgentRequestSchema,
  type CustomAgent,
} from "../helpers/agentSchemas.js";
import { deleteCustomAgent, listCustomAgents, saveCustomAgent } from "../helpers/customAgents.js";
import { skillsPromptSection } from "../helpers/agentSkills.js";
import type { HarnessSpec } from "../helpers/harnessModels.js";

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
    // --input-format stream-json holds stdin open, so a correction can be sent
    // into a run that is already going rather than stopping and resuming it.
    // Its pair, --output-format stream-json, is what makes the run legible
    // while it happens: every tool call arrives as its own event.
    args: [
      "-p",
      "--permission-mode",
      "acceptEdits",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
    ],
    promptFormat: "stream-json",
  },
  codex: {
    kind: "codex",
    label: "Codex",
    command: "codex",
    // --json is the same bargain stream-json is for Claude Code: every step
    // arrives as an event on stdout. Without it Codex writes its progress, and
    // its session id, to stderr as prose that would have to be scraped.
    args: ["exec", "--json", "--sandbox", "workspace-write", "--skip-git-repo-check", "-"],
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
  // The same two harnesses over the Agent Client Protocol, through the
  // adapters their own projects publish. Same accounts, same models, same
  // machine — what changes is that Studio talks to them over a published
  // contract instead of reading their stdout, so they can ask before they act.
  "codex-acp": {
    kind: "codex",
    label: "Codex (ACP)",
    command: "npx",
    args: ["-y", "@agentclientprotocol/codex-acp"],
    transport: "acp",
  },
  "claude-acp": {
    kind: "claude",
    label: "Claude Code (ACP)",
    command: "npx",
    args: ["-y", "@agentclientprotocol/claude-agent-acp"],
    transport: "acp",
  },
};

/**
 * The same harness, told to pick a session back up.
 *
 * Only the harnesses whose resume shape is known appear. Everything else steers
 * by asking again with the original request amended, which costs the session's
 * context but never loses the instruction.
 */
const RESUME_ARGS: Partial<Record<AgentCommand["kind"], (sessionId: string) => string[] | null>> = {
  // `claude -p --resume <id>` still reads the follow-up on stdin.
  claude: (sessionId) => ["--resume", sessionId],
  // Codex resumes through a subcommand with its own, shorter option list —
  // flags first, then the id, then the stdin marker. It takes no --sandbox:
  // the resumed session keeps the one it started with.
  codex: (sessionId) => ["exec", "resume", "--json", "--skip-git-repo-check", sessionId, "-"],
};

/** A resumed form of this command, or null when the harness has no resume. */
export function resumedAgentCommand(
  agent: AgentCommand,
  sessionId: string | undefined,
): AgentCommand | null {
  const build = sessionId ? RESUME_ARGS[agent.kind] : undefined;
  const args = build?.(sessionId!);
  if (!args) return null;
  // Codex rebuilds its args outright; Claude only adds a flag to its own.
  return { ...agent, args: agent.kind === "codex" ? args : [...agent.args, ...args] };
}

/** What the model list needs to know about a harness: which, how, and where. */
function harnessSpec(agent: AgentCommand | null, kind: AgentKind, cwd: string): HarnessSpec {
  return {
    kind,
    command: agent?.command ?? "",
    args: agent?.args ?? [],
    transport: agent?.transport,
    cwd,
  };
}

/** Name a custom command after the harness it points at, so its mark is right. */
function sniffKind(command: string): AgentCommand["kind"] {
  const match = Object.values(AGENT_PRESETS)
    // Only the presets whose command IS the harness can be sniffed for. An ACP
    // adapter is launched by `npx`, and matching on that would name every
    // npx-run agent after whichever adapter happens to be listed first.
    .filter((preset) => preset.transport !== "acp")
    .find((preset) => new RegExp(preset.command, "i").test(command));
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

/**
 * Whether the picker should offer this harness.
 *
 * For a CLI that is the harness, the question is whether it is installed, and
 * a missing file is a real answer. An ACP adapter is not the harness — it is
 * fetched on demand by `npx`, so finding `npx` proves nothing and not finding
 * the adapter proves nothing either. The only honest test is the handshake,
 * which costs a process start per entry in the picker. So a declared ACP agent
 * is offered, and one that cannot run says why when it is used: an error the
 * user can act on beats an option silently missing.
 */
function isAvailable(agent: { command: string; transport?: "native" | "acp" }): boolean {
  return agent.transport === "acp" || isOnPath(agent.command);
}

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
    // A custom agent naming a known harness gets that harness' mark; the ACP
    // registry is full of adapters for CLIs Studio already draws.
    kind: sniffKind(`${agent.command} ${agent.args.join(" ")}`),
    label: agent.label,
    command: agent.command,
    args: agent.args,
    icon: agent.icon,
    transport: agent.transport,
    available: isAvailable(agent),
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
    ...Object.entries(AGENT_PRESETS)
      .filter(([, preset]) => preset.command !== envAgent?.command)
      .map(([id, preset]) => ({ ...preset, id, available: isAvailable(preset) })),
    ...(projectDir ? listCustomAgents(projectDir).map(toChoice) : []),
  ];
}

function resolveCustomAgentCommand(env: NodeJS.ProcessEnv): AgentCommand | null {
  const custom = env.HYPERFRAMES_AGENT_CMD?.trim();
  if (!custom) return null;
  const [command, ...args] = custom.split(/\s+/);
  if (!command) return null;
  // A custom command names no harness of its own: sniff the known ones out of
  // it, else it renders as "custom" (and can supply HYPERFRAMES_AGENT_ICON).
  const kind = sniffKind(custom);
  return {
    kind,
    label: command,
    command,
    args,
    // A wrapper around a known harness speaks that harness' contract, so it
    // gets its prompt format too — otherwise a wrapped Claude Code would
    // silently lose streaming input and every steer would restart the run.
    promptFormat: AGENT_PRESETS[kind]?.promptFormat,
  };
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
    // The command matters now, not just the kind: an ACP agent is asked what it
    // runs over its own protocol, so the list depends on how it is started.
    const agent =
      resolveAgentCommand(process.env, requestedId, project.dir) ?? resolveAgentCommand();
    const kind = requestedKind.success ? requestedKind.data : agent?.kind;
    if (!kind) return c.json({ models: [], defaultModel: null });
    const models = await listAgentModels(harnessSpec(agent, kind, project.dir));
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
      targetRefs,
      targetKind,
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
    const spec = harnessSpec(agent, agent.kind, project.dir);
    const model = requestedModel ?? (await resolveDefaultModel(spec)) ?? undefined;
    // Same rule as the model: the cheapest thing that can do the job, unless
    // the user said otherwise. For effort that is the lowest level offered.
    const effort = requestedEffort ?? (await resolveDefaultEffort(spec, model)) ?? undefined;

    // The prompt is built in the browser, which cannot see what is installed on
    // disk. Naming the skills is the server's job, and it is what turns a
    // generic edit into one that knows the framework's rules.
    const skills = skillsPromptSection(project.dir);
    const job = enqueueAgentJob({
      projectId: project.id,
      projectDir: project.dir,
      // An ACP agent takes its model over the protocol, not on its command
      // line; adding flags here would be Studio guessing at its CLI.
      agent:
        agent.transport === "acp"
          ? agent
          : { ...agent, args: withModelArgs(agent.kind, agent.args, model, effort) },
      model,
      effort,
      prompt: skills.length > 0 ? `${prompt}\n${skills.join("\n")}` : prompt,
      instruction: instruction ?? prompt.slice(0, 120),
      target: target ?? "composition",
      targetRef,
      targetRefs,
      targetKind,
    });

    return c.json({ job });
  });

  // Change a run: `position` reorders a waiting one, `promote` makes it the one
  // that is happening, `steer` corrects what it was asked to do — in place
  // while it waits, or by resuming it mid-flight — and `answer` settles a
  // question the agent stopped to ask.
  api.patch("/projects/:id/agent/jobs/:jobId", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    const jobId = c.req.param("jobId");

    const patch = agentJobPatchSchema.safeParse(await c.req.json().catch(() => null));
    if (!patch.success) return c.json({ error: "position or steer required" }, 400);

    // The agent asked something and the run has stopped on it. Answering is
    // checked against the options the agent itself offered, so a stale tray
    // cannot forward a choice that is no longer on the table.
    if (patch.data.answer !== undefined) {
      const answered = answerAgentJob(project.id, jobId, patch.data.answer);
      if ("refused" in answered) {
        return c.json(
          {
            error:
              answered.refused === "not-offered"
                ? "that option is not one the agent offered"
                : "job is not waiting on an answer",
          },
          409,
        );
      }
      return c.json({ jobs: listAgentJobs(project.id, project.dir) });
    }

    if (patch.data.promote) {
      if (!promoteAgentJob(project.id, jobId, project.dir)) {
        return c.json({ error: "job is not queued" }, 409);
      }
      return c.json({ jobs: listAgentJobs(project.id, project.dir) });
    }

    if (patch.data.steer !== undefined) {
      const job = findAgentJob(project.id, jobId);
      const agent = job ? resolveAgentCommand(process.env, job.kind, project.dir) : null;
      const steered = steerAgentJob({
        projectId: project.id,
        jobId,
        text: patch.data.steer,
        projectDir: project.dir,
        resumed: agent ? resumedAgentCommand(agent, job?.sessionId) : null,
      });
      if (!steered) return c.json({ error: "job cannot be steered" }, 409);
      return c.json({ jobs: listAgentJobs(project.id, project.dir) });
    }

    if (!moveAgentJob(project.id, jobId, Math.trunc(patch.data.position ?? 0))) {
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
