import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

const createdConfigs = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock("./services/renderOrchestrator.js", async () => {
  const { RenderTooSlowError } = await import("./services/render/renderEtaGuard.js");
  class RenderCancelledError extends Error {}
  return {
    RenderCancelledError,
    createRenderJob: (config: Record<string, unknown>) => {
      createdConfigs.push(config);
      return {
        config,
        progress: 0,
        currentStage: "capture",
        framesRendered: 0,
        totalFrames: 0,
        warnings: [],
      };
    },
    executeRenderJob: async () => {
      throw new RenderTooSlowError("capture", {
        maxRenderMs: 120_000,
        elapsedMs: 70_000,
        framesCompleted: 127,
        totalFrames: 21_540,
        msPerFrame: 472,
        etaMs: 10_000_000,
      });
    },
  };
});

import { createRenderHandlers } from "./server.js";

function post(path: string, extra: Record<string, unknown> = {}): Promise<Response> {
  const app = new Hono();
  const handlers = createRenderHandlers({
    getRequestId: () => "too-slow-test",
    maxConcurrentRenders: 1,
  });
  app.post("/v1/render", handlers.render);
  app.post("/v1/render-stream", handlers.renderStream);
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ html: "<html><body></body></html>", maxRenderMs: 120_000, ...extra }),
  });
}

describe("server render too slow", () => {
  it("forwards maxRenderMs into the render config", async () => {
    await post("/v1/render");
    expect(createdConfigs.at(-1)?.maxRenderMs).toBe(120_000);
  });

  it("emits RENDER_TOO_SLOW as non-retryable in blocking JSON", async () => {
    const response = await post("/v1/render");
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      success: false,
      errorCode: "RENDER_TOO_SLOW",
      retryable: false,
      errorOwner: "user",
      errorMetadata: {
        stage: "capture",
        framesCompleted: 127,
        totalFrames: 21_540,
        msPerFrame: 472,
        maxRenderMs: 120_000,
      },
    });
    expect(body.error).toMatch(/^render too slow:/);
  });

  it("emits the same event over SSE", async () => {
    const body = await (await post("/v1/render-stream")).text();
    expect(body).toContain('"errorCode":"RENDER_TOO_SLOW"');
    expect(body).toContain('"retryable":false');
    expect(body).toContain('"error":"render too slow:');
  });

  it.each([-1, 1.5, "90000", null])("rejects maxRenderMs=%p with a 400", async (value) => {
    const response = await post("/v1/render", { maxRenderMs: value });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("maxRenderMs");
  });
});
