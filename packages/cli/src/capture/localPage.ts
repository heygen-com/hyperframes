import {
  createReadStream,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  type Dirent,
} from "node:fs";
import { writeCaptureFileSync } from "./captureFile.js";
import { realpath, stat } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { listenOnBrowserSafePort } from "@hyperframes/engine";

export interface LocalCaptureTarget {
  /** Real path of the directory the page may read from. */
  root: string;
  /** Real path of the HTML file to open. */
  entry: string;
  /** `file://` URL of the entry, reported as the capture source. */
  fileUrl: string;
}

export interface LocalPageServer {
  origin: string;
  /** Loopback URL of the entry page. */
  url: string;
  close(): Promise<void>;
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".txt": "text/plain; charset=utf-8",
};

const activeSites = new Map<string, { root: string; name: string }>();

function localSiteName(entry: string): string {
  const stem = basename(entry, extname(entry));
  const name = stem.toLowerCase() === "index" ? basename(dirname(entry)) : stem;
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "local"
  );
}

/** Name a capture is filed under: the local page's name for an active local server, else the host. */
export function captureSiteName(url: string): string {
  const parsed = new URL(url);
  return activeSites.get(parsed.origin)?.name ?? parsed.hostname.replace(/^www\./, "");
}

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!!rel && !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

/**
 * Resolves a local HTML file (path or `file://` URL) or a directory's `index.html` to a capture
 * target. The entry must lie inside `root` (default: the directory it was named in).
 */
export function resolveLocalCaptureTarget(target: string, root?: string): LocalCaptureTarget {
  const path = resolve(target.startsWith("file:") ? fileURLToPath(target) : target);
  let entry: string;
  let directory: string;
  try {
    // Native realpath, as fs/promises uses for served files, so both agree on case and short names.
    entry = realpathSync.native(path);
    directory = realpathSync.native(dirname(path));
    if (statSync(entry).isDirectory()) {
      directory = entry;
      entry = realpathSync.native(join(entry, "index.html"));
    }
  } catch {
    throw new Error(`Local file not found: ${target}`);
  }
  if (!statSync(entry).isFile()) throw new Error(`Local capture target is not a file: ${target}`);
  let rootPath: string;
  try {
    rootPath = root === undefined ? directory : realpathSync.native(resolve(root));
  } catch {
    throw new Error(`Local capture root not found: ${root}`);
  }
  if (!statSync(rootPath).isDirectory()) {
    throw new Error(`Local capture root is not a directory: ${root}`);
  }
  if (!isInside(rootPath, entry)) {
    throw new Error(`Local capture target ${entry} is outside the root ${rootPath}`);
  }
  return { root: rootPath, entry, fileUrl: pathToFileURL(entry).href };
}

async function servedFile(root: string, pathname: string): Promise<string | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const candidate = resolve(root, `.${decoded}`);
  if (!isInside(root, candidate)) return null;
  try {
    // Symlinks are followed, so the containment check must run on the real path.
    const real = await realpath(candidate);
    if (!isInside(root, real) || !(await stat(real)).isFile()) return null;
    return real;
  } catch {
    return null;
  }
}

function contentType(file: string): string {
  return CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
}

function end(response: ServerResponse, status: number): void {
  response.writeHead(status, { "Content-Length": 0, Connection: "close" });
  response.end();
}

