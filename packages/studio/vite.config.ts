import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import {
  readFileSync,
  readdirSync,
  existsSync,
  writeFileSync,
  lstatSync,
  realpathSync,
} from "node:fs";
import { join, resolve } from "node:path";
import type {
  StudioApiAdapter,
  ResolvedProject,
  RenderJobState,
} from "@hyperframes/core/studio-api";

// ── Shared Puppeteer browser ─────────────────────────────────────────────────

let _browser: import("puppeteer-core").Browser | null = null;
let _browserLaunchPromise: Promise<import("puppeteer-core").Browser> | null = null;

async function getSharedBrowser(): Promise<import("puppeteer-core").Browser | null> {
  if (_browser?.connected) return _browser;
  if (_browserLaunchPromise) return _browserLaunchPromise;
  _browserLaunchPromise = (async () => {
    const puppeteer = await import("puppeteer-core");
    const executablePath = [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/usr/bin/google-chrome",
      "/usr/bin/chromium-browser",
    ].find((p) => existsSync(p));
    if (!executablePath) return null;
    _browser = await puppeteer.default.launch({
      headless: true,
      executablePath,
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    });
    _browserLaunchPromise = null;
    return _browser;
  })();
  return _browserLaunchPromise;
}

// In-flight thumbnail dedup
const _thumbnailInflight = new Map<string, Promise<Buffer>>();

// ── Vite adapter for the shared studio API ───────────────────────────────────

