// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioApi } from "../createStudioApi";
import type { StudioApiAdapter } from "../types";

// Every stat reports the same recent file times, as two writes inside one file-time tick do.
const tick = vi.hoisted(() => ({ ms: 0 }));
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  const pinned = (stat: import("node:fs").Stats) =>
    Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, {
      mtimeMs: tick.ms,
      ctimeMs: tick.ms,
    });
  return {
    ...fs,
    lstatSync: ((path: string, options?: unknown) => {
      const stat = fs.lstatSync(path, options as never);
      return stat && String(path).endsWith("index.html") ? pinned(stat) : stat;
    }) as typeof fs.lstatSync,
  };
});

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function saveTwiceThenLoad(hostSignature?: (dir: string) => string) {
  const project = mkdtempSync(join(tmpdir(), "hf-preview-fresh-"));
  dirs.push(project);
  const file = join(project, "index.html");
  const page = (left: number) =>
    `<html><head></head><body><div style="left: ${left}px"></div></body></html>`;
  tick.ms = Date.now();
  writeFileSync(file, page(200));
  let hostCached: string | null = null;
  const adapter: StudioApiAdapter = {
    listProjects: () => [],
    resolveProject: async (id) => ({ id, dir: project }),
    bundle: async () => readFileSync(file, "utf-8"),
    lint: async () => ({ findings: [] }),
    runtimeUrl: "/api/runtime.js",
    rendersDir: () => join(project, "renders"),
    startRender: () => ({ id: "job", status: "rendering", progress: 0, outputPath: "out.mp4" }),
    ...(hostSignature && {
      getProjectSignature: (dir: string) => (hostCached ??= hostSignature(dir)),
      invalidateProjectSignature: () => {
        hostCached = null;
      },
    }),
  };
  const api = createStudioApi(adapter);
  const url = "http://localhost/projects/demo";
  const save = async (left: number) => {
    const probe = await api.request(`${url}/files/index.html`, { method: "PUT", body: "" });
    const { currentVersion } = (await probe.json()) as { currentVersion: string };
    const res = await api.request(`${url}/files/index.html`, {
      method: "PUT",
      headers: { "If-Match": currentVersion },
      body: page(left),
    });
    expect(res.status).toBeLessThan(300);
  };
  const load = async () => (await api.request(`${url}/preview`)).text();

  await save(201);
  expect(await load()).toContain("left: 201px");
  await save(202);
  expect(await load()).toContain("left: 202px");
}

describe("the preview after a Studio write", () => {
  it("serves a same-size rewrite made inside one file-time tick", async () => {
    await saveTwiceThenLoad();
  });

  it("serves it when the host signs with its own copy of the signature module", async () => {
    // The Studio dev server loads the API from source and its signature cache from the build.
    vi.resetModules();
    const { createProjectSignature } = await import("../helpers/projectSignature");
    await saveTwiceThenLoad(createProjectSignature);
  });
});
