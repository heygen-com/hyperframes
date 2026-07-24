import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { StudioApiAdapter } from "../types";
import { registerRegistryRoutes } from "./registry";

function createAdapter(): StudioApiAdapter {
  return {
    listProjects: () => [],
    resolveProject: async () => null,
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
    readRegistryPreview: async ({ itemName, kind }) =>
      itemName === "camcorder-hud"
        ? {
            content: Buffer.from(`${itemName}:${kind}`),
            contentType: kind === "poster" ? "image/png" : "video/mp4",
          }
        : null,
  };
}

describe("registerRegistryRoutes", () => {
  it("serves generated Registry preview media", async () => {
    const app = new Hono();
    registerRegistryRoutes(app, createAdapter());

    const response = await app.request("http://localhost/registry/previews/camcorder-hud/poster");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(await response.text()).toBe("camcorder-hud:poster");
  });

  it("serves byte ranges for Registry preview videos", async () => {
    const app = new Hono();
    registerRegistryRoutes(app, createAdapter());

    const response = await app.request("http://localhost/registry/previews/camcorder-hud/video", {
      headers: { Range: "bytes=4-8" },
    });

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 4-8/19");
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(await response.text()).toBe("order");
  });

  it("rejects invalid preview kinds and missing media", async () => {
    const app = new Hono();
    registerRegistryRoutes(app, createAdapter());

    const invalid = await app.request("http://localhost/registry/previews/camcorder-hud/source");
    const invalidName = await app.request(
      "http://localhost/registry/previews/%2E%2E%2Fsecret/poster",
    );
    const missing = await app.request("http://localhost/registry/previews/unknown/video");

    expect(invalid.status).toBe(400);
    expect(invalidName.status).toBe(400);
    expect(missing.status).toBe(404);
  });

  it("reports preview read failures without throwing from the route", async () => {
    const app = new Hono();
    registerRegistryRoutes(app, {
      ...createAdapter(),
      readRegistryPreview: async () => {
        throw new Error("disk unavailable");
      },
    });

    const response = await app.request("http://localhost/registry/previews/camcorder-hud/poster");

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Registry preview unavailable" });
  });
});
