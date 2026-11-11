// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioApi } from "../createStudioApi";
import type { StudioApiAdapter } from "../types";

const projectDir = mkdtempSync(join(tmpdir(), "hf-preview-sandbox-"));
writeFileSync(
  join(projectDir, "index.html"),
  '<div data-composition-id="main" data-width="320" data-height="180"></div>',
);
writeFileSync(join(projectDir, "page.html"), "<script>document.title = 'ran'</script>");
writeFileSync(
  join(projectDir, "icon.svg"),
  '<svg xmlns="http://www.w3.org/2000/svg"><script>void 0</script></svg>',
);
writeFileSync(
  join(projectDir, "clip.html"),
  '<video id="local" src="clip.mp4"></video><video id="remote" src="https://cdn.example/a.mp4"></video>',
);
afterAll(() => rmSync(projectDir, { recursive: true, force: true }));

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

const SANDBOX = "sandbox allow-scripts";
const routes = [
  ["a project HTML file", "/projects/demo/preview/page.html", "text/html"],
  ["a project SVG file", "/projects/demo/preview/icon.svg", "image/svg+xml"],
  ["the bundled preview", "/projects/demo/preview", "text/html"],
  ["a sub-composition preview", "/projects/demo/preview/comp/page.html", "text/html"],
] as const;

async function get(path: string, site?: string) {
  return api.request(`http://localhost${path}`, {
    headers: site === undefined ? {} : { "sec-fetch-site": site },
  });
}

describe.each(routes)("%s", (_name, path, type) => {
  it.each(["cross-site", "same-site"])("is sandboxed when the request is %s", async (site) => {
    const res = await get(path, site);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain(type);
    expect(res.headers.get("content-security-policy")).toBe(SANDBOX);
    expect(res.headers.get("vary")).toBe("Sec-Fetch-Site");
  });

  it.each([["same-origin"], ["none"], [undefined]])(
    "keeps its origin when Sec-Fetch-Site is %s",
    async (site) => {
      const res = await get(path, site);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-security-policy")).toBeNull();
      expect(res.headers.get("vary")).toBe("Sec-Fetch-Site");
    },
  );
});

describe("a revalidated preview", () => {
  it("still names Sec-Fetch-Site in Vary and carries the sandbox on a 304", async () => {
    const first = await get("/projects/demo/preview", "same-origin");
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();
    const res = await api.request("http://localhost/projects/demo/preview", {
      headers: { "sec-fetch-site": "cross-site", "if-none-match": etag! },
    });
    expect(res.status).toBe(304);
    expect(res.headers.get("vary")).toBe("Sec-Fetch-Site");
    expect(res.headers.get("content-security-policy")).toBe(SANDBOX);
  });
});

describe("a thumbnail capture document", () => {
  const captures = [
    ["the bundled preview", "/projects/demo/preview?hf-capture=1"],
    ["a sub-composition preview", "/projects/demo/preview/comp/page.html?hf-capture=1"],
  ] as const;
  const sandboxing = createStudioApi(adapter, { sandboxThumbnailCaptures: true });
  const request = (app: typeof api, path: string, headers: Record<string, string> = {}) =>
    app.request(`http://localhost${path}`, { headers });

  describe.each(captures)("%s", (_name, path) => {
    it.each([["same-origin"], ["none"], [undefined]])(
      "is sandboxed when the app opts in, even when Sec-Fetch-Site is %s",
      async (site) => {
        const res = await request(sandboxing, path, site ? { "sec-fetch-site": site } : {});
        expect(res.status).toBe(200);
        expect(res.headers.get("content-security-policy")).toBe(SANDBOX);
      },
    );

    it("keeps its origin when the app has not opted in", async () => {
      const res = await request(api, path, { "sec-fetch-site": "none" });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-security-policy")).toBeNull();
    });
  });

  it("carries the sandbox on a 304", async () => {
    const path = "/projects/demo/preview?hf-capture=1";
    const etag = (await request(sandboxing, path)).headers.get("etag");
    expect(etag).toBeTruthy();
    const res = await request(sandboxing, path, { "if-none-match": etag! });
    expect(res.status).toBe(304);
    expect(res.headers.get("content-security-policy")).toBe(SANDBOX);
  });

  it("loads the project's videos with CORS only when the app opts in", async () => {
    const path = "/projects/demo/preview/comp/clip.html?hf-capture=1";
    const sandboxed = await (await request(sandboxing, path)).text();
    expect(sandboxed).toMatch(/<video crossorigin="anonymous"[^>]*id="local"/);
    expect(sandboxed).toMatch(/<video (?![^>]*crossorigin)[^>]*id="remote"/);
    const plain = await (await request(api, path)).text();
    expect(plain).not.toContain('crossorigin="anonymous"');
  });
});
