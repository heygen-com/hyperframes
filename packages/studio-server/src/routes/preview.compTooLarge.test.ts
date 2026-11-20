// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STUDIO_PREVIEW_ERRORS } from "@hyperframes/core/studio-preview-mark";
import { MAX_EXPANDED_COMPOSITION_BYTES } from "@hyperframes/core/compiler/composition-size-limit";
import { createStudioApi } from "../createStudioApi";
import type { StudioApiAdapter } from "../types";

const projectDir = mkdtempSync(join(tmpdir(), "hf-preview-comp-too-large-"));
afterAll(() => rmSync(projectDir, { recursive: true, force: true }));

const mounts = (src: string, count: number) =>
  `<div data-composition-id="scene" data-composition-src="${src}"></div>`.repeat(count);
const page = (body: string) =>
  `<template><div data-composition-id="page" data-width="320" data-height="180">${body}</div></template>`;

writeFileSync(join(projectDir, "index.html"), "<html><head></head><body></body></html>");
writeFileSync(join(projectDir, "leaf.html"), page("<h1>Leaf</h1>"));
writeFileSync(join(projectDir, "many.html"), page(mounts("leaf.html", 10_001)));
writeFileSync(
  join(projectDir, "big.html"),
  page(`<p>${"x".repeat(Math.ceil(MAX_EXPANDED_COMPOSITION_BYTES / 5))}</p>`),
);
writeFileSync(join(projectDir, "heavy.html"), page(mounts("big.html", 6)));
writeFileSync(join(projectDir, "heavy-encoded.html"), page(mounts("b%69g.html", 6)));
writeFileSync(join(projectDir, "few.html"), page(mounts("leaf.html", 3)));

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
const open = (file: string) => api.request(`http://localhost/projects/demo/preview/comp/${file}`);

describe("a sub-composition preview over a size limit", () => {
  it("refuses a page whose mounts the browser would fetch past the mount limit", async () => {
    const html = await (await open("many.html")).text();
    expect(html).toContain(`window.${STUDIO_PREVIEW_ERRORS}=["`);
    expect(html).toContain("Mount large or repeated scenes fewer times");
    expect(html).not.toContain('data-composition-src="leaf.html"');
  });

  it("refuses a page whose mounts add up past the byte limit", async () => {
    const html = await (await open("heavy.html")).text();
    expect(html).toContain(`window.${STUDIO_PREVIEW_ERRORS}=["`);
    expect(html).not.toContain('data-composition-src="big.html"');
  });

  it("charges a percent-encoded src for the file the route serves for it", async () => {
    const html = await (await open("heavy-encoded.html")).text();
    expect(html).toContain(`window.${STUDIO_PREVIEW_ERRORS}=["`);
    expect(html).not.toContain('data-composition-src="b%69g.html"');
  });

  it("still serves a page with a few mounts", async () => {
    const res = await open("few.html");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html.split('data-composition-src="leaf.html"').length - 1).toBe(3);
    expect(html).not.toContain(`window.${STUDIO_PREVIEW_ERRORS}=["`);
  });
});
