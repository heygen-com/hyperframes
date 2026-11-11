import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterAll, describe, expect, it, vi } from "vitest";
import { referenceBackgroundResult, type ReferenceBackground } from "@hyperframes/engine";

const state = vi.hoisted(() => ({ background: undefined as unknown }));
vi.mock("./services/renderOrchestrator.js", () => ({
  RenderCancelledError: class extends Error {},
  createRenderJob: (config: Record<string, unknown>) => ({ config, progress: 0, warnings: [] }),
  executeRenderJob: async (
    job: Record<string, unknown>,
    _projectDir: string,
    outputPath: string,
  ) => {
    job.reference_background = state.background;
    job.outcome = "completed";
    writeFileSync(outputPath, "fixture");
  },
}));
import { createRenderHandlers } from "./server.js";

const dir = mkdtempSync(join(tmpdir(), "hf-background-response-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("completed render reference background", () => {
  it.each<ReferenceBackground>([
    { kind: "solid", rgb: [10, 46, 138] },
    { kind: "none" },
    { kind: "unsupported_non_solid" },
    { kind: "unknown" },
  ])("preserves $kind identically in blocking and SSE results", async (background) => {
    state.background = background;
    const handlers = createRenderHandlers({ rendersDir: dir });
    const app = new Hono();
    app.post("/render", handlers.render);
    app.post("/render/stream", handlers.renderStream);
    const request = () => ({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ html: "<html><body></body></html>" }),
    });
    const sync = await app.request("/render", request());
    expect(sync.status).toBe(200);
    expect(await sync.json()).toMatchObject(referenceBackgroundResult(background));
    const stream = await app.request("/render/stream", request());
    const terminal = (await stream.text())
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => JSON.parse(line.slice(5)))
      .find((event) => event.type === "complete");
    expect(terminal).toMatchObject(referenceBackgroundResult(background));
  });
  it("returns explicit unknown for an older renderer without the field", async () => {
    state.background = undefined;
    const handlers = createRenderHandlers({ rendersDir: dir });
    const app = new Hono();
    app.post("/render", handlers.render);
    const response = await app.request("/render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ html: "<html><body></body></html>" }),
    });
    expect(await response.json()).toMatchObject({ reference_background: { kind: "unknown" } });
  });
  it("names the producer version that rendered it in the stream's complete event", async () => {
    state.background = undefined;
    const handlers = createRenderHandlers({ rendersDir: dir });
    const app = new Hono();
    app.post("/render/stream", handlers.renderStream);
    const stream = await app.request("/render/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ html: "<html><body></body></html>" }),
    });
    const terminal = (await stream.text())
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => JSON.parse(line.slice(5)))
      .find((event) => event.type === "complete");
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8"));
    expect(terminal.producerVersion).toBe(pkg.version);
  });
});
