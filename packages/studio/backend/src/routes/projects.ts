import { Hono } from "hono";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  rmSync,
  statSync,
  mkdirSync,
} from "fs";
import { join, resolve, extname, basename, dirname } from "path";
import { randomUUID } from "crypto";
import mime from "mime-types";
import * as cheerio from "cheerio";
import { extractZip } from "../utils/zip";
import { loadHyperframeRuntimeSource } from "@hyperframes/core";
import { compileHtml } from "../utils/htmlCompiler";

const DATA_DIR = process.env.STUDIO_DATA_DIR
  ? resolve(process.env.STUDIO_DATA_DIR)
  : resolve(import.meta.dirname, "../../data/projects");
let _interceptorScript: string | undefined;
function getInterceptorScript(): string {
  if (_interceptorScript === undefined) {
    // Try pre-built runtime file first (exists in CLI bundle), fall back to esbuild
    try {
      const prebuiltPath = resolve(import.meta.dirname, "hyperframe-runtime.js");
      if (existsSync(prebuiltPath)) {
        _interceptorScript = readFileSync(prebuiltPath, "utf-8");
      } else {
        _interceptorScript = loadHyperframeRuntimeSource();
      }
    } catch {
      _interceptorScript = loadHyperframeRuntimeSource();
    }
  }
  return _interceptorScript;
}
const RENDER_MODE_SCRIPT = `(function() {
  function waitForPlayer() {
    if (window.__player && typeof window.__player.renderSeek === "function") {
      window.__renderReady = true;
      return;
    }
    if (window.__player) {
      window.__player.renderSeek = function(time) {
        var tl = window.__player._timeline;
        if (!tl) return;
        tl.pause();
        tl.seek(time, false);
      };
      window.__renderReady = true;
      return;
    }
    setTimeout(waitForPlayer, 50);
  }
  waitForPlayer();
})();`;

interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
}

interface PresenceHeartbeatBody {
  sessionId: string;
  filePath?: string;
  line?: number;
  column?: number;
  color?: string;
}

interface PresenceSession {
  sessionId: string;
  filePath?: string;
  line?: number;
  column?: number;
  color?: string;
  lastSeen: number;
}

const PRESENCE_ENABLED = process.env.PRESENCE_ENABLED !== "false";
const PRESENCE_TTL_MS = Number(process.env.PRESENCE_TTL_MS ?? "30000");
const PRESENCE_HEARTBEAT_MAX_AGE_MS = Math.max(1_000, PRESENCE_TTL_MS);
const presenceByProject = new Map<string, Map<string, PresenceSession>>();

function getProjectDir(id: string) {
  return join(DATA_DIR, id);
}

function readMeta(id: string): ProjectMeta | null {
  const metaPath = join(getProjectDir(id), "meta.json");
  if (!existsSync(metaPath)) return null;
  return JSON.parse(readFileSync(metaPath, "utf-8"));
}

function sanitizePresenceSession(
  session: PresenceSession,
  now: number
): PresenceSession | null {
  if (now - session.lastSeen > PRESENCE_HEARTBEAT_MAX_AGE_MS) {
    return null;
  }

  return session;
}

function getActivePresenceSessions(projectId: string): PresenceSession[] {
  const now = Date.now();
  const projectPresence = presenceByProject.get(projectId);
  if (!projectPresence) return [];

  const active: PresenceSession[] = [];
  for (const [sessionId, session] of projectPresence.entries()) {
    const sanitized = sanitizePresenceSession(session, now);
    if (!sanitized) {
      projectPresence.delete(sessionId);
      continue;
    }
    active.push(sanitized);
  }

  if (projectPresence.size === 0) {
    presenceByProject.delete(projectId);
  }

  return active;
}

setInterval(() => {
  const projectIds = Array.from(presenceByProject.keys());
  for (const projectId of projectIds) {
    getActivePresenceSessions(projectId);
  }
}, Math.max(1_000, Math.floor(PRESENCE_HEARTBEAT_MAX_AGE_MS / 2))).unref();

