import type { Hono } from "hono";
import type { StudioApiAdapter } from "../types.js";

function createPreviewResponse(
  preview: { content: Buffer; contentType: string },
  kind: "poster" | "video",
  rangeHeader?: string,
): Response {
  const totalSize = preview.content.length;
  const range = kind === "video" && rangeHeader ? /^bytes=(\d+)-(\d*)$/.exec(rangeHeader) : null;
  if (range) {
    const start = Number(range[1]);
    const requestedEnd = range[2] ? Number(range[2]) : totalSize - 1;
    if (start >= totalSize || requestedEnd < start) {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${totalSize}` },
      });
    }
    const end = Math.min(requestedEnd, totalSize - 1);
    const content = preview.content.subarray(start, end + 1);
    return new Response(new Uint8Array(content), {
      status: 206,
      headers: {
        "Content-Type": preview.contentType,
        "Content-Range": `bytes ${start}-${end}/${totalSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(content.length),
        "Cache-Control": "no-cache",
      },
    });
  }

  return new Response(new Uint8Array(preview.content), {
    headers: {
      "Content-Type": preview.contentType,
      ...(kind === "video" ? { "Accept-Ranges": "bytes" } : {}),
      "Content-Length": String(totalSize),
      "Cache-Control": "no-cache",
    },
  });
}

export function registerRegistryRoutes(api: Hono, adapter: StudioApiAdapter): void {
  api.get("/registry/blocks", async (c) => {
    if (!adapter.listRegistryCatalog) {
      return c.json({ error: "Registry not available" }, 501);
    }
    const items = await adapter.listRegistryCatalog();
    return c.json(items);
  });

  api.get("/registry/previews/:name/:kind", async (c) => {
    if (!adapter.readRegistryPreview) {
      return c.json({ error: "Registry previews not available" }, 501);
    }
    const kind = c.req.param("kind");
    if (kind !== "poster" && kind !== "video") {
      return c.json({ error: "Invalid Registry preview kind" }, 400);
    }
    const itemName = c.req.param("name");
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(itemName)) {
      return c.json({ error: "Invalid Registry item name" }, 400);
    }
    let preview;
    try {
      preview = await adapter.readRegistryPreview({ itemName, kind });
    } catch {
      return c.json({ error: "Registry preview unavailable" }, 500);
    }
    if (!preview) return c.json({ error: "Registry preview not found" }, 404);
    return createPreviewResponse(preview, kind, c.req.header("Range"));
  });

  // fallow-ignore-next-line complexity
  api.post("/projects/:id/registry/install", async (c) => {
    if (!adapter.installRegistryBlock) {
      return c.json({ error: "Registry install not available" }, 501);
    }
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "Project not found" }, 404);

    const body = await c.req.json<{ blockName?: string }>().catch(() => null);
    if (!body?.blockName) {
      return c.json({ error: "blockName is required" }, 400);
    }

    try {
      const result = await adapter.installRegistryBlock({ project, blockName: body.blockName });
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Install failed";
      return c.json({ error: message }, 500);
    }
  });
}
