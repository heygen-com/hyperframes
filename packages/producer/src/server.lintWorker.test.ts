import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

// Every /lint page runs on a worker that never answers, stopped by a short limit.
vi.mock("./services/hyperframeLint.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./services/hyperframeLint.js")>();
  const stuck = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "services/__fixtures__/lintWorkerStuck.mjs",
  );
  return {
    ...actual,
    runHyperframeLint: (prepared: Parameters<typeof actual.runHyperframeLint>[0]) =>
      actual.runHyperframeLint(prepared, { workerEntry: stuck, timeoutMs: 500 }),
  };
});

import { createProducerApp } from "./server.js";

describe("POST /lint", () => {
  it("answers 200 with lint_aborted for a page whose lint never ends, and the server keeps answering", async () => {
    const root = mkdtempSync(join(tmpdir(), "hf-lint-route-"));
    const app = createProducerApp({
      projectsDir: join(root, "projects"),
      rendersDir: join(root, "renders"),
    });
    const lint = Promise.resolve(
      app.request("http://localhost:9847/lint", {
        method: "POST",
        headers: { host: "localhost:9847" },
        body: JSON.stringify({ html: "hang" }),
      }),
    );
    // While that page is stuck, another request is answered.
    const health = await app.request("http://localhost:9847/health", {
      headers: { host: "localhost:9847" },
    });
    expect(health.status).toBe(200);

    const res = await lint;
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      result: { findings: { code: string }[] };
    };
    expect(body.success).toBe(true);
    expect(body.result.findings.map((finding) => finding.code)).toEqual(["lint_aborted"]);
  }, 30_000);
});
