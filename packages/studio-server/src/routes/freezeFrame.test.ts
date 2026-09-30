import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerFreezeFrameRoutes, type FrameExtractor } from "./freezeFrame";
import { fileContentVersion } from "../helpers/fileVersion";
import type { StudioApiAdapter } from "../types";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const html = `<div data-composition-id="main" data-start="0" data-duration="6">
<video id="talk" class="clip" src="media/talk.mp4" data-start="0" data-duration="6" data-track-index="0"></video>
</div>`;

function setup(extract: FrameExtractor) {
  const dir = mkdtempSync(join(tmpdir(), "hf-freeze-"));
  tempDirs.push(dir);
  writeFileSync(join(dir, "index.html"), html);
  const adapter: StudioApiAdapter = {
    listProjects: () => [],
    resolveProject: async (id: string) => ({ id, dir }),
    bundle: async () => null,
    lint: async () => ({ findings: [] }),
    runtimeUrl: "/api/runtime.js",
    rendersDir: () => "/tmp/renders",
    startRender: () => ({ id: "j", status: "rendering", progress: 0, outputPath: "/tmp/o.mp4" }),
  };
  const app = new Hono();
  registerFreezeFrameRoutes(app, adapter, extract);
  const post = (body: unknown) =>
    app.request("http://localhost/projects/demo/file-mutations/freeze-frame", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  return { dir, post };
}

describe("freeze-frame route", () => {
  it("extracts the frame under the playhead and writes split + still in one write", async () => {
    const calls: string[][] = [];
    const { dir, post } = setup(async (args) => {
      calls.push(args);
      return { ok: true };
    });
    const res = await post({
      path: "index.html",
      expectedVersion: fileContentVersion(html),
      target: { id: "talk" },
      playhead: 2.5,
    });
    const body: { before?: string; after?: string; imageSrc?: string } = await res.json();
    expect(res.status).toBe(200);
    expect(calls[0]).toEqual([
      "-y",
      "-ss",
      "2.5",
      "-i",
      join(dir, "media/talk.mp4"),
      "-frames:v",
      "1",
      join(dir, "assets/freeze/talk-2500.png"),
    ]);
    expect(body.imageSrc).toBe("assets/freeze/talk-2500.png");
    expect(body.before).toBe(html);
    expect(readFileSync(join(dir, "index.html"), "utf-8")).toBe(body.after);
    expect(body.after).toContain('id="talk-freeze"');
  });

  it("refuses a stale version without extracting", async () => {
    const calls: string[][] = [];
    const { post } = setup(async (args) => {
      calls.push(args);
      return { ok: true };
    });
    const res = await post({
      path: "index.html",
      expectedVersion: "stale",
      target: { id: "talk" },
      playhead: 1,
    });
    expect(res.status).toBe(409);
    expect(calls).toEqual([]);
  });

  it("leaves the file untouched when extraction fails", async () => {
    const { dir, post } = setup(async () => ({ ok: false, error: "boom" }));
    const res = await post({
      path: "index.html",
      expectedVersion: fileContentVersion(html),
      target: { id: "talk" },
      playhead: 1,
    });
    expect(res.status).toBe(500);
    expect(readFileSync(join(dir, "index.html"), "utf-8")).toBe(html);
  });
});
