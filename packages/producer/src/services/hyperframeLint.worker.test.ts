import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getHeapStatistics } from "node:v8";
import { describe, expect, it } from "vitest";
import { lintHyperframeHtml } from "@hyperframes/lint";
import { runHyperframeLint } from "./hyperframeLint.js";

const STUCK = resolve(dirname(fileURLToPath(import.meta.url)), "__fixtures__/lintWorkerStuck.mjs");
const PAGE = `<html><body><div id="root" data-composition-id="main" data-width="1920" data-height="1080"></div></body></html>`;
const prepared = (html: string) => ({ entryFile: "index.html", html, source: "html" as const });
const withoutTimings = ({ timings: _timings, ...rest }: Record<string, unknown>) => rest;

describe("runHyperframeLint", () => {
  it("lints a page on a worker thread to what the linter returns in process", async () => {
    const result = await runHyperframeLint(prepared(PAGE));
    const direct = await lintHyperframeHtml(PAGE, {
      filePath: "index.html",
      compSrcPath: "index.html",
    });
    expect(withoutTimings({ ...result })).toEqual(withoutTimings({ ...direct }));
  }, 30_000);

  it("caps the worker's heap", async () => {
    const result = await runHyperframeLint(prepared("heap"), { workerEntry: STUCK, heapMb: 64 });
    // Uncapped, a thread has the main thread's limit; the cap (plus its young generation) is far below it.
    const { heapLimitMb } = result as unknown as { heapLimitMb: number };
    expect(heapLimitMb).toBeLessThan(getHeapStatistics().heap_size_limit / 1048576 / 2);
  });

  it.each([
    ["runs past its time limit", "hang", { timeoutMs: 300 }],
    ["runs out of memory", "alloc", { timeoutMs: 20_000, heapMb: 64 }],
    ["has no worker to run on", PAGE, { workerEntry: "/nonexistent/worker.mjs", timeoutMs: 300 }],
  ])(
    "a page that %s is answered with the lint_aborted error",
    async (_name, html, limits) => {
      const began = performance.now();
      const result = await runHyperframeLint(prepared(html), { workerEntry: STUCK, ...limits });
      expect(performance.now() - began).toBeLessThan(10_000);
      expect([result.ok, result.errorCount, result.warningCount, result.infoCount]).toEqual([
        false,
        1,
        0,
        0,
      ]);
      expect(result.findings.map(({ code, severity, file }) => [code, severity, file])).toEqual([
        ["lint_aborted", "error", "index.html"],
      ]);
    },
    30_000,
  );

  it("with every worker slot taken, a waiting page is answered lint_aborted when its time is up and no extra worker starts", async () => {
    const log = join(mkdtempSync(join(tmpdir(), "hf-lint-slots-")), "starts");
    process.env.HF_LINT_FIXTURE_LOG = log;
    try {
      const limits = { workerEntry: STUCK, maxWorkers: 1 };
      const holder = runHyperframeLint(prepared("hang"), { ...limits, timeoutMs: 1_500 });
      await new Promise((resolve) => setTimeout(resolve, 300));
      const began = performance.now();
      const waiter = await runHyperframeLint(prepared("hang"), { ...limits, timeoutMs: 300 });
      expect(performance.now() - began).toBeLessThan(1_000);
      expect(waiter.findings.map(({ code }) => code)).toEqual(["lint_aborted"]);
      expect(readFileSync(log, "utf-8")).toBe("x");
      expect((await holder).findings.map(({ code }) => code)).toEqual(["lint_aborted"]);
    } finally {
      delete process.env.HF_LINT_FIXTURE_LOG;
    }
  }, 30_000);
});
