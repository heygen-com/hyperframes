// Shared scaffolding for the lightweight composition servers used by `play` and
// `present`: locating the built runtime/player/slideshow bundles, serving
// composition asset files, and binding to a free port.
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { getMimeType, openRangeEnd, refuseServiceWorkerScripts } from "@hyperframes/studio-server";
import { stripSdrPngColourTags } from "@hyperframes/core/compiler/png-colour-tags";
import { injectTagsAtHeadStart } from "@hyperframes/core/compiler/html-document";
import {
  PREVIEW_FOR_ANOTHER_SITE_META,
  dropServiceWorkers,
} from "@hyperframes/core/studio-preview-mark";
import {
  PREVIEW_ALLOWED_HOSTS_ENV,
  previewAllowedHostsFromEnv,
  documentFromAnotherSite,
  proxyWorkFromAnotherSite,
  wildcardBindHostAllowed,
} from "@hyperframes/studio-server/request-identity";
import { SAME_ORIGIN_FRAMING_HEADERS } from "@hyperframes/engine";
import type { Context, Hono } from "hono";

/**
 * `window.__HF_MEDIA_CODEC_MAP__` injection + proxy pre-warm for HTML served
 * by `play` and the static project server. Re-exported from the
 * single shared implementation in
 * `packages/studio-server/src/helpers/mediaProxyPreview.ts` (also used by the
 * studio preview route) so injection behavior cannot drift between surfaces.
 */
export { injectMediaCodecMapIntoHtml as injectMediaCodecMap } from "@hyperframes/studio-server/media-proxy-preview";

/** Minimal surface of a listening server (satisfied by @hono/node-server's ServerType). */
interface PortBindable {
  listen(port: number): unknown;
  once(event: "listening" | "error", listener: (err?: NodeJS.ErrnoException) => void): unknown;
  removeListener(
    event: "listening" | "error",
    listener: (err?: NodeJS.ErrnoException) => void,
  ): unknown;
}

function helperDir(): string {
  // fileURLToPath (not URL.pathname) so the Windows "/D:/..." leading-slash form
  // doesn't break the bundle-path resolution below.
  return dirname(fileURLToPath(import.meta.url));
}

