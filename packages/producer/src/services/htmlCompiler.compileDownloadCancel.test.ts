import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { compileForRender } from "./htmlCompiler.js";

const requests = vi.hoisted(() => [] as { url: string; signal?: AbortSignal }[]);
vi.mock("../utils/urlDownloader.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/urlDownloader.js")>()),
  // A transport that never answers: only an abort settles a request.
  downloadToTemp: (url: string, _dir: string, _timeoutMs?: number, signal?: AbortSignal) => {
    requests.push({ url, signal });
    return new Promise<string>((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  },
  fetchPublicHttpsText: async () => {
    throw new Error("offline test");
  },
}));

const dirs: string[] = [];
afterEach(() => {
  requests.length = 0;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const url = (ext: string) => `https://media.example.com/asset.${ext}`;
const root = (body: string) =>
  `<!doctype html><html><head></head><body><main data-composition-id="root" data-start="0" data-duration="1" data-width="16" data-height="16">${body}</main></body></html>`;

const assets = [
  [
    "video",
    "mp4",
    (src: string) => `<video muted src="${src}" data-start="0" data-track-index="0"></video>`,
  ],
  ["image", "png", (src: string) => `<img src="${src}">`],
  ["background image", "jpg", (src: string) => `<div style="background-image: url(${src})"></div>`],
  [
    "font",
    "woff2",
    (src: string) =>
      `<style>@font-face { font-family: Remote; src: url(${src}); } main { font-family: Remote; }</style>text`,
  ],
] as const;

async function cancelDuring(files: Record<string, string>, asset: string) {
  const dir = mkdtempSync(join(tmpdir(), "hf-compile-cancel-"));
  dirs.push(dir);
  for (const [name, html] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), html);
  }
  const cancel = new AbortController();
  const compile = compileForRender(dir, join(dir, "index.html"), join(dir, "out"), {
    allowSystemFontCapture: false,
    abortSignal: cancel.signal,
  });
  await vi.waitFor(() => expect(requests.some((request) => request.url === asset)).toBe(true));
  const started = requests.length;
  cancel.abort(new Error("render cancelled"));

  await expect(compile).rejects.toThrow("render cancelled");
  expect(requests.every((request) => request.signal?.aborted)).toBe(true);
  expect(requests).toHaveLength(started);
}

// fails without the fix: the media, image, background and font downloads had no signal, so a cancel waited on them.
it.each(assets)(
  "a cancel during a remote %s download stops the compile",
  async (_kind, ext, markup) => {
    await cancelDuring({ "index.html": root(markup(url(ext))) }, url(ext));
  },
);

it.each(assets)(
  "a cancel during a sub-composition's remote %s download stops the compile",
  async (_kind, ext, markup) => {
    await cancelDuring(
      {
        "index.html": root(
          `<div data-composition-id="scene" data-composition-src="scene.html" data-start="0" data-duration="1"></div>`,
        ),
        "scene.html": `<template><div data-composition-id="scene" data-width="16" data-height="16">${markup(url(ext))}</div></template>`,
      },
      url(ext),
    );
  },
);
