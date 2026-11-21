// @vitest-environment node
import { afterAll, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StudioApiAdapter } from "../types";

// Each page pass the request thread runs on a whole page, counted here; the build worker loads its own copies.
const onThread = vi.hoisted(() => ({ passes: [] as string[], minLength: Infinity }));
const counted =
  <A extends unknown[], R>(name: string, real: (html: string, ...rest: A) => R) =>
  (html: string, ...rest: A): R => {
    if (typeof html === "string" && html.length >= onThread.minLength) onThread.passes.push(name);
    return real(html, ...rest);
  };
vi.mock("linkedom", async (actual) => {
  const real = await actual<typeof import("linkedom")>();
  return { ...real, parseHTML: counted("parseHTML", real.parseHTML as (html: string) => unknown) };
});
vi.mock("@hyperframes/parsers/hf-ids", async (actual) => {
  const real = await actual<typeof import("@hyperframes/parsers/hf-ids")>();
  return { ...real, ensureHfIds: counted("ensureHfIds", real.ensureHfIds) };
});
vi.mock("@hyperframes/core/compiler", async (actual) => {
  const real = await actual<typeof import("@hyperframes/core/compiler")>();
  return {
    ...real,
    addScenePartsManifest: counted("addScenePartsManifest", real.addScenePartsManifest),
  };
});

const { createStudioApi } = await import("../createStudioApi");

const projectDir = mkdtempSync(join(tmpdir(), "hf-preview-root-off-thread-"));
afterAll(() => rmSync(projectDir, { recursive: true, force: true }));
const shapes = Array.from(
  { length: 2_000 },
  (_, i) => `<path d="M${i % 97} ${i % 89}l9 1 6 8-3 9-8 1z" fill="hsl(${i % 360} 70% 55%)"/>`,
).join("");
const page = `<!doctype html><html><head></head><body><div id="root" data-composition-id="main" data-width="320" data-height="180"><svg viewBox="0 0 100 100">${shapes}</svg><p id="hello">Hi</p></div></body></html>`;
writeFileSync(join(projectDir, "index.html"), page);

const adapter: StudioApiAdapter = {
  listProjects: () => [],
  resolveProject: async (id: string) => ({ id, dir: projectDir }),
  bundle: async () => page,
  lint: async () => ({ findings: [] }),
  runtimeUrl: "/api/runtime.js",
  rendersDir: () => join(projectDir, "renders"),
  startRender: () => ({ id: "job", status: "rendering", progress: 0, outputPath: "/tmp/out.mp4" }),
};

// fails without the fix: the root page's parse passes ran on the request thread, holding it for the whole build while
// Desktop's capture window built a poster beside a playing film.
it("a root preview, captured or not, is served whole with no page pass on the request thread", async () => {
  const api = createStudioApi(adapter);
  onThread.minLength = page.length / 2;
  for (const query of ["", "?hf-capture=1"]) {
    onThread.passes.length = 0;
    const res = await api.request(`http://localhost/projects/demo/preview${query}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/<p[^>]*data-hf-id="[^"]+"[^>]*>Hi<\/p>/);
    expect(onThread.passes).toEqual([]);
  }
}, 120_000);
