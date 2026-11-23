import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { compileForRender } from "./htmlCompiler.js";

const downloads = vi.hoisted(() => [] as { url: string; destDir: string }[]);
vi.mock("../utils/urlDownloader.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/urlDownloader.js")>()),
  downloadToTemp: async (url: string, destDir: string) => {
    downloads.push({ url, destDir });
    throw new Error("offline test");
  },
  fetchPublicHttpsText: async () => {
    throw new Error("offline test");
  },
}));

const dirs: string[] = [];
afterEach(() => {
  downloads.length = 0;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// The download cache is keyed by url and folder: one folder is what makes the second request a cache hit.
it("asks for a remote video in one folder for both its duration probe and its localisation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hf-remote-once-"));
  dirs.push(dir);
  const url = "https://media.example.com/clip.mp4";
  const htmlPath = join(dir, "index.html");
  writeFileSync(
    htmlPath,
    `<!doctype html><html><body><main data-composition-id="root" data-start="0" data-width="16" data-height="16"><video id="v" muted src="${url}" data-start="0" data-track-index="0"></video></main></body></html>`,
  );
  await compileForRender(dir, htmlPath, join(dir, "out"), { allowSystemFontCapture: false });
  const forClip = downloads.filter((call) => call.url === url);
  expect(forClip.length).toBeGreaterThanOrEqual(2);
  expect(new Set(forClip.map((call) => call.destDir)).size).toBe(1);
});