/** Serves only regular files whose real path lies inside `target.root`, on a loopback port. */
export async function startLocalPageServer(target: LocalCaptureTarget): Promise<LocalPageServer> {
  const sockets = new Set<Socket>();
  const server = createServer((request, response) => {
    void (async () => {
      if (request.method !== "GET" && request.method !== "HEAD") return end(response, 405);
      const pathname = new URL(request.url ?? "/", "http://local").pathname;
      const file = await servedFile(target.root, pathname);
      if (!file) return end(response, 404);
      response.writeHead(200, { "Content-Type": contentType(file), "Cache-Control": "no-store" });
      if (request.method === "HEAD") return response.end();
      const stream = createReadStream(file);
      stream.on("error", () => response.destroy());
      stream.pipe(response);
    })().catch(() => response.destroy());
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await listenOnBrowserSafePort(server, "127.0.0.1");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Local page server did not bind");
  const origin = `http://127.0.0.1:${address.port}`;
  const entryPath = relative(target.root, target.entry).split(sep).map(encodeURIComponent);
  activeSites.set(origin, { root: target.root, name: localSiteName(target.entry) });
  let closing: Promise<void> | undefined;
  return {
    origin,
    url: `${origin}/${entryPath.join("/")}`,
    close() {
      closing ??= new Promise<void>((resolveClose) => {
        activeSites.delete(origin);
        server.close(() => resolveClose());
        for (const socket of sockets) socket.destroy();
      });
      return closing;
    },
  };
}

async function localResponse(root: string, pathname: string, method: string): Promise<Response> {
  if (method !== "GET" && method !== "HEAD") return new Response(null, { status: 405 });
  const file = await servedFile(root, pathname);
  if (!file) return new Response(null, { status: 404 });
  const body =
    method === "HEAD"
      ? null
      : (Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>);
  return new Response(body, { status: 200, headers: { "Content-Type": contentType(file) } });
}

/**
 * Answers a URL on an active local page server from disk, with the server's checks; null for every
 * other URL. It never touches the network, so an environment proxy cannot intercept it.
 */
export function fetchLocalPageUrl(url: string, init?: RequestInit): Promise<Response> | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const site = activeSites.get(parsed.origin);
  if (site === undefined) return null;
  return localResponse(site.root, parsed.pathname, (init?.method ?? "GET").toUpperCase());
}

const TEXT_OUTPUTS = new Set([".json", ".md", ".html", ".htm", ".css", ".txt", ".svg", ".js", ""]);

/** Maps every URL on the local server's origin to the `file://` URL of the same path in the root. */
export function localUrlRewriter(origin: string, root: string): (text: string) => string {
  const escapedOrigin = origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`${escapedOrigin}(?![0-9])(/[^\\s"'<>()\\\\]*)?`, "g");
  return (text) =>
    text.replace(pattern, (_match, path: string | undefined) => {
      const url = new URL(path ?? "/", origin);
      let decoded: string;
      try {
        decoded = decodeURIComponent(url.pathname);
      } catch {
        decoded = url.pathname;
      }
      return pathToFileURL(join(root, decoded)).href + url.search + url.hash;
    });
}

/** Applies `rewrite` to every string inside a JSON-like value. */
export function rewriteStrings<T>(value: T, rewrite: (text: string) => string): T {
  if (typeof value === "string") return rewrite(value) as T;
  if (Array.isArray(value)) return value.map((item) => rewriteStrings(item, rewrite)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, rewriteStrings(item, rewrite)]),
    ) as T;
  }
  return value;
}

/** Rewrites local-server URLs in every text file the capture wrote, and records the source. */
export function rewriteLocalCaptureOutput(
  outputDir: string,
  rewrite: (text: string) => string,
  sourceUrl: string,
): void {
  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && TEXT_OUTPUTS.has(extname(entry.name).toLowerCase())) {
        const text = readFileSync(path, "utf8");
        const next = rewrite(text);
        if (next !== text) writeCaptureFileSync(path, next, "utf-8");
      }
    }
  };
  walk(outputDir);
  const metaPath = join(outputDir, "meta.json");
  try {
    const meta: unknown = JSON.parse(readFileSync(metaPath, "utf8"));
    if (meta && typeof meta === "object" && !Array.isArray(meta)) {
      writeCaptureFileSync(metaPath, JSON.stringify({ ...meta, source: sourceUrl }, null, 2));
    }
  } catch {
    /* no meta.json to annotate */
  }
}
