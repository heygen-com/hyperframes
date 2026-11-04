import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import { expect, it } from "vitest";
import { bundleToSingleHtml } from "./htmlBundler.js";

it.each([false, true])(
  "gives colliding scene videos distinct render identities (pre-stamped: %s)",
  async (preStamped) => {
    const project = mkdtempSync(join(tmpdir(), "hf-scene-media-identity-"));
    try {
      mkdirSync(join(project, "scenes"));
      writeFileSync(
        join(project, "index.html"),
        `<html><body>
      <div data-composition-id="main" data-width="320" data-height="180" data-duration="4">
        <div data-composition-id="first" data-composition-src="scenes/first.html" data-start="0" data-duration="2"></div>
        <div data-composition-id="second" data-composition-src="scenes/second.html" data-start="2" data-duration="2"></div>
      </div></body></html>`,
      );
      for (const scene of ["first", "second"]) {
        writeFileSync(
          join(project, "scenes", `${scene}.html`),
          `<template id="${scene}-template">
        <div data-composition-id="${scene}" data-width="320" data-height="180" data-duration="2">
          <video id="clip" ${preStamped ? 'data-hf-render-id="clip"' : ""} src="../source.mov" data-start="0" data-duration="2"></video>
        </div></template>`,
        );
      }
      const { document } = parseHTML(await bundleToSingleHtml(project, { staticGuard: false }));
      const videos = [...document.querySelectorAll("video")];
      expect(videos.map((video) => video.id)).toEqual(["clip", "clip"]);
      expect(videos.map((video) => video.getAttribute("data-hf-render-id"))).toEqual([
        "clip",
        "clip__hf2",
      ]);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  },
);
