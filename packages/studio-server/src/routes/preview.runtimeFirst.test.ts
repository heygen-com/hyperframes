// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import { bundleToSingleHtml } from "@hyperframes/core/compiler";
import { createStudioApi } from "../createStudioApi";
import { PREVIEW_BUNDLE_OPTIONS } from "../index";
import type { StudioApiAdapter } from "../types";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const PAGE = "<script>window.PAGE_RAN=1</script>";
const STAGE = '<div data-composition-id="main" data-width="320" data-height="180"></div>';

// Each page is one a browser opens; they differ in where the page's first script sits.
const shapes: Record<string, string> = {
  "script in head": `<!doctype html><html><head>${PAGE}</head><body>${STAGE}</body></html>`,
  "script between html and head": `<!doctype html><html>${PAGE}<head><title>x</title></head><body>${STAGE}</body></html>`,
  "script before html": `<!doctype html>${PAGE}<html><head></head><body>${STAGE}</body></html>`,
  "script before the doctype": `${PAGE}<!doctype html><html><head></head><body>${STAGE}</body></html>`,
  "no head": `<html>${PAGE}<body>${STAGE}</body></html>`,
  "no head and no body": `${PAGE}${STAGE}`,
  "a head in a comment first": `<!-- <head> -->${PAGE}<html><head></head><body>${STAGE}</body></html>`,
  "an svg script before html": `<svg><script>window.PAGE_RAN=1</script></svg><html><head></head><body>${STAGE}</body></html>`,
  "body before head": `<body>${PAGE}${STAGE}</body><head></head>`,
};

const builds: Record<string, StudioApiAdapter["bundle"]> = {
  "the build runs": async (dir, options) =>
    (await bundleToSingleHtml(dir, { ...PREVIEW_BUNDLE_OPTIONS, ...options })).replace(
      'data-hyperframes-preview-runtime="1" src=""',
      'data-hyperframes-preview-runtime="1" src="/api/runtime.js"',
    ),
  "the build returns nothing": async () => null,
  "the build throws": async () => {
    throw new Error("build failed");
  },
};

// A host's step between the build and Studio's own additions. The font step of the CLI and of a desktop host
// parses the page and writes it out again, so one of these does the same.
const hostSteps: Record<string, StudioApiAdapter["transformPreviewHtml"]> = {
  "no host step": undefined,
  "a host step that re-writes the page": ({ html }) => parseHTML(html).document.toString(),
};

function api(
  html: string,
  bundle: StudioApiAdapter["bundle"],
  transformPreviewHtml?: StudioApiAdapter["transformPreviewHtml"],
) {
  const project = mkdtempSync(join(tmpdir(), "hf-preview-runtime-first-"));
  dirs.push(project);
  writeFileSync(join(project, "index.html"), html);
  mkdirSync(join(project, "scenes"));
  writeFileSync(join(project, "scenes", "one.html"), html);
  return createStudioApi({
    listProjects: () => [],
    resolveProject: async (id) => ({ id, dir: project }),
    bundle,
    transformPreviewHtml,
    lint: async () => ({ findings: [] }),
    runtimeUrl: "/api/runtime.js",
    rendersDir: () => join(project, "renders"),
    startRender: () => ({ id: "job", status: "rendering", progress: 0, outputPath: "out.mp4" }),
  });
}

function order(page: string) {
  const runtime = page.indexOf('src="/api/runtime.js"');
  // The build rewrites a page script (it spaces the statement), so the search allows both spellings.
  const author = page.search(/window\.PAGE_RAN\s*=\s*1/);
  return { runtime, author };
}

const cases = Object.entries(shapes).flatMap(([shape, html]) =>
  Object.entries(hostSteps).map(([step, transform]) => [shape, step, html, transform] as const),
);

describe("the preview runtime script loads before any page script", () => {
  for (const [build, bundle] of Object.entries(builds)) {
    it.each(cases)(`root page, ${build}: %s, %s`, async (_shape, _step, html, transform) => {
      const res = await api(html, bundle, transform).request(
        "http://localhost/projects/demo/preview",
      );
      const { runtime, author } = order(await res.text());
      expect(runtime).toBeGreaterThan(-1);
      expect(author).toBeGreaterThan(runtime);
    });
  }

  it.each(cases)("one composition file: %s, %s", async (_shape, _step, html, transform) => {
    const res = await api(html, builds["the build returns nothing"]!, transform).request(
      "http://localhost/projects/demo/preview/comp/scenes/one.html",
    );
    const page = await res.text();
    const { runtime, author } = order(page);
    expect(runtime).toBeGreaterThan(-1);
    // This page is rebuilt from the file's head and body; a script outside both is left out of it.
    if (page.includes("PAGE_RAN")) expect(author).toBeGreaterThan(runtime);
  });
});