/** Inject the sandbox interceptor script before </head> */
function injectInterceptor(html: string): string {
  const interceptorTag = `<script>${getInterceptorScript()}</script>`;
  const renderTag = `<script>${RENDER_MODE_SCRIPT}</script>`;

  if (html.includes("</head>")) {
    html = html.replace("</head>", () => `${interceptorTag}\n</head>`);
  } else {
    const doctypeIdx = html.toLowerCase().indexOf("<!doctype");
    if (doctypeIdx >= 0) {
      const insertPos = html.indexOf(">", doctypeIdx) + 1;
      html = html.slice(0, insertPos) + interceptorTag + html.slice(insertPos);
    } else {
      html = interceptorTag + html;
    }
  }

  if (html.includes("</body>")) {
    return html.replace("</body>", () => `${renderTag}\n</body>`);
  }
  return html + renderTag;
}

export const projects = new Hono();

// List all projects
projects.get("/", (c) => {
  if (!existsSync(DATA_DIR)) return c.json([]);

  const dirs = readdirSync(DATA_DIR, { withFileTypes: true }).filter((d) =>
    d.isDirectory() || d.isSymbolicLink()
  );

  const projectList: ProjectMeta[] = [];
  for (const dir of dirs) {
    const meta = readMeta(dir.name);
    if (meta) projectList.push(meta);
  }

  // Sort newest first
  projectList.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return c.json(projectList);
});