export function resolveRuntimePath(): string | null {
  const d = helperDir();
  const candidates = [
    resolve(d, "hyperframe.runtime.iife.js"),
    resolve(d, "hyperframe-runtime.js"),
    resolve(d, "..", "hyperframe-runtime.js"),
    // Monorepo dev: src/<dir>/ → src/ → cli/ → packages/ then into core/dist/
    resolve(d, "..", "..", "..", "core", "dist", "hyperframe.runtime.iife.js"),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

export function resolvePlayerPath(): string | null {
  const d = helperDir();
  const candidates = [
    resolve(d, "..", "..", "..", "player", "dist", "hyperframes-player.global.js"),
    resolve(d, "hyperframes-player.global.js"),
    resolve(d, "..", "hyperframes-player.global.js"),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

export function resolveSlideshowPath(): string | null {
  const d = helperDir();
  const candidates = [
    resolve(d, "..", "..", "..", "player", "dist", "slideshow", "hyperframes-slideshow.global.js"),
    resolve(d, "hyperframes-slideshow.global.js"),
    resolve(d, "..", "hyperframes-slideshow.global.js"),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

/**
 * Inject the runtime <script> at the top of the composition's <head>, ahead of
 * every author script. Compositions read `window.__hyperframes.getVariables()`
 * from an inline script at init, so a runtime appended before </body> is not
 * loaded yet at that point and the documented API is undefined. The compiled
 * render path hoists the runtime into <head> the same way; this keeps the
 * served `play` document in parity with it. Placement falls back to before
 * <body>, then to the top of the document, for fragments without a <head>.
 */
export function injectRuntime(html: string): string {
  return injectTagsAtHeadStart(html, `<script src="/runtime.js"></script>`);
}

export function assetContentType(filePath: string): string {
  return getMimeType(filePath);
}

/** `body` with a content validator, or a 304 when the browser already holds these bytes. */
export function revalidatedResponse(
  body: string,
  contentType: string,
  ifNoneMatch: string | undefined,
): Response {
  const etag = `"${createHash("sha256").update(body).digest("base64url").slice(0, 27)}"`;
  const headers = { "Content-Type": contentType, "Cache-Control": "no-cache", ETag: etag };
  if (ifNoneMatch === etag) return new Response(null, { status: 304, headers });
  return new Response(body, { status: 200, headers });
}

function untaggedPngBody(filePath: string, contentType: string): Buffer | null {
  return contentType === "image/png" ? stripSdrPngColourTags(readFileSync(filePath)) : null;
}

/**
 * Hono-native Range/206 response for a file on disk, mirroring the inline
 * Range logic in `packages/studio-server/src/routes/preview.ts`'s static
 * asset route. `staticProjectServer.ts`'s raw-`node:http` counterpart is
 * `serveFileWithRange`; this version converts Node's bounded file stream to a
 * Fetch API stream for Hono without allocating the whole media/proxy file.
 */
export function buildRangeResponse(
  filePath: string,
  contentType: string,
  rangeHeader: string | undefined,
  ifNoneMatch?: string,
): Response {
  const { size, mtimeMs } = statSync(filePath);
  const last = size - 1;
  // Always revalidated, so an edited asset is seen; unchanged bytes cost a 304, not a refetch.
  const cache = {
    "Cache-Control": "no-cache",
    ETag: `"${mtimeMs.toString(36)}-${size.toString(36)}"`,
  };
  if (ifNoneMatch === cache.ETag) return new Response(null, { status: 304, headers: cache });
  const untagged = untaggedPngBody(filePath, contentType);
  if (untagged) {
    const headers = {
      ...cache,
      "Content-Type": contentType,
      "Content-Length": `${untagged.length}`,
    };
    return new Response(new Uint8Array(untagged), { status: 200, headers });
  }
  const match = rangeHeader ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim()) : null;

  const body = (start: number, end: number): ReadableStream<Uint8Array> | null =>
    size === 0
      ? null
      : (Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream<Uint8Array>);

  if (!match) {
    return new Response(body(0, last), {
      status: 200,
      headers: {
        ...cache,
        "Content-Type": contentType,
        "Accept-Ranges": "bytes",
        "Content-Length": String(size),
      },
    });
  }

  const hasStart = match[1] !== "";
  const start = hasStart ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = !hasStart
    ? last
    : match[2] !== ""
      ? Math.min(Number(match[2]), last)
      : openRangeEnd(start, last, contentType);
  if (start > end || start > last) {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" },
    });
  }

  return new Response(body(start, end), {
    status: 206,
    headers: {
      ...cache,
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": String(end - start + 1),
    },
  });
}

/**
 * The server listens on every interface, so every route answers only loopback,
 * this machine's own addresses and names, or a host named in
 * HYPERFRAMES_PREVIEW_ALLOWED_HOSTS. A browser cannot forge Host, which keeps a
 * rebound page name from reading project files.
 */
export function refuseUnknownHosts(app: Hono): void {
  const allowedHosts = previewAllowedHostsFromEnv();
  app.use(async function refuseUnknownHost(c, next) {
    const host = c.req.header("host") ?? new URL(c.req.url).host;
    if (wildcardBindHostAllowed(host, allowedHosts)) return next();
    return c.json(
      {
        error:
          `forbidden: host "${host}" is not allowed. ` +
          `Set ${PREVIEW_ALLOWED_HOSTS_ENV}=${host} to allow it ` +
          `(comma separated for several hosts).`,
      },
      403,
    );
  });
}

function withoutValidators(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.delete("if-none-match");
  headers.delete("if-modified-since");
  return new Request(request, { headers });
}

async function markDocumentForAnotherSite(c: Context): Promise<void> {
  if (c.res.status !== 200 || !c.res.headers.get("content-type")?.startsWith("text/html")) return;
  const headers = new Headers(c.res.headers);
  headers.delete("content-length");
  headers.delete("etag");
  const marked = injectTagsAtHeadStart(
    await c.res.text(),
    `<meta name="${PREVIEW_FOR_ANOTHER_SITE_META}">`,
  );
  c.res = undefined;
  c.res = new Response(marked, { status: 200, headers });
}

/** Files under `path` that another site loads come back sandboxed, and documents marked so their runtime offers that site no editing port. */
export function sandboxForAnotherSite(app: Hono, path: string): void {
  app.use(path, refuseServiceWorkerScripts);
  app.use(path, async function sandboxAnotherSiteLoad(c, next) {
    const anotherSite = documentFromAnotherSite({
      fetchSite: c.req.header("sec-fetch-site"),
      host: c.req.header("host") ?? new URL(c.req.url).host,
      referer: c.req.header("referer"),
    });
    if (anotherSite) c.req.raw = withoutValidators(c.req.raw);
    await next();
    c.header("Vary", "Sec-Fetch-Site, Referer", { append: true });
    if (!anotherSite) return;
    c.header("Content-Security-Policy", "sandbox allow-scripts");
    await markDocumentForAnotherSite(c);
  });
}

/** A `?hf-proxy=` copy runs ffmpeg on this machine, so another site may not ask for one. */
export function refuseProxyWorkForAnotherSite(app: Hono, path: string): void {
  app.use(path, async function refuseAnotherSiteProxyWork(c, next) {
    const anotherSite = proxyWorkFromAnotherSite({
      fetchSite: c.req.header("sec-fetch-site"),
      host: c.req.header("host") ?? new URL(c.req.url).host,
      referer: c.req.header("referer"),
    });
    if (anotherSite && c.req.query("hf-proxy") !== undefined)
      return c.text("Forbidden: media proxy requested by another site", 403);
    await next();
  });
}

/** The runtime hands an editing port to its parent frame, so only this server's own pages may frame what it serves. */
export function refuseFramingByOtherSites(app: Hono): void {
  app.use(async function sameOriginFramingOnly(c, next) {
    await next();
    for (const [name, value] of Object.entries(SAME_ORIGIN_FRAMING_HEADERS)) {
      c.res.headers.append(name, value);
    }
  });
}

/**
 * Bind `server` to the first free port at or after `startPort` (scanning up to
 * 10 ports). Returns the bound port. Rejects if all candidates are in use or on
 * a non-EADDRINUSE error.
 */
export async function listenOnFreePort(server: PortBindable, startPort: number): Promise<number> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const port = startPort + attempt;
    try {
      await new Promise<void>((res, rej) => {
        const onErr = (err?: NodeJS.ErrnoException) => {
          server.removeListener("listening", onOk);
          rej(err ?? new Error("server error"));
        };
        const onOk = () => {
          server.removeListener("error", onErr);
          res();
        };
        server.once("error", onErr);
        server.once("listening", onOk);
        server.listen(port);
      });
      return port;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") continue;
      throw err;
    }
  }
  throw new Error(`No free port found in [${startPort}, ${startPort + 9}]`);
}

export function scriptsAfterWorkersDropped(srcs: readonly string[]): string {
  const add =
    'var s=document.createElement("script");s.src=src;s.async=false;document.head.append(s)';
  const list = JSON.stringify(srcs).replace(
    /[<>/\u2028\u2029]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  const load = `function(){${list}.forEach(function(src){${add}})}`;
  return `<script>(${dropServiceWorkers.toString()})().then(${load});</script>`;
}
