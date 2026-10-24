// @vitest-environment node
import { describe, expect, it } from "vitest";
import { STUDIO_PREVIEW_ERRORS } from "@hyperframes/core/studio-preview-mark";
import { createStudioApi } from "../createStudioApi";
import type { StudioApiAdapter } from "../types";

const adapter = (found: boolean): StudioApiAdapter => ({
  listProjects: () => [],
  resolveProject: async (id: string) => (found ? { id, dir: "/nowhere/" + id } : null),
  bundle: async () => null,
  lint: async () => ({ findings: [] }),
  runtimeUrl: "/api/runtime.js",
  rendersDir: () => "/tmp/renders",
  startRender: () => ({
    id: "job",
    status: "rendering",
    progress: 0,
    outputPath: "/tmp/out.mp4",
  }),
});

const frame = { headers: { "sec-fetch-dest": "iframe" } };

describe("a preview page the server cannot serve", () => {
  it("tells the frame it loaded, so the player reports it instead of waiting for a runtime", async () => {
    const res = await createStudioApi(adapter(false)).request(
      "http://localhost/projects/gone/preview",
      frame,
    );

    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("text/html");
    const page = await res.text();
    expect(page).toContain(`window.${STUDIO_PREVIEW_ERRORS}=[`);
    expect(page).toContain("404");
  });

  it("does the same for a sub-composition page", async () => {
    const res = await createStudioApi(adapter(false)).request(
      "http://localhost/projects/gone/preview/comp/scene.html",
      frame,
    );

    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain(`window.${STUDIO_PREVIEW_ERRORS}=[`);
  });

  it("keeps the JSON answer for a request that is not a frame navigation", async () => {
    const res = await createStudioApi(adapter(false)).request(
      "http://localhost/projects/gone/preview",
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });
});
