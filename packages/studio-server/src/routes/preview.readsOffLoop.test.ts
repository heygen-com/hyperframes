// @vitest-environment node
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { Hono } from "hono";
import { afterEach, expect, it } from "vitest";
import { affectsPreview } from "../helpers/previewReads";
import type { StudioApiAdapter } from "../types";
import { registerPreviewRoutes } from "./preview";

const FILES = 20_000;
let root = "";
afterEach(() => rmSync(root, { recursive: true, force: true }));

const adapter = (dir: string, bundle: StudioApiAdapter["bundle"]): StudioApiAdapter => ({
  listProjects: () => [],
  resolveProject: async (id: string) => ({ id, dir }),
  bundle,
  lint: async () => ({ findings: [] }),
  runtimeUrl: "/api/runtime.js",
  rendersDir: () => "/tmp/renders",
  startRender: () => ({
    id: "job-1",
    status: "rendering",
    progress: 0,
    outputPath: "/tmp/out.mp4",
  }),
});

// The histogram has no sample for work that starts in the tick it was enabled in, so wait for one first.
async function longestHoldMs(work: () => Promise<unknown>): Promise<number> {
  const delay = monitorEventLoopDelay({ resolution: 10 });
  delay.enable();
  while (delay.count === 0) await new Promise(setImmediate);
  await work();
  const seen = delay.count;
  while (delay.count === seen) await new Promise(setImmediate);
  delay.disable();
  return delay.max / 1e6;
}

const pageNaming = (files: string[]) =>
  `<html><body>${files.map((file) => `<img src="${file}">`).join("")}</body></html>`;

// fails without the fix: the build walked each of its 40,000 reads with blocking readlinks (a 1.7 s hold).
it("builds a preview of a page naming 20,000 media files without holding the event loop", async () => {
  root = mkdtempSync(join(tmpdir(), "preview-reads-"));
  // In a linked library, which the project's signature does not list, so the build's own reads are what is timed.
  const library = join(root, "library");
  const projectDir = join(root, "project");
  mkdirSync(library);
  mkdirSync(projectDir);
  symlinkSync(library, join(projectDir, "media"), "junction");
  const files = Array.from({ length: FILES }, (_, i) => `media/clip-${i}.png`);
  for (let i = 0; i < FILES; i++) writeFileSync(join(library, `clip-${i}.png`), "");
  const html = pageNaming(files);
  writeFileSync(join(projectDir, "index.html"), html);
  const app = new Hono();
  registerPreviewRoutes(
    app,
    adapter(projectDir, async (dir, options) => {
      for (const file of files) options?.onRead?.(join(dir, file));
      return html;
    }),
  );

  let status = 0;
  const hold = await longestHoldMs(async () => {
    status = (await app.request("http://localhost/projects/demo/preview")).status;
  });

  expect(status).toBe(200);
  expect(hold).toBeLessThan(200);
  expect(affectsPreview(projectDir, join(library, `clip-${FILES - 1}.png`))).toBe(true);
});

// fails without the fix: the build failed and the sub-composition route answered a server error.
it.skipIf(process.platform === "win32")(
  "still answers when the project folder's real path cannot be resolved",
  async () => {
    root = mkdtempSync(join(tmpdir(), "preview-reads-"));
    const projectDir = join(root, "loop");
    symlinkSync("loop", projectDir);
    const html = pageNaming(["media/a.png"]);
    const app = new Hono();
    registerPreviewRoutes(
      app,
      adapter(projectDir, async () => html),
    );

    expect((await app.request("http://localhost/projects/demo/preview")).status).toBe(200);
    expect(
      (await app.request("http://localhost/projects/demo/preview/comp/scene.html")).status,
    ).toBe(404);
  },
);

it.skipIf(process.platform === "win32")(
  "counts a change behind a symlinked folder the build read through",
  async () => {
    const projectDir = (root = realpathSync(mkdtempSync(join(tmpdir(), "preview-reads-"))));
    mkdirSync(join(projectDir, "shared", "clips"), { recursive: true });
    writeFileSync(join(projectDir, "shared", "clips", "a.png"), "");
    writeFileSync(join(projectDir, "shared", "clips", "b.png"), "");
    symlinkSync("shared/clips", join(projectDir, "media"));
    const html = pageNaming(["media/a.png"]);
    writeFileSync(join(projectDir, "index.html"), html);
    const app = new Hono();
    registerPreviewRoutes(
      app,
      adapter(projectDir, async (dir, options) => {
        options?.onRead?.(join(dir, "media", "b.png"));
        return html;
      }),
    );

    expect((await app.request("http://localhost/projects/demo/preview")).status).toBe(200);

    expect(affectsPreview(projectDir, "media")).toBe(true);
    expect(affectsPreview(projectDir, "shared/clips/a.png")).toBe(true);
    expect(affectsPreview(projectDir, "shared/clips/b.png")).toBe(true);
    expect(affectsPreview(projectDir, "shared/clips/c.png")).toBe(false);
  },
);
