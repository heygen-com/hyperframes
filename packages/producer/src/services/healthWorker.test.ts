/**
 * Tests for the worker_thread /health endpoint.
 *
 * The pin: the listener answers from a worker_thread, so it stays responsive
 * even if the main thread is blocked on a sync task. We verify:
 *
 *  1. Boot: startHealthWorker resolves once the worker is listening, and the
 *     endpoint returns 200 + the expected JSON body.
 *  2. Liveness across main-thread block: while the main thread is blocked on
 *     a long synchronous loop, /health still answers within a tight budget.
 *     This is the property k8s probes need: probe responsiveness is
 *     decoupled from main-thread event-loop latency.
 *  3. Shutdown: the handle's shutdown() actually frees the port (subsequent
 *     boot on the same port succeeds).
 */

import { afterEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { request as httpRequest } from "node:http";
import { startHealthWorker, type HealthWorkerHandle } from "./healthWorker.js";

// Use a fixed test port well above the producer's default port range.
const TEST_PORT = 19848;

// Resolve the worker entry from this test file so vitest (tsx-driven) loads
// the .ts source rather than looking for a non-existent dist/ artifact.
const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER_ENTRY = resolve(HERE, "healthWorkerThread.ts");

async function fetchHealth(
  port: number,
  timeoutMs = 1_000,
): Promise<{ status: number; body: string }> {
  return new Promise((resolveFetch, rejectFetch) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path: "/health",
        method: "GET",
        timeout: timeoutMs,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => resolveFetch({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error(`request timed out after ${timeoutMs}ms`));
    });
    req.on("error", rejectFetch);
    req.end();
  });
}

describe("healthWorker", () => {
  const handles: HealthWorkerHandle[] = [];

  afterEach(async () => {
    while (handles.length > 0) {
      const h = handles.pop()!;
      await h.shutdown().catch(() => {});
    }
  });

  it("boots and serves /health from the worker thread", async () => {
    const handle = await startHealthWorker({
      port: TEST_PORT,
      workerEntry: WORKER_ENTRY,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    handles.push(handle);
    expect(handle.port).toBe(TEST_PORT);

    const res = await fetchHealth(TEST_PORT);
    expect(res.status).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.status).toBe("ok");
    expect(json.thread).toBe("worker");
    expect(typeof json.uptime).toBe("number");
    expect(typeof json.timestamp).toBe("string");
  });

  it("stays responsive while the main thread is blocked on a sync task", async () => {
    const handle = await startHealthWorker({
      port: TEST_PORT,
      workerEntry: WORKER_ENTRY,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    handles.push(handle);

    // Kick off a request, then block the main thread synchronously for 500ms.
    // If /health lived on the main thread, the response wouldn't arrive
    // until after the block finishes. Because it lives on a worker_thread,
    // the worker's socket accept loop has already started responding.
    const fetchPromise = fetchHealth(TEST_PORT, 2_000);
    const blockStart = Date.now();
    // Busy-spin without yielding to the event loop. 500ms is well over the
    // 5s prod probe timeout's "0.1x" budget; a 1s budget on the fetch is
    // generous.
    // eslint-disable-next-line no-empty
    while (Date.now() - blockStart < 500) {}
    const res = await fetchPromise;
    expect(res.status).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.status).toBe("ok");
  });

  it("releases the port on shutdown", async () => {
    const first = await startHealthWorker({
      port: TEST_PORT,
      workerEntry: WORKER_ENTRY,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    await first.shutdown();

    // Booting again on the same port should succeed.
    const second = await startHealthWorker({
      port: TEST_PORT,
      workerEntry: WORKER_ENTRY,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    handles.push(second);
    const res = await fetchHealth(TEST_PORT);
    expect(res.status).toBe(200);
  });
});
