/**
 * File Server
 *
 * Lightweight HTTP server that serves a project directory to headless Chrome.
 * Optionally injects scripts into index.html on-the-fly (e.g. runtime, bridge).
 * Framework-agnostic — the caller decides what scripts to inject.
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { readFileSync, openSync, fstatSync, closeSync, statSync, constants } from "node:fs";
import { join, extname } from "node:path";
import { injectScriptsIntoHtml } from "@hyperframes/core/compiler";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/vnd.microsoft.icon",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

export interface FileServerOptions {
  projectDir: string;
  compiledDir?: string;
  port?: number;
  /** Scripts injected into <head> of index.html. Default: none. */
  headScripts?: string[];
  /** Scripts injected before </body> of index.html. Default: none. */
  bodyScripts?: string[];
  /** Strip embedded runtime scripts from HTML before injection. Default: true. */
  stripEmbeddedRuntime?: boolean;
}

export interface FileServerHandle {
  url: string;
  port: number;
  close: () => void;
}

function readRegularFile(filePath: string): Buffer<ArrayBuffer> | null {
  let fd: number;
  try {
    // Do not block on a named pipe before fstat can reject non-regular files.
    fd = openSync(filePath, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    )
      return null;
    // Platforms report different open errors for directories and sockets.
    // This check only classifies a failed open; no read follows it.
    if (!statSync(filePath, { throwIfNoEntry: false })?.isFile()) return null;
    throw error;
  }
  try {
    if (!fstatSync(fd).isFile()) return null;
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function createFileServer(options: FileServerOptions): Promise<FileServerHandle> {
  const { projectDir, compiledDir, port = 0, stripEmbeddedRuntime = true } = options;

  const headScripts = options.headScripts ?? [];
  const bodyScripts = options.bodyScripts ?? [];

  const app = new Hono();

  app.get("/*", (c) => {
    let requestPath = c.req.path;
    if (requestPath === "/") requestPath = "/index.html";

    // Remove leading slash
    const relativePath = requestPath.replace(/^\//, "");
    const compiledPath = compiledDir ? join(compiledDir, relativePath) : null;
    const content =
      (compiledPath ? readRegularFile(compiledPath) : null) ??
      readRegularFile(join(projectDir, relativePath));
    if (content === null) return c.text("Not found", 404);

    const ext = extname(relativePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    if (ext === ".html") {
      const rawHtml = content.toString("utf-8");
      const html =
        relativePath === "index.html"
          ? injectScriptsIntoHtml(rawHtml, headScripts, bodyScripts, stripEmbeddedRuntime)
          : rawHtml;
      return c.text(html, 200, { "Content-Type": contentType });
    }

    return new Response(content, {
      status: 200,
      headers: { "Content-Type": contentType },
    });
  });

  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port }, (info) => {
      const actualPort = info.port;
      const url = `http://localhost:${actualPort}`;
      resolve({
        url,
        port: actualPort,
        close: () => server.close(),
      });
    });
  });
}
