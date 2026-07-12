// Shared scaffolding for the lightweight composition servers used by `play` and
// `present`: locating the built runtime/player/slideshow bundles, serving
// composition asset files, and binding to a free port.
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

const ASSET_CONTENT_TYPES: Record<string, string> = {
  js: "application/javascript",
  mjs: "application/javascript",
  css: "text/css",
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
};

export function assetContentType(filePath: string): string {
  const ext = filePath.split(".").pop() ?? "";
  // Own-property check so an ext like "__proto__" can't resolve to Object.prototype.
  const type = Object.hasOwn(ASSET_CONTENT_TYPES, ext) ? ASSET_CONTENT_TYPES[ext] : undefined;
  return type ?? "application/octet-stream";
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
