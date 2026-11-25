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

const ENTRY = `<html><head></head><body><div data-composition-id="main">
  <p id="claim" data-composition-file="scenes/other.html">Hi</p>
</div></body></html>`;

function api(bundle: StudioApiAdapter["bundle"]) {
  const project = mkdtempSync(join(tmpdir(), "hf-preview-unbuilt-marks-"));
  dirs.push(project);
  writeFileSync(join(project, "index.html"), ENTRY);
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

describe("the saved page served when the build does not run", () => {
  it.each([
    ["returns nothing", async () => null],
    [
      "throws",
      async () => {
        throw new Error("esbuild failed");
      },
    ],
  ] as const)("drops the file marks it authored when the build %s", async (_label, bundle) => {
    const page = await (await api(bundle).request("http://localhost/projects/demo/preview")).text();

    expect(page).toContain('id="claim"');
    expect(page).not.toContain("data-composition-file");
  });
});
