import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { existsSync, readFileSync } from "node:fs";

export const examples: Example[] = [
  ["Play the current project", "hyperframes play"],
  ["Play a specific project directory", "hyperframes play ./my-video"],
  ["Use a custom port", "hyperframes play --port 8080"],
  ["Start without opening the browser", "hyperframes play --no-open"],
  ["Open with a specific browser", "hyperframes play --browser-path /usr/bin/chromium"],
  [
    "Open with CDP enabled (requires browser path + isolated profile)",
    "hyperframes play --browser-path /usr/bin/chromium --user-data-dir /tmp/hf-profile --remote-debugging-port 9222",
  ],
  [
    "Disable auto-proxying of browser-hostile video codecs (HEVC, ProRes, AV1)",
    "hyperframes play --no-proxy",
  ],
];
import { resolve } from "node:path";
import type { Hono } from "hono";
import * as clack from "@clack/prompts";
import { c } from "../ui/colors.js";
import { resolveProject, type ProjectDir } from "../utils/project.js";
import { resolveAutoProxy } from "../utils/projectConfig.js";
import {
  openBrowser,
  parseRemoteDebuggingPort,
  validateRemoteDebuggingPortDeps,
} from "../utils/openBrowser.js";
import {
  resolveRuntimePath,
  resolvePlayerPath,
  listenOnFreePort,
  injectRuntime,
  injectMediaCodecMap,
  buildRangeResponse,
  assetContentType,
} from "../utils/compositionServer.js";
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
} from "@hyperframes/studio-server/media-codec-map";

export default defineCommand({
  meta: { name: "play", description: "Play a composition in a lightweight browser player" },
  args: {
    dir: { type: "positional", description: "Project directory", required: false },
    port: { type: "string", description: "Port to run the player server on", default: "3003" },
    open: {
      type: "boolean",
      default: true,
      description: "Open browser automatically",
    },
    "browser-path": {
      type: "string",
      description: "Path to the browser executable to open",
    },
    "user-data-dir": {
      type: "string",
      description: "Chromium-compatible user data directory (requires --browser-path)",
    },
    "remote-debugging-port": {
      type: "string",
      description: "Chromium remote debugging port (requires --browser-path and --user-data-dir)",
    },
    proxy: {
      type: "boolean",
      description:
        "Auto-transcode browser-hostile video codecs (HEVC, ProRes, AV1) to a cached authoring proxy for preview (default: on; overrides hyperframes.json's media.autoProxy)",
      negativeDescription: "Disable auto-proxying of browser-hostile video codecs",
    },
  },
  async run({ args }) {
    const project = resolveProject(args.dir);
    const startPort = parseInt(args.port ?? "3003", 10);

    // Validation: --user-data-dir requires --browser-path
    if (args["user-data-dir"] && !args["browser-path"]) {
      clack.log.error("--user-data-dir requires --browser-path");
      process.exitCode = 1;
      return;
    }
    // Validation: --remote-debugging-port deps
    const depsError = validateRemoteDebuggingPortDeps({
      browserPath: args["browser-path"] as string | undefined,
      userDataDir: args["user-data-dir"] as string | undefined,
      remoteDebuggingPort: args["remote-debugging-port"] as string | undefined,
    });
    if (depsError) {
      clack.log.error(depsError);
      process.exitCode = 1;
      return;
    }
    // Parse --remote-debugging-port before any server setup so an invalid value
    // exits cleanly instead of leaving an orphan listening socket behind.
    let remoteDebuggingPort: number | undefined;
    try {
      remoteDebuggingPort = parseRemoteDebuggingPort(
        args["remote-debugging-port"] as string | undefined,
      );
    } catch (err) {
      clack.log.error((err as Error).message);
      process.exitCode = 1;
      return;
    }

    // Resolve runtime path — same logic as studioServer.ts
    const runtimePath = resolveRuntimePath();
    if (!runtimePath) {
      clack.log.error("HyperFrames runtime not found. Run `bun run build` first.");
      process.exitCode = 1;
      return;
    }

    // Resolve player path
    const playerPath = resolvePlayerPath();
    if (!playerPath) {
      clack.log.error(
        "@hyperframes/player not found. Run `bun run --cwd packages/player build` first.",
      );
      process.exitCode = 1;
      return;
    }

    const { Hono } = await import("hono");
    const { createAdaptorServer } = await import("@hono/node-server");

    const app = new Hono();

    // Serve the player JS
    app.get("/player.js", (ctx) => {
      return ctx.body(readFileSync(playerPath, "utf-8"), 200, {
        "Content-Type": "application/javascript",
        "Cache-Control": "no-cache",
      });
    });

    // Serve the runtime JS
    app.get("/runtime.js", (ctx) => {
      return ctx.body(readFileSync(runtimePath, "utf-8"), 200, {
        "Content-Type": "application/javascript",
        "Cache-Control": "no-cache",
      });
    });

    const autoProxy = resolveAutoProxy(project.dir, args.proxy as boolean | undefined);
    await registerCompositionRoute(app, project, autoProxy);

    // Main page — the player wrapper
    app.get("/", (ctx) => {
      return ctx.html(buildPlayerPage(project.name));
    });

    clack.intro(c.bold("hyperframes play"));
    const s = clack.spinner();
    s.start("Starting player...");

    const server = createAdaptorServer({ fetch: app.fetch });
    const actualPort = await listenOnFreePort(server, startPort);

    const url = `http://localhost:${actualPort}`;
    s.stop(c.success("Player running"));
    console.log();
    if (actualPort !== startPort) {
      console.log(`  ${c.warn(`Port ${startPort} is in use, using ${actualPort} instead`)}`);
    }
    console.log(`  ${c.dim("Project")}   ${c.accent(project.name)}`);
    console.log(`  ${c.dim("Player")}    ${c.accent(url)}`);
    console.log();
    console.log(`  ${c.dim("Press Ctrl+C to stop")}`);
    console.log();

    if (args.open) {
      void openBrowser(url, {
        browserPath: args["browser-path"] as string | undefined,
        userDataDir: args["user-data-dir"] as string | undefined,
        remoteDebuggingPort,
      });
    }

    return new Promise<void>(() => {});
  },
});

