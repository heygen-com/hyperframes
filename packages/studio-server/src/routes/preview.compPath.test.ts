// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioApi } from "../createStudioApi";
import type { StudioApiAdapter } from "../types";

const projectDir = mkdtempSync(join(tmpdir(), "hf-preview-comp-path-"));
mkdirSync(join(projectDir, "scenes"));
writeFileSync(join(projectDir, "index.html"), "<html><head></head><body></body></html>");
writeFileSync(
  join(projectDir, "scenes", "intro.html"),
  '<div data-composition-id="intro" data-width="320" data-height="180"><p>Hi</p></div>',
);
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

const compositionFile = (html: string) => html.match(/data-composition-file="([^"]*)"/)?.[1];

describe("a sub-composition preview", () => {
  it("names its root's file by the composition's own path", async () => {
    const res = await api.request("http://localhost/projects/demo/preview/comp/scenes/intro.html");
    expect(res.status).toBe(200);
    expect(compositionFile(await res.text())).toBe("scenes/intro.html");
  });

  it("keeps request text that path resolution drops out of the document", async () => {
    const res = await api.request(
      "http://localhost/projects/demo/preview/comp/x%22%20onmouseover%3D%22alert(1)%2F..%2Fscenes%2Fintro.html",
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(compositionFile(html)).toBe("scenes/intro.html");
    expect(html).not.toContain("onmouseover");
  });
});
