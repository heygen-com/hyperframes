// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioApi } from "../createStudioApi";
import type { StudioApiAdapter } from "../types";

// Every stat reports the same file times, as two writes inside one file-time tick do.
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  const pinned = (stat: import("node:fs").Stats) =>
    Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, { mtimeMs: 1, ctimeMs: 1 });
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

describe("the preview after a Studio write", () => {
  it("serves a same-size rewrite made inside one file-time tick", async () => {
    const project = mkdtempSync(join(tmpdir(), "hf-preview-fresh-"));
    dirs.push(project);
    const file = join(project, "index.html");
    const page = (left: number) =>
      `<html><head></head><body><div style="left: ${left}px"></div></body></html>`;
    writeFileSync(file, page(200));
    const adapter: StudioApiAdapter = {
      listProjects: () => [],
      resolveProject: async (id) => ({ id, dir: project }),
      bundle: async () => readFileSync(file, "utf-8"),
      lint: async () => ({ findings: [] }),
      runtimeUrl: "/api/runtime.js",
      rendersDir: () => join(project, "renders"),
      startRender: () => ({ id: "job", status: "rendering", progress: 0, outputPath: "out.mp4" }),
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
  });
});
