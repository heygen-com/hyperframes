// @vitest-environment node
// Node environment: the abort tests need a request's AbortSignal to reach the route.
import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerLintRoutes } from "./lint";
import { stubAdapter } from "./stubAdapter.test-helpers";
import type { ProjectLintResult, StudioApiAdapter } from "../types";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function projectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-lint-runs-"));
  tempDirs.push(dir);
  writeFileSync(join(dir, "index.html"), "<html><body>real</body></html>");
  return dir;
}

const CLEAN: ProjectLintResult = { results: [{ file: "index.html", result: { findings: [] } }] };

/** Stands in for the lint worker: each run stays live until it is aborted or finished. */
function workerPool() {
  let live = 0;
  let peak = 0;
  let started = 0;
  const finishers: Array<() => void> = [];
  const lintProject = (_dir: string, signal?: AbortSignal) =>
    new Promise<ProjectLintResult>((resolve, reject) => {
      started++;
      live++;
      peak = Math.max(peak, live);
      let exited = false;
      const exit = (settle: () => void) => {
        if (exited) return;
        exited = true;
        live--;
        settle();
      };
      signal?.addEventListener("abort", () => exit(() => reject(signal.reason)), { once: true });
      finishers.push(() => exit(() => resolve(CLEAN)));
    });
  return {
    lintProject,
    finishAll: () => finishers.splice(0).forEach((finish) => finish()),
    stats: () => ({ live, peak, started }),
  };
}

function appFor(dirsById: Record<string, string>, lintProject: StudioApiAdapter["lintProject"]) {
  const adapter: StudioApiAdapter = {
    ...stubAdapter(""),
    resolveProject: async (id: string) => {
      const dir = dirsById[id];
      return dir ? { id, dir } : null;
    },
    lintProject,
  };
  const app = new Hono();
  registerLintRoutes(app, adapter);
  return app;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("project lint runs", () => {
  it("shares one run between concurrent requests for the same project", async () => {
    const pool = workerPool();
    const app = appFor({ demo: projectDir() }, pool.lintProject);

    const requests = Array.from({ length: 5 }, () =>
      app.request("http://localhost/projects/demo/lint"),
    );
    await vi.waitFor(() => expect(pool.stats().started).toBe(1));
    await tick();
    expect(pool.stats().started).toBe(1);
    pool.finishAll();

    for (const res of await Promise.all(requests)) expect(res.status).toBe(200);
    expect(pool.stats().started).toBe(1);
  });

  it("starts a fresh run when the project changed after a run began", async () => {
    const pool = workerPool();
    const dir = projectDir();
    const app = appFor({ demo: dir }, pool.lintProject);

    const before = app.request("http://localhost/projects/demo/lint");
    await vi.waitFor(() => expect(pool.stats().started).toBe(1));
    writeFileSync(join(dir, "scene.html"), "<html><body>new scene</body></html>");
    const after = app.request("http://localhost/projects/demo/lint");
    await vi.waitFor(() => expect(pool.stats().started).toBe(2));
    pool.finishAll();
    for (const res of await Promise.all([before, after])) expect(res.status).toBe(200);
  });

  it("aborts a run once no request waits on it", async () => {
    const pool = workerPool();
    const app = appFor({ demo: projectDir() }, pool.lintProject);
    const first = new AbortController();
    const second = new AbortController();

    const requests = [first, second].map((controller) =>
      app.request("http://localhost/projects/demo/lint", { signal: controller.signal }),
    );
    await vi.waitFor(() => expect(pool.stats().live).toBe(1));
    first.abort();
    await tick();
    expect(pool.stats().live).toBe(1);
    second.abort();
    await tick();
    expect(pool.stats().live).toBe(0);
    await Promise.allSettled(requests);
  });

  it("never keeps more than two runs live while requests start and abort", async () => {
    const pool = workerPool();
    const dirs = Object.fromEntries(
      Array.from({ length: 6 }, (_, index) => [`p${index}`, projectDir()]),
    );
    const app = appFor(dirs, pool.lintProject);
    const pending: Promise<Response>[] = [];

    for (let round = 0; round < 20; round++) {
      const controllers = Object.keys(dirs).map((id) => {
        const controller = new AbortController();
        pending.push(
          app.request(`http://localhost/projects/${id}/lint`, { signal: controller.signal }),
        );
        return controller;
      });
      await vi.waitFor(() => expect(pool.stats().live).toBe(2));
      for (const controller of controllers) controller.abort();
      await vi.waitFor(() => expect(pool.stats().live).toBe(0));
    }

    expect(pool.stats().peak).toBe(2);
    expect(pool.stats().live).toBe(0);
    await Promise.allSettled(pending);
  });
});