function createViteAdapter(dataDir: string, server: ViteDevServer): StudioApiAdapter {
  const PRODUCER_URL = (process.env.PRODUCER_SERVER_URL || "http://127.0.0.1:9847").replace(
    /\/+$/,
    "",
  );

  // Lazy-load the bundler via Vite's SSR module loader
  let _bundler: ((dir: string) => Promise<string>) | null = null;
  const getBundler = async () => {
    if (!_bundler) {
      try {
        const mod = await server.ssrLoadModule("@hyperframes/core/compiler");
        _bundler = (dir: string) => mod.bundleToSingleHtml(dir);
      } catch (err) {
        console.warn("[Studio] Failed to load compiler, previews will use raw HTML:", err);
        _bundler = null as never;
      }
    }
    return _bundler;
  };

  return {
    listProjects() {
      const sessionsDir = resolve(dataDir, "../sessions");
      const sessionMap = new Map<string, { sessionId: string; title: string }>();
      if (existsSync(sessionsDir)) {
        for (const file of readdirSync(sessionsDir).filter((f) => f.endsWith(".json"))) {
          try {
            const raw = JSON.parse(readFileSync(join(sessionsDir, file), "utf-8"));
            if (raw.projectId) {
              sessionMap.set(raw.projectId, {
                sessionId: file.replace(".json", ""),
                title: raw.title || "Untitled",
              });
            }
          } catch {
            /* skip corrupt */
          }
        }
      }
      return readdirSync(dataDir, { withFileTypes: true })
        .filter(
          (d) =>
            (d.isDirectory() || d.isSymbolicLink()) &&
            existsSync(join(dataDir, d.name, "index.html")),
        )
        .map((d) => {
          const session = sessionMap.get(d.name);
          return {
            id: d.name,
            dir: join(dataDir, d.name),
            title: session?.title ?? d.name,
            sessionId: session?.sessionId,
          } satisfies ResolvedProject;
        })
        .sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
    },

    resolveProject(id: string) {
      let projectDir = join(dataDir, id);
      if (!existsSync(projectDir)) {
        // Try resolving as session ID
        const sessionsDir = resolve(dataDir, "../sessions");
        const sessionFile = join(sessionsDir, `${id}.json`);
        if (existsSync(sessionFile)) {
          try {
            const session = JSON.parse(readFileSync(sessionFile, "utf-8"));
            if (session.projectId) {
              projectDir = join(dataDir, session.projectId);
              if (existsSync(projectDir)) {
                return { id: session.projectId, dir: projectDir, title: session.title };
              }
            }
          } catch {
            /* ignore */
          }
        }
        return null;
      }
      return { id, dir: projectDir };
    },

    async bundle(dir: string) {
      const bundler = await getBundler();
      if (!bundler) return null;
      let html = await bundler(dir);
      // Fix empty runtime src from bundler — point to the CDN runtime
      html = html.replace(
        'data-hyperframes-preview-runtime="1" src=""',
        `data-hyperframes-preview-runtime="1" src="${this.runtimeUrl}"`,
      );
      return html;
    },

    async lint(html: string, opts?: { filePath?: string }) {
      const mod = await server.ssrLoadModule("@hyperframes/core/lint");
      return mod.lintHyperframeHtml(html, opts);
    },

    runtimeUrl: "https://cdn.jsdelivr.net/npm/@hyperframes/core/dist/hyperframe.runtime.iife.js",

    rendersDir: () => resolve(dataDir, "../renders"),

    startRender(opts): RenderJobState {
      const state: RenderJobState = {
        id: opts.jobId,
        status: "rendering",
        progress: 0,
        outputPath: opts.outputPath,
      };

      // Proxy to producer server
      const startTime = Date.now();
      fetch(`${PRODUCER_URL}/render/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectDir: opts.project.dir,
          outputPath: opts.outputPath,
          fps: opts.fps,
          quality: opts.quality,
          format: opts.format,
        }),
      })
        .then(async (resp) => {
          if (!resp.ok || !resp.body) {
            state.status = "failed";
            return;
          }
          const reader = resp.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const blocks = buffer.split("\n\n");
            buffer = blocks.pop() || "";
            for (const block of blocks) {
              const data = block
                .split("\n")
                .filter((l) => l.startsWith("data:"))
                .map((l) => l.slice(5).trim())
                .join("");
              if (!data) continue;
              try {
                const evt = JSON.parse(data);
                if (evt.type === "progress") {
                  state.progress = evt.progress;
                  if (evt.stage || evt.message) state.stage = evt.stage || evt.message;
                }
                if (evt.type === "complete") {
                  state.status = "complete";
                  state.outputPath = evt.outputPath || opts.outputPath;
                  const metaPath = opts.outputPath.replace(/\.(mp4|webm)$/, ".meta.json");
                  writeFileSync(
                    metaPath,
                    JSON.stringify({ status: "complete", durationMs: Date.now() - startTime }),
                  );
                }
                if (evt.type === "error") {
                  state.status = "failed";
                  const metaPath = opts.outputPath.replace(/\.(mp4|webm)$/, ".meta.json");
                  writeFileSync(metaPath, JSON.stringify({ status: "failed" }));
                }
              } catch {
                /* ignore parse errors */
              }
            }
          }
          if (state.status === "rendering") {
            state.status = "complete";
            const metaPath = opts.outputPath.replace(/\.(mp4|webm)$/, ".meta.json");
            writeFileSync(
              metaPath,
              JSON.stringify({ status: "complete", durationMs: Date.now() - startTime }),
            );
          }
        })
        .catch(() => {
          state.status = "failed";
          try {
            const metaPath = opts.outputPath.replace(/\.(mp4|webm)$/, ".meta.json");
            writeFileSync(metaPath, JSON.stringify({ status: "failed" }));
          } catch {
            /* ignore */
          }
        });

      return state;
    },

    async generateThumbnail(opts) {
      const cacheKey = `${opts.compPath.replace(/\//g, "_")}_${opts.seekTime.toFixed(2)}.jpg`;

      let bufferPromise = _thumbnailInflight.get(cacheKey);
      if (!bufferPromise) {
        bufferPromise = (async () => {
          const browser = await getSharedBrowser();
          if (!browser) return null;
          const page = await browser.newPage();
          await page.setViewport({
            width: opts.width,
            height: opts.height,
            deviceScaleFactor: 0.5,
          });
          await page.goto(opts.previewUrl, { waitUntil: "domcontentloaded", timeout: 10000 });
          await page.evaluate(() => {
            document.documentElement.style.background = "#000";
            document.body.style.background = "#000";
            document.body.style.margin = "0";
            document.body.style.overflow = "hidden";
          });
          await page
            .waitForFunction(
              `!!(window.__timelines && Object.keys(window.__timelines).length > 0)`,
              { timeout: 5000 },
            )
            .catch(() => {});
          await page.evaluate((t: number) => {
            const w = window as Window & {
              __timelines?: Record<
                string,
                { seek: (t: number) => void; pause: (t?: number) => void }
              >;
              gsap?: { ticker: { tick: () => void } };
            };
            if (w.__timelines) {
              // Seek ALL timelines (compositions may register multiple)
              for (const tl of Object.values(w.__timelines)) {
                if (tl) {
                  // pause(t) both seeks AND forces GSAP to render the frame
                  tl.pause(t);
                }
              }
              // Force GSAP to flush any pending renders
              if (w.gsap?.ticker) w.gsap.ticker.tick();
            }
          }, opts.seekTime);
          await page.evaluate("document.fonts?.ready");
          await new Promise((r) => setTimeout(r, 200));
          const buf = await page.screenshot({ type: "jpeg", quality: 75 });
          await page.close();
          return buf as Buffer;
        })();
        _thumbnailInflight.set(cacheKey, bufferPromise);
        bufferPromise.finally(() => _thumbnailInflight.delete(cacheKey));
      }
      return bufferPromise;
    },

    async resolveSession(sessionId: string) {
      const sessionsDir = resolve(dataDir, "../sessions");
      const sessionFile = join(sessionsDir, `${sessionId}.json`);
      if (!existsSync(sessionFile)) return null;
      try {
        const raw = JSON.parse(readFileSync(sessionFile, "utf-8"));
        if (raw.projectId) return { projectId: raw.projectId, title: raw.title };
      } catch {
        /* ignore */
      }
      return null;
    },
  };
}

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

  // Stream the response body (important for SSE)
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

  return {
    name: "studio-dev-api",
    configureServer(server): void {
      // Load the shared module lazily via SSR (resolves hono + TypeScript)
      let _api: { fetch: (req: Request) => Promise<Response> } | null = null;
      const getApi = async () => {
        if (!_api) {
          const mod = await server.ssrLoadModule("@hyperframes/core/studio-api");
          const adapter = createViteAdapter(dataDir, server);
          _api = mod.createStudioApi(adapter);
        }
        return _api;
      };

      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/")) return next();

        try {
          const api = await getApi();

          // Build a Fetch Request from the Node IncomingMessage
          const url = new URL(req.url, `http://${req.headers.host}`);
          // Strip /api prefix — shared module routes are relative
          url.pathname = url.pathname.slice(4);

          // Read body for non-GET/HEAD
          let body: string | undefined;
          if (req.method !== "GET" && req.method !== "HEAD") {
            body = await new Promise<string>((resolve) => {
              let data = "";
              req.on("data", (chunk: Buffer) => (data += chunk.toString()));
              req.on("end", () => resolve(data));
            });
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

      // Watch project directories for file changes → HMR
      const realProjectPaths: string[] = [];
      try {
        for (const entry of readdirSync(dataDir, { withFileTypes: true })) {
          const full = join(dataDir, entry.name);
          try {
            const real = lstatSync(full).isSymbolicLink() ? realpathSync(full) : full;
            realProjectPaths.push(real);
            server.watcher.add(real);
          } catch {
            /* skip broken symlinks */
          }
        }
      } catch {
        /* dataDir doesn't exist yet */
      }

      server.watcher.on("change", (filePath: string) => {
        const isProjectFile = realProjectPaths.some((p) => filePath.startsWith(p));
        if (
          isProjectFile &&
          (filePath.endsWith(".html") || filePath.endsWith(".css") || filePath.endsWith(".js"))
        ) {
          console.log(`[Studio] File changed: ${filePath}`);
          server.ws.send({ type: "custom", event: "hf:file-change", data: {} });
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devProjectApi()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5190,
  },
});
