import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jobFactory = vi.hoisted(() => ({ fail: false }));

vi.mock("./services/renderOrchestrator.js", () => {
  class RenderCancelledError extends Error {}

  return {
    RenderCancelledError,
    createRenderJob: (config: Record<string, unknown>) => {
      if (jobFactory.fail) throw new Error("job config rejected");
      return {
        config,
        progress: 0,
        currentStage: "queued",
        framesRendered: 0,
        totalFrames: 0,
        warnings: [],
      };
    },
    executeRenderJob: async (job: Record<string, unknown>) => {
      job.outcome = "completed";
      job.currentStage = "complete";
    },
  };
});

import { createRenderHandlers } from "./server.js";

function createApp(rendersDir: string) {
  const app = new Hono();
  const handlers = createRenderHandlers({ maxConcurrentRenders: 1, rendersDir });
  app.post("/render", handlers.render);
  app.post("/render/stream", handlers.renderStream);
  app.get("/render/queue", handlers.queue);
  return app;
}

function post(app: Hono, path: string, body: Record<string, unknown>) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ html: "<html><body></body></html>", ...body }),
  });
}

async function activeRenders(app: Hono): Promise<number> {
  const res = await app.request("/render/queue");
  return ((await res.json()) as { activeRenders: number }).activeRenders;
}

describe("render handlers: rejected job config", () => {
  const priorTmp = process.env.PRODUCER_TMP_PROJECT_DIR;
  let scratch: string;
  const inlineProjects = () =>
    readdirSync(scratch).filter((name) => name.startsWith("producer-project-"));

  beforeEach(() => {
    jobFactory.fail = false;
    scratch = mkdtempSync(join(tmpdir(), "producer-slot-test-"));
    process.env.PRODUCER_TMP_PROJECT_DIR = scratch;
  });

  afterEach(() => {
    if (priorTmp === undefined) delete process.env.PRODUCER_TMP_PROJECT_DIR;
    else process.env.PRODUCER_TMP_PROJECT_DIR = priorTmp;
    rmSync(scratch, { recursive: true, force: true });
  });

  it.each([0, 1.5, -2])("answers 400 for workers %s on both routes", async (workers) => {
    const app = createApp(join(scratch, "renders"));
    const blocking = await post(app, "/render", { workers });
    expect(blocking.status).toBe(400);
    expect(await blocking.json()).toMatchObject({ error: "workers must be a positive integer" });

    const streamed = await (await post(app, "/render/stream", { workers })).text();
    expect(streamed).toContain("workers must be a positive integer");
    expect(inlineProjects()).toEqual([]);
  });

  it.each(["/render", "/render/stream"])(
    "frees the slot and the inline project when job construction throws on %s",
    async (route) => {
      const app = createApp(join(scratch, "renders"));
      jobFactory.fail = true;
      const failed = await post(app, route, {});
      if (route === "/render") expect(failed.status).toBe(400);
      expect(await failed.text()).toContain("job config rejected");
      expect(await activeRenders(app)).toBe(0);
      expect(inlineProjects()).toEqual([]);

      jobFactory.fail = false;
      const next = await post(app, "/render", {});
      expect(next.status).toBe(200);
      expect(await activeRenders(app)).toBe(0);
    },
  );
});
