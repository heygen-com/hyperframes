import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const debugDir = vi.hoisted(() => ({ path: "" }));

vi.mock("./services/renderOrchestrator.js", () => {
  class RenderCancelledError extends Error {}

  return {
    RenderCancelledError,
    resolveRenderDebugDir: () => debugDir.path,
    createRenderJob: (config: Record<string, unknown>) => ({
      id: "job-id",
      config,
      progress: 0,
      currentStage: "queued",
      warnings: [],
    }),
    executeRenderJob: async (job: Record<string, unknown>) => {
      job.outcome = "completed";
      job.perfSummary = { renderId: "job-id", workers: 1 };
    },
  };
});

import { createProducerApp, startServer, type HandlerOptions } from "./server.js";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "hf-server-access-"));
  const projectsDir = join(root, "projects");
  const rendersDir = join(root, "renders");
  debugDir.path = join(root, ".debug");
  mkdirSync(join(projectsDir, "demo"), { recursive: true });
  writeFileSync(join(projectsDir, "demo", "index.html"), "<html></html>");
  writeFileSync(join(root, "outside.html"), "<html></html>");
  mkdirSync(join(debugDir.path, "job"), { recursive: true });
  writeFileSync(join(debugDir.path, "job", "index.html"), "<html></html>");
  return { root, projectsDir, rendersDir };
}

function post(options: HandlerOptions, body: Record<string, unknown>, headers = {}) {
  return createProducerApp(options).request("http://localhost:9847/render", {
    method: "POST",
    headers: { host: "localhost:9847", ...headers },
    body: JSON.stringify(body),
  });
}

describe("createProducerApp: auth token", () => {
  it("refuses requests without the bearer token, except /health", async () => {
    const { projectsDir, rendersDir } = setup();
    const options = { projectsDir, rendersDir, authToken: "s3cret" };
    expect((await post(options, { projectDir: "demo" })).status).toBe(401);
    expect(
      (await post(options, { projectDir: "demo" }, { authorization: "Bearer wrong" })).status,
    ).toBe(401);
    expect(
      (await post(options, { projectDir: "demo" }, { authorization: "Bearer s3cret" })).status,
    ).toBe(200);
    const health = await createProducerApp(options).request("http://localhost:9847/health");
    expect(health.status).toBe(200);
  });
});

describe("createProducerApp: request paths", () => {
  it("renders a project under the projects root into the renders dir", async () => {
    const { projectsDir, rendersDir } = setup();
    const res = await post(
      { projectsDir, rendersDir },
      { projectDir: "demo", outputPath: join(rendersDir, "a/b.mp4") },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { perf: Record<string, unknown> };
    expect(json.perf).toEqual({ workers: 1 });
  });

  it("refuses an output path outside the renders dir without creating it", async () => {
    const { root, projectsDir, rendersDir } = setup();
    const outputPath = join(root, "elsewhere", "x.mp4");
    const res = await post({ projectsDir, rendersDir }, { projectDir: "demo", outputPath });
    expect(res.status).toBe(400);
    expect(existsSync(join(root, "elsewhere"))).toBe(false);
  });

  it("refuses project dirs and entry files outside the projects root", async () => {
    const { root, projectsDir, rendersDir } = setup();
    const options = { projectsDir, rendersDir };
    expect((await post(options, { projectDir: root, entryFile: "outside.html" })).status).toBe(400);
    expect(
      (await post(options, { projectDir: "demo", entryFile: "../../outside.html" })).status,
    ).toBe(400);
    const res = await post(options, { projectDir: "../" });
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain(root);
  });

  it("refuses the debug dir as project content", async () => {
    const { root, rendersDir } = setup();
    const options = { projectsDir: root, rendersDir };
    expect((await post(options, { projectDir: ".debug/job" })).status).toBe(400);
    expect(
      (await post(options, { projectDir: ".", entryFile: ".debug/job/index.html" })).status,
    ).toBe(400);
  });

  it("accepts debug only when the operator allows it", async () => {
    const { projectsDir, rendersDir } = setup();
    const body = { projectDir: "demo", debug: true };
    expect((await post({ projectsDir, rendersDir }, body)).status).toBe(400);
    expect((await post({ projectsDir, rendersDir, allowDebug: true }, body)).status).toBe(200);
  });
});

describe("createProducerApp: lint paths", () => {
  it("refuses a lint projectDir outside the projects root", async () => {
    const { root, projectsDir, rendersDir } = setup();
    const lint = (projectDir: string) =>
      createProducerApp({ projectsDir, rendersDir }).request("http://localhost:9847/lint", {
        method: "POST",
        headers: { host: "localhost:9847" },
        body: JSON.stringify({ projectDir }),
      });
    expect((await lint(root)).status).toBe(400);
    expect((await lint("../")).status).toBe(400);
    expect((await lint("demo")).status).toBe(200);
  });
});

describe("startServer: listen address", () => {
  it("refuses a non-loopback address without an auth token", () => {
    expect(() => startServer({ hostname: "0.0.0.0", port: 0 })).toThrow(/auth token/);
  });
});
