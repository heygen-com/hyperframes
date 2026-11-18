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
import { hostname as machineName, networkInterfaces } from "node:os";
import { injectScriptsIntoHtml } from "@hyperframes/core/compiler";
import { injectTagsAtHeadStart } from "@hyperframes/core/compiler/html-document";
import {
  PREVIEW_FOR_ANOTHER_SITE_META,
  serviceWorkerScriptFetch,
} from "@hyperframes/core/studio-preview-mark";
import { isPrivateFileUnder, isStudioPrivatePath } from "@hyperframes/core/safe-path";
import { isWithinProjectRoot } from "@hyperframes/parsers/asset-resolution";
import { answerOwnLoopbackHostOnly } from "../utils/loopbackOnly.js";

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
  hostname?: string;
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

/**
 * Resolves the request path against both roots and rejects the pair the
 * moment either escapes -- lexically, so a symlinked asset directory still
 * resolves (see the containment note at the call site).
 */
function resolveContainedPaths(
  projectDir: string,
  compiledDir: string | undefined,
  relativePath: string,
): { projectPath: string; compiledPath: string | null } | null {
  const projectPath = join(projectDir, relativePath);
  if (!isWithinProjectRoot(projectDir, projectPath)) return null;
  if (isPrivateFileUnder(projectDir, projectPath, isStudioPrivatePath)) return null;
  if (!compiledDir) return { projectPath, compiledPath: null };
  const compiledPath = join(compiledDir, relativePath);
  if (!isWithinProjectRoot(compiledDir, compiledPath)) return null;
  if (isPrivateFileUnder(compiledDir, compiledPath, isStudioPrivatePath)) return null;
  return { projectPath, compiledPath };
}

const OFFER_NO_FRAMING_SITE_AN_EDITING_PORT = `<meta name="${PREVIEW_FOR_ANOTHER_SITE_META}">`;

function nameInHost(host: string): string {
  const bracketed = /^\[([^\]]+)\]/.exec(host);
  return (bracketed ? bracketed[1] : host.split(":")[0])?.toLowerCase() ?? "";
}

function isLoopbackName(name: string): boolean {
  return name === "localhost" || name === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(name);
}

function thisMachinesNames(): Set<string> {
  const names = new Set([machineName().toLowerCase()]);
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) names.add(entry.address.toLowerCase());
  }
  return names;
}

/** Loopback, the bound name, or on a wildcard bind this machine's own addresses: never a name a page can point here. */
function hostAllowedFor(bound: string): (host: string | undefined) => boolean {
  const boundName = bound.replace(/^\[|\]$/g, "").toLowerCase();
  const wildcard = boundName === "0.0.0.0" || boundName === "::";
  return (host) => {
    const name = host ? nameInHost(host) : "";
    if (name === "") return false;
    if (isLoopbackName(name) || name === boundName) return true;
    return wildcard && thisMachinesNames().has(name);
  };
}

export function createFileServer(options: FileServerOptions): Promise<FileServerHandle> {
  const {
    projectDir,
    compiledDir,
    port = 0,
    stripEmbeddedRuntime = true,
    hostname = "127.0.0.1",
  } = options;

  const headScripts = options.headScripts ?? [];
  const bodyScripts = options.bodyScripts ?? [];

  const app = new Hono();
  let listeningPort = -1;
  const boundToLoopbackOnly = ["127.0.0.1", "localhost", "::1"].includes(hostname);
  if (boundToLoopbackOnly) answerOwnLoopbackHostOnly(app, () => listeningPort);
  if (!boundToLoopbackOnly) {
    const hostAllowed = hostAllowedFor(hostname);
    app.use(async function refuseHostNotServedHere(c, next) {
      if (hostAllowed(c.req.header("host") ?? new URL(c.req.url).host)) return next();
      return c.text("Forbidden: unknown host", 403);
    });
  }

  app.use(async function refuseServiceWorkerScripts(c, next) {
    const serviceWorker = c.req.header("service-worker");
    if (!serviceWorkerScriptFetch({ serviceWorker, fetchDest: c.req.header("sec-fetch-dest") }))
      return next();
    return c.text("Forbidden", 403);
  });

  app.get("/*", (c) => {
    let requestPath = c.req.path;
    if (requestPath === "/") requestPath = "/index.html";

    // Remove leading slash
    const relativePath = requestPath.replace(/^\//, "");
    // Percent escapes can decode into separators and dot segments before the
    // join, so a hostile request can name files above either root -- see
    // resolveContainedPaths for why the check stays lexical, not realpath.
    const resolved = resolveContainedPaths(projectDir, compiledDir, relativePath);
    if (!resolved) return c.text("Not found", 404);
    const content =
      (resolved.compiledPath ? readRegularFile(resolved.compiledPath) : null) ??
      readRegularFile(resolved.projectPath);
    if (content === null) return c.text("Not found", 404);

    const ext = extname(relativePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    if (ext === ".html") {
      const rawHtml = content.toString("utf-8");
      const html =
        relativePath === "index.html"
          ? injectScriptsIntoHtml(rawHtml, headScripts, bodyScripts, stripEmbeddedRuntime)
          : rawHtml;
      return c.text(injectTagsAtHeadStart(html, OFFER_NO_FRAMING_SITE_AN_EDITING_PORT), 200, {
        "Content-Type": contentType,
      });
    }

    return new Response(content, {
      status: 200,
      headers: { "Content-Type": contentType },
    });
  });

  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
      const actualPort = info.port;
      listeningPort = actualPort;
      const url = `http://localhost:${actualPort}`;
      resolve({
        url,
        port: actualPort,
        close: () => server.close(),
      });
    });
  });
}
