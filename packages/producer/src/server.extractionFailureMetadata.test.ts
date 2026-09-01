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
      host: "media.heygen.ai",
      statusClass: "http_5xx",
      retry: { phase: "download", used: 1, budget: 1 },
    },
  ],
  omittedGroupCount: 0,
}));
const overlongAllowedSuffixHost = `${`${"a".repeat(63)}.`.repeat(4)}heygen.com`;

vi.mock("./services/renderOrchestrator.js", () => {
  class RenderCancelledError extends Error {}
  class MockVideoExtractionStageError extends Error {
    readonly code = "VIDEO_EXTRACTION_FAILED";
    readonly retryable = true;
    readonly extractionFailure = safeExtractionFailure;
    readonly source =
      "https://media.heygen.ai/private/clip.mp4?X-Amz-Signature=must-not-reach-wire";
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
    safeExtractionFailure.groups[0]!.host = "media.heygen.ai";
  });

  it("emits the bounded top-level contract in blocking JSON", async () => {
    const response = await request("/v1/render");
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(body)).toMatchObject({
      success: false,
      errorCode: "VIDEO_EXTRACTION_FAILED",
      retryable: true,
      extractionFailure: safeExtractionFailure,
    });
    expectPrivateDiagnosticsAbsent(body);
  });

  it("emits the same bounded top-level contract in SSE", async () => {
    const response = await request("/v1/render-stream");
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('"errorCode":"VIDEO_EXTRACTION_FAILED"');
    expect(body).toContain('"retryable":true');
    expect(body).toContain(`"extractionFailure":${JSON.stringify(safeExtractionFailure)}`);
    expectPrivateDiagnosticsAbsent(body);
  });

  it.each([
    ["blocking JSON", "/v1/render", "https://evil.heygen.com"],
    ["blocking JSON", "/v1/render", "a/b.heygen.com"],
    ["blocking JSON", "/v1/render", "media.heygen.com?signature=secret"],
    ["blocking JSON", "/v1/render", overlongAllowedSuffixHost],
    ["SSE", "/v1/render-stream", "https://evil.heygen.com"],
    ["SSE", "/v1/render-stream", "a/b.heygen.com"],
    ["SSE", "/v1/render-stream", "media.heygen.com?signature=secret"],
    ["SSE", "/v1/render-stream", overlongAllowedSuffixHost],
  ])("drops a malformed host from %s at %s: %s", async (_transport, path, host) => {
    safeExtractionFailure.groups[0]!.host = host;

    const response = await request(path);
    const body = await response.text();

    expect(body).not.toContain('"extractionFailure"');
    expect(body).not.toContain(host);
    expect(body).not.toContain("signature=secret");
  });
});
