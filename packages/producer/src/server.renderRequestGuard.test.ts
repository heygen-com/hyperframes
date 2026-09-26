import { Hono } from "hono";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer as createHttpServer } from "node:http";

const capturedRenderConfigs = vi.hoisted(() => new Array<Record<string, unknown>>());
const capturedExecuteOutputPaths = vi.hoisted(() => new Array<string>());

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
    executeRenderJob: async (
      job: Record<string, unknown>,
      _projectDir: string,
      outputPath: string,
    ) => {
      capturedExecuteOutputPaths.push(outputPath);
      job.outcome = "completed";
      job.currentStage = "complete";
    },
  };
});

import { createRenderHandlers, validatePreviewUrl } from "./server.js";

let sandbox = "";
let rendersDir = "";

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "producer-guard-"));
  rendersDir = join(sandbox, "renders");
  capturedRenderConfigs.splice(0);
  capturedExecuteOutputPaths.splice(0);
});

afterEach(() => {
  delete process.env.PRODUCER_PREVIEW_HOST_ALLOWLIST;
  rmSync(sandbox, { recursive: true, force: true });
});

interface HandlerAppOptions {
  allowedOutputRoots?: string[];
}

function createApp(handlerOptions: HandlerAppOptions = {}): Hono {
  const app = new Hono();
  const handlers = createRenderHandlers({
    getRequestId: () => "guard-test",
    maxConcurrentRenders: 1,
    rendersDir,
    ...handlerOptions,
  });
  app.post("/render", handlers.render);
  app.post("/render/stream", handlers.renderStream);
  return app;
}

function requestStream(overrides: Record<string, unknown>, app = createApp()) {
  return app.request("/render/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ html: "<html><body></body></html>", ...overrides }),
  });
}

describe("POST /render — outputPath containment", () => {
  it("rejects an outputPath that escapes the renders directory when output roots are declared", async () => {
    const escaped = join(sandbox, "outside", "evil.mp4");
    const response = await createApp({ allowedOutputRoots: [rendersDir] }).request("/render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ html: "<html><body></body></html>", outputPath: escaped }),
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("renders directory");
    expect(capturedRenderConfigs).toHaveLength(0);
    expect(existsSync(join(sandbox, "outside"))).toBe(false);
  });

  it("rejects a traversal outputPath that resolves outside the renders directory", async () => {
    const response = await requestStream(
      { outputPath: join(rendersDir, "..", "outside", "evil.mp4") },
      createApp({ allowedOutputRoots: [rendersDir] }),
    );

    expect(response.status).toBe(200); // SSE envelope
    const text = await response.text();
    expect(text).toContain('"type":"error"');
    expect(text).toContain("renders directory");
    expect(capturedRenderConfigs).toHaveLength(0);
    expect(existsSync(join(sandbox, "outside"))).toBe(false);
  });

  it("rejects the legacy `output` alias with the same containment", async () => {
    const response = await createApp({ allowedOutputRoots: [rendersDir] }).request("/render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ html: "<html><body></body></html>", output: "C:\\evil\\x.mp4" }),
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("renders directory");
    expect(capturedRenderConfigs).toHaveLength(0);
  });

  it("does not echo the server's absolute renders directory back to the caller", async () => {
    const response = await createApp({ allowedOutputRoots: [rendersDir] }).request("/render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        html: "<html><body></body></html>",
        outputPath: join(sandbox, "outside", "evil.mp4"),
      }),
    });

    const text = await response.text();
    expect(response.status).toBe(400);
    expect(text).not.toContain(rendersDir);
    expect(text).not.toContain(sandbox);
  });

  it("rejects an outputPath written through a symlinked subdirectory of the renders directory", async () => {
    mkdirSync(rendersDir, { recursive: true });
    const outside = join(sandbox, "symlink-target");
    mkdirSync(outside, { recursive: true });
    let linked = false;
    try {
      symlinkSync(outside, join(rendersDir, "link"), "dir");
      linked = true;
    } catch {
      // Windows without symlink privilege: the realpath guard is still
      // exercised by the implementation; pin it only where symlinks work.
    }
    if (!linked) return;

    const response = await requestStream(
      { outputPath: join(rendersDir, "link", "evil.mp4") },
      createApp({ allowedOutputRoots: [rendersDir] }),
    );

    const text = await response.text();
    expect(text).toContain('"type":"error"');
    expect(capturedRenderConfigs).toHaveLength(0);
    expect(existsSync(join(outside, "evil.mp4"))).toBe(false);
  });

  it("accepts an embedder that declares its own output roots", async () => {
    const jobRoot = join(sandbox, "per-job");
    const response = await requestStream(
      { outputPath: join(jobRoot, "out.mp4") },
      createApp({ allowedOutputRoots: [jobRoot] }),
    );

    expect(await response.text()).toContain('"type":"complete"');
    expect(capturedExecuteOutputPaths[0]).toBe(join(jobRoot, "out.mp4"));
  });

  it("keeps absolute output paths working for handlers built without declared roots", async () => {
    const absolute = join(sandbox, "embedder-choice", "out.mp4");
    const response = await requestStream({ outputPath: absolute }, createApp());

    expect(await response.text()).toContain('"type":"complete"');
    expect(capturedExecuteOutputPaths[0]).toBe(absolute);
  });

  it("accepts a bare filename and renders inside the renders directory", async () => {
    const response = await requestStream({ outputPath: "out.mp4" });

    expect(await response.text()).toContain('"type":"complete"');
    expect(capturedRenderConfigs).toHaveLength(1);
    const outputPath = capturedExecuteOutputPaths[0];
    expect(typeof outputPath).toBe("string");
    expect(outputPath?.startsWith(rendersDir)).toBe(true);
  });

  it("accepts an outputPath nested inside the renders directory", async () => {
    const response = await requestStream(
      { outputPath: join(rendersDir, "sub", "out.mp4") },
      createApp({ allowedOutputRoots: [rendersDir] }),
    );

    expect(await response.text()).toContain('"type":"complete"');
    expect(capturedRenderConfigs).toHaveLength(1);
  });

  it("still renders when no outputPath is supplied", async () => {
    const response = await requestStream({});

    expect(await response.text()).toContain('"type":"complete"');
    expect(capturedRenderConfigs).toHaveLength(1);
  });
});

