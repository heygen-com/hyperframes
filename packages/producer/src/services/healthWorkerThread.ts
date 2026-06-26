/**
 * Worker-thread entry for the off-main-thread /health endpoint.
 *
 * Runs a minimal `node:http` server bound to `workerData.port` that answers
 * `GET /health` with `{ status, uptime, timestamp, thread: "worker" }`.
 *
 * Lifecycle:
 *
 * - On startup, binds the port and posts `{ type: "listening" }` to the
 *   parent. If `listen()` errors (port in use, permission denied), posts
 *   `{ type: "listen-error", error }` and exits non-zero.
 * - On `{ type: "shutdown" }` from the parent, closes the server and exits 0.
 * - All other requests (path or method other than `GET /health`) get 404.
 *
 * The HTTP layer is intentionally raw — no framework, zero deps beyond the
 * Node stdlib — so the worker's surface is small and its event loop has
 * nothing to block on except its own socket accept loop.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { parentPort, workerData } from "node:worker_threads";

const startTime = Date.now();
const port = Number(workerData?.port ?? 9848);

if (!parentPort) {
  // Defensive — this module is only meaningful inside a worker_thread.
  throw new Error("[healthWorkerThread] must run inside a worker_thread");
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  if (req.method === "GET" && (req.url === "/health" || req.url?.startsWith("/health?"))) {
    const body = JSON.stringify({
      status: "ok",
      uptime: Math.floor((Date.now() - startTime) / 1000),
      timestamp: new Date().toISOString(),
      thread: "worker",
    });
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      "Cache-Control": "no-store",
    });
    res.end(body);
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

// Disable timeouts — `/health` is a fast endpoint, but if the kernel is
// slow to flush at process-tear-down time we'd rather respond than time out.
server.keepAliveTimeout = 0;
server.requestTimeout = 0;
server.headersTimeout = 0;

server.on("error", (err: NodeJS.ErrnoException) => {
  parentPort?.postMessage({
    type: "listen-error",
    error: `${err.code ?? "unknown"}: ${err.message}`,
  });
  // Give the parent a beat to receive the error, then close our message
  // channel so the worker thread exits naturally. process.exit() inside a
  // worker has had inconsistent semantics across Node versions; closing
  // parentPort + letting the event loop drain is the documented clean path
  // and lets the parent's `exit` listener fire with the natural code.
  setTimeout(() => parentPort?.close(), 50);
});

server.listen(port, "0.0.0.0", () => {
  parentPort?.postMessage({ type: "listening", port });
});

parentPort.on("message", (msg: { type?: string }) => {
  if (msg?.type === "shutdown") {
    // Close the server and the parent-port message channel. The parent
    // owns the authoritative shutdown timeout (see healthWorker.ts —
    // Promise.race against a 2s clock then worker.terminate()), so we do
    // NOT need a redundant force-exit timer here: if server.close() hangs
    // on a lingering keep-alive socket, the parent's terminate() lands
    // first and kills the worker. Single source of truth for the deadline.
    server.close(() => parentPort?.close());
  }
});
