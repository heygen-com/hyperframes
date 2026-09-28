import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mkdtemp, rm, writeFile, symlink, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { registerImageThumbnailRoutes } from "./imageThumbnail";
import type { StudioApiAdapter } from "../types";

let dir: string;
let outside: string;
let app: Hono;
const url = "http://localhost/projects/p/image-thumbnail/photo.jpg";
async function photo(path: string, width = 2560, height = 1920) {
  await sharp({ create: { width, height, channels: 3, background: "#6495ed" } })
    .jpeg()
    .toFile(path);
}
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hf-image-thumbnail-"));
  outside = await mkdtemp(join(tmpdir(), "hf-image-outside-"));
  const adapter: StudioApiAdapter = {
    listProjects: () => [],
    resolveProject: (id) => (id === "p" ? { id, dir } : null),
    bundle: async () => null,
    lint: async () => ({ findings: [] }),
    runtimeUrl: "/runtime.js",
    rendersDir: () => dir,
    startRender: () => ({ id: "unused", status: "rendering", progress: 0, outputPath: "" }),
  };
  app = new Hono();
  registerImageThumbnailRoutes(app, adapter);
  await photo(join(dir, "photo.jpg"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe("JPEG timeline thumbnail route", () => {
  it("returns a bounded JPEG, privately revalidated and unchanged on repeat requests", async () => {
    const response = await app.request(url);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toBe("private, no-cache");
    const bytes = Buffer.from(await response.arrayBuffer());
    const metadata = await sharp(bytes).metadata();
    expect([metadata.width, metadata.height]).toEqual([180, 135]);
    const repeat = await app.request(url);
    expect(Buffer.from(await repeat.arrayBuffer())).toEqual(bytes);
    const etag = response.headers.get("etag");
    if (!etag) throw new Error("missing etag");
    expect((await app.request(url, { headers: { "If-None-Match": etag } })).status).toBe(304);
  });
  it("invalidates cached responses when the source changes", async () => {
    const first = await app.request(url);
    await photo(join(dir, "photo.jpg"), 1000, 2000);
    const next = await app.request(url);
    expect(next.headers.get("etag")).not.toBe(first.headers.get("etag"));
    const metadata = await sharp(Buffer.from(await next.arrayBuffer())).metadata();
    expect([metadata.width, metadata.height]).toEqual([68, 135]);
  });
  it("deduplicates concurrent requests and keeps their results readable", async () => {
    const responses = await Promise.all(Array.from({ length: 8 }, () => app.request(url)));
    const buffers = await Promise.all(
      responses.map(async (response) => {
        expect(response.status).toBe(200);
        return Buffer.from(await response.arrayBuffer());
      }),
    );
    expect(buffers.every((buffer) => buffer.equals(buffers[0]))).toBe(true);
  });
  it("respects EXIF orientation and rejects excessive pixel counts", async () => {
    const path = join(dir, "photo.jpg");
    const bytes = await sharp({
      create: { width: 2560, height: 1920, channels: 3, background: "#6495ed" },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    await writeFile(path, bytes);
    const response = await app.request(url);
    const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
    expect([metadata.width, metadata.height]).toEqual([101, 135]);
    const header = bytes.indexOf(Buffer.from([0xff, 0xc0]));
    expect(header).toBeGreaterThan(0);
    bytes.writeUInt16BE(50000, header + 5);
    bytes.writeUInt16BE(50000, header + 7);
    await writeFile(path, bytes);
    expect((await app.request(url)).status).toBe(422);
    expect((await app.request(url.replace("photo.jpg", "missing.jpg"))).status).toBe(404);
  });

  it("does not upscale small JPEGs", async () => {
    await photo(join(dir, "photo.jpg"), 40, 30);
    const response = await app.request(url);
    const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
    expect([metadata.width, metadata.height]).toEqual([40, 30]);
  });
  it("rejects unknown projects, encoded traversal and symlink escapes", async () => {
    expect((await app.request(url.replace("/p/", "/unknown/"))).status).toBe(404);
    expect((await app.request(url.replace("photo.jpg", "..%2Foutside.jpg"))).status).toBe(404);
    await photo(join(outside, "private.jpg"));
    await symlink(join(outside, "private.jpg"), join(dir, "link.jpg"));
    expect((await app.request(url.replace("photo.jpg", "link.jpg"))).status).toBe(404);
  });
  it("rejects other formats even if renamed to JPEG", async () => {
    expect((await app.request(url.replace("photo.jpg", "photo.png"))).status).toBe(415);
    await writeFile(
      join(dir, "photo.jpg"),
      await sharp({ create: { width: 10, height: 10, channels: 4, background: "#fff" } })
        .png()
        .toBuffer(),
    );
    expect((await app.request(url)).status).toBe(422);
  });
  it("rejects malformed paths, corrupt images and oversized sources", async () => {
    expect((await app.request(url.replace("photo.jpg", "%FF.jpg"))).status).toBe(400);
    await writeFile(join(dir, "photo.jpg"), "not an image");
    expect((await app.request(url)).status).toBe(422);
    const file = await open(join(dir, "photo.jpg"), "w");
    await file.truncate(65 * 1024 * 1024);
    await file.close();
    expect((await app.request(url)).status).toBe(413);
  });
});
