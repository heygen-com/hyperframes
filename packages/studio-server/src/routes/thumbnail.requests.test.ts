// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioApi } from "../createStudioApi";
import type { StudioApiAdapter } from "../types";

vi.mock("../helpers/proxyTranscoder.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../helpers/proxyTranscoder.js")>()),
  proxyActivityMark: vi.fn(() => "0"),
}));

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup() {
  const root = mkdtempSync(join(tmpdir(), "hf-thumbnail-requests-"));
  dirs.push(root);
  const projectDir = join(root, "project");
  mkdirSync(join(projectDir, "scenes"), { recursive: true });
  writeFileSync(join(projectDir, "index.html"), '<div data-width="320" data-height="180"></div>');
  writeFileSync(
    join(projectDir, "scenes", "intro.html"),
    '<div data-composition-id="intro"></div>',
  );
  const captures: { compPath: string; previewUrl: string }[] = [];
  const adapter: StudioApiAdapter = {
    listProjects: () => [],
    resolveProject: async (id: string) => ({ id, dir: projectDir }),
    bundle: async () => null,
    lint: async () => ({ findings: [] }),
    runtimeUrl: "/api/runtime.js",
    rendersDir: () => join(projectDir, "renders"),
    startRender: () => ({ id: "job", status: "rendering", progress: 0, outputPath: "/tmp/o.mp4" }),
    serverOrigin: () => "http://127.0.0.1:3002",
    generateThumbnail: async ({ compPath, previewUrl }) => {
      captures.push({ compPath, previewUrl });
      return Buffer.from("thumb");
    },
  };
  const api = createStudioApi(adapter);
  let seek = 0;
  const request = (path: string, headers: Record<string, string> = {}) =>
    api.request(`http://localhost/projects/demo/thumbnail/${path}?t=${(seek += 0.25)}`, {
      headers,
    });
  return { root, projectDir, request, captures };
}

describe("thumbnail requests", () => {
  it.each(["cross-site", "same-site"])("are refused before any capture when %s", async (site) => {
    const { request, captures } = setup();

    const res = await request("index.html?selector=p", { "sec-fetch-site": site });

    expect(res.status).toBe(403);
    expect(captures).toEqual([]);
  });

  it.each([["same-origin"], ["none"], [undefined]])(
    "are answered when Sec-Fetch-Site is %s",
    async (site) => {
      const { request, captures } = setup();

      const res = await request("index.html", site ? { "sec-fetch-site": site } : {});

      expect(res.status).toBe(200);
      expect(captures).toHaveLength(1);
    },
  );

  it("capture the composition under its own path, however the request spells it", async () => {
    const { request, captures } = setup();

    expect((await request("scenes%2Fintro.html")).status).toBe(200);
    expect((await request("x%22%20onload%3D1%2F..%2Fscenes%2Fintro.html")).status).toBe(200);

    expect(captures.map((capture) => capture.compPath)).toEqual([
      "scenes/intro.html",
      "scenes/intro.html",
    ]);
    for (const { previewUrl } of captures) {
      expect(previewUrl).toMatch(/\/api\/projects\/demo\/preview\/comp\/scenes\/intro\.html\?/);
    }
  });

  it.skipIf(process.platform === "win32")(
    "still answer, but cache nothing, when .thumbnails links outside the project",
    async () => {
      const { root, projectDir, request, captures } = setup();
      const outside = join(root, "outside");
      mkdirSync(outside);
      symlinkSync(outside, join(projectDir, ".thumbnails"));

      const res = await request("index.html");

      expect(res.status).toBe(200);
      expect(captures).toHaveLength(1);
      expect(readdirSync(outside)).toEqual([]);
    },
  );
});