describe("previewUrl guard", () => {
  it("allows loopback http and https URLs", () => {
    expect(validatePreviewUrl("http://127.0.0.1:4173/")).toBeUndefined();
    expect(validatePreviewUrl("http://localhost:4173/index.html")).toBeUndefined();
    expect(validatePreviewUrl("https://localhost/")).toBeUndefined();
    expect(validatePreviewUrl("http://[::1]:4173/")).toBeUndefined();
  });

  it("rejects non-http schemes", () => {
    expect(validatePreviewUrl("file:///etc/passwd")).toContain("http or https");
    expect(validatePreviewUrl("ftp://127.0.0.1/x")).toContain("http or https");
  });

  it("rejects malformed URLs", () => {
    expect(validatePreviewUrl("not a url")).toContain("valid URL");
  });

  it("rejects non-loopback hosts", () => {
    expect(validatePreviewUrl("http://192.168.1.5:8080/")).toContain("loopback");
    expect(validatePreviewUrl("https://example.com/")).toContain("loopback");
    expect(validatePreviewUrl("http://169.254.169.254/latest/meta-data")).toContain("loopback");
    expect(validatePreviewUrl("http://127.0.0.2:4173/")).toContain("loopback");
  });

  it("honors the PRODUCER_PREVIEW_HOST_ALLOWLIST override", () => {
    process.env.PRODUCER_PREVIEW_HOST_ALLOWLIST = "Staging.Example.com";
    expect(validatePreviewUrl("https://staging.example.com:8443/")).toBeUndefined();
    expect(validatePreviewUrl("https://other.example.com/")).toContain("loopback");
  });

  it("rejects a non-loopback previewUrl at the handler level", async () => {
    const response = await createApp().request("/render/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // No `html` field: resolveInlineRenderHtml short-circuits html before it
      // ever considers previewUrl, so the guard must be tested without it.
      body: JSON.stringify({ previewUrl: "http://192.168.1.5:8080/" }),
    });

    const text = await response.text();
    expect(text).toContain('"type":"error"');
    expect(text).toContain("loopback");
    expect(capturedRenderConfigs).toHaveLength(0);
  });

  it("does not follow a redirect that leaves the loopback policy", async () => {
    // A second loopback address (127.0.0.2 is inside 127/8) plays the role of
    // an internal host the first URL redirects to.
    const secret = createHttpServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><body>TOPSECRET-PAGE</body></html>");
    });
    await new Promise<void>((resolvePromise) => secret.listen(0, "127.0.0.2", resolvePromise));
    const secretPort = (secret.address() as { port: number }).port;

    const redirector = createHttpServer((_req, res) => {
      res.writeHead(302, { location: `http://127.0.0.2:${secretPort}/` });
      res.end();
    });
    await new Promise<void>((resolvePromise) => redirector.listen(0, "127.0.0.1", resolvePromise));
    const redirectPort = (redirector.address() as { port: number }).port;

    try {
      const response = await createApp().request("/render/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ previewUrl: `http://127.0.0.1:${redirectPort}/` }),
      });

      const text = await response.text();
      expect(text).toContain('"type":"error"');
      expect(text).toContain("loopback");
      expect(text).not.toContain("TOPSECRET-PAGE");
      expect(capturedRenderConfigs).toHaveLength(0);
    } finally {
      secret.close();
      redirector.close();
    }
  });

  it("still fetches a loopback previewUrl that does not redirect", async () => {
    const target = createHttpServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><body>loopback page</body></html>");
    });
    await new Promise<void>((resolvePromise) => target.listen(0, "127.0.0.1", resolvePromise));
    const port = (target.address() as { port: number }).port;

    try {
      const response = await createApp().request("/render/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ previewUrl: `http://127.0.0.1:${port}/index.html` }),
      });

      expect(await response.text()).toContain('"type":"complete"');
      expect(capturedRenderConfigs).toHaveLength(1);
    } finally {
      target.close();
    }
  });
});
