import { realpathSync } from "node:fs";
import type { Hono } from "hono";
import {
  isCreateTimelineCommentInput,
  isTimelineCommentElement,
  listTimelineComments,
  removeTimelineCommentFromProject,
  type TimelineCommentElement,
  writeTimelineCommentToProject,
} from "../helpers/timelineComments.js";
import type { ResolvedProject, StudioApiAdapter } from "../types.js";

interface StudioAgentRunInput {
  commentId: string;
  filePath: string;
  prompt: string;
  rangeStart: number;
  rangeEnd: number;
  elements: TimelineCommentElement[];
}

interface StudioAgentRunEvent {
  type: string;
  sessionId?: string;
  content?: unknown;
  error?: string;
}

type AdapterInfo = { kind: string; detected: boolean; selected: boolean };

type SuperconnectorModule = {
  createSuperconnector: (opts?: { cwd?: string }) => {
    whichAdapterWillRun: (opts: {
      appId: string;
      sessionSelector?: string;
      resumeLastCreatedSession?: boolean;
    }) => {
      ready: boolean;
      adapter: string | null;
      action?: string;
      source?: string;
      reason?: string;
      session?: { sessionId?: string } | null;
    };
    listAdapters: () => AdapterInfo[];
    spawn: (opts: {
      prompt: string;
      appId: string;
      sessionSelector?: string;
      resumeLastCreatedSession?: boolean;
      permissionMode?: "acceptEdits";
      signal?: AbortSignal;
    }) => AsyncIterable<{ type: string; sessionId?: string; content?: unknown }>;
  };
};

const TIMELINE_COMMENT_AGENT_APP_ID = "hyperframes";

interface ActiveAgentRun {
  commentId: string;
  abortController: AbortController;
  startedAt: number;
}

const activeAgentRuns = new Map<string, ActiveAgentRun>();

function encodeNdjson(event: StudioAgentRunEvent): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`);
}

function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" || err.message.toLowerCase().includes("abort"))
  );
}

function isStudioAgentRunInput(value: unknown): value is StudioAgentRunInput {
  if (!value || typeof value !== "object") return false;
  const input = value as Partial<StudioAgentRunInput>;
  return (
    typeof input.commentId === "string" &&
    typeof input.filePath === "string" &&
    typeof input.prompt === "string" &&
    typeof input.rangeStart === "number" &&
    typeof input.rangeEnd === "number" &&
    Array.isArray(input.elements) &&
    input.elements.every(isTimelineCommentElement)
  );
}

function createSuperconnectorOptions(projectDir: string): { cwd: string } {
  return { cwd: realpathSync(projectDir) };
}

async function loadSuperconnector(): Promise<SuperconnectorModule> {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (
    specifier: string,
  ) => Promise<SuperconnectorModule>;
  return dynamicImport("@nimrobo/superconnector");
}

type SuperconnectorConfig = { preferredAdapter?: string; [key: string]: unknown };

type SuperconnectorConfigModule = {
  localConfigPath: (cwd: string) => string;
  readConfig: (path: string) => SuperconnectorConfig | null;
  writeConfig: (path: string, cfg: SuperconnectorConfig) => void;
};

async function loadSuperconnectorConfig(): Promise<SuperconnectorConfigModule> {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (
    specifier: string,
  ) => Promise<SuperconnectorConfigModule>;
  return dynamicImport("@nimrobo/superconnector/config");
}

function buildTimelineCommentAgentPrompt(
  project: ResolvedProject,
  input: StudioAgentRunInput,
): string {
  const elements = input.elements
    .map((element) => {
      const source = element.sourceFile ? `, source ${element.sourceFile}` : "";
      const selector = element.selector ? `, selector ${element.selector}` : "";
      return `- ${element.id} (${element.tag}) ${element.start}-${element.start + element.duration}s, track ${element.track}${source}${selector}`;
    })
    .join("\n");

  return `You are resolving a Hyperframes Studio timeline comment.

Project: ${project.title ?? project.id}
Comment id: ${input.commentId}
Comment file: ${input.filePath}
Time range: ${input.rangeStart}-${input.rangeEnd}s

Affected timeline elements:
${elements || "(none)"}

User request:
${input.prompt}

