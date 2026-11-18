// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioApi } from "../createStudioApi";
import type { StudioApiAdapter } from "../types";

const projectDir = mkdtempSync(join(tmpdir(), "hf-preview-worker-"));
writeFileSync(join(projectDir, "index.html"), '<div data-composition-id="main"></div>');
writeFileSync(join(projectDir, "worker.js"), "self.onfetch = () => {};");
mkdirSync(join(projectDir, "comp"));
writeFileSync(join(projectDir, "comp", "worker.js"), "self.onfetch = () => {};");
afterAll(() => rmSync(projectDir, { recursive: true, force: true }));

const adapter: StudioApiAdapter = {
  listProjects: () => [],
  resolveProject: async (id: string) => ({ id, dir: projectDir }),
  bundle: async () => null,
  lint: async () => ({ findings: [] }),
  runtimeUrl: "/api/runtime.js",
  rendersDir: () => join(projectDir, "renders"),
  startRender: () => ({ id: "job", status: "rendering", progress: 0, outputPath: "/tmp/out.mp4" }),
};
const api = createStudioApi(adapter);
const get = (path: string, headers: Record<string, string>) =>
  api.request(`http://localhost${path}`, {
    headers: { "sec-fetch-site": "same-origin", ...headers },
  });

const paths = ["/projects/demo/preview/worker.js", "/projects/demo/preview/comp/worker.js"];
const workerFetches = [{ "service-worker": "script" }, { "sec-fetch-dest": "serviceworker" }];

describe("a project file asked for as a service worker's script", () => {
  it.each(paths)("is refused at %s, however the browser marks the fetch", async (path) => {
    for (const headers of workerFetches) expect((await get(path, headers)).status).toBe(403);
  });

  it.each(paths)("still loads at %s as a page script, module or dedicated worker", async (path) => {
    for (const dest of ["script", "worker", "empty"]) {
      const res = await get(path, { "sec-fetch-dest": dest });
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("onfetch");
    }
  });
});
