import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const safeExtractionFailure = vi.hoisted(() => ({
  schemaVersion: 1,
  kindCounts: [{ kind: "download_transient", affectedElementCount: 1 }],
  groups: [
    {
      kind: "download_transient",
      affectedElementCount: 1,
      sourceFingerprint: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      host: "media.customer-cdn.example",
      statusClass: "http_5xx",
      retry: { phase: "download", used: 1, budget: 1 },
    },
  ],
  omittedGroupCount: 0,
}));
vi.mock("./services/renderOrchestrator.js", () => {
  class RenderCancelledError extends Error {}
  class MockVideoExtractionStageError extends Error {
    readonly code = "VIDEO_EXTRACTION_FAILED";
    readonly retryable = true;
    readonly publicMetadata = { extractionFailure: safeExtractionFailure };
    readonly source =
      "https://media.customer-cdn.example/private/clip.mp4?X-Amz-Signature=must-not-reach-wire";
    readonly videoId = "private-video-id";
    readonly statusText = "upstream private status text";
    readonly localPath = "/tmp/private-render/clip.mp4";
  }

  return {
    RenderCancelledError,
    createRenderJob: (config: Record<string, unknown>) => ({
      config,
      progress: 0,
      currentStage: "video_extract",
      framesRendered: 0,
      totalFrames: 0,
      warnings: [],
    }),
    executeRenderJob: async () => {
      throw new MockVideoExtractionStageError("Video extraction failed");
    },
  };
});

import { createRenderHandlers } from "./server.js";

function createApp(): Hono {
  const app = new Hono();
  const handlers = createRenderHandlers({
    getRequestId: () => "extraction-failure-test",
    maxConcurrentRenders: 1,
  });
  app.post("/v1/render", handlers.render);
  app.post("/v1/render-stream", handlers.renderStream);
  return app;
}

function request(path: string): Promise<Response> {
  return createApp().request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ html: "<html><body></body></html>" }),
  });
}

function expectPrivateDiagnosticsAbsent(body: string): void {
  expect(body).not.toContain("must-not-reach-wire");
  expect(body).not.toContain("/private/");
  expect(body).not.toContain("private-video-id");
  expect(body).not.toContain("private status text");
  expect(body).not.toContain("/tmp/private-render");
}

describe("server extraction failure metadata", () => {
  beforeEach(() => {
    safeExtractionFailure.groups[0]!.host = "media.customer-cdn.example";
  });

  it("emits the bounded top-level contract in blocking JSON", async () => {
    const response = await request("/v1/render");
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(body)).toMatchObject({
      success: false,
      errorCode: "VIDEO_EXTRACTION_FAILED",
      retryable: true,
      errorMetadata: { extractionFailure: safeExtractionFailure },
    });
    expectPrivateDiagnosticsAbsent(body);
  });

  it("emits the same bounded top-level contract in SSE", async () => {
    const response = await request("/v1/render-stream");
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('"errorCode":"VIDEO_EXTRACTION_FAILED"');
    expect(body).toContain('"retryable":true');
    expect(body).toContain(
      `"errorMetadata":{"extractionFailure":${JSON.stringify(safeExtractionFailure)}}`,
    );
    expectPrivateDiagnosticsAbsent(body);
  });

  it("does not impose a caller-specific schema on public metadata", async () => {
    Object.assign(safeExtractionFailure, { callerDefinedField: "v2" });
    const body = await (await request("/v1/render")).text();
    expect(body).toContain('"callerDefinedField":"v2"');
    delete (safeExtractionFailure as Record<string, unknown>).callerDefinedField;
  });
});
