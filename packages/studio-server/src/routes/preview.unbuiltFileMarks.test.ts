// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioApi } from "../createStudioApi";
import type { StudioApiAdapter } from "../types";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const entry = (mark: string) => `<html><head></head><body><div data-composition-id="main">
  <p id="claim" ${mark}="scenes/other.html">Hi</p>
  <template><b ${mark}="scenes/other.html">later</b></template>
</div></body></html>`;

function api(bundle: StudioApiAdapter["bundle"], mark: string) {
  const project = mkdtempSync(join(tmpdir(), "hf-preview-unbuilt-marks-"));
  dirs.push(project);
  writeFileSync(join(project, "index.html"), entry(mark));
  return createStudioApi({
    listProjects: () => [],
    resolveProject: async (id) => ({ id, dir: project }),
    bundle,
    lint: async () => ({ findings: [] }),
    runtimeUrl: "/api/runtime.js",
    rendersDir: () => join(project, "renders"),
    startRender: () => ({ id: "job", status: "rendering", progress: 0, outputPath: "out.mp4" }),
  });
}

const noBuild: StudioApiAdapter["bundle"] = async () => null;
const failedBuild: StudioApiAdapter["bundle"] = async () => {
  throw new Error("esbuild failed");
};

describe("the saved page served when the build does not run", () => {
  it.each([
    ["returns nothing", "data-composition-file", noBuild],
    ["throws", "data-composition-file", failedBuild],
    ["returns nothing", "DATA-Composition-File", noBuild],
    ["throws", "DATA-Composition-File", failedBuild],
  ] as const)(
    "drops the file marks it authored when the build %s (written %s)",
    async (_label, mark, bundle) => {
      const res = await api(bundle, mark).request("http://localhost/projects/demo/preview");
      const page = await res.text();

      expect(page).toContain('id="claim"');
      expect(page.toLowerCase()).not.toContain("data-composition-file");
    },
  );
});
