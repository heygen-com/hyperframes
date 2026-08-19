import { setCommandExitCode } from "../utils/commandResult.js";
import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { existsSync, readFileSync } from "node:fs";

export const examples: Example[] = [
  ["Present the current deck", "hyperframes present"],
  ["Present a specific project directory", "hyperframes present ./my-deck"],
  ["Use a custom port", "hyperframes present --port 8080"],
  ["Start without opening the browser", "hyperframes present --no-open"],
  ["Open with a specific browser", "hyperframes present --browser-path /usr/bin/chromium"],
];
import { resolve } from "node:path";
import * as clack from "@clack/prompts";
import { c } from "../ui/colors.js";
import { resolveProject } from "../utils/project.js";
import {
  openBrowser,
  parseRemoteDebuggingPort,
  validateRemoteDebuggingPortDeps,
} from "../utils/openBrowser.js";
import {
  resolvePlayerPath,
  resolveSlideshowPath,
  listenOnFreePort,
  assetContentType,
} from "../utils/compositionServer.js";

export default defineCommand({
  meta: {
    name: "present",
    description: "Serve a slideshow deck and open it in presenter mode (with audience sync)",
  },
  args: {
    dir: { type: "positional", description: "Project directory", required: false },
    port: { type: "string", description: "Port to run the present server on", default: "3004" },
    open: { type: "boolean", default: true, description: "Open browser automatically" },
    "browser-path": { type: "string", description: "Path to the browser executable to open" },
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
    const startPort = parseInt(args.port ?? "3004", 10);

    if (args["user-data-dir"] && !args["browser-path"]) {
      clack.log.error("--user-data-dir requires --browser-path");
      setCommandExitCode(1);
      return;
    }
    const depsError = validateRemoteDebuggingPortDeps({
      browserPath: args["browser-path"] as string | undefined,
      userDataDir: args["user-data-dir"] as string | undefined,
      remoteDebuggingPort: args["remote-debugging-port"] as string | undefined,
    });
    if (depsError) {
      clack.log.error(depsError);
      setCommandExitCode(1);
      return;
    }
    let remoteDebuggingPort: number | undefined;
    try {
      remoteDebuggingPort = parseRemoteDebuggingPort(
        args["remote-debugging-port"] as string | undefined,
      );
    } catch (err) {
      clack.log.error((err as Error).message);
      setCommandExitCode(1);
      return;
    }

    const playerPath = resolvePlayerPath();
    const slideshowPath = resolveSlideshowPath();
    if (!playerPath || !slideshowPath) {
      clack.log.error(
        "@hyperframes/player not found. Run `bun run --cwd packages/player build` first.",
      );
      setCommandExitCode(1);
      return;
    }

    // The deck must carry a slideshow island; the presenter view is meaningless
    // without one. Extract it here so we can inline it into the wrapper page.
    const indexHtml = readFileSync(project.indexPath, "utf-8");
    const { slideshowIslandRegex } = await import("@hyperframes/core/slideshow");
    const islandMatch = slideshowIslandRegex("i").exec(indexHtml);
    if (!islandMatch?.[1]) {
      clack.log.error(
        `No slideshow island found in ${project.indexPath}. ` +
          `Add a <script type="application/hyperframes-slideshow+json"> block — see /hyperframes (slideshow).`,
      );
      setCommandExitCode(1);
      return;
    }
    const islandJson = islandMatch[1].trim();
    // Malformed island JSON makes the slideshow component render no chrome at
    // all (no Present control, P key dead) — fail loudly here instead.
    try {
      JSON.parse(islandJson);
    } catch (err) {
      clack.log.error(
        `Slideshow island in ${project.indexPath} is not valid JSON: ${(err as Error).message}`,
      );
      setCommandExitCode(1);
      return;
    }

    const { Hono } = await import("hono");
    const { createAdaptorServer } = await import("@hono/node-server");
    const { isSafePath } = await import("@hyperframes/core/studio-api");

    const app = new Hono();

    app.get("/player.js", (ctx) =>
      ctx.body(readFileSync(playerPath, "utf-8"), 200, {
        "Content-Type": "application/javascript",
        "Cache-Control": "no-cache",
      }),
    );
    app.get("/slideshow.js", (ctx) =>
      ctx.body(readFileSync(slideshowPath, "utf-8"), 200, {
        "Content-Type": "application/javascript",
        "Cache-Control": "no-cache",
      }),
    );
    // Serve composition files raw. Slideshow compositions self-drive their own
    // timelines (no engine runtime injected) — the same model demo.html / the
    // standalone harness use; injecting a runtime would leave the composition
    // engine-paused and blank.
    app.get("/composition/*", (ctx) => {
      const reqPath = ctx.req.path.replace("/composition/", "");
      const filePath = resolve(project.dir, reqPath);
      // Security: canonicalizes symlinks + guards the trailing separator so neither
      // an in-project symlink nor a sibling dir sharing the prefix can escape.
      if (!isSafePath(project.dir, filePath)) return ctx.text("Forbidden", 403);
      if (!existsSync(filePath)) return ctx.text("Not found", 404);
      if (filePath.endsWith(".html")) return ctx.html(readFileSync(filePath, "utf-8"));
      return ctx.body(readFileSync(filePath), 200, { "Content-Type": assetContentType(filePath) });
    });

    // Both the presenter window and the audience window (opened by present() with
    // ?mode=audience) load this same page; the component reads the mode from the URL.
    app.get("/", (ctx) => ctx.html(buildPresentPage(project.name, islandJson)));

    clack.intro(c.bold("hyperframes present"));
    const s = clack.spinner();
    s.start("Starting presenter server...");

    const server = createAdaptorServer({ fetch: app.fetch });
    const actualPort = await listenOnFreePort(server, startPort);

    const url = `http://localhost:${actualPort}`;
    s.stop(c.success("Presenter server running"));
    console.log();
    if (actualPort !== startPort) {
      console.log(`  ${c.warn(`Port ${startPort} is in use, using ${actualPort} instead`)}`);
    }
    console.log(`  ${c.dim("Deck")}      ${c.accent(project.name)}`);
    console.log(`  ${c.dim("Present")}   ${c.accent(url)}`);
    console.log();
    console.log(
      `  ${c.dim("Click the Present control (or press P) to open the audience display.")}`,
    );
    console.log(
      `  ${c.dim('Google Meet: share the AUDIENCE tab ("Share screen → A tab"), not a window or your whole screen.')}`,
    );
    console.log(
      `  ${c.dim("Zoom desktop: drag the audience tab into its own window and share that window (keep it at least partly visible).")}`,
    );
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

function buildPresentPage(projectName: string, islandJson: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escHtml(projectName)} — Presenter</title>
    <script>
      // Retitle the audience tab so the two tabs are distinguishable in the
      // browser tab strip and in Meet's "Share a tab" picker.
      if (new URLSearchParams(location.search).get("mode") === "audience") {
        document.title = ${JSON.stringify(projectName).replace(/</g, "\\u003c")} + " — Audience";
      }
    </script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { height: 100%; background: #0a0a0a; overflow: hidden; }
      hyperframes-slideshow { display: block; position: relative; width: 100vw; height: 100vh; }
      hyperframes-player { position: absolute; inset: 0; }
    </style>
    <script src="/player.js"></script>
    <script src="/slideshow.js"></script>
  </head>
  <body>
    <hyperframes-slideshow tabindex="0" sound>
      <hyperframes-player interactive src="/composition/index.html"></hyperframes-player>
      <script type="application/hyperframes-slideshow+json">
${islandJson}
      </script>
    </hyperframes-slideshow>
    <!-- Present CTA lives in the component's nav cluster (data-hf-present, plus
         the P key) — no page-level button, or we'd render two Present CTAs. -->
    <script>
      // Sound effects play HERE, in the parent document. The composition runs in the
      // player's iframe, which is autoplay-blocked without its own user gesture; the
      // slideshow posts { type: "hf-sfx", name } to the parent on nav, and we play the
      // matching clip from the deck's sfx/ folder (served under /composition/sfx/).
      // Runs in both presenter and audience windows. Missing clips fail silently.
      (function () {
        var clips = {
          advance: new Audio("/composition/sfx/advance.mp3"),
          fragment: new Audio("/composition/sfx/fragment.mp3"),
          "branch-enter": new Audio("/composition/sfx/branch-enter.mp3"),
          back: new Audio("/composition/sfx/back.mp3"),
        };
        clips.advance.volume = 0.45;
        clips.fragment.volume = 0.4;
        clips["branch-enter"].volume = 0.4;
        clips.back.volume = 0.4;
        for (var k in clips) clips[k].preload = "auto";

        // Mute state is owned by <hyperframes-slideshow sound>; mirror it.
        var muted = false;
        function setClipsMuted(nextMuted) {
          Object.keys(clips).forEach(function (name) {
            clips[name].muted = nextMuted;
          });
        }
        var ss = document.querySelector("hyperframes-slideshow");
        if (ss) {
          ss.addEventListener("hf-sound", function (e) {
            muted = e.detail && e.detail.muted === true;
            setClipsMuted(muted);
          });
        }

        // Autoplay needs a user gesture — prime each clip (play muted, reset) on the
        // first interaction so later plays are instant and allowed.
        var unlocked = false;
        function unlock() {
          if (unlocked) return;
          unlocked = true;
          Object.keys(clips).forEach(function (name) {
            var el = clips[name];
            var v = el.volume;
            el.volume = 0;
            el.play()
              .then(function () {
                el.pause();
                el.currentTime = 0;
                el.volume = v;
              })
              .catch(function () {
                el.volume = v;
              });
          });
        }
        window.addEventListener("keydown", unlock, true);
        window.addEventListener("pointerdown", unlock, true);
        window.addEventListener("click", unlock, true);

        window.addEventListener("message", function (e) {
          // Only accept cues from this origin (the composition iframe is same-origin).
          if (e.origin !== location.origin) return;
          var d = e.data;
          if (!d || d.type !== "hf-sfx" || muted) return;
          // Own-property guard: a malicious name like "__proto__" must not resolve to
          // a prototype object (which would be truthy and then get mutated below).
          if (!Object.prototype.hasOwnProperty.call(clips, d.name)) return;
          var el = clips[d.name];
          if (!el || !unlocked) return;
          try {
            el.currentTime = 0;
            el.play().catch(function () {});
          } catch (err) {
            /* ignore */
          }
        });
      })();
    </script>
  </body>
</html>`;
}

function escHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