Instructions:
- Edit the project files directly to satisfy the request.
- Follow Hyperframes conventions: HTML compositions, data-start/data-duration/data-track-index, paused GSAP timelines registered on window.__timelines, deterministic rendering.
- Keep the change scoped to this timeline request.
- When the request is resolved, remove the matching "<!-- hyperframes-comment ... -->" comment with id "${input.commentId}" from ${input.filePath}.
- If you edit any .html composition, run npx hyperframes lint and npx hyperframes validate before finishing.`;
}

async function previewAgentRun(project: ResolvedProject) {
  const { createSuperconnector } = await loadSuperconnector();
  const superconnectorOptions = createSuperconnectorOptions(project.dir);
  const sc = createSuperconnector(superconnectorOptions);
  const preview = sc.whichAdapterWillRun({
    appId: TIMELINE_COMMENT_AGENT_APP_ID,
    sessionSelector: project.id,
    resumeLastCreatedSession: false,
  });
  let adapters: { kind: string; detected: boolean }[] = [];
  try {
    adapters = sc.listAdapters().map((a) => ({ kind: a.kind, detected: a.detected }));
  } catch {
    // listAdapters is advisory; preview still works without the adapter list.
  }
  return {
    ready: preview.ready,
    agent: preview.adapter,
    path: superconnectorOptions.cwd,
    action: preview.action,
    source: preview.source,
    reason: preview.reason,
    adapters,
  };
}

async function* runAgentCommentResolution(
  project: ResolvedProject,
  input: StudioAgentRunInput,
  signal?: AbortSignal,
): AsyncIterable<StudioAgentRunEvent> {
  const { createSuperconnector } = await loadSuperconnector();
  const sc = createSuperconnector(createSuperconnectorOptions(project.dir));
  for await (const msg of sc.spawn({
    prompt: buildTimelineCommentAgentPrompt(project, input),
    appId: TIMELINE_COMMENT_AGENT_APP_ID,
    sessionSelector: project.id,
    resumeLastCreatedSession: false,
    permissionMode: "acceptEdits",
    signal,
  })) {
    yield {
      type: msg.type,
      sessionId: msg.sessionId,
      content: msg.content,
    };
  }
}

export function registerTimelineCommentRoutes(api: Hono, adapter: StudioApiAdapter): void {
  // Warm the Superconnector modules at startup so the first agent preview and
  // the first adapter change don't pay the cold dynamic-import cost.
  void loadSuperconnector().catch(() => {});
  void loadSuperconnectorConfig().catch(() => {});

  api.get("/projects/:id/timeline-comments", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    return c.json({ comments: listTimelineComments(project.dir) });
  });

  api.post("/projects/:id/timeline-comments", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);

    const body = await c.req.json().catch(() => null);
    if (!isCreateTimelineCommentInput(body)) {
      return c.json({ error: "filePath and prompt required" }, 400);
    }

    try {
      const result = writeTimelineCommentToProject(project.dir, body);
      return c.json(result, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message === "forbidden" ? 403 : 500;
      return c.json({ error: message }, status);
    }
  });

  api.delete("/projects/:id/timeline-comments/:commentId", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);

    const result = removeTimelineCommentFromProject(project.dir, c.req.param("commentId"));
    return c.json({ ok: true, ...result });
  });

  api.get("/projects/:id/agent/preview", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    return c.json(await previewAgentRun(project));
  });

  api.put("/projects/:id/agent/adapter", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);

    const body = (await c.req.json().catch(() => null)) as { adapter?: unknown } | null;
    if (!body || typeof body.adapter !== "string") {
      return c.json({ error: "adapter required" }, 400);
    }

    const { createSuperconnector } = await loadSuperconnector();
    const options = createSuperconnectorOptions(project.dir);
    const sc = createSuperconnector(options);
    const known = new Set(sc.listAdapters().map((a) => a.kind));
    if (!known.has(body.adapter)) {
      return c.json({ error: `unknown adapter: ${body.adapter}` }, 400);
    }

    const { localConfigPath, readConfig, writeConfig } = await loadSuperconnectorConfig();
    const configPath = localConfigPath(options.cwd);
    const current = readConfig(configPath) ?? {};
    writeConfig(configPath, { ...current, preferredAdapter: body.adapter });

    return c.json(await previewAgentRun(project));
  });

  api.post("/projects/:id/agent/resolve-comment", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);

    const input = await c.req.json().catch(() => null);
    if (!isStudioAgentRunInput(input)) {
      return c.json({ error: "commentId, filePath, and prompt required" }, 400);
    }

    if (activeAgentRuns.has(project.id)) {
      return c.json({ error: "busy", commentId: input.commentId }, 409);
    }

    const controller = new AbortController();
    c.req.raw.signal.addEventListener("abort", () => controller.abort(), { once: true });

    activeAgentRuns.set(project.id, {
      commentId: input.commentId,
      abortController: controller,
      startedAt: Date.now(),
    });

    const stream = new ReadableStream<Uint8Array>({
      async start(streamController) {
        try {
          for await (const event of runAgentCommentResolution(project, input, controller.signal)) {
            streamController.enqueue(encodeNdjson(event));
          }
          streamController.enqueue(encodeNdjson({ type: "done" }));
        } catch (err) {
          if (controller.signal.aborted || isAbortError(err)) {
            // client disconnected or cancelled — close the stream silently
          } else {
            streamController.enqueue(
              encodeNdjson({
                type: "error",
                error: err instanceof Error ? err.message : String(err),
              }),
            );
          }
        } finally {
          activeAgentRuns.delete(project.id);
          streamController.close();
        }
      },
      cancel() {
        controller.abort();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-store",
      },
    });
  });

  api.get("/projects/:id/agent/active-run", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    const active = activeAgentRuns.get(project.id);
    return c.json({
      active: !!active,
      run: active ? { commentId: active.commentId, startedAt: active.startedAt } : null,
    });
  });

  api.post("/projects/:id/agent/cancel", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    const body = (await c.req.json().catch(() => null)) as { commentId?: unknown } | null;
    if (!body || typeof body.commentId !== "string") {
      return c.json({ error: "commentId required" }, 400);
    }
    const active = activeAgentRuns.get(project.id);
    if (active && active.commentId === body.commentId) {
      active.abortController.abort();
      activeAgentRuns.delete(project.id);
      return c.json({ ok: true, cancelled: "running", commentId: active.commentId });
    }

    return c.json({ ok: true, cancelled: false });
  });
}
