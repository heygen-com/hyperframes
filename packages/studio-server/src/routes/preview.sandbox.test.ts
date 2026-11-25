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
writeFileSync(
  join(projectDir, "page.html"),
  `<div data-composition-id="page"></div><script>document.title = 'ran'</script>`,
);
writeFileSync(
  join(projectDir, "icon.svg"),
  '<svg xmlns="http://www.w3.org/2000/svg"><script>void 0</script></svg>',
);
writeFileSync(
  join(projectDir, "clip.html"),
  '<div data-composition-id="clip"><video id="local" src="clip.mp4"></video><video id="remote" src="https://cdn.example/a.mp4"></video></div>',
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
    expect(res.headers.get("vary")).toBe("Sec-Fetch-Site, Referer");
  });

  it.each([["same-origin"], ["none"]])(
    "keeps its origin when Sec-Fetch-Site is %s",
    async (site) => {
      const res = await get(path, site);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-security-policy")).toBeNull();
      expect(res.headers.get("vary")).toBe("Sec-Fetch-Site, Referer");
    },
  );
});

describe("a preview document answered to another site", () => {
  const MARK = '<meta name="hyperframes-preview-for-another-site">';
  const documents = routes.filter(([, , type]) => type === "text/html");

  it.each(documents)("%s is marked so its runtime offers no editing port", async (_n, path) => {
    const res = await get(path, "cross-site");
    const body = await res.text();
    expect(body).toContain(MARK);
    expect(res.headers.get("content-length")).toBeNull();
    expect(res.headers.get("etag")).toBeNull();
    expect(res.headers.get("content-security-policy")).toBe(SANDBOX);
  });

  it.each(documents)("%s stays unmarked for the Studio's own pages", async (_n, path) => {
    const res = await get(path, "same-origin");
    expect(await res.text()).not.toContain(MARK);
  });

  it("leaves a file that is not a document as served", async () => {
    const res = await get("/projects/demo/preview/icon.svg", "cross-site");
    expect(await res.text()).not.toContain(MARK);
  });
});

describe.each(routes)("%s opened by direct navigation", (_name, path, type) => {
  const guarded = createStudioApi(adapter, { sandboxDirectOpens: true });
  const open = (app: typeof api, headers: Record<string, string> = {}) =>
    app.request(`http://localhost${path}`, {
      headers: { "sec-fetch-site": "none", "sec-fetch-dest": "document", ...headers },
    });

  it("is sandboxed, marked and never sniffed when the host asks for it", async () => {
    const res = await open(guarded);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain(type);
    expect(res.headers.get("content-security-policy")).toBe(SANDBOX);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await res.text()).includes("hyperframes-preview-for-another-site")).toBe(
      type === "text/html",
    );
  });

  it("is answered in full, not from the copy a Studio frame cached", async () => {
    const etag = (await get(path, "same-origin")).headers.get("etag");
    const res = await open(guarded, etag ? { "if-none-match": etag } : {});
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBe(SANDBOX);
  });

  it("keeps its origin in a Studio frame, and for a host that does not ask", async () => {
    const framed = await guarded.request(`http://localhost${path}`, {
      headers: { "sec-fetch-site": "same-origin", "sec-fetch-dest": "iframe" },
    });
    expect(framed.headers.get("content-security-policy")).toBeNull();
    expect((await open(api)).headers.get("content-security-policy")).toBeNull();
  });
});

