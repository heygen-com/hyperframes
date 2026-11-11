// @vitest-environment node
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioApi } from "../createStudioApi";
import type { StudioApiAdapter } from "../types";

const projectDir = mkdtempSync(join(tmpdir(), "hf-preview-opaque-loads-"));
mkdirSync(join(projectDir, "fonts"));
writeFileSync(join(projectDir, "index.html"), '<div data-composition-id="main"></div>');
writeFileSync(join(projectDir, "scene.html"), '<div data-composition-id="scene"></div>');
writeFileSync(join(projectDir, "fonts", "Brand.woff2"), Buffer.from("wOF2font"));
writeFileSync(join(projectDir, "fonts", "Brand.ttf"), Buffer.from("ttf-font"));
writeFileSync(join(projectDir, "scene.js"), "export const scene = 1;");
writeFileSync(join(projectDir, "scene.mjs"), "export const scene = 2;");
writeFileSync(join(projectDir, "data.json"), '{"secret":true}');
writeFileSync(join(projectDir, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
afterAll(() => rmSync(projectDir, { recursive: true, force: true }));
afterEach(() => vi.useRealTimers());

const adapter: StudioApiAdapter = {
  listProjects: () => [],
  resolveProject: async (id: string) => ({ id, dir: projectDir }),
  bundle: async () => null,
  lint: async () => ({ findings: [] }),
  runtimeUrl: "/api/runtime.js",
  rendersDir: () => join(projectDir, "renders"),
  startRender: () => ({ id: "job", status: "rendering", progress: 0, outputPath: "/tmp/out.mp4" }),
};
const api = createStudioApi(adapter);

const PREVIEW = "/projects/demo/preview";

function load(path: string, headers: Record<string, string>) {
  return api.request(`http://localhost${PREVIEW}/${path}`, {
    headers: { "sec-fetch-site": "cross-site", "sec-fetch-mode": "cors", ...headers },
  });
}

function expectGranted(res: Response) {
  expect(res.headers.get("access-control-allow-origin")).toBe("null");
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  expect(res.headers.get("vary")?.split(/,\s*/)).toContain("Origin");
}

function expectNotGranted(res: Response) {
  expect(res.headers.get("access-control-allow-origin")).toBeNull();
  expect(res.headers.get("vary")?.split(/,\s*/) ?? []).not.toContain("Origin");
}

describe("an opaque preview frame's loads", () => {
  it.each([
    ["font", "fonts/Brand.woff2", "font/woff2"],
    ["font", "fonts/Brand.ttf", "font/ttf"],
  ])("lets a %s load of %s through", async (dest, path, type) => {
    const res = await load(path, { origin: "null", "sec-fetch-dest": dest });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain(type);
    expectGranted(res);
  });

  it("lets a revalidated font through on a 304", async () => {
    // Past the server's settle window, so the just-written font gets an ETag.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 60_000);
    const first = await load("fonts/Brand.woff2", { "sec-fetch-dest": "font" });
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();
    const res = await load("fonts/Brand.woff2", {
      origin: "null",
      "sec-fetch-dest": "font",
      "if-none-match": etag!,
    });
    expect(res.status).toBe(304);
    expectGranted(res);
  });

  it("refuses a revalidated file that is not a font, even for a font load", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 60_000);
    const etag = (await load("logo.png", { "sec-fetch-dest": "image" })).headers.get("etag");
    expect(etag).toBeTruthy();
    const res = await load("logo.png", {
      origin: "null",
      "sec-fetch-dest": "font",
      "if-none-match": etag!,
    });
    expect(res.status).toBe(304);
    expectNotGranted(res);
  });

  it.each([
    ["empty", "fonts/Brand.woff2"],
    ["empty", "scene.js"],
    ["empty", "data.json"],
    ["empty", "scene.html"],
    ["document", "scene.html"],
    ["iframe", "scene.html"],
    ["image", "logo.png"],
    ["style", "fonts/Brand.woff2"],
    ["font", "data.json"],
    ["font", "scene.js"],
    ["script", "scene.js"],
    ["script", "scene.mjs"],
    ["script", "data.json"],
    ["script", "fonts/Brand.woff2"],
    ["script", "scene.html"],
    ["script", "comp/scene.html"],
    // The sub-composition route answers any project file with an HTML page.
    ["script", "comp/scene.js"],
    ["font", "comp/fonts/Brand.woff2"],
    ["toString", "scene.js"],
    ["constructor", "fonts/Brand.woff2"],
  ])("refuses a %s load of %s", async (dest, path) => {
    const res = await load(path, { origin: "null", "sec-fetch-dest": dest });
    expect(res.status).toBe(200);
    expectNotGranted(res);
  });

  it.each(["scene.js", "scene.mjs"])(
    "refuses a module load of %s, from a tag or import()",
    async (path) => {
      const res = await load(path, { origin: "null", "sec-fetch-dest": "script" });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/javascript");
      expectNotGranted(res);
    },
  );

  it("refuses a page's own fetch, which carries no Sec-Fetch-Dest it can choose", async () => {
    const res = await load("fonts/Brand.woff2", { origin: "null" });
    expectNotGranted(res);
  });

  it.each([["https://evil.example"], ["http://localhost"], [undefined]])(
    "refuses a font load from origin %s",
    async (origin) => {
      const res = await load("fonts/Brand.woff2", {
        "sec-fetch-dest": "font",
        ...(origin === undefined ? {} : { origin }),
      });
      expect(res.status).toBe(200);
      expectNotGranted(res);
    },
  );

  it("refuses a missing font", async () => {
    const res = await load("fonts/Missing.woff2", { origin: "null", "sec-fetch-dest": "font" });
    expect(res.status).toBe(404);
    expectNotGranted(res);
  });

  it("refuses a font outside the preview path", async () => {
    const res = await api.request("http://localhost/projects/demo/files/fonts/Brand.woff2", {
      headers: { origin: "null", "sec-fetch-dest": "font", "sec-fetch-site": "cross-site" },
    });
    expectNotGranted(res);
  });
});
