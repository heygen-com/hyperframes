import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, readdirSync, existsSync, lstatSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { readNodeRequestBody } from "./vite.request-body.js";
import { watch } from "chokidar";
import { createProjectSignatureCache, createViteAdapter } from "./vite.adapter";
import { previewConfigPayload } from "./vite.preview-config";

async function loadRuntimeSourceForDev(
  server: import("vite").ViteDevServer,
): Promise<string | null> {
  try {
    const mod = await server.ssrLoadModule(
      resolve(__dirname, "../core/src/inline-scripts/hyperframe.ts"),
    );
    if (typeof mod.loadHyperframeRuntimeSource === "function") {
      return mod.loadHyperframeRuntimeSource();
    }
  } catch (err) {
    console.warn("[Studio] Failed to load runtime source from core:", err);
  }
  return null;
}

const studioPkg = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf-8"));

// ── Bridge Hono fetch → Node http response ───────────────────────────────────

async function bridgeHonoResponse(
  honoResponse: Response,
  res: import("node:http").ServerResponse,
): Promise<void> {
  const headers: Record<string, string> = {};
  honoResponse.headers.forEach((v, k) => {
    headers[k] = v;
  });
  res.writeHead(honoResponse.status, headers);

  if (!honoResponse.body) {
    res.end();
    return;
  }

  const reader = honoResponse.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } catch {
    /* client disconnected */
  }
  res.end();
}

// ── Vite plugin ──────────────────────────────────────────────────────────────

function devProjectApi(): Plugin {
  const dataDir = resolve(__dirname, "data/projects");
  const runtimePath = resolve(__dirname, "../core/dist/hyperframe.runtime.iife.js");

  return {
    name: "studio-dev-api",
    configureServer(server): void {
      // Watch project directories on a watcher of our own. Vite's is told to
      // ignore them (see `server.watch.ignored`), because it answers an html
      // change with a full page reload; this one only announces the change and
      // lets Studio decide what to do with it.
      const realProjectPaths: string[] = [];
      try {
        for (const entry of readdirSync(dataDir, { withFileTypes: true })) {
          const full = join(dataDir, entry.name);
          try {
            realProjectPaths.push(lstatSync(full).isSymbolicLink() ? realpathSync(full) : full);
          } catch {
            /* skip broken symlinks */
          }
        }
      } catch {
        /* dataDir doesn't exist yet */
      }

      const projectWatcher = watch(realProjectPaths, {
        ignoreInitial: true,
        // A project write is a whole-file replace; wait for it to settle so a
        // half-written composition is never announced.
        awaitWriteFinish: { stabilityThreshold: 40, pollInterval: 10 },
      });

      // This watcher, and not Vite's, is what clears the preview signature.
      // Vite's ignores `data/projects/**`, so subscribing the cache to it left
      // the ETag frozen for the life of the dev server: the preview answered
      // every revalidation with 304 and thumbnails regenerated after an edit
      // still rendered the pre-edit composition. Every event type counts, since
      // an added or deleted asset changes the signature as surely as an edit.
      const signatureCache = createProjectSignatureCache({
        watch: (projectDir) => void projectWatcher.add(projectDir),
      });
      for (const event of ["add", "change", "unlink", "addDir", "unlinkDir"] as const) {
        projectWatcher.on(event, (filePath: string) => signatureCache.invalidate(filePath));
      }

      let _api: { fetch: (req: Request) => Promise<Response> } | null = null;
      let _studioServerModule: {
        createStudioApi: (adapter: ReturnType<typeof createViteAdapter>) => {
          fetch: (req: Request) => Promise<Response>;
        };
        consumeFileWriteReceipt?: (
          path: string,
          expectedVersion: string,
        ) => { path: string; version: string; writeToken: string } | null;
        fileContentVersion?: (content: string) => string;
      } | null = null;
      const getApi = async () => {
        if (!_api) {
          const mod = await server.ssrLoadModule("@hyperframes/studio-server");
          _studioServerModule = mod as typeof _studioServerModule;
          const adapter = createViteAdapter(dataDir, server, signatureCache);
          _api = mod.createStudioApi(adapter);
        }
        return _api;
      };

      server.middlewares.use((req, res, next) => {
        if (req.url !== "/__hyperframes_config") return next();
        const payload = previewConfigPayload(process.env, process.pid, studioPkg.version);
        if (!payload) return next();
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify(payload));
      });

      // Runtime endpoint — prefer source build over dist artifact
      server.middlewares.use((req, res, next) => {
        if (req.url !== "/api/runtime.js") return next();
        const serve = async () => {
          let runtimeSource = await loadRuntimeSourceForDev(server);
          if (!runtimeSource && existsSync(runtimePath)) {
            runtimeSource = readFileSync(runtimePath, "utf-8");
          }
          if (!runtimeSource) {
            res.writeHead(404);
            res.end("runtime not available — build packages/core or load runtime source");
            return;
          }
          res.writeHead(200, {
            "Content-Type": "text/javascript",
            "Cache-Control": "no-store",
          });
          res.end(runtimeSource);
        };
        void serve().catch((err) => {
          console.error("[Studio runtime] Failed to serve runtime", err);
          if (!res.headersSent) {
            res.writeHead(500);
            res.end("failed to serve runtime");
          }
        });
      });

      // API middleware
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/")) return next();
        try {
          const api = await getApi();
          const url = new URL(req.url, `http://${req.headers.host}`);
          url.pathname = url.pathname.slice(4);
          let body: Buffer | undefined;
          if (req.method !== "GET" && req.method !== "HEAD") {
            const bytes = await readNodeRequestBody(req);
            body = bytes.byteLength > 0 ? bytes : undefined;
          }
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(req.headers)) {
            if (value != null) headers[key] = Array.isArray(value) ? value.join(", ") : value;
          }
          const fetchReq = new Request(url.toString(), {
            method: req.method,
            headers,
            body,
          });
          const response = await api.fetch(fetchReq);
          await bridgeHonoResponse(response, res);
        } catch (err) {
          console.error("[Studio API] Error:", err);
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Internal server error" }));
          }
        }
      });

      projectWatcher.on("change", (filePath: string) => {
        if (
          !filePath.endsWith(".html") &&
          !filePath.endsWith(".css") &&
          !filePath.endsWith(".js") &&
          !filePath.endsWith(".json")
        )
          return;
        console.log(`[Studio] File changed: ${filePath}`);
        // The receipt is matched on the file's current bytes, not just its path,
        // so a write is only recognised as ours when the version agrees. Calling
        // this without the version could never match, which left every Studio
        // write looking external and reloaded the preview on each edit.
        let version: string | null = null;
        try {
          version =
            _studioServerModule?.fileContentVersion?.(readFileSync(filePath, "utf-8")) ?? null;
        } catch {
          // A deletion has no current bytes to match a write receipt against.
        }
        const receipt = version
          ? (_studioServerModule?.consumeFileWriteReceipt?.(filePath, version) ?? null)
          : null;
        server.ws.send({
          type: "custom",
          event: "hf:file-change",
          data: receipt ?? { path: filePath },
        });
      });
      server.httpServer?.on("close", () => void projectWatcher.close());
    },
  };
}

