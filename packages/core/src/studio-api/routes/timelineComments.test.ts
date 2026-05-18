import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerTimelineCommentRoutes } from "./timelineComments";
import type { StudioApiAdapter } from "../types";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createProjectDir(): string {
  const projectDir = mkdtempSync(join(tmpdir(), "hf-comments-test-"));
  tempDirs.push(projectDir);
  writeFileSync(
    join(projectDir, "index.html"),
    '<main><section id="hero" data-start="1">Hero</section></main>',
  );
  return projectDir;
}

function createAdapter(projectDir: string): StudioApiAdapter {
  return {
    listProjects: () => [],
    resolveProject: async (id: string) => ({ id, dir: projectDir }),
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

describe("registerTimelineCommentRoutes", () => {
  it("creates, lists, and clears source-backed comments", async () => {
    const projectDir = createProjectDir();
    const app = new Hono();
    registerTimelineCommentRoutes(app, createAdapter(projectDir));

    const createResponse = await app.request("http://localhost/projects/demo/timeline-comments", {
      method: "POST",
      body: JSON.stringify({
        id: "hfc_route",
        filePath: "index.html",
        rangeStart: 1,
        rangeEnd: 4,
        prompt: "Make hero faster",
        elements: [{ id: "hero", tag: "section", start: 1, duration: 3, track: 0 }],
        target: { id: "hero" },
      }),
    });
    expect(createResponse.status).toBe(201);
    expect(readFileSync(join(projectDir, "index.html"), "utf-8")).toContain("hfc_route");

    const listResponse = await app.request("http://localhost/projects/demo/timeline-comments");
    const listed = (await listResponse.json()) as { comments: Array<{ id: string }> };
    expect(listed.comments.map((comment) => comment.id)).toEqual(["hfc_route"]);

    const deleteResponse = await app.request(
      "http://localhost/projects/demo/timeline-comments/hfc_route",
      { method: "DELETE" },
    );
    expect(deleteResponse.status).toBe(200);
    expect(readFileSync(join(projectDir, "index.html"), "utf-8")).not.toContain("hfc_route");
  });

  it("rejects agent-run payloads with malformed elements", async () => {
    const projectDir = createProjectDir();
    const app = new Hono();
    registerTimelineCommentRoutes(app, createAdapter(projectDir));

    const response = await app.request("http://localhost/projects/demo/agent/resolve-comment", {
      method: "POST",
      body: JSON.stringify({
        commentId: "hfc_route",
        filePath: "index.html",
        prompt: "do thing",
        rangeStart: 0,
        rangeEnd: 1,
        elements: [{ id: "hero" }],
      }),
    });

    expect(response.status).toBe(400);
  });

  it("reports no active runs when none are in flight", async () => {
    const projectDir = createProjectDir();
    const app = new Hono();
    registerTimelineCommentRoutes(app, createAdapter(projectDir));

    const response = await app.request("http://localhost/projects/demo/agent/active-run");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ active: false, run: null });
  });

  it("cancel endpoint is a no-op when nothing is running for the given comment", async () => {
    const projectDir = createProjectDir();
    const app = new Hono();
    registerTimelineCommentRoutes(app, createAdapter(projectDir));

    const response = await app.request("http://localhost/projects/demo/agent/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commentId: "hfc_missing" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, cancelled: false });
  });

  it("cancel endpoint rejects missing commentId", async () => {
    const projectDir = createProjectDir();
    const app = new Hono();
    registerTimelineCommentRoutes(app, createAdapter(projectDir));

    const response = await app.request("http://localhost/projects/demo/agent/cancel", {
      method: "POST",
    });
    expect(response.status).toBe(400);
  });

  it("rejects invalid comment payloads", async () => {
    const projectDir = createProjectDir();
    const app = new Hono();
    registerTimelineCommentRoutes(app, createAdapter(projectDir));

    const response = await app.request("http://localhost/projects/demo/timeline-comments", {
      method: "POST",
      body: JSON.stringify({ filePath: "index.html" }),
    });

    expect(response.status).toBe(400);
  });
});