/**
 * Registers the `/composition/*` route: serves composition HTML (runtime +
 * `__HF_MEDIA_CODEC_MAP__` injected) and asset files, with byte-Range support
 * (`play` previously did a whole-file `readFileSync`, so seeking/duration
 * probing on media elements never worked) and a `?hf-proxy=` branch that
 * serves the alpha-aware authoring proxy for a browser-hostile video asset
 * (per docs/plans/2026-07-14-002-feat-transparent-media-proxies-plan.md,
 * unit U4). Exported standalone (rather than inlined in `run()`) so tests can
 * exercise it via `app.request(...)` without booting a real HTTP listener,
 * `clack` UI, or `openBrowser`.
 */
export async function registerCompositionRoute(
  app: Hono,
  project: ProjectDir,
  autoProxy: boolean,
): Promise<void> {
  const { isSafePath } = await import("@hyperframes/core/studio-api");

  // fallow-ignore-next-line complexity
  app.get("/composition/*", async (ctx) => {
    const reqPath = ctx.req.path.replace("/composition/", "");
    const filePath = resolve(project.dir, reqPath);

    // Security: don't allow path traversal outside project dir. isSafePath
    // canonicalizes symlinks and applies a trailing-separator guard, so neither
    // an in-project symlink to an external target nor a sibling dir whose name
    // shares the project-dir prefix (e.g. `<dir>-evil`) can escape.
    if (!isSafePath(project.dir, filePath)) return ctx.text("Forbidden", 403);
    if (!existsSync(filePath)) return ctx.text("Not found", 404);

    // HTML gets the runtime + codec-map injected; other assets pass through.
    if (filePath.endsWith(".html")) {
      let html = injectRuntime(readFileSync(filePath, "utf-8"));
      if (autoProxy) {
        html = await injectMediaCodecMap(html, project.dir, [{ html, compSrcPath: reqPath }]);
      }
      return ctx.html(html);
    }

    const contentType = assetContentType(filePath);
    const proxyParam = ctx.req.query("hf-proxy");
    if (proxyParam !== undefined && isProxyVariantRequest(proxyParam)) {
      // Opt-out (or a non-video asset) 404s the param without attempting a
      // transcode; a missing asset already 404'd above.
      if (!autoProxy || !contentType.startsWith("video/")) return ctx.text("Not found", 404);
      try {
        const facts = await probeAssetCodec(filePath);
        const eligibility = decideMediaProxyEligibility(facts);
        if (!eligibility.eligible) {
          return ctx.text(`Media proxy unavailable: ${eligibility.reason}`, 422);
        }
        if (!facts) return ctx.text("Media proxy unavailable: unknown_codec", 422);
        const proxyVariant = resolveProxyVariantRequest(proxyParam, facts);
        if (!proxyVariant) {
          return ctx.text("Media proxy variant does not match asset", 422);
        }
        const proxyPath = await resolveProxy(project.dir, filePath, proxyVariant);
        return buildRangeResponse(
          proxyPath,
          PROXY_VARIANT_CONFIG[proxyVariant].contentType,
          ctx.req.header("Range"),
        );
      } catch (err) {
        if (err instanceof ProxyCapacityError) {
          return ctx.text(`Proxy transcode deferred: ${err.message}`, 503, {
            "Retry-After": "1",
          });
        }
        if (err instanceof ProxyTranscodeError) {
          return ctx.text(`Proxy transcode failed: ${err.message}`, 502);
        }
        throw err;
      }
    }

    return buildRangeResponse(filePath, contentType, ctx.req.header("Range"));
  });
}

function buildPlayerPage(projectName: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${projectName} — HyperFrames Player</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        background: #0a0a0a; color: #fff;
        font-family: system-ui, -apple-system, sans-serif;
        height: 100vh; display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        padding: 24px;
      }
      .player-wrap {
        width: 100%; max-width: 1280px; aspect-ratio: 16/9;
        border-radius: 8px; overflow: hidden;
      }
      hyperframes-player { width: 100%; height: 100%; }
      .info {
        margin-top: 16px; font-size: 12px; color: #444;
        font-family: monospace;
      }
    </style>
  </head>
  <body>
    <div class="player-wrap">
      <hyperframes-player src="/composition/index.html" controls muted></hyperframes-player>
    </div>
    <div class="info">${projectName} — hyperframes play</div>
    <script src="/player.js"></script>
  </body>
</html>`;
}
