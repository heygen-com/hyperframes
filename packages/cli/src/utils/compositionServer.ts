// Shared scaffolding for the lightweight composition servers used by `play` and
// `present`: locating the built runtime/player/slideshow bundles, serving
// composition asset files, and binding to a free port.
import { createReadStream, existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { getMimeType } from "@hyperframes/studio-server";

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

/** Inject the runtime <script> into composition HTML before </body> (or at the end). */
export function injectRuntime(html: string): string {
  const runtimeTag = `<script src="/runtime.js"></script>`;
  return html.includes("</body>")
    ? html.replace("</body>", `${runtimeTag}\n</body>`)
    : html + `\n${runtimeTag}`;
}

export function assetContentType(filePath: string): string {
  return getMimeType(filePath);
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
): Response {
  const size = statSync(filePath).size;
  const last = size - 1;
  const match = rangeHeader ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim()) : null;

  const body = (start: number, end: number): ReadableStream<Uint8Array> | null =>
    size === 0
      ? null
      : (Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream<Uint8Array>);

  if (!match) {
    return new Response(body(0, last), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Accept-Ranges": "bytes",
        "Content-Length": String(size),
      },
    });
  }

  const hasStart = match[1] !== "";
  const start = hasStart ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = !hasStart ? last : match[2] !== "" ? Math.min(Number(match[2]), last) : last;
  if (start > end || start > last) {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" },
    });
  }

  return new Response(body(start, end), {
    status: 206,
    headers: {
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": String(end - start + 1),
    },
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
