/**
 * File Server
 *
 * Lightweight HTTP server that serves a project directory to headless Chrome.
 * Optionally injects scripts into index.html on-the-fly (e.g. runtime, bridge).
 * Framework-agnostic — the caller decides what scripts to inject.
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".aac": "audio/aac",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

function stripEmbeddedRuntimeScripts(html: string): string {
  if (!html) return html;
  const scriptRe = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
  const runtimeSrcMarkers = [
    "hyperframe.runtime.iife.js",
    "hyperframes-runtime.modular.inline.js",
    "data-hyperframes-preview-runtime",
  ];
  const runtimeInlineMarkers = [
    "__hyperframeRuntimeBootstrapped",
    "__hyperframeRuntime",
    "__hyperframeRuntimeTeardown",
    "window.__player =",
    "window.__playerReady",
    "window.__renderReady",
  ];

  const shouldStrip = (block: string): boolean => {
    const lowered = block.toLowerCase();
    for (const marker of runtimeSrcMarkers) {
      if (lowered.includes(marker.toLowerCase())) {
        return true;
      }
    }
    for (const marker of runtimeInlineMarkers) {
      if (block.includes(marker)) {
        return true;
      }
    }
    return false;
  };

  return html.replace(scriptRe, (block) => (shouldStrip(block) ? "" : block));
}

function injectScriptsIntoHtml(
  html: string,
  headScripts: string[],
  bodyScripts: string[],
  stripEmbedded: boolean,
): string {
  if (stripEmbedded) {
    html = stripEmbeddedRuntimeScripts(html);
  }

  if (headScripts.length > 0) {
    const headTags = headScripts.map((src) => `<script>${src}</script>`).join("\n");
    if (html.includes("</head>")) {
      html = html.replace("</head>", () => `${headTags}\n</head>`);
    } else if (html.includes("<body")) {
      html = html.replace("<body", () => `${headTags}\n<body`);
    } else {
      html = headTags + "\n" + html;
    }
  }

  if (bodyScripts.length > 0) {
    const bodyTags = bodyScripts.map((src) => `<script>${src}</script>`).join("\n");
    if (html.includes("</body>")) {
      html = html.replace("</body>", () => `${bodyTags}\n</body>`);
    } else {
      html = html + "\n" + bodyTags;
    }
  }

  return html;
}

export interface FileServerOptions {
  projectDir: string;
  compiledDir?: string;
  port?: number;
  /** Scripts injected into <head> of index.html. Default: none. */
  headScripts?: string[];
  /** Scripts injected before </body> of index.html. Default: none. */
  bodyScripts?: string[];
  /** Strip embedded runtime scripts from HTML before injection. Default: true. */
  stripEmbeddedRuntime?: boolean;
}

export interface FileServerHandle {
  url: string;
  port: number;
  close: () => void;
}

export function createFileServer(options: FileServerOptions): Promise<FileServerHandle> {
  const { projectDir, compiledDir, port = 0, stripEmbeddedRuntime = true } = options;

  const headScripts = options.headScripts ?? [];
  const bodyScripts = options.bodyScripts ?? [];

  const app = new Hono();

  app.get("/*", (c) => {
    let requestPath = c.req.path;
    if (requestPath === "/") requestPath = "/index.html";

    // Remove leading slash
    const relativePath = requestPath.replace(/^\//, "");
    const compiledPath = compiledDir ? join(compiledDir, relativePath) : null;
    const hasCompiledFile = Boolean(compiledPath && existsSync(compiledPath) && statSync(compiledPath).isFile());
    const filePath = hasCompiledFile ? (compiledPath as string) : join(projectDir, relativePath);

    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      return c.text("Not found", 404);
    }

    const ext = extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    if (ext === ".html") {
      const rawHtml = readFileSync(filePath, "utf-8");
      const html =
        relativePath === "index.html"
          ? injectScriptsIntoHtml(rawHtml, headScripts, bodyScripts, stripEmbeddedRuntime)
          : rawHtml;
      return c.text(html, 200, { "Content-Type": contentType });
    }

    const content = readFileSync(filePath);
    return new Response(content, {
      status: 200,
      headers: { "Content-Type": contentType },
    });
  });

  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port }, (info) => {
      const actualPort = info.port;
      const url = `http://localhost:${actualPort}`;
      resolve({
        url,
        port: actualPort,
        close: () => server.close(),
      });
    });
  });
}
