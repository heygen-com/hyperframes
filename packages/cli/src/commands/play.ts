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
];
import { resolve, dirname } from "node:path";
import * as clack from "@clack/prompts";
import { c } from "../ui/colors.js";
import { resolveProject } from "../utils/project.js";
import {
  openBrowser,
  parseRemoteDebuggingPort,
  validateRemoteDebuggingPortDeps,
} from "../utils/openBrowser.js";

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
    const { isSafePath } = await import("@hyperframes/core/studio-api");

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

    // Serve composition files (HTML + assets)
    app.get("/composition/*", async (ctx) => {
      const reqPath = ctx.req.path.replace("/composition/", "");
      const filePath = resolve(project.dir, reqPath);

      // Security: don't allow path traversal outside project dir. isSafePath
      // canonicalizes symlinks and applies a trailing-separator guard, so neither
      // an in-project symlink to an external target nor a sibling dir whose name
      // shares the project-dir prefix (e.g. `<dir>-evil`) can escape.
      if (!isSafePath(project.dir, filePath)) return ctx.text("Forbidden", 403);
      if (!existsSync(filePath)) return ctx.text("Not found", 404);

      const content = readFileSync(filePath, "utf-8");

      // For the main HTML, inject the runtime script before </body>
      if (filePath.endsWith(".html")) {
        const injected = injectRuntime(content);
        return ctx.html(injected);
      }

      // Guess content type for other files
      const ext = filePath.split(".").pop() ?? "";
      const types: Record<string, string> = {
        js: "application/javascript",
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
      return ctx.body(readFileSync(filePath), 200, {
        "Content-Type": types[ext] ?? "application/octet-stream",
      });
    });

    // Main page — the player wrapper
    app.get("/", (ctx) => {
      return ctx.html(buildPlayerPage(project.name));
    });

    clack.intro(c.bold("hyperframes play"));
    const s = clack.spinner();
    s.start("Starting player...");

    const server = createAdaptorServer({ fetch: app.fetch });
    let actualPort = startPort;

    for (let attempt = 0; attempt < 10; attempt++) {
      const port = startPort + attempt;
      try {
        await new Promise<void>((res, rej) => {
          const onErr = (err: NodeJS.ErrnoException) => {
            server.removeListener("listening", onOk);
            rej(err);
          };
          const onOk = () => {
            server.removeListener("error", onErr);
            res();
          };
          server.once("error", onErr);
          server.once("listening", onOk);
          server.listen(port);
        });
        actualPort = port;
        break;
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") continue;
        throw err;
      }
    }

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

function commandDir(): string {
  return dirname(new URL(import.meta.url).pathname);
}

function resolveRuntimePath(): string | null {
  const d = commandDir();
  const candidates = [
    // Bundled with CLI dist
    resolve(d, "hyperframe-runtime.js"),
    resolve(d, "..", "hyperframe-runtime.js"),
    // Monorepo dev: commands/ → src/ → cli/ → packages/ then into core/dist/
    resolve(d, "..", "..", "..", "core", "dist", "hyperframe.runtime.iife.js"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function resolvePlayerPath(): string | null {
  const d = commandDir();
  const candidates = [
    // Monorepo dev: commands/ → src/ → cli/ → packages/ then into player/dist/
    resolve(d, "..", "..", "..", "player", "dist", "hyperframes-player.global.js"),
    // Bundled with CLI dist
    resolve(d, "hyperframes-player.global.js"),
    resolve(d, "..", "hyperframes-player.global.js"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function injectRuntime(html: string): string {
  // Inject runtime script before closing </body> or at the end
  const runtimeTag = `<script src="/runtime.js"></script>`;
  if (html.includes("</body>")) {
    return html.replace("</body>", `${runtimeTag}\n</body>`);
  }
  return html + `\n${runtimeTag}`;
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
