import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { open, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { StudioApiAdapter } from "../types.js";
import { pinWithinProject } from "../helpers/safePath.js";
import { requestSubPath } from "../helpers/requestSubPath.js";
import { ThumbnailGenerationCoordinator } from "./thumbnailGenerationCoordinator.js";

const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const MAX_CACHE_BYTES = 8 * 1024 * 1024;

let sharpLoad: Promise<typeof import("sharp").default> | undefined;
function loadSharp() {
  sharpLoad ??= import("sharp").then(
    (module) => module.default,
    (error: unknown) => {
      console.warn("[Studio] JPEG thumbnails are off: sharp could not load:", error);
      throw error;
    },
  );
  return sharpLoad;
}

async function generateThumbnail(path: string, signal: AbortSignal): Promise<Buffer> {
  const sharp = await loadSharp();
  const file = await open(path, "r");
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > MAX_SOURCE_BYTES) throw new Error("Unsupported image");
    const source = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < source.length) {
      signal.throwIfAborted();
      const { bytesRead } = await file.read(source, offset, source.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (source[0] !== 0xff || source[1] !== 0xd8) throw new Error("Unsupported image");
    const image = sharp(source.subarray(0, offset), { limitInputPixels: 40_000_000 });
    if ((await image.metadata()).format !== "jpeg") throw new Error("Unsupported image");
    signal.throwIfAborted();
    const result = await image
      .rotate()
      .resize(240, 135, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    signal.throwIfAborted();
    return result;
  } finally {
    await file.close();
  }
}

async function resolveSource(adapter: StudioApiAdapter, id: string, url: string) {
  const project = await adapter.resolveProject(id);
  if (!project) throw new HTTPException(404);
  let relative: string;
  try {
    relative = requestSubPath(url, "projects/:id/image-thumbnail");
  } catch {
    throw new HTTPException(400);
  }
  if (!/\.jpe?g$/i.test(relative)) throw new HTTPException(415);
  const path = pinWithinProject(project.dir, relative);
  if (!path) throw new HTTPException(404);
  const info = await stat(path).catch(() => {
    throw new HTTPException(404);
  });
  if (!info.isFile()) throw new HTTPException(404);
  if (info.size > MAX_SOURCE_BYTES) throw new HTTPException(413);
  return { path, info };
}

export function registerImageThumbnailRoutes(api: Hono, adapter: StudioApiAdapter): void {
  const coordinator = new ThumbnailGenerationCoordinator(2);
  const cache = new Map<string, Buffer>();
  let cacheBytes = 0;
  const remember = (key: string, image: Buffer) => {
    cacheBytes -= cache.get(key)?.byteLength ?? 0;
    cache.delete(key);
    cache.set(key, image);
    cacheBytes += image.byteLength;
    while (cacheBytes > MAX_CACHE_BYTES || cache.size > 128) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cacheBytes -= cache.get(oldest)?.byteLength ?? 0;
      cache.delete(oldest);
    }
  };
  api.get("/projects/:id/image-thumbnail/*", async (c) => {
    try {
      const { path, info } = await resolveSource(adapter, c.req.param("id"), c.req.url);
      const key = createHash("sha256")
        .update(JSON.stringify([path, info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs]))
        .digest("hex");
      const etag = `"${key}"`;
      c.header("ETag", etag);
      c.header("Cache-Control", "private, no-cache");
      c.header("X-Content-Type-Options", "nosniff");
      if (c.req.header("If-None-Match") === etag) return c.body(null, 304);
      let result = cache.get(key);
      if (result) remember(key, result);
      else {
        if (coordinator.protectedKeys().size >= 32) return c.text("thumbnail queue full", 429);
        result =
          (await coordinator.acquire(key, c.req.raw.signal, async (signal) => {
            const image = await generateThumbnail(path, signal);
            remember(key, image);
            return image;
          })) ?? undefined;
      }
      if (!result) return c.text("image unavailable", 422);
      c.header("Content-Type", "image/jpeg");
      return c.body(new Uint8Array(result));
    } catch (error) {
      if (error instanceof HTTPException) return error.getResponse();
      return c.text("image unavailable", 422);
    }
  });
}
