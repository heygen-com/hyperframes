import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { compileForRender, MAX_REMOTE_ASSETS } from "./htmlCompiler.js";

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

const videos = (prefix: string, count: number) =>
  Array.from(
    { length: count },
    (_, i) =>
      `<video muted src="https://media.example.com/${prefix}${i}.mp4" data-start="0" data-track-index="0"></video>`,
  ).join("");
const scene = (id: string, body: string) =>
  `<template><div data-composition-id="${id}" data-width="16" data-height="16">${body}</div></template>`;
const mount = (id: string) =>
  `<div data-composition-id="${id}" data-composition-src="${id}.html" data-start="0" data-duration="1"></div>`;

function compile(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "hf-asset-lifetime-"));
  dirs.push(dir);
  for (const [name, html] of Object.entries(files)) writeFileSync(join(dir, name), html);
  return compileForRender(dir, join(dir, "index.html"), join(dir, "out"), {
    allowSystemFontCapture: false,
  });
}
const root = (body: string) =>
  `<!doctype html><html><head></head><body><main data-composition-id="root" data-start="0" data-duration="1" data-width="16" data-height="16">${body}</main></body></html>`;

// fails without the fix: a failed compile left its other downloads running, with nothing to stop them.
it("stops every download of a compile that fails", async () => {
  const compiled = compile({
    "index.html": root(mount("a") + mount("b")),
    "a.html": scene("a", videos("a", 20)),
    "b.html": scene("b", videos("b", MAX_REMOTE_ASSETS)),
  });

  await expect(compiled).rejects.toThrow(`at most ${MAX_REMOTE_ASSETS} are downloaded`);
  const started = requests.length;
  expect(started).toBeGreaterThan(0);
  expect(requests.every((request) => request.signal?.aborted)).toBe(true);
  await new Promise(setImmediate);
  expect(requests).toHaveLength(started);
});

// fails without the fix: each source was reserved on its own, so the first ones started before the cap refused.
it.each([
  ["without", "<video "],
  ["with", '<video data-duration="1" '],
])(
  "refuses a file's media %s a set duration past the cap before any of them downloads",
  async (_with, tag) => {
    const body = videos("v", MAX_REMOTE_ASSETS + 1).replaceAll("<video ", tag);
    await expect(compile({ "index.html": root(body) })).rejects.toThrow(
      `at most ${MAX_REMOTE_ASSETS} are downloaded`,
    );
    expect(requests).toHaveLength(0);
  },
);
