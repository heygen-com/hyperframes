import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { lintHyperframeHtml } from "./hyperframeLinter.js";
import { lintProject } from "./project.js";

const HIDDEN = "<svg><title><!-- </title><img src=x onerror=f()> --></title></svg>";
const page = (body: string) =>
  `<!DOCTYPE html><html><head></head><body><div data-composition-id="main" data-width="320" data-height="180" data-start="0" data-duration="2">${body}</div></body></html>`;
const scene = (body: string) =>
  `<template><div data-composition-id="scene" data-width="320" data-height="180">${body}</div></template>`;
const host = (src: string) =>
  `<div data-composition-id="scene" data-composition-src="${src}" data-start="0" data-duration="1"></div>`;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-lint-refused-"));
  dirs.push(dir);
  for (const [path, html] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), html);
  }
  return dir;
}

const refusalsIn = (findings: { code: string; file?: string }[]) =>
  findings.filter((finding) => finding.code === "html_read_unlike_browser");

// fails without the fix: the parser's refusal escaped lint, so `hyperframes lint` failed the whole run with a
// runtime_error instead of naming the file.
describe("a file the HTML parser refuses", () => {
  it("is one error finding when linted on its own", async () => {
    const result = await lintHyperframeHtml(page(HIDDEN));
    expect(result.ok).toBe(false);
    expect(refusalsIn(result.findings)).toHaveLength(1);
    expect(result.findings[0]?.message).toMatch(/can't be read the way a browser reads them/);
  });

  it("is a finding on the root, not a failed run", async () => {
    const dir = project({ "index.html": page(HIDDEN) });
    const { results, totalErrors } = await lintProject(dir);
    expect(refusalsIn(results[0]!.result.findings)).toHaveLength(1);
    expect(totalErrors).toBeGreaterThan(0);
  });

  it("is a finding on its own file while the rest of the project is still linted", async () => {
    const dir = project({
      "index.html": page(host("compositions/scene.html")),
      "compositions/scene.html": scene(HIDDEN),
    });
    const { results } = await lintProject(dir);
    const sceneResult = results.find((entry) => entry.file === "compositions/scene.html");
    expect(refusalsIn(sceneResult!.result.findings)).toHaveLength(1);
    expect(refusalsIn(results[0]!.result.findings)).toHaveLength(0);
  });

  it("leaves the report whole when the mounted file's name is URL-encoded", async () => {
    const dir = project({
      "index.html": page(
        `${host("scenes/my%20scene.html")}<audio src="missing.mp3" data-start="0"></audio>`,
      ),
      "scenes/my scene.html": scene(HIDDEN),
    });
    const { results } = await lintProject(dir);
    const codes = results.flatMap((entry) => entry.result.findings.map((finding) => finding.code));
    expect(codes).toContain("audio_src_not_found");
  });

  it("is named when a scene outside compositions/ mounts it", async () => {
    const dir = project({
      "index.html": page(host("scenes/scene.html")),
      "scenes/scene.html": scene(HIDDEN),
    });
    const { results } = await lintProject(dir);
    const messages = results.flatMap((entry) =>
      entry.result.findings.map((finding) => finding.message),
    );
    expect(messages.join("\n")).toMatch(
      /scenes\/scene\.html[\s\S]*can't be read the way a browser reads them/,
    );
  });
});