// Upload ZIP
projects.post("/upload", async (c) => {
  const formData = await c.req.formData();
  const file = formData.get("file") as File | null;
  const name = (formData.get("name") as string) || "Untitled Project";

  if (!file) {
    return c.json({ error: "No file provided" }, 400);
  }

  if (!file.name.endsWith(".zip")) {
    return c.json({ error: "File must be a .zip" }, 400);
  }

  const id = randomUUID();
  const projectDir = getProjectDir(id);

  const buffer = Buffer.from(await file.arrayBuffer());
  const result = extractZip(buffer, projectDir);

  if (!result.success) {
    // Clean up on failure
    if (existsSync(projectDir)) {
      rmSync(projectDir, { recursive: true, force: true });
    }
    return c.json({ error: result.error }, 400);
  }

  // Write metadata
  const meta: ProjectMeta = {
    id,
    name,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(join(projectDir, "meta.json"), JSON.stringify(meta, null, 2));

  return c.json(meta, 201);
});

// Get project metadata (with composition dimensions)
projects.get("/:id", (c) => {
  const id = c.req.param("id");
  const meta = readMeta(id);
  if (!meta) return c.json({ error: "Project not found" }, 404);

  // Try to extract composition dimensions from index.html
  const indexPath = join(getProjectDir(id), "index.html");
  let width: number | null = null;
  let height: number | null = null;

  if (existsSync(indexPath)) {
    try {
      const html = readFileSync(indexPath, "utf-8");
      const $ = cheerio.load(html);
      // Look for root composition element with data-width/data-height
      const rootComp = $(
        "[data-composition-id][data-width][data-height]"
      ).first();
      if (rootComp.length) {
        width = parseInt(rootComp.attr("data-width") || "", 10) || null;
        height = parseInt(rootComp.attr("data-height") || "", 10) || null;
      }
    } catch {
      // Ignore parse errors
    }
  }

  return c.json({ ...meta, width, height });
});

// Delete project
projects.delete("/:id", (c) => {
  const id = c.req.param("id");
  const projectDir = getProjectDir(id);

  if (!existsSync(projectDir)) {
    return c.json({ error: "Project not found" }, 404);
  }

  rmSync(projectDir, { recursive: true, force: true });
  presenceByProject.delete(id);
  return c.json({ success: true });
});

projects.post("/:id/presence/heartbeat", async (c) => {
  if (!PRESENCE_ENABLED) {
    return c.json({ enabled: false }, 200);
  }

  const id = c.req.param("id");
  const projectDir = getProjectDir(id);
  if (!existsSync(projectDir)) {
    return c.json({ error: "Project not found" }, 404);
  }

  const body = await c.req.json<PresenceHeartbeatBody>();
  const sessionId = body.sessionId?.trim();
  if (!sessionId) {
    return c.json({ error: "sessionId is required" }, 400);
  }

  const line =
    typeof body.line === "number" && Number.isFinite(body.line)
      ? Math.max(1, Math.floor(body.line))
      : undefined;
  const column =
    typeof body.column === "number" && Number.isFinite(body.column)
      ? Math.max(1, Math.floor(body.column))
      : undefined;

  let projectPresence = presenceByProject.get(id);
  if (!projectPresence) {
    projectPresence = new Map<string, PresenceSession>();
    presenceByProject.set(id, projectPresence);
  }

  projectPresence.set(sessionId, {
    sessionId,
    filePath: typeof body.filePath === "string" ? body.filePath : undefined,
    line,
    column,
    color: typeof body.color === "string" ? body.color : undefined,
    lastSeen: Date.now(),
  });

  return c.json({ enabled: true });
});

projects.get("/:id/presence", (c) => {
  if (!PRESENCE_ENABLED) {
    return c.json({ enabled: false, ttlMs: PRESENCE_HEARTBEAT_MAX_AGE_MS, sessions: [] });
  }

  const id = c.req.param("id");
  const projectDir = getProjectDir(id);
  if (!existsSync(projectDir)) {
    return c.json({ error: "Project not found" }, 404);
  }

  const sessions = getActivePresenceSessions(id);
  return c.json({ enabled: true, ttlMs: PRESENCE_HEARTBEAT_MAX_AGE_MS, sessions });
});

// Update an element's data-start attribute in index.html
projects.patch("/:id/elements/:elementId", async (c) => {
  const id = c.req.param("id");
  const elementId = c.req.param("elementId");
  const projectDir = getProjectDir(id);
  const indexPath = join(projectDir, "index.html");

  if (!existsSync(indexPath)) {
    return c.json({ error: "Project or index.html not found" }, 404);
  }

  const body = await c.req.json<{ start: number }>();
  if (typeof body.start !== "number" || isNaN(body.start)) {
    return c.json({ error: "start must be a valid number" }, 400);
  }

  const html = readFileSync(indexPath, "utf-8");
  const $ = cheerio.load(html, null, false);
  const el = $(`[id="${elementId}"]`);

  if (!el.length) {
    return c.json({ error: `Element #${elementId} not found` }, 404);
  }

  const newStart = Math.max(0, body.start);
  el.attr("data-start", String(newStart));
  writeFileSync(indexPath, $.html(), "utf-8");

  console.log(`[MoveClip] Updated #${elementId} data-start to ${newStart}`);
  return c.json({ elementId, start: newStart });
});

// Preview the final injected HTML as plain text (for debugging)
projects.get("/:id/preview", async (c) => {
  const id = c.req.param("id");
  const projectDir = getProjectDir(id);
  const indexPath = join(projectDir, "index.html");

  if (!existsSync(indexPath)) {
    return c.json({ error: "Project or index.html not found" }, 404);
  }

  const rawHtml = readFileSync(indexPath, "utf-8");
  const compiled = await compileHtml(rawHtml, projectDir);
  const html = injectInterceptor(compiled);

  return new Response(html, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
});

// Preview the original HTML before injection (for comparison)
projects.get("/:id/preview-raw", (c) => {
  const id = c.req.param("id");
  const indexPath = join(getProjectDir(id), "index.html");

  if (!existsSync(indexPath)) {
    return c.json({ error: "Project or index.html not found" }, 404);
  }

  const rawHtml = readFileSync(indexPath, "utf-8");

  return new Response(rawHtml, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
});

// Serve extracted static files
projects.get("/:id/serve/*", async (c) => {
  const id = c.req.param("id");
  const projectDir = getProjectDir(id);

  if (!existsSync(projectDir)) {
    return c.json({ error: "Project not found" }, 404);
  }

  // Get the file path after /serve/
  const url = new URL(c.req.url);
  const servePrefix = `/api/projects/${id}/serve/`;
  let filePath = decodeURIComponent(
    url.pathname.slice(url.pathname.indexOf(servePrefix) + servePrefix.length)
  );

  if (!filePath) filePath = "index.html";

  // Directory traversal protection
  const resolvedPath = resolve(projectDir, filePath);
  if (!resolvedPath.startsWith(projectDir)) {
    return c.json({ error: "Forbidden" }, 403);
  }

  if (!existsSync(resolvedPath) || statSync(resolvedPath).isDirectory()) {
    return c.json({ error: "File not found" }, 404);
  }

  const ext = extname(resolvedPath);
  const contentType = mime.lookup(ext) || "application/octet-stream";

  // For HTML files: compile timing attrs (+ ffprobe unresolved media), then inject interceptor for index.html
  if (ext === ".html") {
    const rawHtml = readFileSync(resolvedPath, "utf-8");
    const compiled = await compileHtml(rawHtml, projectDir);
    const html =
      filePath === "index.html" ? injectInterceptor(compiled) : compiled;

    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  }

  const content = readFileSync(resolvedPath);

  return new Response(content, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-cache",
    },
  });
});

// --- File CRUD for CodeSandbox editor ---

const EDITABLE_EXTENSIONS = new Set([
  ".html",
  ".css",
  ".js",
  ".json",
  ".svg",
  ".txt",
  ".ts",
  ".jsx",
  ".tsx",
]);

function extToLanguage(ext: string): string {
  const map: Record<string, string> = {
    ".html": "html",
    ".css": "css",
    ".js": "javascript",
    ".jsx": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".json": "json",
    ".svg": "xml",
    ".txt": "plaintext",
  };
  return map[ext] || "plaintext";
}

// Recursively collect editable files from a directory
function collectEditableFiles(
  dir: string,
  baseDir: string,
  results: { filename: string; language: string; size: number }[] = []
): { filename: string; language: string; size: number }[] {
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relativePath = fullPath.slice(baseDir.length + 1); // +1 for trailing slash

    if (entry.isDirectory()) {
      collectEditableFiles(fullPath, baseDir, results);
    } else if (entry.isFile()) {
      if (entry.name === "meta.json") continue;
      const ext = extname(entry.name).toLowerCase();
      if (!EDITABLE_EXTENSIONS.has(ext)) continue;

      const stat = statSync(fullPath);
      results.push({
        filename: relativePath,
        language: extToLanguage(ext),
        size: stat.size,
      });
    }
  }

  return results;
}

