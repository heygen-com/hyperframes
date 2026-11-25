// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioApi } from "../createStudioApi";
import type { StudioApiAdapter } from "../types";

const SCRIPT = `<script>fetch("/api/projects")</script>`;
const projectDir = mkdtempSync(join(tmpdir(), "hf-preview-compositions-only-"));
for (const dir of ["scenes", "extracted", ".hyperframes"]) mkdirSync(join(projectDir, dir));
writeFileSync(join(projectDir, "index.html"), '<div data-composition-id="main"></div>');
writeFileSync(join(projectDir, "scenes", "intro.html"), '<div data-composition-id="intro"></div>');
writeFileSync(join(projectDir, "scenes", "outro.htm"), '<div data-composition-id="outro"></div>');
writeFileSync(join(projectDir, "extracted", "page.html"), `<html><body>${SCRIPT}</body></html>`);
writeFileSync(join(projectDir, "extracted", "visible-text.txt"), SCRIPT);
writeFileSync(join(projectDir, "data.json"), JSON.stringify({ html: SCRIPT }));
writeFileSync(join(projectDir, "subs.vtt"), `WEBVTT\n\n00:00.000 --> 00:01.000\n${SCRIPT}`);
writeFileSync(join(projectDir, "clip.mp4"), `<div data-composition-id="x">${SCRIPT}</div>`);
writeFileSync(
  join(projectDir, ".hyperframes", "preset.html"),
  `<div data-composition-id="p">${SCRIPT}</div>`,
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

const comp = (path: string, site?: string) =>
  api.request(`http://localhost/projects/demo/preview/comp/${path}`, {
    headers: site === undefined ? {} : { "sec-fetch-site": site },
  });

// fails without the fix: the comp route built a page from any project file, so its scripts ran on Studio's origin
describe("the sub-composition preview", () => {
  const notCompositions = [
    "extracted/page.html",
    "extracted/visible-text.txt",
    "data.json",
    "subs.vtt",
    "clip.mp4",
    ".hyperframes/preset.html",
  ];
  const sites = [undefined, "same-origin", "none", "cross-site"];

  it.each(notCompositions)("answers no page for %s, however the request is made", async (path) => {
    for (const site of sites) {
      const res = await comp(path, site);
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type") ?? "").not.toContain("text/html");
      expect(await res.text()).not.toContain("fetch(");
    }
  });

  it.each(["scenes/intro.html", "scenes/outro.htm"])("still builds %s", async (path) => {
    const res = await comp(path, "same-origin");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("answers only for what the project listing reports as compositions", async () => {
    const listing = await (await api.request("http://localhost/projects/demo")).json();
    expect([...listing.compositions].sort()).toEqual([
      "index.html",
      "scenes/intro.html",
      "scenes/outro.htm",
    ]);
  });
});
