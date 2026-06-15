import { defineConfig } from "vite";
import path from "node:path";
import type { Plugin } from "vite";
import type { Connect } from "vite";
import type { ServerResponse } from "node:http";
import { createFsAdapter } from "@hyperframes/sdk/adapters/fs";
import type { PersistAdapter } from "@hyperframes/sdk/adapters/types";

const COMP_ROOT = path.resolve(import.meta.dirname);
const COMP_PATH = "composition.html";

function sendHtml(res: ServerResponse, html: string | undefined) {
  if (html === undefined) {
    res.statusCode = 404;
    res.end("");
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(html);
}

function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function versionKeyOf(req: Connect.IncomingMessage): string | null {
  return new URL(req.url ?? "/", "http://localhost").searchParams.get("version");
}

async function handleCompositionGet(
  adapter: PersistAdapter,
  req: Connect.IncomingMessage,
  res: ServerResponse,
) {
  const versionKey = versionKeyOf(req);
  const html = versionKey
    ? await adapter.loadFrom(COMP_PATH, versionKey)
    : await adapter.read(COMP_PATH);
  sendHtml(res, html);
}

async function handleCompositionPut(
  adapter: PersistAdapter,
  req: Connect.IncomingMessage,
  res: ServerResponse,
) {
  await adapter.write(COMP_PATH, await readBody(req));
  res.statusCode = 204;
  res.end();
}

function methodNotAllowed(res: ServerResponse) {
  res.statusCode = 405;
  res.end();
}

async function handleHttpFileGet(
  adapter: PersistAdapter,
  filePath: string,
  optional: boolean,
  res: ServerResponse,
) {
  const content = await adapter.read(filePath);
  if (content === undefined) {
    res.statusCode = 404;
    res.end(optional ? "{}" : "");
    return;
  }
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ content }));
}

async function handleHttpFilePut(
  adapter: PersistAdapter,
  filePath: string,
  req: Connect.IncomingMessage,
  res: ServerResponse,
) {
  const body = JSON.parse(await readBody(req)) as { content?: string };
  if (typeof body.content !== "string") {
    res.statusCode = 400;
    res.end();
    return;
  }
  await adapter.write(filePath, body.content);
  res.statusCode = 200;
  res.end();
}

function compositionPlugin(): Plugin {
  const adapter = createFsAdapter({ root: COMP_ROOT });

  return {
    name: "hf-composition",
    configureServer(server) {
      server.middlewares.use("/api/composition/versions", async (req, res) => {
        if (req.method !== "GET") return methodNotAllowed(res);
        const versions = await adapter.listVersions(COMP_PATH);
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(versions.map((v) => ({ key: v.key, timestamp: v.timestamp }))));
      });

      server.middlewares.use("/api/composition", async (req, res) => {
        if (req.method === "GET") return handleCompositionGet(adapter, req, res);
        if (req.method === "PUT") return handleCompositionPut(adapter, req, res);
        methodNotAllowed(res);
      });

      // Stage 7: HTTP adapter-compatible REST routes.
      // createHttpAdapter expects GET /files/{path}?optional=1 → { content } and
      // PUT /files/{path} body { content } → 200.
      // fallow-ignore-next-line complexity
      server.middlewares.use("/api/project/files/", async (req, res) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const filePath = decodeURIComponent(url.pathname.replace(/^\/api\/project\/files\//, ""));
        if (!filePath) return methodNotAllowed(res);
        if (req.method === "GET") {
          return handleHttpFileGet(
            adapter,
            filePath,
            url.searchParams.get("optional") === "1",
            res,
          );
        }
        if (req.method === "PUT") return handleHttpFilePut(adapter, filePath, req, res);
        methodNotAllowed(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [compositionPlugin()],
});
