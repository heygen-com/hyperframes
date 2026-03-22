import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, readdirSync, existsSync, statSync, writeFileSync, lstatSync, realpathSync } from "node:fs";
import { join, resolve, sep } from "node:path";

/** Reject paths that escape the project directory. */
function isSafePath(base: string, resolved: string): boolean {
  const norm = resolve(base) + sep;
  return resolved.startsWith(norm) || resolved === resolve(base);
}

// Lazy-load the bundler via Vite's SSR module loader (resolves .ts imports correctly)
let _bundler: ((dir: string) => Promise<string>) | null = null;

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

        // Render endpoints — not yet wired up in standalone studio
        if (req.url.startsWith("/api/render/") || (req.method === "POST" && req.url.match(/\/api\/projects\/[^/]+\/render/))) {
          res.writeHead(501, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Render not available in standalone studio mode" }));
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
                  sessionMap.set(raw.projectId, { sessionId: file.replace(".json", ""), title: raw.title || "Untitled" });
                }
              } catch { /* skip corrupt */ }
            }
          }

          const projects = readdirSync(dataDir, { withFileTypes: true })
            .filter((d) => (d.isDirectory() || d.isSymbolicLink()) && existsSync(join(dataDir, d.name, "index.html")))
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
            } catch { /* ignore */ }
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
            } catch { /* ignore */ }
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
          function walk(d: string, prefix: string) {
            for (const entry of readdirSync(d, { withFileTypes: true })) {
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
            const bundled = bundler ? await bundler(projectDir) : readFileSync(join(projectDir, "index.html"), "utf-8");
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
            res.end(bundled);
          } catch (err) {
            // Fallback to raw HTML if bundling fails
            const file = join(projectDir, "index.html");
            if (existsSync(file)) {
              res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
              res.end(readFileSync(file, "utf-8"));
            } else {
              res.writeHead(404); res.end("not found");
            }
          }
          return;
        }

        // GET /api/projects/:id/preview/comp/* — serve sub-composition as standalone playable page
        if (req.method === "GET" && rest.startsWith("/preview/comp/")) {
          const compPath = decodeURIComponent(rest.replace("/preview/comp/", "").split("?")[0]);
          const compFile = resolve(projectDir, compPath);
          if (!isSafePath(projectDir, compFile) || !existsSync(compFile) || !statSync(compFile).isFile()) { res.writeHead(404); res.end("not found"); return; }

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
                .replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_, css) => { styles.push(css); return ""; })
                .replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, (_, js) => { scripts.push(js); return ""; });
              // Find the inner root with data-composition-id and use its children
              const innerRootMatch = body.match(/<([a-z][a-z0-9]*)\b[^>]*data-composition-id[^>]*>([\s\S]*)<\/\1>/i);
              const innerHTML = innerRootMatch ? innerRootMatch[2] : body;
              // Keep data-composition-src on the host for drill-down URL resolution
              return before + srcAttr + after.replace(/>$/, ">") + innerHTML +
                (styles.length ? `<style>${styles.join("\n")}</style>` : "") +
                (scripts.length ? `<script>${scripts.map(s => `(function(){try{${s}}catch(e){}})();`).join("\n")}</script>` : "");
            }
          );

          // Build a standalone HTML page with GSAP + runtime
          const runtimeUrl = (process.env.HYPERFRAME_RUNTIME_URL || "").trim() || "";
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
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
          res.end(standalone);
          return;
        }

        // GET /api/projects/:id/preview/* — serve static assets (images, audio, etc.)
        if (req.method === "GET" && rest.startsWith("/preview/")) {
          const subPath = decodeURIComponent(rest.replace("/preview/", "").split("?")[0]);
          const file = resolve(projectDir, subPath);
          if (!isSafePath(projectDir, file) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end("not found"); return; }
          const isText = /\.(html|css|js|json|svg|txt)$/i.test(subPath);
          const contentType = subPath.endsWith(".html") ? "text/html" : subPath.endsWith(".js") ? "text/javascript" : subPath.endsWith(".css") ? "text/css" : "application/octet-stream";
          res.writeHead(200, { "Content-Type": contentType });
          res.end(readFileSync(file, isText ? "utf-8" : undefined));
          return;
        }

        // GET /api/projects/:id/files/:path — returns JSON { filename, content }
        if (req.method === "GET" && rest.startsWith("/files/")) {
          const filePath = decodeURIComponent(rest.replace("/files/", ""));
          const file = resolve(projectDir, filePath);
          if (!isSafePath(projectDir, file) || !existsSync(file)) { res.writeHead(404); res.end("not found"); return; }
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
          req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
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
          } catch { /* skip broken symlinks */ }
        }
      } catch { /* dataDir doesn't exist yet */ }

      // When a project file changes, send HMR event to refresh the preview
      server.watcher.on("change", (filePath: string) => {
        const isProjectFile = realProjectPaths.some((p) => filePath.startsWith(p));
        if (isProjectFile && (filePath.endsWith(".html") || filePath.endsWith(".css") || filePath.endsWith(".js"))) {
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
