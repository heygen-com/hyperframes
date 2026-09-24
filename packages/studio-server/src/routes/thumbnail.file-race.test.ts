// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { registerThumbnailRoutes } from "./thumbnail.js";
import type { StudioApiAdapter } from "../types.js";

// Lets a test make the existence check see a file that is gone by the time it is read.
const vanished = vi.hoisted(() => ({ matches: (_path: string) => false }));
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return { ...fs, existsSync: (path: string) => vanished.matches(path) || fs.existsSync(path) };
});

const projectDirs: string[] = [];

afterEach(() => {
  vanished.matches = () => false;
  for (const dir of projectDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function serveThumbnails(): { app: Hono; adapter: StudioApiAdapter; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "hf-thumbnail-race-"));
  projectDirs.push(dir);
  writeFileSync(join(dir, "index.html"), `<div data-width="640" data-height="360"></div>`);
  const adapter = {
    resolveProject: async (id: string) => ({ id, dir }),
    generateThumbnail: vi.fn(async () => Buffer.from("thumb")),
  } as unknown as StudioApiAdapter;
  const app = new Hono();
  registerThumbnailRoutes(app, adapter);
  return { app, adapter, dir };
}

describe("thumbnail reads that race a delete", () => {
  it.each(["studio-manual-edits.json", "studio-motion.json"])(
    "serves a thumbnail when %s disappears between the check and the read",
    async (manifest) => {
      const { app, adapter } = serveThumbnails();
      vanished.matches = (path) => path.endsWith(manifest);

      const res = await app.request("http://localhost/projects/demo/thumbnail/index.html");

      expect(res.status).toBe(200);
      expect(adapter.generateThumbnail).toHaveBeenCalledTimes(1);
    },
  );

  it("regenerates a cached thumbnail that is pruned between the check and the read", async () => {
    const { app, adapter } = serveThumbnails();
    vanished.matches = (path) => path.includes(".thumbnails") && path.endsWith(".jpg");

    const res = await app.request("http://localhost/projects/demo/thumbnail/index.html");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("thumb");
    expect(adapter.generateThumbnail).toHaveBeenCalledTimes(1);
  });

  it("caches a thumbnail when the cache folder disappears between the check and its use", async () => {
    const { app, dir } = serveThumbnails();
    vanished.matches = (path) => path.endsWith(".thumbnails");

    const res = await app.request("http://localhost/projects/demo/thumbnail/index.html");

    expect(res.status).toBe(200);
    expect(readdirSync(join(dir, ".thumbnails"))).toHaveLength(1);
  });
});
