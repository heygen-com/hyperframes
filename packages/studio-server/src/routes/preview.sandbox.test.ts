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
