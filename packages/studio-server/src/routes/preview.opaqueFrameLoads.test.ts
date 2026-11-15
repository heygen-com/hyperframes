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
writeFileSync(join(projectDir, "scene.js"), "export const scene = 1;");
writeFileSync(join(projectDir, "scene.mjs"), "export const scene = 2;");
writeFileSync(join(projectDir, "data.json"), '{"secret":true}');
writeFileSync(join(projectDir, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
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

  it("refuses a page's own fetch, which carries no Sec-Fetch-Dest it can choose", async () => {
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
});

describe("a frame without the project's token", () => {
  const guessed = "A".repeat(43);
  it.each([
    ["the plain path", ""],
    ["a guessed token", `~${guessed}/`],
    ["another project's token", () => `~${otherToken}/`],
    ["a token of the wrong length", `~${"A".repeat(42)}/`],
  ])("gets no grant for a font or module script on %s", async (_name, prefix) => {
    const at = typeof prefix === "function" ? prefix() : prefix;
    for (const [dest, path] of [
      ["font", "fonts/Brand.woff2"],
      ["script", "scene.js"],
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

  it("refuses a font outside the preview path", async () => {
    const res = await api.request("http://localhost/projects/demo/files/fonts/Brand.woff2", {
      headers: { origin: "null", "sec-fetch-dest": "font", "sec-fetch-site": "cross-site" },
    });
    expectNotGranted(res);
  });
});
