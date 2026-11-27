import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { STUDIO_PREVIEW_ERRORS } from "@hyperframes/core/studio-preview-mark";
import { createStudioServer, type StudioServer } from "./studioServer.js";
import { cleanupStudioServerRoot, makeStudioServerRoot } from "./studioServerTestFixture.js";

const mounts = (src: string, count: number) =>
  `<div data-composition-id="scene" data-composition-src="${src}" data-start="0" data-duration="1"></div>`.repeat(
    count,
  );

let root: string;
let projectDir: string;
let server: StudioServer;

beforeEach(() => {
  ({ root, projectDir } = makeStudioServerRoot("hf-preview-too-large-"));
  // Four levels of ten: 11,110 mounts from five small files.
  fs.writeFileSync(
    path.join(projectDir, "index.html"),
    `<!doctype html><html><body><div data-composition-id="main" data-width="320" data-height="180">${mounts("level-0.html", 10)}</div></body></html>`,
  );
  for (let level = 0; level < 3; level += 1) {
    fs.writeFileSync(
      path.join(projectDir, `level-${level}.html`),
      `<template><div data-composition-id="scene">${mounts(`level-${level + 1}.html`, 10)}</div></template>`,
    );
  }
  fs.writeFileSync(
    path.join(projectDir, "level-3.html"),
    `<template><div data-composition-id="scene"><h1>Leaf</h1></div></template>`,
  );
  server = createStudioServer({ projectDir, projectName: "film" });
});

afterEach(() => cleanupStudioServerRoot(server, root));

describe("studio preview of a project over the mount limit", () => {
  it("serves the refusal, not the raw page that would expand the mounts in the browser", async () => {
    const response = await server.app.request("/api/projects/film/preview");
    const html = await response.text();

    expect(html).toContain(`window.${STUDIO_PREVIEW_ERRORS}=[`);
    expect(html).toContain("Mount large or repeated scenes fewer times");
    expect(html).not.toContain("<h1>Leaf</h1>");
    expect(html).not.toContain('data-composition-src="level-0.html"');
  });
});