// List editable text files (including subfolders)
projects.get("/:id/files", (c) => {
  const id = c.req.param("id");
  const projectDir = getProjectDir(id);

  if (!existsSync(projectDir)) {
    return c.json({ error: "Project not found" }, 404);
  }

  const files = collectEditableFiles(projectDir, projectDir);

  // Sort: index.html first, then by path (folders grouped)
  files.sort((a, b) => {
    if (a.filename === "index.html") return -1;
    if (b.filename === "index.html") return 1;
    return a.filename.localeCompare(b.filename);
  });

  return c.json({ files });
});

// Read file content
projects.get("/:id/files/:filename", async (c) => {
  const id = c.req.param("id");
  const filename = c.req.param("filename");
  const projectDir = getProjectDir(id);

  const resolvedPath = resolve(projectDir, filename);
  if (!resolvedPath.startsWith(projectDir)) {
    return c.json({ error: "Forbidden" }, 403);
  }

  if (!existsSync(resolvedPath) || statSync(resolvedPath).isDirectory()) {
    return c.json({ error: "File not found" }, 404);
  }

  const ext = extname(filename).toLowerCase();
  const raw = readFileSync(resolvedPath, "utf-8");
  const isCompiled = c.req.query("compiled") === "true";
  const content =
    isCompiled && ext === ".html" ? await compileHtml(raw, projectDir) : raw;

  return c.json({
    filename,
    language: extToLanguage(ext),
    content,
  });
});

// Write file content
projects.put("/:id/files/:filename", async (c) => {
  const id = c.req.param("id");
  const filename = c.req.param("filename");
  const projectDir = getProjectDir(id);

  if (!existsSync(projectDir)) {
    return c.json({ error: "Project not found" }, 404);
  }

  const resolvedPath = resolve(projectDir, filename);
  if (!resolvedPath.startsWith(projectDir)) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const ext = extname(filename).toLowerCase();
  if (!EDITABLE_EXTENSIONS.has(ext)) {
    return c.json({ error: `File type ${ext} is not editable` }, 400);
  }

  const body = await c.req.json<{ content: string }>();
  if (typeof body.content !== "string") {
    return c.json({ error: "content must be a string" }, 400);
  }

  // Create parent directories if they don't exist
  const parentDir = dirname(resolvedPath);
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  writeFileSync(resolvedPath, body.content, "utf-8");

  return c.json({
    filename,
    language: extToLanguage(ext),
    size: Buffer.byteLength(body.content, "utf-8"),
  });
});
