import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  bundleToSingleHtml,
  extractCompiledHtmlParityContract,
  injectScriptsIntoHtml,
} from "@hyperframes/core/compiler";
import { compileForRender } from "./htmlCompiler.js";
import { getVerifiedHyperframeRuntimeSource } from "./hyperframeRuntimeLoader.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-compiler-parity-"));
  tempDirs.push(dir);
  for (const [relative, content] of Object.entries(files)) {
    const path = join(dir, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return dir;
}

async function contracts(files: Record<string, string>) {
  const dir = project(files);
  const preview = await bundleToSingleHtml(dir);
  const render = await compileForRender(dir, join(dir, "index.html"), join(dir, ".downloads"), {
    allowSystemFontCapture: false,
  });
  const servedRender = injectScriptsIntoHtml(
    render.html,
    [getVerifiedHyperframeRuntimeSource()],
    [],
    true,
  );
  return {
    preview: extractCompiledHtmlParityContract(preview),
    render: extractCompiledHtmlParityContract(servedRender),
  };
}

const shell = (body: string, head = "") => `<!doctype html>
<html><head>${head}</head><body>${body}
<script>window.__timelines = window.__timelines || {};</script></body></html>`;

describe("preview/render semantic compilation parity", () => {
  it("preserves canonical timing, track, authored style, font, and resource contracts", async () => {
    const result = await contracts({
      "index.html": shell(
        `<main data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="4">
          <div id="title" data-start="1" data-duration="2" data-track-index="3" class="clip parity-card">Title</div>
          <img id="logo" src="assets/logo.svg" alt="" />
        </main>`,
        `<style>@font-face { font-family: "ParityDisplay"; src: url(data:font/woff2;base64,d09GMgAB) format("woff2"); }
        .parity-card { --parity-contract: 1; color: red; font-family: "ParityDisplay", sans-serif; }</style>`,
      ),
      "assets/logo.svg": `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>`,
    });
    expect(result.render).toEqual(result.preview);
  });

  it("keeps legacy end/layer timing semantically identical", async () => {
    const result = await contracts({
      "index.html":
        shell(`<main data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="5">
        <div id="legacy" class="clip" data-start="1.5" data-end="4" data-layer="2">Legacy timing</div>
      </main>`),
    });
    expect(result.render).toEqual(result.preview);
  });

  it("keeps flattened sub-composition identity and variable bootstrap identical", async () => {
    const result = await contracts({
      "index.html":
        shell(`<main data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="6">
        <section id="card-host" data-composition-id="card" data-composition-src="compositions/card.html"
          data-start="1" data-duration="3" data-variable-values='{"title":"Pro"}'></section>
      </main>`),
      "compositions/card.html": `<template id="card-template">
        <article data-composition-id="card" data-width="800" data-height="600">
          <h2 id="card-title" class="parity-card">Card</h2>
          <style>@font-face { font-family: ParityBody; src: url(data:font/woff2;base64,d09GMgAB) format("woff2"); }
          .parity-card { --parity-contract: 2; font-family: ParityBody, sans-serif; }</style>
        </article>
      </template>
      <script>window.__timelines = window.__timelines || {};</script>`,
    });
    expect(result.render).toEqual(result.preview);
  });
});
