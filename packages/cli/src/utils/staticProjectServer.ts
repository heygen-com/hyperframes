import { createServer, type ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
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
  const body = readFileSync(filePath);
  const headers: Record<string, string> = {
    "Content-Type": getMimeType(filePath),
    "Accept-Ranges": "bytes",
  };

  const match = rangeHeader ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim()) : null;
  if (!match) {
    res.writeHead(200, { ...headers, "Content-Length": String(body.length) });
    res.end(body);
    return;
  }

  // Resolve `bytes=start-end`, including the open-ended (`start-`) and
  // suffix (`-N`, last N bytes) forms.
  const last = body.length - 1;
  const hasStart = match[1] !== "";
  const start = hasStart ? Number(match[1]) : Math.max(0, body.length - Number(match[2]));
  const end = !hasStart ? last : match[2] !== "" ? Math.min(Number(match[2]), last) : last;

  if (start > end || start > last) {
    res.writeHead(416, { ...headers, "Content-Range": `bytes */${body.length}` });
    res.end();
    return;
  }

  res.writeHead(206, {
    ...headers,
    "Content-Range": `bytes ${start}-${end}/${body.length}`,
    "Content-Length": String(end - start + 1),
  });
  res.end(body.subarray(start, end + 1));
}

export async function serveStaticProjectHtml(
  projectDir: string,
  html: string,
  bindErrorMessage = "Failed to bind local HTTP server",
): Promise<StaticProjectServer> {
  // fallow-ignore-next-line complexity
  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === "/" || url === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
      return;
    }

    const filePath = resolve(projectDir, decodeURIComponent(url).replace(/^\//, ""));
    const rel = relative(projectDir, filePath);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (existsSync(filePath)) {
      serveFileWithRange(filePath, req.headers.range, res);
      return;
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
