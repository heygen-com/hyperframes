import { createServer, type ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { getMimeType } from "@hyperframes/core/studio-api";
import { resolveAutoProxy } from "./projectConfig.js";
import { injectMediaCodecMap } from "./compositionServer.js";
import {
  resolveProxy,
  ProxyCapacityError,
  ProxyTranscodeError,
} from "@hyperframes/studio-server/proxy-transcoder";
import {
  decideMediaProxyEligibility,
  isProxyVariantRequest,
  probeAssetCodec,
  resolveProxyVariantRequest,
  PROXY_VARIANT_CONFIG,
  type ProxyVariantRequest,
} from "@hyperframes/studio-server/media-codec-map";

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
  contentType = getMimeType(filePath),
) {
  const size = statSync(filePath).size;
  const headers: Record<string, string> = {
    "Content-Type": contentType,
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

/**
 * Serves an alpha-aware `?hf-proxy=` variant for a media request: 404s (no transcode attempted)
 * when auto-proxying is off or the asset isn't a video, resolves+serves the
 * cached proxy with Range support on success, and answers 502 on a
 * transcode failure (never a silent black frame). Shared by every one of
 * `serveStaticProjectHtml`'s seven callers (check/snapshot/validate/compare/
 * grade-compare/motionShot/layout) — see the KTD in
 * docs/plans/2026-07-14-002-feat-transparent-media-proxies-plan.md.
 */
/** Map a transcode failure to a response; never a silent black frame. */
function writeProxyError(err: unknown, res: ServerResponse): void {
  if (err instanceof ProxyCapacityError) {
    res.writeHead(503, { "Content-Type": "text/plain", "Retry-After": "1" });
    res.end(`Proxy transcode deferred: ${err.message}`);
    return;
  }
  if (err instanceof ProxyTranscodeError) {
    res.writeHead(502, { "Content-Type": "text/plain" });
    res.end(`Proxy transcode failed: ${err.message}`);
    return;
  }
  res.writeHead(500);
  res.end();
}

async function serveProxyRequest(
  projectDir: string,
  filePath: string,
  request: ProxyVariantRequest,
  autoProxy: boolean,
  rangeHeader: string | undefined,
  res: ServerResponse,
): Promise<void> {
  const contentType = getMimeType(filePath);
  if (!autoProxy || !contentType.startsWith("video/")) {
    res.writeHead(404);
    res.end();
    return;
  }
  try {
    const facts = await probeAssetCodec(filePath);
    const eligibility = decideMediaProxyEligibility(facts);
    if (!eligibility.eligible) {
      res.writeHead(422, { "Content-Type": "text/plain" });
      res.end(`media proxy unavailable: ${eligibility.reason}`);
      return;
    }
    if (!facts) {
      res.writeHead(422, { "Content-Type": "text/plain" });
      res.end("media proxy unavailable: unknown_codec");
      return;
    }
    const variant = resolveProxyVariantRequest(request, facts);
    if (!variant) {
      res.writeHead(422, { "Content-Type": "text/plain" });
      res.end("media proxy variant does not match asset");
      return;
    }
    const proxyPath = await resolveProxy(projectDir, filePath, variant);
    // The await above can span a whole transcode; the client may be gone.
    if (res.writableEnded || res.destroyed) return;
    serveFileWithRange(proxyPath, rangeHeader, res, PROXY_VARIANT_CONFIG[variant].contentType);
  } catch (err) {
    writeProxyError(err, res);
  }
}

export async function serveStaticProjectHtml(
  projectDir: string,
  html: string,
  bindErrorMessage = "Failed to bind local HTTP server",
  // Extra dirs to resolve non-index requests against, after projectDir (e.g. a
  // temp dir of localized remote assets).
  assetRoots: readonly string[] = [],
  // Explicit CLI --proxy/--no-proxy value. Undefined preserves the project's
  // committed hyperframes.json setting.
  autoProxyOverride?: boolean,
): Promise<StaticProjectServer> {
  const roots = [projectDir, ...assetRoots];
  // Codec-map injection lives here (not per-caller) so all seven callers of
  // this function inherit it in one place; computed once since `html` is
  // static for the lifetime of this server, not re-scanned per request.
  const autoProxy = resolveAutoProxy(projectDir, autoProxyOverride);
  const servedHtml = autoProxy ? await injectMediaCodecMap(html, projectDir, [{ html }]) : html;

  // fallow-ignore-next-line complexity
  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === "/" || url === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(servedHtml);
      return;
    }

    const queryIndex = url.indexOf("?");
    const pathOnly = queryIndex === -1 ? url : url.slice(0, queryIndex);
    const proxyParam =
      queryIndex === -1 ? null : new URLSearchParams(url.slice(queryIndex + 1)).get("hf-proxy");
    const proxyRequest =
      proxyParam !== null && isProxyVariantRequest(proxyParam) ? proxyParam : null;

    const requestPath = decodeURIComponent(pathOnly).replace(/^\//, "");
    for (const root of roots) {
      const filePath = resolve(root, requestPath);
      const rel = relative(root, filePath);
      if (rel.startsWith("..") || isAbsolute(rel)) continue; // traversal guard; try next root
      if (existsSync(filePath)) {
        if (proxyRequest) {
          void serveProxyRequest(
            projectDir,
            filePath,
            proxyRequest,
            autoProxy,
            req.headers.range,
            res,
          );
        } else {
          serveFileWithRange(filePath, req.headers.range, res);
        }
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