describe("a revalidated preview", () => {
  it("still names Sec-Fetch-Site in Vary on a 304 to the Studio's own pages", async () => {
    const etag = (await get("/projects/demo/preview", "same-origin")).headers.get("etag");
    expect(etag).toBeTruthy();
    const res = await api.request("http://localhost/projects/demo/preview", {
      headers: { "sec-fetch-site": "same-origin", "if-none-match": etag! },
    });
    expect(res.status).toBe(304);
    expect(res.headers.get("vary")).toBe("Sec-Fetch-Site, Referer");
  });

  it.each(["cross-site", "same-site"])(
    "answers a %s frame load carrying the unmarked copy's validators with a marked 200",
    async (site) => {
      const first = await get("/projects/demo/preview", "same-origin");
      const etag = first.headers.get("etag");
      expect(etag).toBeTruthy();
      const res = await api.request("http://localhost/projects/demo/preview", {
        headers: {
          "sec-fetch-site": site,
          "sec-fetch-dest": "iframe",
          "if-none-match": etag!,
          "if-modified-since": new Date(Date.now() + 60_000).toUTCString(),
        },
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('<meta name="hyperframes-preview-for-another-site">');
      expect(res.headers.get("vary")).toBe("Sec-Fetch-Site, Referer");
      expect(res.headers.get("content-security-policy")).toBe(SANDBOX);
    },
  );
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
    const navigation = { "sec-fetch-site": "none" };
    const etag = (await request(sandboxing, path, navigation)).headers.get("etag");
    expect(etag).toBeTruthy();
    const res = await request(sandboxing, path, { ...navigation, "if-none-match": etag! });
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

describe("a plain-HTTP request to a LAN name, which carries no fetch metadata", () => {
  const MARK = '<meta name="hyperframes-preview-for-another-site">';
  const LAN = "http://192.168.1.20:3002";
  const documents = routes.filter(([, , type]) => type === "text/html");
  const lanGet = (path: string, headers: Record<string, string> = {}) =>
    api.request(`${LAN}${path}`, { headers });

  it.each(documents)(
    "%s is marked and sandboxed for a frame that sends no Referer",
    async (_n, path) => {
      const res = await lanGet(path);
      expect(await res.text()).toContain(MARK);
      expect(res.headers.get("content-security-policy")).toBe(SANDBOX);
    },
  );

  it.each(documents)("%s is marked and sandboxed for another site's Referer", async (_n, path) => {
    const res = await lanGet(path, { referer: "http://elsewhere.example/page" });
    expect(await res.text()).toContain(MARK);
    expect(res.headers.get("content-security-policy")).toBe(SANDBOX);
  });

  it.each(documents)("%s stays unmarked for the Studio's own player", async (_n, path) => {
    const res = await lanGet(path, { referer: `${LAN}/?project=demo` });
    expect(await res.text()).not.toContain(MARK);
    expect(res.headers.get("content-security-policy")).toBeNull();
  });

  it("never answers the unmarked copy's validators with a 304", async () => {
    const own = await lanGet("/projects/demo/preview", { referer: `${LAN}/` });
    const etag = own.headers.get("etag");
    expect(etag).toBeTruthy();
    const res = await lanGet("/projects/demo/preview", { "if-none-match": etag! });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(MARK);
  });

  it.each(["frame-token", "thumbnail/index.html", "waveform/clip.mp4", "peaks/clip.mp4"])(
    "refuses %s with no Referer and answers the Studio's own page",
    async (route) => {
      expect((await lanGet(`/projects/demo/${route}`)).status).toBe(403);
      const own = await lanGet(`/projects/demo/${route}`, { referer: `${LAN}/` });
      expect(own.status).not.toBe(403);
    },
  );
});

// fails without the fix: with no fetch metadata a loopback load counted as Studio's own, so another site's frame got
// an unmarked page whose runtime offered it the editing port.
describe("a loopback request from a browser that sends no fetch metadata", () => {
  const MARK = '<meta name="hyperframes-preview-for-another-site">';
  const LOCAL = "http://localhost:3002";
  const documents = routes.filter(([, , type]) => type === "text/html");
  const localGet = (path: string, headers: Record<string, string> = {}) =>
    api.request(`${LOCAL}${path}`, { headers });

  it.each(documents)("%s is marked and sandboxed with no Referer", async (_n, path) => {
    const res = await localGet(path);
    expect(await res.text()).toContain(MARK);
    expect(res.headers.get("content-security-policy")).toBe(SANDBOX);
  });

  it.each(documents)("%s is marked and sandboxed for another site's Referer", async (_n, path) => {
    const res = await localGet(path, { referer: "http://elsewhere.example/page" });
    expect(await res.text()).toContain(MARK);
    expect(res.headers.get("content-security-policy")).toBe(SANDBOX);
  });

  it.each(documents)("%s stays unmarked for the Studio's own player", async (_n, path) => {
    const res = await localGet(path, { referer: `${LOCAL}/?project=demo` });
    expect(await res.text()).not.toContain(MARK);
    expect(res.headers.get("content-security-policy")).toBeNull();
  });

  it("still answers a local tool's request to a route that refuses other sites", async () => {
    expect((await localGet("/projects/demo/frame-token")).status).not.toBe(403);
  });
});
