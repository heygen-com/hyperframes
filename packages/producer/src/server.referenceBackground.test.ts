import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterAll, describe, expect, it, vi } from "vitest";
import { referenceBackgroundResult, type ReferenceBackground } from "@hyperframes/engine";

const state = vi.hoisted(() => ({
  background: undefined as unknown,
  dimensionsChecked: undefined as boolean | undefined,
  config: {} as Record<string, unknown>,
}));
vi.mock("./services/renderOrchestrator.js", () => ({
  RenderCancelledError: class extends Error {},
  createRenderJob: (config: Record<string, unknown>) => ({ config, progress: 0, warnings: [] }),
  executeRenderJob: async (
    job: Record<string, unknown>,
    _projectDir: string,
    outputPath: string,
  ) => {
    job.reference_background = state.background;
    job.outputDimensionsChecked = state.dimensionsChecked;
    state.config = job.config as Record<string, unknown>;
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

describe("output dimension confirmation", () => {
  it.each([true, undefined])(
    "transports the renderer confirmation %s without inventing it",
    async (checked) => {
      state.dimensionsChecked = checked;
      const handlers = createRenderHandlers({ rendersDir: dir });
      const app = new Hono();
      app.post("/render", handlers.render);
      app.post("/stream", handlers.renderStream);
      for (const path of ["/render", "/stream"]) {
        const response = await app.request(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            html: "<html/>",
            expectedOutputDimensions: { width: 1280, height: 720 },
          }),
        });
        expect(response.status).toBe(200);
        const result =
          path === "/render"
            ? await response.json()
            : (await response.text())
                .split("\n")
                .filter((line) => line.startsWith("data:"))
                .map((line) => JSON.parse(line.slice(5)))
                .find((event) => event.type === "complete");
        expect(state.config.expectedOutputDimensions).toEqual({ width: 1280, height: 720 });
        expect(result.outputDimensionsChecked).toBe(checked);
      }
    },
  );
  it.each([
    null,
    {},
    { width: 0, height: 720 },
    { width: 1280.5, height: 720 },
    { width: "1280", height: 720 },
  ])("rejects invalid dimension constraints %j before rendering", async (dimensions) => {
    const app = new Hono();
    app.post("/render", createRenderHandlers({ rendersDir: dir }).render);
    const response = await app.request("/render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ html: "<html/>", expectedOutputDimensions: dimensions }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false });
  });
});
