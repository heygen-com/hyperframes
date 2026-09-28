import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StudioApiAdapter } from "../types";

vi.mock("sharp", () => {
  throw new Error("sharp's native binary is missing for this platform");
});

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("studio-server where sharp cannot load", () => {
  it("still loads the package", async () => {
    await expect(import("../index.js")).resolves.toHaveProperty("createStudioApi");
  });

  it("answers a JPEG thumbnail request with 422 instead of failing", async () => {
    const { registerImageThumbnailRoutes } = await import("./imageThumbnail.js");
    dir = await mkdtemp(join(tmpdir(), "hf-image-no-sharp-"));
    await writeFile(join(dir, "photo.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const adapter = { resolveProject: (id: string) => (id === "p" ? { id, dir } : null) };
    const app = new Hono();
    registerImageThumbnailRoutes(app, adapter as unknown as StudioApiAdapter);
    const res = await app.request("http://localhost/projects/p/image-thumbnail/photo.jpg");
    expect(res.status).toBe(422);
  });
});
