// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STUDIO_PREVIEW_ERRORS } from "@hyperframes/core/studio-preview-mark";
import { createStudioApi } from "../createStudioApi";
import type { StudioApiAdapter } from "../types";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const RAW_ENTRY = `<html><head></head><body><div data-composition-src="scene.html"></div></body></html>`;

function api(bundle: StudioApiAdapter["bundle"]) {
  const project = mkdtempSync(join(tmpdir(), "hf-preview-too-large-"));
  dirs.push(project);
  writeFileSync(join(project, "index.html"), RAW_ENTRY);
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

const tooLarge = (message: string) =>
  Object.assign(new Error(message), { code: "COMPOSITION_TOO_LARGE" as const });

describe("a preview over a size limit", () => {
  it("shows the refusal instead of the raw page, whose mounts the browser would expand", async () => {
    const message = 'Sub-composition mounts, ending at "<b>scene</b>.html", add up to 64.1 MB.';
    const res = await api(async () => {
      throw tooLarge(message);
    }).request("http://localhost/projects/demo/preview");

    const page = await res.text();
    expect(page).toContain(`window.${STUDIO_PREVIEW_ERRORS}=[`);
    expect(page).toContain("&lt;b&gt;scene&lt;/b&gt;.html");
    expect(page).not.toContain("<b>scene</b>");
    expect(page).not.toContain('data-composition-src="scene.html"');
  });

  it("still falls back to the raw page for any other bundle failure", async () => {
    const res = await api(async () => {
      throw new Error("esbuild failed");
    }).request("http://localhost/projects/demo/preview");

    expect(await res.text()).toContain('data-composition-src="scene.html"');
  });
});
