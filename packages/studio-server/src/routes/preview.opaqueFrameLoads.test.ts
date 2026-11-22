// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioApi } from "../createStudioApi";
import type { StudioApiAdapter } from "../types";

const root = mkdtempSync(join(tmpdir(), "hf-preview-opaque-loads-"));
const projectDir = join(root, "demo");
mkdirSync(join(projectDir, "fonts"), { recursive: true });
mkdirSync(join(root, "other"));
writeFileSync(join(projectDir, "index.html"), '<div data-composition-id="main"></div>');
writeFileSync(
  join(projectDir, "scene.html"),
  '<div data-composition-id="scene"><img src="/logo.png"><script type="module" src="scene.js"></script></div>',
);
writeFileSync(join(projectDir, "fonts", "Brand.woff2"), Buffer.from("wOF2font"));
writeFileSync(join(projectDir, "fonts", "Brand.ttf"), Buffer.from("ttf-font"));
writeFileSync(
  join(projectDir, "sized.html"),
  '<div data-composition-id="sized"><div id="card" data-hf-studio-box-size="true"></div></div>',
);
writeFileSync(join(projectDir, "scene.js"), "export const scene = 1;");
writeFileSync(join(projectDir, "scene.mjs"), "export const scene = 2;");
writeFileSync(join(projectDir, "data.json"), '{"secret":true}');
writeFileSync(join(projectDir, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
writeFileSync(join(projectDir, "clip.mp4"), Buffer.from("mp4-bytes"));
writeFileSync(join(projectDir, "music.mp3"), Buffer.from("mp3-bytes"));
writeFileSync(join(root, "other", "index.html"), '<div data-composition-id="main"></div>');
afterAll(() => rmSync(root, { recursive: true, force: true }));
afterEach(() => vi.useRealTimers());

const adapter: StudioApiAdapter = {
  listProjects: () => [],
  resolveProject: async (id: string) =>
    id === "demo" || id === "other" ? { id, dir: join(root, id) } : null,
  bundle: async () => null,
  lint: async () => ({ findings: [] }),
  runtimeUrl: "/api/runtime.js",
  rendersDir: () => join(root, "renders"),
  startRender: () => ({ id: "job", status: "rendering", progress: 0, outputPath: "/tmp/out.mp4" }),
};
const api = createStudioApi(adapter);

async function frameToken(project: string, site = "same-origin") {
  return api.request(`http://localhost/projects/${project}/frame-token`, {
    headers: { "sec-fetch-site": site },
  });
}

let token = "";
let otherToken = "";
beforeAll(async () => {
  token = (await (await frameToken("demo")).json()).token;
  otherToken = (await (await frameToken("other")).json()).token;
});

function load(path: string, headers: Record<string, string>, prefix = `~${token}/`) {
  return api.request(`http://localhost/projects/demo/preview/${prefix}${path}`, {
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

describe("the frame token", () => {
  it("is a 256-bit base64url value per project", () => {
    expect(token).toMatch(/^[\w-]{43}$/);
    expect(otherToken).toMatch(/^[\w-]{43}$/);
    expect(otherToken).not.toBe(token);
  });

  it.each(["cross-site", "same-site"])("is refused to a %s request", async (site) => {
    const res = await frameToken("demo", site);
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain(token);
  });

  it("is not minted for an unknown project", async () => {
    expect((await frameToken("missing")).status).toBe(404);
  });
});

describe("an opaque preview frame's loads under its token", () => {
  it.each([
    ["font", "fonts/Brand.woff2", "font/woff2"],
    ["font", "fonts/Brand.ttf", "font/ttf"],
    ["script", "scene.js", "text/javascript"],
    ["script", "scene.mjs", "text/javascript"],
    ["image", "logo.png", "image/png"],
    ["video", "clip.mp4", "video/mp4"],
    ["audio", "music.mp3", "audio/mpeg"],
    // The runtime fetches captions, sub-compositions, grades and audio from its own frame.
    ["empty", "data.json", "application/json"],
    ["empty", "comp/scene.html", "text/html"],
    ["empty", "music.mp3", "audio/mpeg"],
    ["empty", "fonts/Brand.woff2", "font/woff2"],
  ])("lets a %s load of %s through", async (dest, path, type) => {
    const res = await load(path, { origin: "null", "sec-fetch-dest": dest });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain(type);
    expectGranted(res);
  });

  it("serves the same bytes as the plain path", async () => {
    const tokened = await load("fonts/Brand.woff2", { "sec-fetch-dest": "font" });
    const plain = await load("fonts/Brand.woff2", { "sec-fetch-dest": "font" }, "");
    expect(Buffer.from(await tokened.arrayBuffer())).toEqual(
      Buffer.from(await plain.arrayBuffer()),
    );
  });

  it("lets a revalidated font through on a 304", async () => {
    // Past the server's settle window, so the just-written font gets an ETag.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 60_000);
    const etag = (await load("fonts/Brand.woff2", { "sec-fetch-dest": "font" })).headers.get(
      "etag",
    );
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
    ["document", "scene.html"],
    ["iframe", "scene.html"],
    ["style", "fonts/Brand.woff2"],
    ["image", "data.json"],
    ["image", "clip.mp4"],
    ["video", "music.mp3"],
    ["video", "logo.png"],
    ["audio", "clip.mp4"],
    ["audio", "comp/music.mp3"],
    ["font", "data.json"],
    ["font", "scene.js"],
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

  it("refuses a load that names no Sec-Fetch-Dest", async () => {
    expectNotGranted(await load("fonts/Brand.woff2", { origin: "null" }));
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

  it("re-bases the composition document under the token and sends no referrer", async () => {
    const res = await load("comp/scene.html", { "sec-fetch-dest": "iframe" });
    expect(res.status).toBe(200);
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    const html = await res.text();
    const tokened = `/api/projects/demo/preview/~${token}/`;
    expect(html).toContain(`<base href="${tokened}">`);
    expect(html.replaceAll(tokened, "")).not.toContain("/api/projects/demo/preview/");
  });

  // fails without the fix: a sealed document with no Studio edit yet got no reapply, so the first edit an undo or redo
  // put back on it could not be kept in place.
  it("puts Studio's seek reapply last in every sealed document, edited or not, and in no plain one", async () => {
    const reapply = "//# sourceURL=hyperframes://position-seek-reapply</script>";
    const sealed = await (await load("comp/sized.html", { "sec-fetch-dest": "iframe" })).text();
    expect(sealed).toContain(reapply);
    expect(sealed.indexOf(reapply)).toBeGreaterThan(sealed.indexOf('id="card"'));
    const plain = await api.request("http://localhost/projects/demo/preview/comp/sized.html", {
      headers: { "sec-fetch-site": "same-origin", "sec-fetch-dest": "iframe" },
    });
    expect(await plain.text()).not.toContain(reapply);
    const unedited = await (await load("comp/scene.html", { "sec-fetch-dest": "iframe" })).text();
    expect(unedited).toContain(reapply);
  });

  it("serves the main preview under the token, re-based", async () => {
    const res = await api.request(`http://localhost/projects/demo/preview/~${token}`, {
      headers: { "sec-fetch-site": "same-origin", "sec-fetch-dest": "iframe" },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('data-composition-id="main"');
    expect(html).toContain(`<base href="/api/projects/demo/preview/~${token}/">`);
  });
});

describe("a frame without the project's token", () => {
  const guessed = "A".repeat(43);
  it.each([
    ["the plain path", ""],
    ["a guessed token", `~${guessed}/`],
    ["another project's token", () => `~${otherToken}/`],
    ["a token of the wrong length", `~${"A".repeat(42)}/`],
  ])("gets no grant for any load on %s", async (_name, prefix) => {
    const at = typeof prefix === "function" ? prefix() : prefix;
    for (const [dest, path] of [
      ["font", "fonts/Brand.woff2"],
      ["script", "scene.js"],
      ["image", "logo.png"],
      ["empty", "data.json"],
    ]) {
      const res = await load(path!, { origin: "null", "sec-fetch-dest": dest! }, at);
      expectNotGranted(res);
    }
  });

  it.each([
    ["a guessed token", `~${"A".repeat(43)}/`],
    ["another project's token", () => `~${otherToken}/`],
    ["a token of the wrong length", `~${"A".repeat(42)}/`],
  ])("is not served at all with %s", async (_name, prefix) => {
    const at = typeof prefix === "function" ? prefix() : prefix;
    expect((await load("fonts/Brand.woff2", { "sec-fetch-dest": "font" }, at)).status).toBe(404);
  });

  it("is not served under an unknown project", async () => {
    const res = await api.request(
      `http://localhost/projects/missing/preview/~${token}/fonts/Brand.woff2`,
      { headers: { origin: "null", "sec-fetch-dest": "font" } },
    );
    expect(res.status).toBe(404);
    expectNotGranted(res);
  });

  it.each([
    ["font", "fonts/Brand.woff2"],
    ["empty", "data.json"],
  ])("refuses a %s load of %s outside the preview path", async (dest, path) => {
    const res = await api.request(`http://localhost/projects/demo/files/${path}`, {
      headers: { origin: "null", "sec-fetch-dest": dest, "sec-fetch-site": "cross-site" },
    });
    expectNotGranted(res);
  });
});

describe("an opaque preview frame's wait for a video's proxy copy", () => {
  const preflight = (path: string, headers: Record<string, string> = {}, prefix = `~${token}/`) =>
    api.request(`http://localhost/projects/demo/preview/${prefix}${path}`, {
      method: "OPTIONS",
      headers: {
        origin: "null",
        "sec-fetch-site": "cross-site",
        "sec-fetch-mode": "cors",
        "access-control-request-method": "GET",
        "access-control-request-headers": "range,x-hf-proxy-priority",
        ...headers,
      },
    });

  it("answers its preflight with the proxy GET's method and headers", async () => {
    const res = await preflight("clip.mp4?hf-proxy=1");
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("null");
    expect(res.headers.get("access-control-allow-methods")).toBe("GET");
    expect(res.headers.get("access-control-allow-headers")?.toLowerCase()).toBe(
      "range, x-hf-proxy-priority",
    );
    expect(res.headers.get("vary")).toBe("Origin");
  });

  it.each([
    ["a file that is not a video", "data.json?hf-proxy=1", {}],
    ["a video without the proxy query", "clip.mp4", {}],
    ["a caller that is not an opaque frame", "clip.mp4?hf-proxy=1", { origin: "https://a.test" }],
    ["a method other than GET", "clip.mp4?hf-proxy=1", { "access-control-request-method": "PUT" }],
  ])("leaves the preflight of %s unanswered", async (_name, path, headers) => {
    const res = await preflight(path, headers);
    expect(res.status).not.toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("leaves a preflight without the project's token unanswered", async () => {
    const res = await preflight("clip.mp4?hf-proxy=1", {}, `~${"A".repeat(43)}/`);
    expect(res.status).toBe(404);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("lets the frame read the proxy wait's headers on a granted load", async () => {
    const res = await load("clip.mp4", { origin: "null", "sec-fetch-dest": "empty" });
    expectGranted(res);
    expect(res.headers.get("access-control-expose-headers")?.split(/,\s*/)).toEqual([
      "Retry-After",
      "X-HF-Proxy-Progress",
      "Content-Range",
    ]);
  });
});

describe("a media proxy asked for by another site", () => {
  const ask = (prefix: string, site: string) =>
    api.request(`http://localhost/projects/demo/preview/${prefix}clip.mp4?hf-proxy=h264`, {
      headers: { "sec-fetch-site": site },
    });

  it.each(["cross-site", "same-site"])(
    "is refused on the plain path to a %s request",
    async (site) => {
      const res = await ask("", site);
      expect(res.status).toBe(403);
      expect(await res.text()).toBe("forbidden: media proxy requested by another site");
    },
  );

  // fails without the fix: a request carrying neither fetch metadata nor a Referer counted as the Studio's.
  it("is refused on the plain path to a request with no fetch metadata and no Referer", async () => {
    const res = await api.request("http://localhost/projects/demo/preview/clip.mp4?hf-proxy=h264");
    expect(res.status).toBe(403);
  });

  it("is refused on the plain path even with a still query", async () => {
    const res = await api.request(
      "http://localhost/projects/demo/preview/clip.mp4?hf-proxy=h264&hf-proxy-still=1",
      { headers: { "sec-fetch-site": "cross-site" } },
    );
    expect(res.status).toBe(403);
  });

  it("goes through under the project's frame token, and from the Studio itself", async () => {
    expect((await ask(`~${token}/`, "cross-site")).status).not.toBe(403);
    expect((await ask("", "same-origin")).status).not.toBe(403);
    const referred = await api.request(
      "http://localhost/projects/demo/preview/clip.mp4?hf-proxy=h264",
      { headers: { referer: "http://localhost/projects/demo/preview/index.html" } },
    );
    expect(referred.status).not.toBe(403);
  });

  it("leaves another site's plain load of a video without the proxy query alone", async () => {
    const res = await api.request("http://localhost/projects/demo/preview/clip.mp4", {
      headers: { "sec-fetch-site": "cross-site" },
    });
    expect(res.status).not.toBe(403);
  });
});
