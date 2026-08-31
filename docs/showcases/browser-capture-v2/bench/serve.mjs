import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const BENCH_DIR = dirname(fileURLToPath(import.meta.url));
const SHOWCASE_DIR = resolve(BENCH_DIR, "..");
const CORE_DIST = resolve(BENCH_DIR, "../../../../packages/core/dist");
const EVIDENCE_DIR = resolve(SHOWCASE_DIR, "evidence");
const PORT = Number(process.env.PORT ?? 4178);
const MAX_EVIDENCE_BYTES = 64 * 1024;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

function safePath(root, pathname) {
  const target = resolve(root, `.${pathname}`);
  return target === root || target.startsWith(`${root}${sep}`) ? target : null;
}

async function body(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_EVIDENCE_BYTES) throw new Error("evidence body is too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(response, status, value) {
  response.writeHead(status, { "content-type": MIME[".json"] });
  response.end(`${JSON.stringify(value, null, 2)}\n`);
}

async function serveFile(response, path) {
  try {
    const content = await readFile(path);
    response.writeHead(200, {
      "content-type": MIME[extname(path)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(content);
  } catch {
    response.writeHead(404);
    response.end("not found\n");
  }
}

await mkdir(EVIDENCE_DIR, { recursive: true });

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${PORT}`);
  const evidenceMatch = /^\/evidence\/([a-z0-9-]+)$/.exec(url.pathname);
  if (evidenceMatch) {
    const id = evidenceMatch[1];
    const path = resolve(EVIDENCE_DIR, `${id}.json`);
    if (request.method === "POST") {
      try {
        const evidence = JSON.parse(await body(request));
        if (evidence.caseId !== id) throw new Error("evidence case does not match the route");
        await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
        return sendJson(response, 200, { ok: true, path: `evidence/${id}.json` });
      } catch (error) {
        return sendJson(response, 400, { ok: false, error: String(error) });
      }
    }
    if (request.method === "GET") return serveFile(response, path);
    response.writeHead(405, { allow: "GET, POST" });
    return response.end("method not allowed\n");
  }

  if (url.pathname.startsWith("/core/")) {
    const path = safePath(CORE_DIST, url.pathname.slice("/core".length));
    return path ? serveFile(response, path) : sendJson(response, 400, { error: "invalid path" });
  }

  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const path = safePath(BENCH_DIR, pathname);
  return path ? serveFile(response, path) : sendJson(response, 400, { error: "invalid path" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Web Capture v2 bench: http://127.0.0.1:${PORT}`);
  console.log(`Evidence directory: ${EVIDENCE_DIR}`);
});
