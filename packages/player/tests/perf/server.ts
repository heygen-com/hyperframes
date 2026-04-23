import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Static file server for player perf tests.
 *
 * Serves all bundles, vendor scripts, fixtures, and the embed host page from
 * a single origin so the player iframe stays same-origin. Without same-origin
 * the runtime probe in `_onIframeLoad` falls into the cross-origin catch path
 * and the `ready` event fires later (or not at all) — which would be measured
 * as a player-side regression instead of an environment artifact.
 *
 * URL routes:
 *   /                                  → host.html (default fixture: gsap-heavy)
 *   /host.html?fixture=<name>          → embed page hosting <hyperframes-player>
 *   /player/hyperframes-player.global.js
 *   /vendor/gsap.min.js
 *   /vendor/hyperframe.runtime.iife.js
 *   /fixtures/<name>/<file>            → fixture HTML + assets
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PLAYER_PKG = resolve(HERE, "../..");
const REPO_ROOT = resolve(PLAYER_PKG, "../..");

function firstExisting(candidates: string[]): string {
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return candidates[0] ?? "";
}

const PATHS = {
  player: join(PLAYER_PKG, "dist/hyperframes-player.global.js"),
  runtime: join(REPO_ROOT, "packages/core/dist/hyperframe.runtime.iife.js"),
  // bun installs gsap into the package's node_modules in workspace mode, but
  // hoists it to the repo root if multiple packages share the same version.
  // Probe both locations so the server works regardless of layout.
  gsap: firstExisting([
    join(PLAYER_PKG, "node_modules/gsap/dist/gsap.min.js"),
    join(REPO_ROOT, "node_modules/gsap/dist/gsap.min.js"),
  ]),
  fixturesDir: join(HERE, "fixtures"),
} as const;

export type ServeOptions = {
  port?: number;
  /** Disables HTTP cache so every request is a "cold" fetch. Used for cold-load scenarios. */
  noCache?: boolean;
};

export type RunningServer = {
  port: number;
  origin: string;
  stop(): Promise<void>;
};

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
};

function mimeFor(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return "application/octet-stream";
  return MIME_TYPES[path.slice(dot).toLowerCase()] ?? "application/octet-stream";
}

function buildHostHtml(fixtureName: string, width: number, height: number): string {
  const playerSrc = "/player/hyperframes-player.global.js";
  const fixtureSrc = `/fixtures/${fixtureName}/index.html`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>player perf host: ${fixtureName}</title>
    <style>
      html, body { margin: 0; padding: 0; background: #000; }
      hyperframes-player { display: block; }
    </style>
  </head>
  <body>
    <hyperframes-player
      id="player"
      src="${fixtureSrc}"
      width="${width}"
      height="${height}"
      muted
    ></hyperframes-player>
    <script>
      window.__playerReady = false;
      window.__playerReadyAt = null;
      window.__playerNavStart = performance.timeOrigin + performance.now();
      const player = document.getElementById("player");
      player.addEventListener("ready", function (event) {
        window.__playerReady = true;
        window.__playerReadyAt = performance.timeOrigin + performance.now();
        window.__playerDuration = (event.detail && event.detail.duration) || 0;
      });
      player.addEventListener("error", function (event) {
        window.__playerError = (event.detail && event.detail.message) || "unknown";
      });
    </script>
    <script src="${playerSrc}"></script>
  </body>
</html>`;
}

async function readBunFile(path: string): Promise<Response> {
  if (!existsSync(path)) {
    return new Response(`Not found: ${path}`, { status: 404 });
  }
  const file = Bun.file(path);
  return new Response(file, {
    headers: {
      "Content-Type": mimeFor(path),
    },
  });
}

function applyCacheHeaders(res: Response, noCache: boolean): Response {
  if (noCache) {
    res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.headers.set("Pragma", "no-cache");
    res.headers.set("Expires", "0");
  } else {
    res.headers.set("Cache-Control", "public, max-age=3600");
  }
  return res;
}

export function startServer(options: ServeOptions = {}): RunningServer {
  const noCache = options.noCache ?? false;

  const server = Bun.serve({
    port: options.port ?? 0,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      if (path === "/" || path === "/host.html") {
        const fixture = url.searchParams.get("fixture") || "gsap-heavy";
        const width = Number(url.searchParams.get("width") || "1920");
        const height = Number(url.searchParams.get("height") || "1080");
        const html = buildHostHtml(fixture, width, height);
        return applyCacheHeaders(
          new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } }),
          noCache,
        );
      }

      if (path === "/player/hyperframes-player.global.js") {
        return applyCacheHeaders(await readBunFile(PATHS.player), noCache);
      }

      if (path === "/vendor/hyperframe.runtime.iife.js") {
        return applyCacheHeaders(await readBunFile(PATHS.runtime), noCache);
      }

      if (path === "/vendor/gsap.min.js") {
        return applyCacheHeaders(await readBunFile(PATHS.gsap), noCache);
      }

      if (path.startsWith("/fixtures/")) {
        const rel = path.replace(/^\/fixtures\//, "");
        const filePath = join(PATHS.fixturesDir, rel);
        if (!filePath.startsWith(PATHS.fixturesDir)) {
          return new Response("Forbidden", { status: 403 });
        }
        return applyCacheHeaders(await readBunFile(filePath), noCache);
      }

      return new Response("Not found", { status: 404 });
    },
  });

  // server.port is `number | undefined` in Bun's types (undefined only for unix-socket
  // servers, which we never use). Narrow it once at startup so the rest of the perf
  // harness can rely on a numeric origin.
  const port = server.port;
  if (port === undefined) {
    throw new Error("[player-perf] Bun.serve did not assign a TCP port");
  }
  return {
    port,
    origin: `http://127.0.0.1:${port}`,
    async stop() {
      server.stop(true);
    },
  };
}
