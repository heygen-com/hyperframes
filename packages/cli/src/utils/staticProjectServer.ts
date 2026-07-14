import { createServer, type ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { getMimeType } from "@hyperframes/core/studio-api";
import { isChromiumUnsafePort } from "./chromiumUnsafePorts.js";

export interface StaticProjectServer {
  url: string;
  port: number;
  close: () => Promise<void>;
}

interface EphemeralPortServer {
  once(event: "error", listener: (error: Error) => void): unknown;
  removeListener(event: "error", listener: (error: Error) => void): unknown;
  listen(port: number, host: string, callback: () => void): unknown;
  address(): string | { port: number } | null;
  close(callback: (error?: Error) => void): unknown;
}

const MAX_SAFE_PORT_BIND_ATTEMPTS = 10;

function listenOnce(server: EphemeralPortServer, bindErrorMessage: string): Promise<number> {
  return new Promise<number>((resolvePort, rejectPort) => {
    const onError = (error: Error) => {
      server.removeListener("error", onError);
      rejectPort(error);
    };
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", onError);
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      if (!port) rejectPort(new Error(bindErrorMessage));
      else resolvePort(port);
    });
  });
}

function closeServer(server: EphemeralPortServer): Promise<void> {
  return new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) rejectClose(error);
      else resolveClose();
    });
  });
}

export async function listenOnChromiumSafeEphemeralPort(
  server: EphemeralPortServer,
  bindErrorMessage: string,
  maxAttempts = MAX_SAFE_PORT_BIND_ATTEMPTS,
): Promise<number> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const port = await listenOnce(server, bindErrorMessage);
    if (!isChromiumUnsafePort(port)) return port;
    await closeServer(server);
  }
  throw new Error(`${bindErrorMessage}: no Chromium-safe port after ${maxAttempts} attempts`);
}

/**
 * Serve a file with HTTP Range support. Chromium needs byte-range seekability
 * to determine the duration of formats that carry it in a trailing/implicit
 * position (notably WAV, which otherwise reports `.duration` as `Infinity`
 * however long it buffers). A plain 200 with no `Accept-Ranges` makes the
 * media element non-seekable, so `hyperframes validate` would spuriously warn
 * that a perfectly valid local WAV's duration "could not be read".
 */
function serveFileWithRange(
  filePath: string,
  rangeHeader: string | undefined,
  res: ServerResponse,
) {
  const size = statSync(filePath).size;
  const headers: Record<string, string> = {
    "Content-Type": getMimeType(filePath),
    "Accept-Ranges": "bytes",
  };

  // Resolve the requested byte window. Absent/malformed Range serves the
  // whole file (200); a valid `bytes=start-end` (including the open-ended
  // `start-` and suffix `-N` forms) serves a 206 slice.
  const last = size - 1;
  let start = 0;
  let end = last;
  let status = 200;
  const match = rangeHeader ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim()) : null;
  if (match) {
    const hasStart = match[1] !== "";
    start = hasStart ? Number(match[1]) : Math.max(0, size - Number(match[2]));
    end = !hasStart ? last : match[2] !== "" ? Math.min(Number(match[2]), last) : last;

    if (start > end || start > last) {
      res.writeHead(416, { ...headers, "Content-Range": `bytes */${size}` });
      res.end();
      return;
    }
    status = 206;
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  }
  headers["Content-Length"] = String(end - start + 1);

  // Stream only the requested window instead of buffering the whole file: a
  // 1KB Range of a 50MB asset must not allocate 50MB. createReadStream reads
  // just `[start, end]` and closes its own fd on end/error. writeHead is
  // deferred to `open` so a failed open can still answer 500.
  const stream = createReadStream(filePath, { start, end });
  stream.on("open", () => {
    res.writeHead(status, headers);
    stream.pipe(res);
  });
  stream.on("error", () => {
    if (!res.headersSent) res.writeHead(500);
    res.end();
    stream.destroy();
  });
}

export async function serveStaticProjectHtml(
  projectDir: string,
  html: string,
  bindErrorMessage = "Failed to bind local HTTP server",
  // Extra dirs to resolve non-index requests against, after projectDir (e.g. a
  // temp dir of localized remote assets).
  assetRoots: readonly string[] = [],
): Promise<StaticProjectServer> {
  const roots = [projectDir, ...assetRoots];
  // fallow-ignore-next-line complexity
  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === "/" || url === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
      return;
    }

    const requestPath = decodeURIComponent(url).replace(/^\//, "");
    for (const root of roots) {
      const filePath = resolve(root, requestPath);
      const rel = relative(root, filePath);
      if (rel.startsWith("..") || isAbsolute(rel)) continue; // traversal guard; try next root
      if (existsSync(filePath)) {
        serveFileWithRange(filePath, req.headers.range, res);
        return;
      }
    }
    res.writeHead(404);
    res.end();
  });

  // Bind loopback only (SECURITY F-001): a bare listen(0) binds 0.0.0.0/::,
  // which an IDE's port auto-forward surfaces as a transient "preview". The
  // snapshot browser is co-located (url below is already 127.0.0.1).
  const port = await listenOnChromiumSafeEphemeralPort(server, bindErrorMessage);

  return {
    url: `http://127.0.0.1:${port}/`,
    port,
    close: () =>
      new Promise<void>((resolveClose) => {
        server.close(() => resolveClose());
      }),
  };
}
