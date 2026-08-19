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

function requestRender(overrides: Record<string, unknown>) {
  return createInternalStreamingApp().request("/v1/render-stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ html: "<html><body></body></html>", ...overrides }),
  });
}

describe("POST /v1/render-stream — outputDynamicRange", () => {
  beforeEach(() => capturedRenderConfigs.splice(0));

  it.each([
    ["auto", "auto"],
    ["hdr", "force-hdr"],
    ["sdr", "force-sdr"],
  ] as const)(
    "maps %s through createRenderRequest to internal hdrMode %s",
    async (outputDynamicRange, hdrMode) => {
      const response = await requestRender({ outputDynamicRange });

      expect(response.status).toBe(200);
      expect(await response.text()).toContain('"type":"complete"');
      expect(capturedRenderConfigs).toHaveLength(1);
      expect(capturedRenderConfigs[0]?.hdrMode).toBe(hdrMode);
    },
  );

  it("rejects an invalid mode before creating a render job", async () => {
    const response = await requestRender({ outputDynamicRange: "force-sdr" });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain(
      'outputDynamicRange must be one of: \\"auto\\", \\"hdr\\", \\"sdr\\"',
    );
    expect(capturedRenderConfigs).toHaveLength(0);
  });

  it("accepts the matching legacy field during rolling deployment", async () => {
    const response = await requestRender({
      outputDynamicRange: "sdr",
      hdrMode: "force-sdr",
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"type":"complete"');
    expect(capturedRenderConfigs).toHaveLength(1);
    expect(capturedRenderConfigs[0]?.hdrMode).toBe("force-sdr");
  });
});
