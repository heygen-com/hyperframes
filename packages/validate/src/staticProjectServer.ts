import { createServer, type ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { getMimeType } from "@hyperframes/core/studio-api";

export interface StaticProjectServer {
  url: string;
  port: number;
  close: () => Promise<void>;
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

  const port = await new Promise<number>((resolvePort, rejectPort) => {
    server.on("error", rejectPort);
    // Bind loopback only (SECURITY F-001): a bare listen(0) binds 0.0.0.0/::,
    // which an IDE's port auto-forward surfaces as a transient "preview". The
    // snapshot browser is co-located (url below is already 127.0.0.1).
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const resolvedPort = typeof addr === "object" && addr ? addr.port : 0;
      if (!resolvedPort) rejectPort(new Error(bindErrorMessage));
      else resolvePort(resolvedPort);
    });
  });

  return {
    url: `http://127.0.0.1:${port}/`,
    port,
    close: () =>
      new Promise<void>((resolveClose) => {
        server.close(() => resolveClose());
      }),
  };
}
