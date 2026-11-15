import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const capturedRenderConfigs = vi.hoisted(() => new Array<Record<string, unknown>>());

vi.mock("./services/renderOrchestrator.js", () => {
  class RenderCancelledError extends Error {}

  return {
    RenderCancelledError,
    createRenderJob: (config: Record<string, unknown>) => {
      capturedRenderConfigs.push(config);
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

function requestRender(overrides: Record<string, unknown>) {
  const app = new Hono();
  const handlers = createRenderHandlers({
    getRequestId: () => "force-screenshot-test",
    maxConcurrentRenders: 1,
  });
  app.post("/v1/render-stream", handlers.renderStream);
  return app.request("/v1/render-stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ html: "<html><body></body></html>", ...overrides }),
  });
}

describe("POST /v1/render-stream: forceScreenshot", () => {
  const priorEnv = process.env.PRODUCER_FORCE_SCREENSHOT;
  beforeEach(() => {
    capturedRenderConfigs.splice(0);
    process.env.PRODUCER_FORCE_SCREENSHOT = "false";
  });
  afterEach(() => {
    if (priorEnv === undefined) delete process.env.PRODUCER_FORCE_SCREENSHOT;
    else process.env.PRODUCER_FORCE_SCREENSHOT = priorEnv;
  });

  const expectForced = (forceScreenshot: boolean) =>
    expect(capturedRenderConfigs[0]).toMatchObject({ producerConfig: { forceScreenshot } });

  it("forces screenshot capture for this render when the body asks, over the env", async () => {
    await (await requestRender({ forceScreenshot: true })).text();
    expectForced(true);
  });

  it.each([{}, { forceScreenshot: false }, { forceScreenshot: "true" }])(
    "keeps the env value when the body does not ask (%j)",
    async (extra) => {
      await (await requestRender(extra)).text();
      expectForced(false);
    },
  );
});