export default defineConfig({
  plugins: [react(), devProjectApi()],
  define: {
    __STUDIO_VERSION__: JSON.stringify(studioPkg.version),
  },
  resolve: {
    alias: {
      "@hyperframes/player": resolve(__dirname, "../player/src/hyperframes-player.ts"),
      "@hyperframes/studio-server/source-mutation": resolve(
        __dirname,
        "../studio-server/src/helpers/sourceMutation.ts",
      ),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  optimizeDeps: {
    include: ["bpm-detective"],
  },
  server: {
    port: 5190,
    watch: {
      // A composition lives under this package's root, so Vite's HMR sees a
      // write to one as an html page dependency changing and full-reloads the
      // browser. That reload is the flash after every edit in the canvas, and
      // it is not Studio's to make: the app already decides whether a write of
      // its own needs the preview refreshed, and the plugin below announces
      // project writes as `hf:file-change` off its own watcher.
      ignored: ["**/data/projects/**"],
    },
  },
  ssr: {
    // recast / @babel/parser are CommonJS and call `require("fs")`. They are
    // reachable only server-side via the Node-only `@hyperframes/parsers/gsap-parser`
    // subpath (studio-api GSAP mutations + the linter), which the dev server loads
    // through Vite SSR. Externalizing them makes SSR load the native Node modules
    // instead of esbuild-transforming the `require` into a shim that throws
    // "Dynamic require of fs is not supported". Browser bundles never reach them.
    external: ["recast", "@babel/parser", "ast-types"],
  },
  test: {
    exclude: ["data/**", "node_modules/**"],
    setupFiles: ["src/test-setup.ts"],
  },
});
