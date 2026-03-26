import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import {
  readFileSync,
  readdirSync,
  existsSync,
  statSync,
  writeFileSync,
  lstatSync,
  realpathSync,
  createReadStream,
} from "node:fs";
import { join, resolve, sep } from "node:path";

/** Reject paths that escape the project directory. */
function isSafePath(base: string, resolved: string): boolean {
  const norm = resolve(base) + sep;
  return resolved.startsWith(norm) || resolved === resolve(base);
}

// Lazy-load the bundler via Vite's SSR module loader (resolves .ts imports correctly)
let _bundler: ((dir: string) => Promise<string>) | null = null;

// Shared Puppeteer browser instance — lazy-init, reused across thumbnail requests
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

// Render job store with TTL cleanup (fixes globalThis memory leak)
const renderJobs = new Map<
  string,
  { id: string; status: string; progress: number; outputPath: string }
>();
setInterval(() => {
  const now = Date.now();
  for (const [key, job] of renderJobs) {
    // Remove completed/failed jobs after 5 minutes
    if (
      (job.status === "complete" || job.status === "failed") &&
      now - parseInt(key.split("-").pop() || "0") > 300_000
    ) {
      renderJobs.delete(key);
    }
  }
}, 60_000);

/** Minimal project API for standalone dev mode */
function devProjectApi(): Plugin {
  const dataDir = resolve(__dirname, "data/projects");

  return {
    name: "studio-dev-api",
    configureServer(server): void {
      // Load the bundler via Vite's SSR module loader (resolves .ts imports)
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

      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/")) return next();

        // ── Render endpoints ──────────────────────────────────────────
        const PRODUCER_URL = (process.env.PRODUCER_SERVER_URL || "http://127.0.0.1:9847").replace(
          /\/+$/,
          "",
        );

        // POST /api/projects/:id/render — start a render job via producer
        const renderMatch =
          req.method === "POST" && req.url.match(/\/api\/projects\/([^/]+)\/render/);
        if (renderMatch) {
          const pid = renderMatch[1];
          const pDir = join(dataDir, pid);
          if (!existsSync(pDir)) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Project not found" }));
            return;
          }
          const jobId = `${pid}-${Date.now()}`;
          const outputDir = resolve(dataDir, "../renders");
          if (!existsSync(outputDir)) {
            const { mkdirSync: mk } = await import("fs");
            mk(outputDir, { recursive: true });
          }
          const outputPath = join(outputDir, `${jobId}.mp4`);
          // Store job state — referenced by the SSE progress endpoint and the fetch callback below
          const _jobState = { id: jobId, status: "rendering", progress: 0, outputPath };
          renderJobs.set(jobId, _jobState);

          // Start render in background
          fetch(`${PRODUCER_URL}/render/stream`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectDir: pDir, outputPath, fps: 30, quality: "standard" }),
          })
            .then(async (resp) => {
              if (!resp.ok || !resp.body) {
                _jobState.status = "failed";
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
                      _jobState.progress = evt.progress;
                    }
                    if (evt.type === "complete") {
                      _jobState.status = "complete";
                      _jobState.outputPath = evt.outputPath || outputPath;
                    }
                    if (evt.type === "error") {
                      _jobState.status = "failed";
                    }
                  } catch {}
                }
              }
              if (_jobState.status === "rendering") _jobState.status = "complete";
            })
            .catch(() => {
              _jobState.status = "failed";
            });

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ jobId, status: "rendering" }));
          return;
        }

        // GET /api/render/:jobId/progress — SSE progress stream
        if (
          req.method === "GET" &&
          req.url.startsWith("/api/render/") &&
          req.url.endsWith("/progress")
        ) {
          const jobId = req.url.replace("/api/render/", "").replace("/progress", "");
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          const interval = setInterval(() => {
            const state = renderJobs.get(jobId) as { status: string; progress: number } | undefined;
            if (!state) {
              clearInterval(interval);
              res.end();
              return;
            }
            res.write(
              `event: progress\ndata: ${JSON.stringify({ status: state.status, progress: state.progress })}\n\n`,
            );
            if (state.status === "complete" || state.status === "failed") {
              clearInterval(interval);
              setTimeout(() => res.end(), 100);
            }
          }, 500);
          req.on("close", () => clearInterval(interval));
          return;
        }

        // GET /api/render/:jobId/download — serve the rendered MP4
        if (
          req.method === "GET" &&
          req.url.startsWith("/api/render/") &&
          req.url.endsWith("/download")
        ) {
          const jobId = req.url.replace("/api/render/", "").replace("/download", "");
          const jobState = renderJobs.get(jobId) as
            | { outputPath?: string; status: string }
            | undefined;
          if (
            !jobState ||
            jobState.status !== "complete" ||
            !jobState.outputPath ||
            !existsSync(jobState.outputPath)
          ) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Render not ready or not found" }));
            return;
          }
          const fileStat = statSync(jobState.outputPath);
          res.writeHead(200, {
            "Content-Type": "video/mp4",
            "Content-Length": String(fileStat.size),
            "Content-Disposition": `attachment; filename="${jobId}.mp4"`,
          });
          const stream = createReadStream(jobState.outputPath);
          stream.pipe(res);
          return;
        }

        // GET /api/projects — list all projects with session metadata
        if (req.method === "GET" && (req.url === "/api/projects" || req.url === "/api/projects/")) {
          // Build session → project mapping for titles
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

          const projects = readdirSync(dataDir, { withFileTypes: true })
            .filter(
              (d) =>
                (d.isDirectory() || d.isSymbolicLink()) &&
                existsSync(join(dataDir, d.name, "index.html")),
            )
            .map((d) => {
              const session = sessionMap.get(d.name);
              return { id: d.name, title: session?.title ?? d.name, sessionId: session?.sessionId };
            })
            .sort((a, b) => a.title.localeCompare(b.title));
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ projects }));
          return;
        }

        // GET /api/resolve-session/:sessionId — resolve session ID to project ID
        const sessionMatch = req.url.match(/^\/api\/resolve-session\/([^/]+)/);
        if (req.method === "GET" && sessionMatch) {
          const sessionsDir = resolve(dataDir, "../sessions");
          const sessionFile = join(sessionsDir, `${sessionMatch[1]}.json`);
          if (existsSync(sessionFile)) {
            try {
              const raw = JSON.parse(readFileSync(sessionFile, "utf-8"));
              if (raw.projectId) {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ projectId: raw.projectId, title: raw.title }));
                return;
              }
            } catch {
              /* ignore */
            }
          }
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Session not found" }));
          return;
        }

        const match = req.url.match(/^\/api\/projects\/([^/]+)(.*)/);
        if (!match) return next();

        let [, projectId, rest] = match;
        let projectDir = join(dataDir, projectId);

        // If project ID not found, try resolving it as a session ID
        if (!existsSync(projectDir)) {
          const sessionsDir = resolve(dataDir, "../sessions");
          const sessionFile = join(sessionsDir, `${projectId}.json`);
          if (existsSync(sessionFile)) {
            try {
              const session = JSON.parse(readFileSync(sessionFile, "utf-8"));
              if (session.projectId) {
                projectId = session.projectId;
                projectDir = join(dataDir, projectId);
              }
            } catch {
              /* ignore */
            }
          }
        }

        if (!existsSync(projectDir)) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "not found" }));
          return;
        }

        // GET /api/projects/:id
        if (req.method === "GET" && !rest) {
          const files: string[] = [];
          const IGNORE_DIRS = new Set([".thumbnails", "node_modules", ".git"]);
          function walk(d: string, prefix: string) {
            for (const entry of readdirSync(d, { withFileTypes: true })) {
              if (IGNORE_DIRS.has(entry.name)) continue;
              const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
              if (entry.isDirectory()) walk(join(d, entry.name), rel);
              else files.push(rel);
            }
          }
          walk(projectDir, "");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ id: projectId, files }));
          return;
        }

        // GET /api/projects/:id/preview — bundle and serve the full composition
        if (req.method === "GET" && rest === "/preview") {
          try {
            const bundler = await getBundler();
            let bundled = bundler
              ? await bundler(projectDir)
              : readFileSync(join(projectDir, "index.html"), "utf-8");

            // Inject runtime if not already present
            const runtimeUrl =
              "https://cdn.jsdelivr.net/npm/@hyperframes/core/dist/hyperframe.runtime.iife.js";
            if (!bundled.includes("hyperframe.runtime")) {
              const runtimeTag = `<script src="${runtimeUrl}"></script>`;
              if (bundled.includes("</body>")) {
                bundled = bundled.replace("</body>", `${runtimeTag}\n</body>`);
              } else {
                bundled += `\n${runtimeTag}`;
              }
            }

            // Inject <base> for relative asset resolution
            const baseHref = `/api/projects/${projectId}/preview/`;
            if (!bundled.includes("<base")) {
              bundled = bundled.replace(/<head>/i, `<head><base href="${baseHref}">`);
            }

            res.writeHead(200, {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "no-store",
            });
            res.end(bundled);
          } catch {
            // Fallback to raw HTML if bundling fails
            const file = join(projectDir, "index.html");
            if (existsSync(file)) {
              res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
              res.end(readFileSync(file, "utf-8"));
            } else {
              res.writeHead(404);
              res.end("not found");
            }
          }
          return;
        }

        // GET /api/projects/:id/preview/comp/* — serve sub-composition as standalone playable page
        if (req.method === "GET" && rest.startsWith("/preview/comp/")) {
          const compPath = decodeURIComponent(rest.replace("/preview/comp/", "").split("?")[0]);
          const compFile = resolve(projectDir, compPath);
          if (
            !isSafePath(projectDir, compFile) ||
            !existsSync(compFile) ||
            !statSync(compFile).isFile()
          ) {
            res.writeHead(404);
            res.end("not found");
            return;
          }

          let rawComp = readFileSync(compFile, "utf-8");

          // Extract content from <template> if present
          const templateMatch = rawComp.match(/<template>([\s\S]*)<\/template>/i);
          let content = templateMatch ? templateMatch[1] : rawComp;

          // Inline nested data-composition-src references (keep the attr for drill-down navigation)
          content = content.replace(
            /(<[^>]*?)(data-composition-src=["']([^"']+)["'])([^>]*>)/g,
            (_match, before, srcAttr, src, after) => {
              const nestedFile = join(projectDir, src);
              if (!existsSync(nestedFile)) return before + srcAttr + after;
              const nestedRaw = readFileSync(nestedFile, "utf-8");
              const nestedTemplate = nestedRaw.match(/<template>([\s\S]*)<\/template>/i);
              const nestedContent = nestedTemplate ? nestedTemplate[1] : nestedRaw;
              // Extract styles, scripts, and body from nested content
              const styles: string[] = [];
              const scripts: string[] = [];
              let body = nestedContent
                .replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_, css) => {
                  styles.push(css);
                  return "";
                })
                .replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, (_, js) => {
                  scripts.push(js);
                  return "";
                });
              // Find the inner root with data-composition-id and use its children
              const innerRootMatch = body.match(
                /<([a-z][a-z0-9]*)\b[^>]*data-composition-id[^>]*>([\s\S]*)<\/\1>/i,
              );
              const innerHTML = innerRootMatch ? innerRootMatch[2] : body;
              // Keep data-composition-src on the host for drill-down URL resolution
              return (
                before +
                srcAttr +
                after.replace(/>$/, ">") +
                innerHTML +
                (styles.length ? `<style>${styles.join("\n")}</style>` : "") +
                (scripts.length
                  ? `<script>${scripts.map((s) => `(function(){try{${s}}catch(e){}})();`).join("\n")}</script>`
                  : "")
              );
            },
          );

          // Build a standalone HTML page with GSAP + runtime
          const runtimeUrl =
            (process.env.HYPERFRAME_RUNTIME_URL || "").trim() ||
            "https://cdn.jsdelivr.net/npm/@hyperframes/core/dist/hyperframe.runtime.iife.js";
          const standalone = `<!DOCTYPE html>
<html>
<head>
<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
<script data-hyperframes-preview-runtime="1" src="${runtimeUrl}"></script>
</head>
<body>
${content}
</body>
</html>`;
          res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
          });
          res.end(standalone);
          return;
        }

        // GET /api/projects/:id/thumbnail/* — generate JPEG thumbnail via Puppeteer
        if (req.method === "GET" && rest.startsWith("/thumbnail/")) {
          const compPath = decodeURIComponent(rest.replace("/thumbnail/", "").split("?")[0]);
          const url = new URL(req.url!, `http://${req.headers.host}`);
          const seekTime = parseFloat(url.searchParams.get("t") || "0.5") || 0.5;
          const vpWidth = parseInt(url.searchParams.get("w") || "0") || 0;
          const vpHeight = parseInt(url.searchParams.get("h") || "0") || 0;

          // Determine the preview URL for this composition
          const previewUrl =
            compPath === "index.html"
              ? `http://${req.headers.host}/api/projects/${projectId}/preview`
              : `http://${req.headers.host}/api/projects/${projectId}/preview/comp/${compPath}`;

          // Cache path
          const cacheDir = join(projectDir, ".thumbnails");
          const cacheKey = `${compPath.replace(/\//g, "_")}_${seekTime.toFixed(2)}.jpg`;
          const cachePath = join(cacheDir, cacheKey);

          // Return cached thumbnail if available
          if (existsSync(cachePath)) {
            res.writeHead(200, {
              "Content-Type": "image/jpeg",
              "Cache-Control": "public, max-age=60",
            });
            res.end(readFileSync(cachePath));
            return;
          }

          try {
            const browser = await getSharedBrowser();
            if (!browser) {
              res.writeHead(501, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Chrome not found for thumbnails" }));
              return;
            }
            // Detect composition dimensions from the HTML file
            let compW = vpWidth || 1920;
            let compH = vpHeight || 1080;
            if (!vpWidth) {
              const htmlFile = join(projectDir, compPath);
              if (existsSync(htmlFile)) {
                const html = readFileSync(htmlFile, "utf-8");
                const wMatch = html.match(/data-width=["'](\d+)["']/);
                const hMatch = html.match(/data-height=["'](\d+)["']/);
                if (wMatch) compW = parseInt(wMatch[1]);
                if (hMatch) compH = parseInt(hMatch[1]);
              }
            }

            const page = await browser.newPage();
            await page.setViewport({ width: compW, height: compH, deviceScaleFactor: 0.5 });
            await page.goto(previewUrl, { waitUntil: "domcontentloaded", timeout: 10000 });

            // Wait for GSAP + seek
            await page
              .waitForFunction(
                `!!(window.__timelines && Object.keys(window.__timelines).length > 0)`,
                { timeout: 5000 },
              )
              .catch(() => {});
            await page.evaluate((t: number) => {
              const w = window as Window & {
                __timelines?: Record<string, { seek: (t: number) => void; pause: () => void }>;
              };
              if (w.__timelines) {
                const tl = Object.values(w.__timelines)[0];
                if (tl) {
                  tl.seek(t);
                  tl.pause();
                }
              }
            }, seekTime);
            await page.evaluate("document.fonts?.ready");
            await new Promise((r) => setTimeout(r, 100));

            const buffer = await page.screenshot({ type: "jpeg", quality: 75 });
            await page.close();

            // Cache
            if (!existsSync(cacheDir)) {
              const { mkdirSync } = await import("fs");
              mkdirSync(cacheDir, { recursive: true });
            }
            writeFileSync(cachePath, buffer);

            res.writeHead(200, {
              "Content-Type": "image/jpeg",
              "Cache-Control": "public, max-age=60",
            });
            res.end(buffer);
          } catch (err) {
            console.warn("[Studio] Thumbnail generation failed:", err);
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Thumbnail generation failed" }));
          }
          return;
        }

        // GET /api/projects/:id/preview/* — serve static assets (images, audio, etc.)
        if (req.method === "GET" && rest.startsWith("/preview/")) {
          const subPath = decodeURIComponent(rest.replace("/preview/", "").split("?")[0]);
          const file = resolve(projectDir, subPath);
          if (!isSafePath(projectDir, file) || !existsSync(file) || !statSync(file).isFile()) {
            res.writeHead(404);
            res.end("not found");
            return;
          }
          const isText = /\.(html|css|js|json|svg|txt)$/i.test(subPath);
          const contentType = subPath.endsWith(".html")
            ? "text/html"
            : subPath.endsWith(".js")
              ? "text/javascript"
              : subPath.endsWith(".css")
                ? "text/css"
                : "application/octet-stream";
          res.writeHead(200, { "Content-Type": contentType });
          res.end(readFileSync(file, isText ? "utf-8" : undefined));
          return;
        }

        // GET /api/projects/:id/files/:path — returns JSON { filename, content }
        if (req.method === "GET" && rest.startsWith("/files/")) {
          const filePath = decodeURIComponent(rest.replace("/files/", ""));
          const file = resolve(projectDir, filePath);
          if (!isSafePath(projectDir, file) || !existsSync(file)) {
            res.writeHead(404);
            res.end("not found");
            return;
          }
          const content = readFileSync(file, "utf-8");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ filename: filePath, content }));
          return;
        }

        // PUT /api/projects/:id/files/:path
        if (req.method === "PUT" && rest.startsWith("/files/")) {
          const filePath = decodeURIComponent(rest.replace("/files/", ""));
          const file = resolve(projectDir, filePath);
          if (!isSafePath(projectDir, file)) {
            res.writeHead(403, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "forbidden" }));
            return;
          }
          let body = "";
          req.on("data", (chunk: Buffer) => {
            body += chunk.toString();
          });
          req.on("end", () => {
            writeFileSync(file, body, "utf-8");
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
          });
          return;
        }

        next();
      });

      // Watch project directories for external file changes (user editing HTML outside the editor).
      // Resolve symlinks so the watcher sees the real file paths.
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

      // When a project file changes, send HMR event to refresh the preview
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
