// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerThumbnailRoutes } from "./thumbnail";
import type { StudioApiAdapter } from "../types";

vi.mock("../helpers/proxyTranscoder.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../helpers/proxyTranscoder.js")>()),
  proxyActivityMark: vi.fn(() => "0"),
}));

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup(serverOrigin?: string) {
  const projectDir = mkdtempSync(join(tmpdir(), "hf-thumbnail-origin-"));
  dirs.push(projectDir);
  writeFileSync(join(projectDir, "index.html"), '<div data-width="320" data-height="180"></div>');
  const visited: string[] = [];
  const adapter: StudioApiAdapter = {
    listProjects: () => [],
    resolveProject: async (id: string) => ({ id, dir: projectDir }),
    bundle: async () => null,
    lint: async () => ({ findings: [] }),
    runtimeUrl: "/api/runtime.js",
    rendersDir: () => join(projectDir, "renders"),
    startRender: () => ({ id: "job", status: "rendering", progress: 0, outputPath: "/tmp/o.mp4" }),
    ...(serverOrigin !== undefined && { serverOrigin: () => serverOrigin }),
    generateThumbnail: async ({ previewUrl }) => {
      visited.push(previewUrl);
      return Buffer.from("thumb");
    },
  };
  const app = new Hono();
  registerThumbnailRoutes(app, adapter);
  // Each request a fresh `t`, so none is answered from the previous one's cache.
  let seek = 0;
  const request = (host: string) =>
    app.request(`http://localhost/projects/demo/thumbnail/index.html?t=${(seek += 0.25)}`, {
      headers: { host },
    });
  return { request, visited };
}

describe("the thumbnail browser's destination", () => {
  it("is the server's own origin, whatever Host the request names", async () => {
    const { request, visited } = setup("http://127.0.0.1:3002");

    const res = await request("other.example:3002");

    expect(res.status).toBe(200);
    expect(visited).toHaveLength(1);
    expect(new URL(visited[0]!).origin).toBe("http://127.0.0.1:3002");
    expect(visited[0]).toMatch(/^http:\/\/127\.0\.0\.1:3002\/api\/projects\/demo\/preview\?/);
  });

  it("never comes from a non-loopback Host when the host reports no origin", async () => {
    const { request, visited } = setup();

    for (const host of [
      "other.example:3002",
      "127.0.0.1:3002@other.example",
      "localhost.other.example",
      "127.0.0.1.other.example:3002",
    ]) {
      expect((await request(host)).status).toBe(400);
    }
    expect(visited).toEqual([]);
  });

  it("is a loopback Host as given when the host reports no origin", async () => {
    const { request, visited } = setup();

    for (const host of ["localhost:3002", "127.0.0.1:4100", "[::1]:3002"]) {
      expect((await request(host)).status).toBe(200);
    }
    expect(visited.map((url) => new URL(url).host)).toEqual([
      "localhost:3002",
      "127.0.0.1:4100",
      "[::1]:3002",
    ]);
  });
});
