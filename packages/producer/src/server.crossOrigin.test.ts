import { describe, expect, it, vi } from "vitest";

const started = vi.hoisted(() => ({ count: 0 }));

vi.mock("./services/renderOrchestrator.js", () => {
  class RenderCancelledError extends Error {}

  return {
    RenderCancelledError,
    createRenderJob: (config: Record<string, unknown>) => ({
      config,
      progress: 0,
      currentStage: "queued",
      framesRendered: 0,
      totalFrames: 0,
      warnings: [],
    }),
    executeRenderJob: async (job: Record<string, unknown>) => {
      started.count += 1;
      job.outcome = "completed";
    },
  };
});

import { createProducerApp } from "./server.js";

function postRender(headers: Record<string, string>) {
  return createProducerApp().request("http://localhost:9847/render", {
    method: "POST",
    headers: { host: "localhost:9847", ...headers },
    body: JSON.stringify({ html: "<html><body></body></html>" }),
  });
}

describe("createProducerApp: cross-origin browser requests", () => {
  it("refuses a page on another origin, even as a text/plain simple request", async () => {
    const before = started.count;
    const res = await postRender({ origin: "https://example.com", "content-type": "text/plain" });
    expect(res.status).toBe(403);
    expect(started.count).toBe(before);
  });

  it("refuses a malformed origin", async () => {
    expect((await postRender({ origin: "null" })).status).toBe(403);
  });

  it.each(["cross-site", "same-site"])(
    "refuses a page the browser marks %s, even when Origin matches Host",
    async (fetchSite) => {
      const res = await postRender({
        origin: "http://localhost:9847",
        "sec-fetch-site": fetchSite,
      });
      expect(res.status).toBe(403);
    },
  );

  it.each([
    ["no Origin (curl, server-to-server)", {}],
    ["a same-origin page", { origin: "http://localhost:9847" }],
    [
      "a same-origin page behind a proxy that rewrites Host",
      { origin: "https://render.example.com", "sec-fetch-site": "same-origin" },
    ],
  ])("renders for %s", async (_label, headers) => {
    const res = await postRender({ "content-type": "application/json", ...headers });
    expect(res.status).toBe(200);
  });
});
