import { createServer, request as httpRequest, type Server, type ServerResponse } from "node:http";
import { Duplex } from "node:stream";
import { createReadStream, existsSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import {
  PREVIEW_PROXY_BOX_PARAM,
  parsePreviewProxyBox,
  type PreviewProxyBox,
} from "@hyperframes/core";
import { getMimeType } from "@hyperframes/core/studio-api";
import { decodeWellFormedEscapes } from "@hyperframes/studio-server";
import { findStageProxyBox } from "./compositionViewport.js";
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
  recordProxyRequest,
  resolveProxyVariantRequest,
  PROXY_VARIANT_CONFIG,
  type ProxyVariantRequest,
} from "@hyperframes/studio-server/media-codec-map";

export interface StaticProjectServer {
  url: string;
  /** 0 when nothing listens: the server answers in this process only (see `answer`). */
  port: number;
  close: () => Promise<void>;
  /** Set when a sandbox refused listen(): the browser's requests to `url` come here instead of a socket. */
  answer?: (request: InProcessRequest) => Promise<InProcessResponse>;
}

export interface InProcessRequest {
  method: string;
  /** Path and query, e.g. `/assets/a.mp4?hf-proxy=alpha`. */
  path: string;
  headers: Record<string, string>;
}

export interface InProcessResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

/** A sandbox refuses a loopback listen() with one of these; any other bind error stays fatal. */
const REFUSED_LISTEN = new Set(["EPERM", "EACCES"]);

/** Two connected in-memory sockets: what one side writes, the other reads. */
function socketPair(): [Duplex, Duplex] {
  const sides: Duplex[] = [];
  const side = (other: () => Duplex) =>
    new Duplex({
      read() {},
      write(chunk, _encoding, done) {
        other().push(chunk);
        done();
      },
      final(done) {
        other().push(null);
        done();
      },
    });
  sides.push(
    side(() => sides[1]!),
    side(() => sides[0]!),
  );
  return [sides[0]!, sides[1]!];
}

/** Hands one request to `server` over an in-memory socket, so its handler (Range, proxies) answers unchanged. */
function answerInProcess(server: Server, request: InProcessRequest): Promise<InProcessResponse> {
  const [client, served] = socketPair();
  server.emit("connection", served);
  return new Promise((resolveAnswer, rejectAnswer) => {
    const req = httpRequest(
      {
        method: request.method,
        path: request.path,
        headers: { ...request.headers, connection: "close" },
        // No `agent`: Node uses createConnection only when no agent is given.
        createConnection: () => client as never,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("error", rejectAnswer);
        res.on("end", () => {
          const headers: Record<string, string> = {};
          for (const [name, value] of Object.entries(res.headers)) {
            if (value !== undefined && name !== "connection" && name !== "transfer-encoding")
              headers[name] = Array.isArray(value) ? value.join(", ") : value;
          }
          resolveAnswer({ status: res.statusCode ?? 500, headers, body: Buffer.concat(chunks) });
        });
      },
    );
    req.on("error", rejectAnswer);
    req.end();
  });
}

let inProcessServers = 0;
const inProcessAnswers = new Map<
  string,
  (request: InProcessRequest) => Promise<InProcessResponse>
>();

/** The in-process answer for a URL served by `serveStaticProjectHtml` when listen() was refused, else undefined. */
export function inProcessAnswer(url: string) {
  return inProcessAnswers.get(new URL(url).origin);
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

  if (size === 0) {
    res.writeHead(status, headers);
    res.end();
    return;
  }

  // Stream only the requested window instead of buffering the whole file: a
  // 1KB Range of a 50MB asset must not allocate 50MB. createReadStream reads
  // just `[start, end]` and closes its own fd on end/error. writeHead is
  // deferred to `open` so a failed open can still answer 500.
  const stream = createReadStream(filePath, { start, end });
  res.once("close", () => stream.destroy());
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
  box: PreviewProxyBox | undefined,
  autoProxy: boolean,
  rangeHeader: string | undefined,
  res: ServerResponse,
  signal: AbortSignal,
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
    recordProxyRequest();
    const proxyPath = await resolveProxy(projectDir, filePath, variant, box, { signal });
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
  const copies = new AbortController();
  const servedHtml = autoProxy
    ? await injectMediaCodecMap(
        html,
        projectDir,
        [{ html }],
        undefined,
        true,
        copies.signal,
        findStageProxyBox(html),
      )
    : html;

  // fallow-ignore-next-line complexity
  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === "/" || url === "/index.html") {
      res.writeHead(200, { "Content-Type": getMimeType("index.html") });
      res.end(servedHtml);
      return;
    }

    const queryIndex = url.indexOf("?");
    const pathOnly = queryIndex === -1 ? url : url.slice(0, queryIndex);
    const query = new URLSearchParams(queryIndex === -1 ? "" : url.slice(queryIndex + 1));
    const proxyParam = query.get("hf-proxy");
    const proxyRequest =
      proxyParam !== null && isProxyVariantRequest(proxyParam) ? proxyParam : null;
    const boxParam = query.get(PREVIEW_PROXY_BOX_PARAM);
    const proxyBox = boxParam === null ? undefined : parsePreviewProxyBox(boxParam);
    if (proxyBox === null || (proxyBox && !proxyRequest)) {
      res.writeHead(404);
      res.end();
      return;
    }

    const requestPath = decodeWellFormedEscapes(pathOnly).replace(/^\//, "");
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
            proxyBox,
            autoProxy,
            req.headers.range,
            res,
            copies.signal,
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
  }).catch((error: unknown) => {
    if (REFUSED_LISTEN.has((error as NodeJS.ErrnoException).code ?? "")) return 0;
    throw error;
  });

  if (port === 0) {
    server.removeAllListeners("error");
    // A sandbox (e.g. an agent's) may refuse listen(); the browser asks this origin and the process answers.
    const url = `http://hyperframes-${++inProcessServers}.localhost/`;
    const answer = (request: InProcessRequest) => answerInProcess(server, request);
    inProcessAnswers.set(new URL(url).origin, answer);
    return {
      url,
      port: 0,
      close: async () => {
        copies.abort();
        inProcessAnswers.delete(new URL(url).origin);
      },
      answer,
    };
  }

  return {
    url: `http://127.0.0.1:${port}/`,
    port,
    close: () =>
      new Promise<void>((resolveClose) => {
        copies.abort();
        server.close(() => resolveClose());
      }),
  };
}
