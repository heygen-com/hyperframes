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

function createApp(): Hono {
  const app = new Hono();
  const handlers = createRenderHandlers({
    getRequestId: () => "encoder-options-test",
    maxConcurrentRenders: 1,
  });
  app.post("/render", handlers.render);
  app.post("/render/stream", handlers.renderStream);
  return app;
}

async function requestRender(
  path: "/render" | "/render/stream",
  overrides: Record<string, unknown>,
) {
  const response = await createApp().request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ html: "<html><body></body></html>", ...overrides }),
  });
  return { status: response.status, text: await response.text() };
}

const ROUTES = ["/render", "/render/stream"] as const;

describe.each(ROUTES)("POST %s — encoder options", (path) => {
  beforeEach(() => capturedRenderConfigs.splice(0));

  async function expectRejected(body: Record<string, unknown>, message: string) {
    const response = await requestRender(path, body);
    expect(response.text).toContain(message);
    expect(capturedRenderConfigs).toHaveLength(0);
  }

  it("preserves explicit page motion blur off in the render config", async () => {
    const response = await requestRender(path, { pageMotionBlur: "off" });
    expect(response.status).toBe(200);
    expect(capturedRenderConfigs[0]?.pageMotionBlur).toBe("off");
  });

  it("keeps page motion blur unspecified when omitted", async () => {
    await requestRender(path, {});
    expect(capturedRenderConfigs[0]).not.toHaveProperty("pageMotionBlur");
  });

  it.each(["on", "", true, false, null, 0])(
    "rejects invalid page motion blur %j",
    async (value) => {
      await expectRejected({ pageMotionBlur: value }, "pageMotionBlur must be off when supplied");
    },
  );

  it("sends no encoder overrides when none are requested", async () => {
    const response = await requestRender(path, { quality: "high" });

    expect(response.status).toBe(200);
    expect(capturedRenderConfigs).toHaveLength(1);
    for (const field of ["crf", "videoBitrate", "videoFrameFormat"]) {
      expect(capturedRenderConfigs[0]).not.toHaveProperty(field);
    }
  });

  it.each([
    ["mp4", 0],
    ["mp4", 12],
    ["mp4", 51],
    ["webm", 63],
  ] as const)("forwards %s crf %d", async (format, crf) => {
    const response = await requestRender(path, { format, crf, quality: "high" });

    expect(response.status).toBe(200);
    expect(capturedRenderConfigs[0]?.crf).toBe(crf);
    expect(capturedRenderConfigs[0]?.quality).toBe("high");
  });

  it.each([
    ["mp4", "12", "0 to 51 for mp4"],
    ["mp4", 12.5, "0 to 51 for mp4"],
    ["mp4", -1, "0 to 51 for mp4"],
    ["mp4", 52, "0 to 51 for mp4"],
    ["webm", 64, "0 to 63 for webm"],
  ] as const)("rejects %s crf %j", async (format, crf, range) => {
    await expectRejected({ format, crf }, `crf must be an integer from ${range}`);
  });

  it("defaults the crf range to mp4 when no format is given", async () => {
    await expectRejected({ crf: 52 }, "crf must be an integer from 0 to 51 for mp4");
  });

  it("ignores crf and videoBitrate for mov, which has no rate control", async () => {
    const response = await requestRender(path, { format: "mov", crf: 999, videoBitrate: "10M" });

    expect(response.status).toBe(200);
    expect(capturedRenderConfigs).toHaveLength(1);
    expect(capturedRenderConfigs[0]).not.toHaveProperty("crf");
    expect(capturedRenderConfigs[0]).not.toHaveProperty("videoBitrate");
  });

  it.each(["10M", "2500k", "8000000"])("forwards videoBitrate %s", async (videoBitrate) => {
    const response = await requestRender(path, { videoBitrate });

    expect(response.status).toBe(200);
    expect(capturedRenderConfigs[0]?.videoBitrate).toBe(videoBitrate);
    expect(capturedRenderConfigs[0]).not.toHaveProperty("crf");
  });

  it.each(["", "10 M", "-5M", "10M; rm", 10])("rejects videoBitrate %j", async (videoBitrate) => {
    await expectRejected({ videoBitrate }, "videoBitrate must look like");
  });

  it("rejects crf and videoBitrate together", async () => {
    await expectRejected({ crf: 12, videoBitrate: "10M" }, "use either crf or videoBitrate");
  });

  it("forwards videoFrameFormat", async () => {
    await requestRender(path, { videoFrameFormat: "png" });

    expect(capturedRenderConfigs[0]?.videoFrameFormat).toBe("png");
  });

  it("rejects an unknown videoFrameFormat", async () => {
    await expectRejected({ videoFrameFormat: "webp" }, "videoFrameFormat must be one of");
  });

  it("forwards hdrMode", async () => {
    await requestRender(path, { hdrMode: "force-sdr" });

    expect(capturedRenderConfigs[0]?.hdrMode).toBe("force-sdr");
  });

  it("rejects an unknown hdrMode", async () => {
    await expectRejected({ hdrMode: "on" }, "hdrMode must be one of");
  });

  it("accepts hdrMode alongside the matching outputDynamicRange", async () => {
    const response = await requestRender(path, { hdrMode: "force-sdr", outputDynamicRange: "sdr" });

    expect(response.status).toBe(200);
    expect(capturedRenderConfigs[0]?.hdrMode).toBe("force-sdr");
  });

  it("rejects hdrMode that conflicts with outputDynamicRange rather than picking a winner", async () => {
    await expectRejected(
      { hdrMode: "force-hdr", outputDynamicRange: "sdr" },
      "outputDynamicRange and legacy hdrMode must describe the same output policy",
    );
  });
});
