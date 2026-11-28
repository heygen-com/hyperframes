// @vitest-environment node
import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioApi } from "../createStudioApi";
import type { StudioApiAdapter } from "../types";

vi.mock("../helpers/subCompositionBuild.js", async (real) => ({
  ...(await real<typeof import("../helpers/subCompositionBuild.js")>()),
  ROOT_PREVIEW_DEADLINE_MS: 200,
}));

const projectDir = mkdtempSync(join(tmpdir(), "hf-preview-root-deadline-"));
writeFileSync(
  join(projectDir, "index.html"),
  '<html><head></head><body><div data-composition-id="main"><p>saved film</p></div></body></html>',
);
afterAll(() => rmSync(projectDir, { recursive: true, force: true }));

const adapter: StudioApiAdapter = {
  listProjects: () => [],
  resolveProject: async (id: string) => ({ id, dir: projectDir }),
  bundle: () => new Promise<never>(() => {}),
  lint: async () => ({ findings: [] }),
  runtimeUrl: "/api/runtime.js",
  rendersDir: () => join(projectDir, "renders"),
  startRender: () => ({ id: "job", status: "rendering", progress: 0, outputPath: "/tmp/out.mp4" }),
};

describe("the root preview page's deadline", () => {
  // fails without the fix: a host bundle that never answered kept the page request open, past every deadline.
  it("covers the host's own bundle: past it, the page built from the saved file is served", async () => {
    const api = createStudioApi(adapter);
    const late = new Promise<"no answer">((done) => setTimeout(done, 5_000, "no answer"));
    const res = await Promise.race([api.request("http://localhost/projects/demo/preview"), late]);
    expect(res).not.toBe("no answer");
    const page = res as Response;
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("saved film");
  }, 30_000);
});
