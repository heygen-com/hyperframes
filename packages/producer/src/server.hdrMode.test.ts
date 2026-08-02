import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

function createInternalStreamingApp(): Hono {
  const app = new Hono();
  const handlers = createRenderHandlers({
    getRequestId: () => "hdr-mode-test",
    maxConcurrentRenders: 1,
  });
  app.post("/v1/render-stream", handlers.renderStream);
  return app;
}

describe("POST /v1/render-stream — hdrMode", () => {
  beforeEach(() => capturedRenderConfigs.splice(0));

  it.each(["auto", "force-hdr", "force-sdr"] as const)(
    "forwards %s through createRenderRequest into RenderConfig",
    async (hdrMode) => {
      const response = await createInternalStreamingApp().request("/v1/render-stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ html: "<html><body></body></html>", hdrMode }),
      });

      expect(response.status).toBe(200);
      expect(await response.text()).toContain('"type":"complete"');
      expect(capturedRenderConfigs).toHaveLength(1);
      expect(capturedRenderConfigs[0]?.hdrMode).toBe(hdrMode);
    },
  );

  it("rejects an invalid mode before creating a render job", async () => {
    const response = await createInternalStreamingApp().request("/v1/render-stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ html: "<html><body></body></html>", hdrMode: "hdr" }),
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain(
      'hdrMode must be one of: \\"auto\\", \\"force-hdr\\", \\"force-sdr\\"',
    );
    expect(capturedRenderConfigs).toHaveLength(0);
  });
});
