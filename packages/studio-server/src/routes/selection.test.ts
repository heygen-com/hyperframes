import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { registerSelectionRoutes } from "./selection";
import type { StudioApiAdapter, StudioSelectionSnapshot } from "../types";

function createAdapter(): StudioApiAdapter {
  return {
    listProjects: () => [],
    resolveProject: async (id: string) =>
      id === "demo" ? { id, dir: "/tmp/demo", title: "Demo" } : null,
    bundle: async () => null,
    lint: async () => ({ findings: [] }),
    runtimeUrl: "/api/runtime.js",
    rendersDir: () => "/tmp/renders",
    startRender: () => ({
      id: "job-1",
      status: "rendering",
      progress: 0,
      outputPath: "/tmp/out.mp4",
    }),
  };
}

const selection = {
  schemaVersion: 1,
  projectId: "demo",
  compositionPath: "index.html",
  sourceFile: "index.html",
  currentTime: 1.25,
  target: { hfId: "hero-title", selector: ".title", selectorIndex: 0 },
  label: "Hero title",
  tagName: "h1",
  boundingBox: { x: 10, y: 20, width: 300, height: 64 },
  textContent: "Launch faster",
  dataAttributes: { "data-hf-id": "hero-title" },
  inlineStyles: { color: "white" },
  computedStyles: { "font-size": "48px" },
  textFields: [
    {
      key: "self",
      label: "Text",
      value: "Launch faster",
      tagName: "h1",
      source: "self",
    },
  ],
  capabilities: { canSelect: true, canEditStyles: true },
  thumbnailUrl:
    "/api/projects/demo/thumbnail/index.html?t=1.25&format=png&selector=.title&selectorIndex=0",
} satisfies StudioSelectionSnapshot;

describe("registerSelectionRoutes", () => {
  it("stores and returns the latest Studio selection snapshot", async () => {
    const app = new Hono();
    registerSelectionRoutes(app, createAdapter());

    const put = await app.request("http://localhost/projects/demo/selection", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selection }),
    });
    expect(put.status).toBe(200);

    const response = await app.request("http://localhost/projects/demo/selection");
    const payload = (await response.json()) as {
      selection?: StudioSelectionSnapshot | null;
      updatedAt?: string | null;
    };

    expect(response.status).toBe(200);
    expect(payload.selection).toMatchObject({
      projectId: "demo",
      sourceFile: "index.html",
      target: { hfId: "hero-title" },
      thumbnailUrl: expect.stringContaining("/thumbnail/index.html"),
    });
    expect(payload.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("clears a stored selection when Studio posts null", async () => {
    const app = new Hono();
    registerSelectionRoutes(app, createAdapter());

    await app.request("http://localhost/projects/demo/selection", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selection }),
    });

    const clear = await app.request("http://localhost/projects/demo/selection", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selection: null }),
    });
    expect(clear.status).toBe(200);

    const response = await app.request("http://localhost/projects/demo/selection");
    const payload = (await response.json()) as {
      selection?: StudioSelectionSnapshot | null;
      updatedAt?: string | null;
    };

    expect(payload.selection).toBeNull();
    expect(payload.updatedAt).toBeNull();
  });

  it("rejects malformed selection payloads", async () => {
    const app = new Hono();
    registerSelectionRoutes(app, createAdapter());

    const response = await app.request("http://localhost/projects/demo/selection", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selection: { projectId: "demo" } }),
    });

    expect(response.status).toBe(400);
  });
});
