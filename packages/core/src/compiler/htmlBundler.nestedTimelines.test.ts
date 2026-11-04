// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { bundleToSingleHtml } from "./htmlBundler.js";

/** Each script wrapper's runtime timeline key, in the bundle's order. */
const timelineKeys = (html: string) =>
  [...html.matchAll(/var __hfTimelineCompId = "([^"]*)";/g)].map(([, id]) => id);

// fails without the fix: two caption layers of one style inside a scene registered their timelines under the
// file's shared id, so the first take played the second take's words and the second played none.
it("gives each host inside a scene its own timeline, even when their files share a composition id", async () => {
  const project = mkdtempSync(join(tmpdir(), "hf-nested-timelines-"));
  try {
    mkdirSync(join(project, "layers"));
    writeFileSync(
      join(project, "index.html"),
      `<html><body>
      <div data-composition-id="main" data-width="320" data-height="180" data-duration="4">
        <div data-composition-id="captions" data-composition-src="captions.html" data-start="0" data-duration="4"></div>
      </div></body></html>`,
    );
    writeFileSync(
      join(project, "captions.html"),
      `<template><div data-composition-id="captions" data-width="320" data-height="180" data-duration="4">
        <div data-composition-id="take-a" data-composition-src="layers/a.html" data-start="0" data-duration="2"></div>
        <div data-composition-id="take-b" data-composition-src="layers/b.html" data-start="2" data-duration="2"></div>
      </div></template>`,
    );
    for (const take of ["a", "b"]) {
      writeFileSync(
        join(project, "layers", `${take}.html`),
        `<html><body><div data-composition-id="caption-style" data-width="320" data-height="180">
          <p id="words">${take}</p>
          <script>
            window.__timelines = window.__timelines || {};
            window.__timelines["caption-style"] = gsap.timeline({ paused: true });
          </script>
        </div></body></html>`,
      );
    }
    const bundled = await bundleToSingleHtml(project);
    expect(timelineKeys(bundled)).toEqual(expect.arrayContaining(["take-a", "take-b"]));
    expect(timelineKeys(bundled)).not.toContain("caption-style");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
