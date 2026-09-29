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
  vi.restoreAllMocks();
});

describe("studio-server where sharp cannot load", () => {
  it("still loads the package", async () => {
    await expect(import("../index.js")).resolves.toHaveProperty("createStudioApi");
  });

  it("answers a real JPEG with 422 and warns once", async () => {
    const { default: realSharp } = await vi.importActual<typeof import("sharp")>("sharp");
    const jpeg = await realSharp({
      create: { width: 64, height: 48, channels: 3, background: "#6495ed" },
    })
      .jpeg()
      .toBuffer();
    const { registerImageThumbnailRoutes } = await import("./imageThumbnail.js");
    dir = await mkdtemp(join(tmpdir(), "hf-image-no-sharp-"));
    await writeFile(join(dir, "a.jpg"), jpeg);
    await writeFile(join(dir, "b.jpg"), jpeg);
    const adapter = { resolveProject: (id: string) => (id === "p" ? { id, dir } : null) };
    const app = new Hono();
    registerImageThumbnailRoutes(app, adapter as unknown as StudioApiAdapter);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const url = (name: string) => `http://localhost/projects/p/image-thumbnail/${name}`;
    expect((await app.request(url("a.jpg"))).status).toBe(422);
    expect((await app.request(url("b.jpg"))).status).toBe(422);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
