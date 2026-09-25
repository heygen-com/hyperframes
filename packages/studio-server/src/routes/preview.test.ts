// fallow-ignore-file code-duplication
import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import {
  closeSync,
  ftruncateSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureHfIds } from "@hyperframes/parsers/hf-ids";
import { PREVIEW_BUNDLE_OPTIONS, registerPreviewRoutes } from "./preview";
import { registerFileRoutes } from "./files";
import { createPreviewDocumentStore } from "../helpers/previewDocumentStore";
import type { StudioApiAdapter } from "../types";

const tempDirs: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Moves the clock past settledFileTag's window, so a just-written asset gets an ETag. */
function pastSettleWindow(): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + 60_000);
}

function createProjectDir(): string {
  const projectDir = mkdtempSync(join(tmpdir(), "hf-preview-test-"));
  tempDirs.push(projectDir);
  writeFileSync(join(projectDir, "index.html"), "<html><head></head><body>Preview</body></html>");
  return projectDir;
}

function createAdapter(
  projectDir: string,
  overrides: Partial<StudioApiAdapter> & { autoProxy?: boolean } = {},
): StudioApiAdapter & { autoProxy?: boolean } {
  return {
    listProjects: () => [],
    resolveProject: async (id: string) => ({ id, dir: projectDir }),
    bundle: async () => null,
    lint: async () => ({ findings: [] }),
    runtimeUrl: "/api/runtime.js",
    rendersDir: () => "/tmp/renders",
    startRender: () => ({
      id: "job-1",
      status: "rendering",
      progress: 0,
      outputPath: "/tmp/out.mp4",
    }),
    ...overrides,
  };
}

function tryCreateSymlink(target: string, path: string, type: "dir" | "file"): boolean {
  try {
    symlinkSync(target, path, type);
    return true;
  } catch {
    return false;
  }
}

async function getPreviewSignature(projectDir: string): Promise<string> {
  const app = new Hono();
  registerPreviewRoutes(app, createAdapter(projectDir));

  const response = await app.request("http://localhost/projects/demo/preview");
  expect(response.status).toBe(200);
  const html = await response.text();
  const match = /<meta name="hyperframes-project-signature" content="([^"]+)">/.exec(html);
  expect(match?.[1]).toBeTruthy();
  return match![1]!;
}

describe("registerPreviewRoutes", () => {
  it("adds its <base> even when a script mentions one, and keeps an authored <base>", async () => {
    const projectDir = createProjectDir();
    const app = new Hono();
    registerPreviewRoutes(app, createAdapter(projectDir));
    writeFileSync(
      join(projectDir, "index.html"),
      `<!doctype html><html><head><script>if (0) document.write('<base href="../">');</script></head><body></body></html>`,
    );
    const injected = await (await app.request("http://localhost/projects/demo/preview")).text();
    expect(injected).toContain('<base href="/api/projects/demo/preview/">');

    writeFileSync(
      join(projectDir, "index.html"),
      `<!doctype html><html><head><base href="/cdn/"></head><body></body></html>`,
    );
    const authored = await (await app.request("http://localhost/projects/demo/preview")).text();
    expect(authored).not.toContain('<base href="/api/projects/demo/preview/">');
  });

  it("injects Studio GSAP motion manifest runtime into project preview", async () => {
    const projectDir = createProjectDir();
    writeFileSync(
      join(projectDir, "index.html"),
      "<!doctype html><html><head></head><body><div id='card'></div></body></html>",
    );
    const manifestDir = join(projectDir, ".hyperframes");
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(
      join(manifestDir, "studio-motion.json"),
      `{"version":1,"motions":[{"kind":"gsap-motion","target":{"sourceFile":"index.html","id":"card"},"start":0,"duration":1,"ease":"power2.out","from":{"y":32},"to":{"y":0}}]}`,
    );
    const app = new Hono();
    registerPreviewRoutes(app, createAdapter(projectDir));

    const response = await app.request("http://localhost/projects/demo/preview");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("__hfStudioMotionApply");
    expect(html).toContain("studio-motion");
    expect(html).toContain("gsap@3.15.0/dist/gsap.min.js");
  });

  it("injects the GSAP CustomEase plugin when Studio motion uses a custom ease", async () => {
    const projectDir = createProjectDir();
    writeFileSync(
      join(projectDir, "index.html"),
      "<!doctype html><html><head></head><body><div id='card'></div></body></html>",
    );
    const manifestDir = join(projectDir, ".hyperframes");
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(
      join(manifestDir, "studio-motion.json"),
      `{"version":1,"motions":[{"kind":"gsap-motion","target":{"sourceFile":"index.html","id":"card"},"start":0,"duration":1,"ease":"studio-card-ease","customEase":{"id":"studio-card-ease","data":"M0,0 C0.18,0.9 0.32,1 1,1"},"from":{"y":32},"to":{"y":0}}]}`,
    );
    const app = new Hono();
    registerPreviewRoutes(app, createAdapter(projectDir));

    const response = await app.request("http://localhost/projects/demo/preview");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("gsap@3.15.0/dist/gsap.min.js");
    expect(html).toContain("gsap@3.15.0/dist/CustomEase.min.js");
    expect(html.indexOf("gsap.min.js")).toBeLessThan(html.indexOf("CustomEase.min.js"));
    expect(html.indexOf("CustomEase.min.js")).toBeLessThan(html.indexOf("__hfStudioMotionApply"));
  });

  it("injects the GSAP MotionPathPlugin when the composition uses a motionPath", async () => {
    const projectDir = createProjectDir();
    writeFileSync(
      join(projectDir, "index.html"),
      `<!doctype html><html><head>
        <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
      </head><body><div id="card" class="clip"></div>
        <script>
          const tl = gsap.timeline({ paused: true });
          tl.to("#card", { motionPath: { path: [{ x: 0, y: 0 }, { x: 100, y: 50 }] }, duration: 1 }, 0);
          window.__timelines = { index: tl };
        </script>
      </body></html>`,
    );
    const app = new Hono();
    registerPreviewRoutes(app, createAdapter(projectDir));

    const response = await app.request("http://localhost/projects/demo/preview");
    const html = await response.text();

    expect(response.status).toBe(200);
    // Plugin version is derived from the composition's own gsap (gsap@3 here).
    expect(html).toContain("gsap@3/dist/MotionPathPlugin.min.js");
    // Plugin must load AFTER the core gsap script so it can register onto it.
    expect(html.indexOf("gsap.min.js")).toBeLessThan(html.indexOf("MotionPathPlugin.min.js"));
  });

  it("does NOT inject MotionPathPlugin when the composition has no motionPath", async () => {
    const projectDir = createProjectDir();
    writeFileSync(
      join(projectDir, "index.html"),
      `<!doctype html><html><head>
        <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
      </head><body><div id="card" class="clip"></div>
        <script>
          const tl = gsap.timeline({ paused: true });
          tl.to("#card", { x: 100, duration: 1 }, 0);
          window.__timelines = { index: tl };
        </script>
      </body></html>`,
    );
    const app = new Hono();
    registerPreviewRoutes(app, createAdapter(projectDir));

    const response = await app.request("http://localhost/projects/demo/preview");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).not.toContain("MotionPathPlugin.min.js");
  });

  it("injects Studio GSAP motion runtime into sub-composition previews with the active source path", async () => {
    const projectDir = createProjectDir();
    mkdirSync(join(projectDir, "compositions"), { recursive: true });
    writeFileSync(
      join(projectDir, "index.html"),
      "<!doctype html><html><head></head><body></body></html>",
    );
    writeFileSync(
      join(projectDir, "compositions/scene.html"),
      `<template><section id="card" data-composition-id="scene" data-width="1280" data-height="720"></section></template>`,
    );
    const manifestDir = join(projectDir, ".hyperframes");
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(
      join(manifestDir, "studio-motion.json"),
      `{"version":1,"motions":[{"kind":"gsap-motion","target":{"sourceFile":"compositions/scene.html","id":"card"},"start":0,"duration":1,"ease":"power2.out","from":{"y":32},"to":{"y":0}}]}`,
    );
    const app = new Hono();
    registerPreviewRoutes(app, createAdapter(projectDir));

    const response = await app.request(
      "http://localhost/projects/demo/preview/comp/compositions/scene.html",
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("__hfStudioMotionApply");
    expect(html).toContain("compositions/scene.html");
  });

  it("applies adapter preview transforms to bundled root previews", async () => {
    const projectDir = createProjectDir();
    const app = new Hono();
    registerPreviewRoutes(
      app,
      createAdapter(projectDir, {
        bundle: async () => "<!doctype html><html><head></head><body>Preview</body></html>",
        transformPreviewHtml: async ({ html, activeCompositionPath }) =>
          html.replace(
            "</head>",
            `<meta name="preview-path" content="${activeCompositionPath}"></head>`,
          ),
      }),
    );

    const response = await app.request("http://localhost/projects/demo/preview");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('<meta name="preview-path" content="index.html">');
  });

  it("applies adapter preview transforms to sub-composition previews", async () => {
    const projectDir = createProjectDir();
    mkdirSync(join(projectDir, "compositions"), { recursive: true });
    writeFileSync(
      join(projectDir, "compositions/scene.html"),
      `<template><section data-composition-id="scene" data-width="1280" data-height="720"></section></template>`,
    );
    const app = new Hono();
    registerPreviewRoutes(
      app,
      createAdapter(projectDir, {
        transformPreviewHtml: async ({ html, activeCompositionPath }) =>
          html.replace(
            "</head>",
            `<meta name="preview-path" content="${activeCompositionPath}"></head>`,
          ),
      }),
    );

    const response = await app.request(
      "http://localhost/projects/demo/preview/comp/compositions/scene.html",
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('<meta name="preview-path" content="compositions/scene.html">');
  });

  it("applies adapter preview transforms when bundle() returns null (reads from disk)", async () => {
    const projectDir = createProjectDir();
    const app = new Hono();
    registerPreviewRoutes(
      app,
      createAdapter(projectDir, {
        // bundle: async () => null  <-- default; falls back to reading index.html from disk
        transformPreviewHtml: async ({ html, activeCompositionPath }) =>
          html.replace(
            "</head>",
            `<meta name="preview-path" content="${activeCompositionPath}"></head>`,
          ),
      }),
    );

    const response = await app.request("http://localhost/projects/demo/preview");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('<meta name="preview-path" content="index.html">');
  });

  it("applies adapter preview transforms in the bundle error fallback path", async () => {
    const projectDir = createProjectDir();
    const app = new Hono();
    registerPreviewRoutes(
      app,
      createAdapter(projectDir, {
        bundle: async () => {
          throw new Error("bundler unavailable");
        },
        transformPreviewHtml: async ({ html, activeCompositionPath }) =>
          html.replace(
            "</head>",
            `<meta name="preview-path" content="${activeCompositionPath}"></head>`,
          ),
      }),
    );

    const response = await app.request("http://localhost/projects/demo/preview");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('<meta name="preview-path" content="index.html">');
  });

  it("falls back to original HTML when transformPreviewHtml throws", async () => {
    const projectDir = createProjectDir();
    const app = new Hono();
    registerPreviewRoutes(
      app,
      createAdapter(projectDir, {
        bundle: async () => "<!doctype html><html><head></head><body>Preview</body></html>",
        transformPreviewHtml: async () => {
          throw new Error("transform failed");
        },
      }),
    );

    const response = await app.request("http://localhost/projects/demo/preview");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Preview");
  });

  it("uses the adapter project signature when available", async () => {
    const projectDir = createProjectDir();
    const getProjectSignature = vi.fn(() => "cached-signature");
    const app = new Hono();
    registerPreviewRoutes(app, createAdapter(projectDir, { getProjectSignature }));

    const response = await app.request("http://localhost/projects/demo/preview");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(getProjectSignature).toHaveBeenCalledWith(projectDir);
    expect(html).toContain(
      '<meta name="hyperframes-project-signature" content="cached-signature">',
    );
  });

  it("updates the preview signature after project text edits", async () => {
    const projectDir = createProjectDir();
    const file = join(projectDir, "scene.js");
    writeFileSync(file, "export const label = 'first';");

    const firstSignature = await getPreviewSignature(projectDir);
    expect(await getPreviewSignature(projectDir)).toBe(firstSignature);

    writeFileSync(file, "export const label = 'second with changed size';");

    await expect(getPreviewSignature(projectDir)).resolves.not.toBe(firstSignature);
  });

  it("updates the preview signature after Studio manifest edits", async () => {
    const projectDir = createProjectDir();
    const manifestDir = join(projectDir, ".hyperframes");
    mkdirSync(manifestDir, { recursive: true });
    const motionFile = join(manifestDir, "studio-motion.json");
    writeFileSync(motionFile, `{"version":1,"motions":[]}`);

    const firstSignature = await getPreviewSignature(projectDir);

    writeFileSync(
      motionFile,
      `{"version":1,"motions":[{"kind":"gsap-motion","target":{"sourceFile":"index.html","id":"card"},"start":0,"duration":1,"from":{"y":32},"to":{"y":0}}]}`,
    );

    await expect(getPreviewSignature(projectDir)).resolves.not.toBe(firstSignature);
  });

  it("skips symlinked files when creating the preview signature", async () => {
    const projectDir = createProjectDir();
    const firstSignature = await getPreviewSignature(projectDir);

    const externalDir = mkdtempSync(join(tmpdir(), "hf-preview-external-"));
    tempDirs.push(externalDir);
    const externalFile = join(externalDir, "external.js");
    writeFileSync(externalFile, "export const external = true;");

    if (!tryCreateSymlink(externalFile, join(projectDir, "external.js"), "file")) return;

    await expect(getPreviewSignature(projectDir)).resolves.toBe(firstSignature);
  });

  it("skips symlinked directories when creating the preview signature", async () => {
    const projectDir = createProjectDir();
    if (!tryCreateSymlink(projectDir, join(projectDir, "loop"), "dir")) return;

    const signature = await getPreviewSignature(projectDir);

    expect(signature).toMatch(/^[a-f0-9]{24}$/);
  });
});

describe("built preview reuse", () => {
  const BUILT = "<!doctype html><html><head></head><body>Preview</body></html>";

  it("serves one build per ETag to cold browsers and rebuilds when the content changes", async () => {
    const projectDir = createProjectDir();
    const bundle = vi.fn(async () => BUILT);
    const app = new Hono();
    registerPreviewRoutes(app, createAdapter(projectDir, { bundle }));

    const first = await app.request("http://localhost/projects/demo/preview");
    const second = await app.request("http://localhost/projects/demo/preview");
    expect(await second.text()).toBe(await first.text());
    expect(second.headers.get("ETag")).toBe(first.headers.get("ETag"));
    expect(bundle).toHaveBeenCalledTimes(1);

    writeFileSync(join(projectDir, "index.html"), "<html><body>edited</body></html>");
    await app.request("http://localhost/projects/demo/preview");
    expect(bundle).toHaveBeenCalledTimes(2);
  });

  it("shares one build between requests that arrive while it runs", async () => {
    const projectDir = createProjectDir();
    let finish: (html: string) => void = () => {};
    const bundle = vi.fn(() => new Promise<string>((resolve) => (finish = resolve)));
    const app = new Hono();
    registerPreviewRoutes(app, createAdapter(projectDir, { bundle }));

    const early = app.request("http://localhost/projects/demo/preview");
    const player = app.request("http://localhost/projects/demo/preview");
    await vi.waitFor(() => expect(bundle).toHaveBeenCalled());
    finish(BUILT);
    const [a, b] = await Promise.all([early, player]);
    expect(await b.text()).toBe(await a.text());
    expect(bundle).toHaveBeenCalledTimes(1);
  });

  it("does not keep the disk fallback served after a failed build", async () => {
    const projectDir = createProjectDir();
    const bundle = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("bundle failed"))
      .mockResolvedValue(BUILT);
    const app = new Hono();
    registerPreviewRoutes(app, createAdapter(projectDir, { bundle }));

    await app.request("http://localhost/projects/demo/preview");
    const retry = await app.request("http://localhost/projects/demo/preview");
    expect(await retry.text()).toContain("Preview");
    expect(bundle).toHaveBeenCalledTimes(2);
  });

  it("serves a restarted server from the document store unless the build changed", async () => {
    const projectDir = createProjectDir();
    const storeDir = join(projectDir, ".hyperframes", "preview");
    const serve = async (salt: string) => {
      const bundle = vi.fn(async () => BUILT);
      const app = new Hono();
      registerPreviewRoutes(
        app,
        createAdapter(projectDir, {
          bundle,
          previewDocuments: createPreviewDocumentStore(storeDir, salt),
        } as Partial<StudioApiAdapter>),
      );
      const html = await (await app.request("http://localhost/projects/demo/preview")).text();
      return { html, builds: bundle.mock.calls.length };
    };

    const cold = await serve("build-a");
    expect(cold.builds).toBe(1);
    const restarted = await serve("build-a");
    expect(restarted).toEqual({ html: cold.html, builds: 0 });
    expect((await serve("build-b")).builds).toBe(1);
  });
});

describe("hf-id surfacing in preview route", () => {
  const idsOf = (html: string) =>
    [...html.matchAll(/data-hf-id="(hf-[a-z0-9]+)"/g)].map((m) => m[1]).sort();
  const postPatch = (app: Hono, file: string, hfId: string | undefined) =>
    app.request(`http://localhost/projects/demo/file-mutations/patch-element/${file}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target: { hfId },
        operations: [{ type: "inline-style", property: "opacity", value: "0.5" }],
      }),
    });

  it("serving the preview and a sub-comp twice leaves both files' bytes and mtime unchanged", async () => {
    const projectDir = createProjectDir();
    const files = [join(projectDir, "index.html"), join(projectDir, "scene.html")];
    writeFileSync(
      files[0]!,
      `<!doctype html><html><head></head><body><div>hello</div></body></html>`,
    );
    writeFileSync(
      files[1]!,
      `<div class="clip" data-start="0" data-end="3"><img src="logo.png"></div>`,
    );
    const snapshot = () => files.map((f) => [readFileSync(f, "utf-8"), statSync(f).mtimeMs]);
    const before = snapshot();
    const app = new Hono();
    registerPreviewRoutes(app, createAdapter(projectDir));
    for (let i = 0; i < 2; i++) {
      expect((await app.request("http://localhost/projects/demo/preview")).status).toBe(200);
      const comp = await app.request("http://localhost/projects/demo/preview/comp/scene.html");
      expect(comp.status).toBe(200);
    }
    expect(snapshot()).toEqual(before);
  });

  it("a save finds an element by the id the sub-comp route served, though the file has no ids", async () => {
    const projectDir = createProjectDir();
    const compPath = join(projectDir, "scene.html");
    writeFileSync(
      compPath,
      `<div class="clip" data-start="0" data-end="3"><img src="assets/logo.png"></div>`,
    );
    const app = new Hono();
    const adapter = createAdapter(projectDir);
    registerPreviewRoutes(app, adapter);
    registerFileRoutes(app, adapter);
    const served = await (
      await app.request("http://localhost/projects/demo/preview/comp/scene.html")
    ).text();
    const imgId = /<img[^>]*data-hf-id="(hf-[a-z0-9]+)"/.exec(served)?.[1];
    expect(imgId).toBeDefined();
    const res = await postPatch(app, "scene.html", imgId);
    expect(await res.json()).toMatchObject({ matched: true, changed: true });
    expect(readFileSync(compPath, "utf-8")).toMatch(/<img[^>]*opacity: ?0\.5/);
  });

  it("a save finds an element whose src the bundler rewrote, though its file has no ids", async () => {
    const projectDir = createProjectDir();
    mkdirSync(join(projectDir, "compositions"));
    writeFileSync(
      join(projectDir, "index.html"),
      `<!doctype html><html><head></head><body><div id="root" data-composition-id="main" data-width="1920" data-height="1080"><div id="s" data-composition-id="scene" data-composition-src="compositions/scene.html" data-start="0" data-duration="3"></div></div></body></html>`,
    );
    const compPath = join(projectDir, "compositions", "scene.html");
    writeFileSync(
      compPath,
      `<template id="scene-template"><div data-composition-id="scene" data-width="1920" data-height="1080"><img class="logo" src="logo.png"></div></template>`,
    );
    writeFileSync(join(projectDir, "compositions", "logo.png"), "png");
    const { bundleToSingleHtml } = await import("@hyperframes/core/compiler");
    const app = new Hono();
    const adapter = createAdapter(projectDir, {
      bundle: (dir, options) => bundleToSingleHtml(dir, { ...PREVIEW_BUNDLE_OPTIONS, ...options }),
    });
    registerPreviewRoutes(app, adapter);
    registerFileRoutes(app, adapter);
    const served = await (await app.request("http://localhost/projects/demo/preview")).text();
    const img = /<img[^>]*class="logo"[^>]*>/.exec(served)?.[0] ?? "";
    expect(img).not.toContain('src="logo.png"');
    const res = await postPatch(
      app,
      "compositions/scene.html",
      /data-hf-id="(hf-[a-z0-9]+)"/.exec(img)?.[1],
    );
    expect(await res.json()).toMatchObject({ matched: true, changed: true });
  });

  it("serves HTML with data-hf-id on body elements (R7 write-back)", async () => {
    const projectDir = createProjectDir();
    writeFileSync(
      join(projectDir, "index.html"),
      `<!doctype html><html><head></head><body><div class="card"><p>text</p></div></body></html>`,
    );
    const app = new Hono();
    registerPreviewRoutes(app, createAdapter(projectDir));
    const res = await app.request("http://localhost/projects/demo/preview");
    expect(res.status).toBe(200);
    const html = await res.text();
    const ids = html.match(/data-hf-id="hf-[a-z0-9]{4}"/g);
    // div and p both tagged
    expect(ids?.length).toBeGreaterThanOrEqual(2);
  });

  it("bundle returning untagged HTML gets the ids minted from the source file", async () => {
    const projectDir = createProjectDir();
    const indexPath = join(projectDir, "index.html");
    const sourceHtml = `<!doctype html><html><head></head><body><div class="card"><p>hello</p></div></body></html>`;
    writeFileSync(indexPath, sourceHtml);

    const app = new Hono();
    // Bundler returns the same untagged source HTML (simulates stale cache read)
    registerPreviewRoutes(app, createAdapter(projectDir, { bundle: async () => sourceHtml }));
    const res = await app.request("http://localhost/projects/demo/preview");
    expect(res.status).toBe(200);

    const servedIds = idsOf(await res.text());
    expect(servedIds.length).toBeGreaterThanOrEqual(2);
    expect(servedIds).toEqual(idsOf(ensureHfIds(sourceHtml)));
  });

  it("returns ByteString-safe stable and distinct ETags for percent-encoded CJK sub-comp paths", async () => {
    const projectDir = createProjectDir();
    mkdirSync(join(projectDir, "compositions"));
    writeFileSync(join(projectDir, "compositions/測試.html"), "<div>First</div>");
    writeFileSync(join(projectDir, "compositions/別頁.html"), "<div>Second</div>");
    const app = new Hono();
    registerPreviewRoutes(
      app,
      createAdapter(projectDir, { getProjectSignature: () => "stable-signature" }),
    );

    const first = await app.request(
      "http://localhost/projects/demo/preview/comp/compositions/%E6%B8%AC%E8%A9%A6.html",
    );
    const repeat = await app.request(
      "http://localhost/projects/demo/preview/comp/compositions/%E6%B8%AC%E8%A9%A6.html",
    );
    const other = await app.request(
      "http://localhost/projects/demo/preview/comp/compositions/%E5%88%A5%E9%A0%81.html",
    );

    expect([first.status, repeat.status, other.status]).toEqual([200, 200, 200]);
    const firstEtag = first.headers.get("ETag");
    expect(firstEtag).toBeTruthy();
    expect(firstEtag).toMatch(/^[\x20-\x7e]+$/);
    expect(repeat.headers.get("ETag")).toBe(firstEtag);
    expect(other.headers.get("ETag")).not.toBe(firstEtag);
  });

  it("sub-comp served ids equal the source's ids even when relative asset paths are rewritten", async () => {
    // Guards setTiming element_not_found: minting after the route rewrites src gives ids the source lacks.
    const projectDir = createProjectDir();
    const raw = `<div class="clip" data-start="0" data-end="3"><img src="assets/logo.png"></div>`;
    writeFileSync(join(projectDir, "scene.html"), raw);
    const app = new Hono();
    registerPreviewRoutes(app, createAdapter(projectDir));
    const res = await app.request("http://localhost/projects/demo/preview/comp/scene.html");
    expect(res.status).toBe(200);
    const servedIds = idsOf(await res.text());
    expect(servedIds.length).toBeGreaterThanOrEqual(2); // div + img
    expect(servedIds).toEqual(idsOf(ensureHfIds(raw)));
  });

  it("template-based sub-comp: the served (unwrapped) ids are the source's inner ids", async () => {
    const projectDir = createProjectDir();
    const raw = `<template data-composition-id="test-minimal"><div class="clip" data-start="0" data-end="3">Hello</div><div class="clip" data-start="3" data-end="6">World</div></template>`;
    writeFileSync(join(projectDir, "test-minimal.html"), raw);
    const app = new Hono();
    registerPreviewRoutes(app, createAdapter(projectDir));
    const res = await app.request("http://localhost/projects/demo/preview/comp/test-minimal.html");
    expect(res.status).toBe(200);
    const servedIds = idsOf(await res.text());
    const sourceIds = idsOf(ensureHfIds(raw));
    expect(sourceIds.length).toBe(2);
    for (const id of sourceIds) expect(servedIds).toContain(id);
  });

  it("sub-comp route does NOT rewrite a non-HTML file on disk (GET must not corrupt assets)", async () => {
    const projectDir = createProjectDir();
    const svgPath = join(projectDir, "logo.svg");
    const svgBytes = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>`;
    writeFileSync(svgPath, svgBytes);
    const app = new Hono();
    registerPreviewRoutes(app, createAdapter(projectDir));
    await app.request("http://localhost/projects/demo/preview/comp/logo.svg");
    // Whatever the route serves, a GET must leave the file byte-identical.
    expect(readFileSync(svgPath, "utf-8")).toBe(svgBytes);
  });

  it("serves an asset reached through an in-project symlink to a shared external directory", async () => {
    const projectDir = createProjectDir();
    const externalDir = mkdtempSync(join(tmpdir(), "hf-preview-shared-assets-"));
    tempDirs.push(externalDir);
    mkdirSync(join(projectDir, "assets"));
    writeFileSync(join(externalDir, "sample.svg"), "<svg>shared</svg>");
    if (!tryCreateSymlink(externalDir, join(projectDir, "assets", "shared"), "dir")) return;

    const app = new Hono();
    registerPreviewRoutes(app, createAdapter(projectDir));

    const response = await app.request(
      "http://localhost/projects/demo/preview/assets/shared/sample.svg",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/svg+xml");
    expect(await response.text()).toBe("<svg>shared</svg>");

    const traversal = await app.request(
      "http://localhost/projects/demo/preview/..%2f..%2f..%2fetc%2fpasswd",
    );
    expect(traversal.status).toBe(404);
  });

  it("a save does NOT stamp ids inside a plain <template> (runtime clone-source)", async () => {
    const projectDir = createProjectDir();
    const compPath = join(projectDir, "clones.html");
    writeFileSync(
      compPath,
      `<div class="clip" data-start="0" data-end="3">stage</div><template><li class="row">item</li></template>`,
    );
    const app = new Hono();
    registerFileRoutes(app, createAdapter(projectDir));
    const res = await app.request(
      "http://localhost/projects/demo/file-mutations/patch-element/clones.html",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: { selector: ".clip" },
          operations: [{ type: "inline-style", property: "opacity", value: "0.5" }],
        }),
      },
    );
    expect(await res.json()).toMatchObject({ matched: true });
    const disk = readFileSync(compPath, "utf-8");
    expect(disk).toMatch(/<div[^>]*data-hf-id/); // stage div stamped
    expect(disk).not.toMatch(/<li[^>]*data-hf-id/); // clone-source untouched
  });
});

describe("preview ?variables= injection", () => {
  it("injects window.__hfVariables before composition scripts in the main preview", async () => {
    const projectDir = createProjectDir();
    const app = new Hono();
    registerPreviewRoutes(app, createAdapter(projectDir));

    const values = { title: "Custom", count: 5 };
    const res = await app.request(
      `http://localhost/projects/demo/preview?variables=${encodeURIComponent(JSON.stringify(values))}`,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("data-hf-preview-variables");
    expect(html).toContain('window.__hfVariables={"title":"Custom","count":5}');
    // Injected in <head> — before the runtime script and all body scripts.
    expect(html.indexOf("data-hf-preview-variables")).toBeLessThan(html.indexOf("</head>"));
  });

  it("escapes </script> breakout attempts in string values", async () => {
    const projectDir = createProjectDir();
    const app = new Hono();
    registerPreviewRoutes(app, createAdapter(projectDir));

    const values = { title: "</script><script>alert(1)</script>" };
    const res = await app.request(
      `http://localhost/projects/demo/preview?variables=${encodeURIComponent(JSON.stringify(values))}`,
    );
    const html = await res.text();
    const injected = /<script data-hf-preview-variables>([\s\S]*?)<\/script>/.exec(html);
    expect(injected?.[1]).toContain("\\u003c/script>");
    expect(injected?.[1]).not.toContain("</script>");
  });

  it("returns 400 for invalid JSON and non-object payloads", async () => {
    const projectDir = createProjectDir();
    const app = new Hono();
    registerPreviewRoutes(app, createAdapter(projectDir));

    const bad = await app.request("http://localhost/projects/demo/preview?variables=%7Bnope");
    expect(bad.status).toBe(400);
    const arr = await app.request(
      `http://localhost/projects/demo/preview?variables=${encodeURIComponent("[1,2]")}`,
    );
    expect(arr.status).toBe(400);
  });

  it("salts the ETag so cached previews revalidate when values change", async () => {
    const projectDir = createProjectDir();
    const app = new Hono();
    registerPreviewRoutes(app, createAdapter(projectDir));

    const plain = await app.request("http://localhost/projects/demo/preview");
    const withVars = await app.request(
      `http://localhost/projects/demo/preview?variables=${encodeURIComponent('{"a":1}')}`,
    );
    const otherVars = await app.request(
      `http://localhost/projects/demo/preview?variables=${encodeURIComponent('{"a":2}')}`,
    );
    const etags = [plain, withVars, otherVars].map((r) => r.headers.get("ETag"));
    expect(new Set(etags).size).toBe(3);
  });

  it("injects variables into sub-composition previews", async () => {
    const projectDir = createProjectDir();
    writeFileSync(
      join(projectDir, "scene.html"),
      "<!doctype html><html><head></head><body><div class='clip' data-start='0' data-duration='2'>Scene</div></body></html>",
    );
    const app = new Hono();
    registerPreviewRoutes(app, createAdapter(projectDir));

    const res = await app.request(
      `http://localhost/projects/demo/preview/comp/scene.html?variables=${encodeURIComponent('{"accent":"#f00"}')}`,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('window.__hfVariables={"accent":"#f00"}');
  });
});

describe("sub-composition preview attribute integrity", () => {
  it("preserves quote-bearing html attributes (data-composition-variables JSON)", async () => {
    const projectDir = createProjectDir();
    const decls = JSON.stringify([
      { id: "title", type: "string", label: "Title", default: "Hello" },
    ]);
    writeFileSync(
      join(projectDir, "card.html"),
      `<!doctype html><html data-composition-variables='${decls}'><head></head><body><div class="clip" data-start="0" data-duration="2">x</div></body></html>`,
    );
    const app = new Hono();
    registerPreviewRoutes(app, createAdapter(projectDir));

    const res = await app.request("http://localhost/projects/demo/preview/comp/card.html");
    expect(res.status).toBe(200);
    const html = await res.text();
    const attr = /data-composition-variables="([^"]*)"/.exec(html)?.[1] ?? "";
    // Entities decode back to the exact declared JSON — a lost/shredded
    // attribute here silently breaks getVariables() on the comp route.
    const decoded = attr.replace(/&quot;/g, '"').replace(/&amp;/g, "&");
    expect(JSON.parse(decoded)).toEqual(JSON.parse(decls));
  });
});

// ── U3: ?hf-proxy=h264 negotiation + __HF_MEDIA_CODEC_MAP__ injection ───────
// (docs/plans/2026-07-14-002-feat-transparent-media-proxies-plan.md)
//
// Both helpers preview.ts depends on (proxyTranscoder's resolveProxy,
// mediaCodecMap's scanProjectMediaCodecMap) are mocked here rather than
// exercised for real: their own behavior (ffmpeg spawning/caching, ffprobe
// codec detection) is already covered by proxyTranscoder.test.ts and
// mediaCodecMap.test.ts. This suite only tests preview.ts's own wiring —
// the route branches, ETag salting, 404/502 mapping, and injection point.
describe("hf-proxy negotiation and media codec map injection (U3)", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("../helpers/proxyTranscoder.js");
    vi.doUnmock("../helpers/mediaCodecMap.js");
  });

  class FakeProxyTranscodeError extends Error {
    readonly exitCode: number | null;
    readonly stderrTail: string;
    constructor(message: string, exitCode: number | null, stderrTail: string) {
      super(message);
      this.name = "ProxyTranscodeError";
      this.exitCode = exitCode;
      this.stderrTail = stderrTail;
    }
  }

  class FakeProxyCapacityError extends FakeProxyTranscodeError {}

  type ScanMapImpl = (
    projectDir: string,
    htmlSources: Array<{ html: string; compSrcPath?: string }>,
    options?: unknown,
  ) => Promise<
    Record<
      string,
      {
        codecName: string;
        browserHostile: boolean;
        representativeMime: string | null;
      }
    >
  >;

  async function loadPreviewModule(opts: {
    resolveProxyImpl?: (
      projectDir: string,
      absoluteSourcePath: string,
      variant?: "h264" | "vp8",
    ) => Promise<string>;
    scanMapImpl?: ScanMapImpl;
    probeAssetCodecImpl?: () => Promise<{
      codecName: string;
      browserHostile: boolean;
      representativeMime: string | null;
      hasAlpha: boolean;
    } | null>;
  }): Promise<typeof import("./preview.js")> {
    vi.resetModules();
    const resolveProxy =
      opts.resolveProxyImpl ??
      (async () => {
        throw new FakeProxyTranscodeError(
          "no resolveProxy impl configured for this test",
          null,
          "",
        );
      });
    vi.doMock("../helpers/proxyTranscoder.js", () => ({
      resolveProxy,
      ProxyTranscodeError: FakeProxyTranscodeError,
      ProxyCapacityError: FakeProxyCapacityError,
      PROXY_PARAMS_VERSION: "v1",
      getProxyCachePath: () => "",
    }));
    // Spread the real module first so the pre-warm gate (`shouldPrewarmProxy`
    // and its codec table) is the production one — a hand-written copy of that
    // rule would let the table and this suite drift apart. The explicit keys
    // below still replace everything that would touch ffprobe or ffmpeg.
    vi.doMock("../helpers/mediaCodecMap.js", async () => ({
      ...(await vi.importActual<typeof import("../helpers/mediaCodecMap.js")>(
        "../helpers/mediaCodecMap.js",
      )),
      scanProjectMediaCodecMap: opts.scanMapImpl ?? (async () => ({})),
      createMediaCodecProbeCache: () => new Map(),
      probeAssetCodec:
        opts.probeAssetCodecImpl ??
        (async () => ({
          codecName: "hevc",
          browserHostile: true,
          representativeMime: null,
          hasAlpha: false,
        })),
      decideMediaProxyEligibility: (
        facts: {
          browserHostile: boolean;
          hasAlpha: boolean;
        } | null,
      ) => {
        if (!facts) return { eligible: false, reason: "unknown_codec" };
        if (!facts.browserHostile) {
          return { eligible: false, reason: "browser_safe_codec" };
        }
        return { eligible: true };
      },
      isProxyVariant: (value: string) => value === "h264" || value === "vp8",
      isProxyVariantRequest: (value: string) =>
        value === "auto" || value === "h264" || value === "vp8",
      proxyVariantFor: (facts: { hasAlpha: boolean }) => (facts.hasAlpha ? "vp8" : "h264"),
      resolveProxyVariantRequest: (
        request: "auto" | "h264" | "vp8",
        facts: { hasAlpha: boolean },
      ) => {
        const expected = facts.hasAlpha ? "vp8" : "h264";
        return request === "auto" || request === expected ? expected : null;
      },
      PROXY_VARIANT_CONFIG: {
        h264: { extension: ".mp4", contentType: "video/mp4" },
        vp8: { extension: ".webm", contentType: "video/webm" },
      },
    }));
    return import("./preview.js");
  }

  describe("?hf-proxy=h264 on the static asset route", () => {
    it("serves proxy bytes with Accept-Ranges on a full request, and a 206 range slice on a Range request", async () => {
      const projectDir = createProjectDir();
      writeFileSync(join(projectDir, "clip.mp4"), "original-hevc-bytes");
      const resolveProxyMock = vi.fn(async () => {
        const proxyPath = join(projectDir, "proxy.mp4");
        writeFileSync(proxyPath, "0123456789proxybytes");
        return proxyPath;
      });
      const { registerPreviewRoutes: register } = await loadPreviewModule({
        resolveProxyImpl: resolveProxyMock,
      });

      const app = new Hono();
      register(app, createAdapter(projectDir));

      const full = await app.request(
        "http://localhost/projects/demo/preview/clip.mp4?hf-proxy=h264",
      );
      expect(full.status).toBe(200);
      expect(full.headers.get("Accept-Ranges")).toBe("bytes");
      expect(full.headers.get("Content-Type")).toBe("video/mp4");
      expect(await full.text()).toBe("0123456789proxybytes");
      expect(resolveProxyMock).toHaveBeenCalledTimes(1);
      expect(resolveProxyMock).toHaveBeenCalledWith(
        projectDir,
        join(projectDir, "clip.mp4"),
        "h264",
      );

      const ranged = await app.request(
        "http://localhost/projects/demo/preview/clip.mp4?hf-proxy=h264",
        {
          headers: { Range: "bytes=0-9" },
        },
      );
      expect(ranged.status).toBe(206);
      expect(await ranged.text()).toBe("0123456789");
      expect(ranged.headers.get("Content-Range")).toBe("bytes 0-9/20");
    });

    it("honors If-None-Match on a repeat request with a 304, without re-invoking resolveProxy", async () => {
      const projectDir = createProjectDir();
      writeFileSync(join(projectDir, "clip.mp4"), "original-hevc-bytes");
      pastSettleWindow();
      const resolveProxyMock = vi.fn(async () => {
        const proxyPath = join(projectDir, "proxy.mp4");
        writeFileSync(proxyPath, "proxy-bytes");
        return proxyPath;
      });
      const { registerPreviewRoutes: register } = await loadPreviewModule({
        resolveProxyImpl: resolveProxyMock,
      });

      const app = new Hono();
      register(app, createAdapter(projectDir));

      const first = await app.request(
        "http://localhost/projects/demo/preview/clip.mp4?hf-proxy=h264",
      );
      expect(first.status).toBe(200);
      const etag = first.headers.get("ETag");
      expect(etag).toBeTruthy();
      expect(resolveProxyMock).toHaveBeenCalledTimes(1);

      const second = await app.request(
        "http://localhost/projects/demo/preview/clip.mp4?hf-proxy=h264",
        { headers: { "If-None-Match": etag! } },
      );
      expect(second.status).toBe(304);
      // The 304 shortcut never needs the proxy — no second transcode call.
      expect(resolveProxyMock).toHaveBeenCalledTimes(1);
    });

    it("tags no asset written in the last moments, so a same-size rewrite cannot reuse its tag", async () => {
      const projectDir = createProjectDir();
      writeFileSync(join(projectDir, "clip.mp4"), "original-hevc-bytes");
      const { registerPreviewRoutes: register } = await loadPreviewModule({});
      const app = new Hono();
      register(app, createAdapter(projectDir));

      const fresh = await app.request("http://localhost/projects/demo/preview/clip.mp4");

      expect(fresh.status).toBe(200);
      expect(fresh.headers.get("ETag")).toBeNull();
    });

    it("counts one proxy request per resolved proxy, not per HTTP request", async () => {
      const projectDir = createProjectDir();
      writeFileSync(join(projectDir, "clip.mp4"), "original-hevc-bytes");
      pastSettleWindow();
      const resolveProxyMock = vi.fn(async () => {
        const proxyPath = join(projectDir, "proxy.mp4");
        writeFileSync(proxyPath, "0123456789proxybytes");
        return proxyPath;
      });
      const { registerPreviewRoutes: register } = await loadPreviewModule({
        resolveProxyImpl: resolveProxyMock,
      });
      const { mediaProxyDemand } = await import("../helpers/mediaCodecMap.js");
      const before = mediaProxyDemand().proxyRequests;

      const app = new Hono();
      register(app, createAdapter(projectDir));

      const first = await app.request(
        "http://localhost/projects/demo/preview/clip.mp4?hf-proxy=h264",
      );
      const etag = first.headers.get("ETag");
      // A 304 revalidation is the same asset already served; counting it would
      // put this on a different scale from `prewarmsRequested`.
      await app.request("http://localhost/projects/demo/preview/clip.mp4?hf-proxy=h264", {
        headers: { "If-None-Match": etag! },
      });

      expect(mediaProxyDemand().proxyRequests - before).toBe(1);
    });

    it("returns 404 without transcoding when the asset is missing", async () => {
      const projectDir = createProjectDir();
      const resolveProxyMock = vi.fn(async () => "should-not-be-called");
      const { registerPreviewRoutes: register } = await loadPreviewModule({
        resolveProxyImpl: resolveProxyMock,
      });

      const app = new Hono();
      register(app, createAdapter(projectDir));

      const res = await app.request(
        "http://localhost/projects/demo/preview/does-not-exist.mp4?hf-proxy=h264",
      );
      expect(res.status).toBe(404);
      expect(resolveProxyMock).not.toHaveBeenCalled();
    });

    it("returns 404 without transcoding when the asset is not a video", async () => {
      const projectDir = createProjectDir();
      writeFileSync(join(projectDir, "notes.txt"), "just text");
      const resolveProxyMock = vi.fn(async () => "should-not-be-called");
      const { registerPreviewRoutes: register } = await loadPreviewModule({
        resolveProxyImpl: resolveProxyMock,
      });

      const app = new Hono();
      register(app, createAdapter(projectDir));

      const res = await app.request(
        "http://localhost/projects/demo/preview/notes.txt?hf-proxy=h264",
      );
      expect(res.status).toBe(404);
      expect(resolveProxyMock).not.toHaveBeenCalled();
    });

    it("serves an alpha asset as a VP8 WebM proxy", async () => {
      const projectDir = createProjectDir();
      writeFileSync(join(projectDir, "clip.mov"), "alpha-video-bytes");
      const resolveProxyMock = vi.fn(async () => {
        const proxyPath = join(projectDir, "proxy.webm");
        writeFileSync(proxyPath, "vp8-alpha-proxy");
        return proxyPath;
      });
      const { registerPreviewRoutes: register } = await loadPreviewModule({
        resolveProxyImpl: resolveProxyMock,
        probeAssetCodecImpl: async () => ({
          codecName: "prores",
          browserHostile: true,
          representativeMime: null,
          hasAlpha: true,
        }),
      });
      const app = new Hono();
      register(app, createAdapter(projectDir));

      const res = await app.request("http://localhost/projects/demo/preview/clip.mov?hf-proxy=vp8");

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("video/webm");
      expect(resolveProxyMock).toHaveBeenCalledWith(
        projectDir,
        join(projectDir, "clip.mov"),
        "vp8",
      );
    });

    it("rejects a proxy variant that disagrees with the asset facts", async () => {
      const projectDir = createProjectDir();
      writeFileSync(join(projectDir, "clip.mp4"), "video-bytes");
      const resolveProxyMock = vi.fn(async () => "should-not-be-called");
      const { registerPreviewRoutes: register } = await loadPreviewModule({
        resolveProxyImpl: resolveProxyMock,
      });
      const app = new Hono();
      register(app, createAdapter(projectDir));

      const res = await app.request("http://localhost/projects/demo/preview/clip.mp4?hf-proxy=vp8");

      expect(res.status).toBe(422);
      expect(resolveProxyMock).not.toHaveBeenCalled();
    });

    it("rejects browser-safe sources before transcoding", async () => {
      const projectDir = createProjectDir();
      writeFileSync(join(projectDir, "clip.mp4"), "video-bytes");
      const resolveProxyMock = vi.fn(async () => "should-not-be-called");
      const { registerPreviewRoutes: register } = await loadPreviewModule({
        resolveProxyImpl: resolveProxyMock,
        probeAssetCodecImpl: async () => ({
          codecName: "h264",
          browserHostile: false,
          representativeMime: null,
          hasAlpha: false,
        }),
      });
      const app = new Hono();
      register(app, createAdapter(projectDir));

      const res = await app.request(
        "http://localhost/projects/demo/preview/clip.mp4?hf-proxy=h264",
      );

      expect(res.status).toBe(422);
      expect(resolveProxyMock).not.toHaveBeenCalled();
    });

    it("returns 404 without transcoding when the param value is not a proxy variant", async () => {
      const projectDir = createProjectDir();
      writeFileSync(join(projectDir, "clip.mp4"), "original-hevc-bytes");
      const resolveProxyMock = vi.fn(async () => "should-not-be-called");
      const { registerPreviewRoutes: register } = await loadPreviewModule({
        resolveProxyImpl: resolveProxyMock,
      });

      const app = new Hono();
      register(app, createAdapter(projectDir));

      for (const value of ["H264", ""]) {
        const res = await app.request(
          `http://localhost/projects/demo/preview/clip.mp4?hf-proxy=${value}`,
        );
        expect(res.status).toBe(404);
      }
      expect(resolveProxyMock).not.toHaveBeenCalled();
    });

    it("maps a ProxyTranscodeError to a 502 carrying the error message", async () => {
      const projectDir = createProjectDir();
      writeFileSync(join(projectDir, "clip.mp4"), "original-hevc-bytes");
      const resolveProxyMock = vi.fn(async () => {
        throw new FakeProxyTranscodeError("ffmpeg exited with code 1", 1, "unsupported codec");
      });
      const { registerPreviewRoutes: register } = await loadPreviewModule({
        resolveProxyImpl: resolveProxyMock,
      });

      const app = new Hono();
      register(app, createAdapter(projectDir));

      const res = await app.request(
        "http://localhost/projects/demo/preview/clip.mp4?hf-proxy=h264",
      );
      expect(res.status).toBe(502);
      expect(await res.text()).toBe("ffmpeg exited with code 1");
    });

    it("maps a full proxy queue to a retryable 503", async () => {
      const projectDir = createProjectDir();
      writeFileSync(join(projectDir, "clip.mp4"), "original-hevc-bytes");
      const { registerPreviewRoutes: register } = await loadPreviewModule({
        resolveProxyImpl: async () => {
          throw new FakeProxyCapacityError("media proxy queue is full", null, "");
        },
      });
      const app = new Hono();
      register(app, createAdapter(projectDir));

      const res = await app.request(
        "http://localhost/projects/demo/preview/clip.mp4?hf-proxy=h264",
      );
      expect(res.status).toBe(503);
      expect(res.headers.get("Retry-After")).toBe("5");
    });

    it("rejects a path-traversal attempt through the proxied path (404, no transcode)", async () => {
      const projectDir = createProjectDir();
      const resolveProxyMock = vi.fn(async () => "should-not-be-called");
      const { registerPreviewRoutes: register } = await loadPreviewModule({
        resolveProxyImpl: resolveProxyMock,
      });

      const app = new Hono();
      register(app, createAdapter(projectDir));

      const res = await app.request(
        "http://localhost/projects/demo/preview/..%2f..%2f..%2fetc%2fpasswd?hf-proxy=h264",
      );
      expect(res.status).toBe(404);
      expect(resolveProxyMock).not.toHaveBeenCalled();
    });

    it("404s the param when auto-proxy is disabled for the adapter, without transcoding", async () => {
      const projectDir = createProjectDir();
      writeFileSync(join(projectDir, "clip.mp4"), "original-hevc-bytes");
      const resolveProxyMock = vi.fn(async () => "should-not-be-called");
      const { registerPreviewRoutes: register } = await loadPreviewModule({
        resolveProxyImpl: resolveProxyMock,
      });

      const app = new Hono();
      register(app, createAdapter(projectDir, { autoProxy: false }));

      const res = await app.request(
        "http://localhost/projects/demo/preview/clip.mp4?hf-proxy=h264",
      );
      expect(res.status).toBe(404);
      expect(resolveProxyMock).not.toHaveBeenCalled();
    });
  });

  describe("__HF_MEDIA_CODEC_MAP__ injection into composition HTML", () => {
    it("keeps HTML byte-identical when the scan finds no proxy-eligible media", async () => {
      const projectDir = createProjectDir();
      const { registerPreviewRoutes: register } = await loadPreviewModule({
        scanMapImpl: async () => ({}),
      });
      const app = new Hono();
      register(app, createAdapter(projectDir));

      const res = await app.request("http://localhost/projects/demo/preview");
      const html = await res.text();
      expect(html).not.toContain("data-hf-media-codec-map");
    });
    it("injects the scanned map naming the hostile fixture, and pre-warms resolveProxy for it", async () => {
      const projectDir = createProjectDir();
      const resolveProxyMock = vi.fn(async () => join(projectDir, ".transcode-cache", "x.mp4"));
      const scanMapMock = vi.fn(async () => ({
        "/videos/hevc.mp4": {
          codecName: "hevc",
          browserHostile: true,
          representativeMime: 'video/mp4; codecs="hvc1.1.6.L120.B0"',
        },
      }));
      const { registerPreviewRoutes: register } = await loadPreviewModule({
        resolveProxyImpl: resolveProxyMock,
        scanMapImpl: scanMapMock,
      });

      const app = new Hono();
      register(app, createAdapter(projectDir));

      const res = await app.request("http://localhost/projects/demo/preview");
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("window.__HF_MEDIA_CODEC_MAP__");
      expect(html).toContain("/videos/hevc.mp4");
      expect(html).not.toContain("h264.mp4");
      expect(scanMapMock).toHaveBeenCalled();

      // Pre-warm: fire-and-forget resolveProxy for the hostile entry.
      await Promise.resolve();
      await Promise.resolve();
      expect(resolveProxyMock).toHaveBeenCalledWith(
        projectDir,
        join(projectDir, "/videos/hevc.mp4"),
        "h264",
      );
    });

    it("injects and serves a proxy for a hostile video through an external asset symlink", async () => {
      const projectDir = createProjectDir();
      const externalDir = mkdtempSync(join(tmpdir(), "hf-preview-shared-video-"));
      tempDirs.push(externalDir);
      mkdirSync(join(projectDir, "assets"));
      writeFileSync(join(externalDir, "clip.mov"), "shared-hevc-bytes");
      if (!tryCreateSymlink(externalDir, join(projectDir, "assets", "shared"), "dir")) return;

      const proxyPath = join(projectDir, ".transcode-cache", "shared.mp4");
      const resolveProxyMock = vi.fn(async () => {
        mkdirSync(join(projectDir, ".transcode-cache"), { recursive: true });
        writeFileSync(proxyPath, "proxy-bytes");
        return proxyPath;
      });
      const scanMapMock = vi.fn(async () => ({
        "/assets/shared/clip.mov": {
          codecName: "hevc",
          browserHostile: true,
          representativeMime: 'video/mp4; codecs="hvc1.1.6.L120.B0"',
        },
      }));
      const { registerPreviewRoutes: register } = await loadPreviewModule({
        resolveProxyImpl: resolveProxyMock,
        scanMapImpl: scanMapMock,
      });
      const app = new Hono();
      register(app, createAdapter(projectDir));

      const preview = await app.request("http://localhost/projects/demo/preview");
      expect(await preview.text()).toContain("/assets/shared/clip.mov");
      expect(scanMapMock).toHaveBeenCalled();

      const proxied = await app.request(
        "http://localhost/projects/demo/preview/assets/shared/clip.mov?hf-proxy=h264",
      );
      expect(proxied.status).toBe(200);
      expect(proxied.headers.get("Content-Type")).toBe("video/mp4");
      expect(await proxied.text()).toBe("proxy-bytes");
      expect(resolveProxyMock).toHaveBeenCalledWith(
        projectDir,
        join(projectDir, "assets", "shared", "clip.mov"),
        "h264",
      );
    });

    it("escapes script terminators and JavaScript line separators in codec-map keys", async () => {
      const projectDir = createProjectDir();
      const { registerPreviewRoutes: register } = await loadPreviewModule({
        resolveProxyImpl: async () => join(projectDir, ".transcode-cache", "x.mp4"),
        scanMapImpl: async () => ({
          "/videos/</script>\u2028\u2029.mp4": {
            codecName: "hevc",
            browserHostile: true,
            representativeMime: null,
          },
        }),
      });
      const app = new Hono();
      register(app, createAdapter(projectDir));

      const html = await (await app.request("http://localhost/projects/demo/preview")).text();

      const injected = /<script data-hf-media-codec-map>([\s\S]*?)<\/script>/.exec(html)?.[1];
      expect(injected).toContain("\\u003c/script>");
      expect(injected).toContain("\\u2028");
      expect(injected).toContain("\\u2029");
      expect(injected).not.toContain("</script>");
    });

    it("does not inject the codec map (and 404s the proxy param) when auto-proxy is disabled", async () => {
      const projectDir = createProjectDir();
      writeFileSync(join(projectDir, "clip.mp4"), "bytes");
      const resolveProxyMock = vi.fn(async () => "should-not-be-called");
      const scanMapMock = vi.fn(async () => ({
        "/clip.mp4": {
          codecName: "hevc",
          browserHostile: true,
          representativeMime: null,
        },
      }));
      const { registerPreviewRoutes: register } = await loadPreviewModule({
        resolveProxyImpl: resolveProxyMock,
        scanMapImpl: scanMapMock,
      });

      const app = new Hono();
      register(app, createAdapter(projectDir, { autoProxy: false }));

      const res = await app.request("http://localhost/projects/demo/preview");
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).not.toContain("__HF_MEDIA_CODEC_MAP__");
      expect(scanMapMock).not.toHaveBeenCalled();

      const proxyRes = await app.request(
        "http://localhost/projects/demo/preview/clip.mp4?hf-proxy=h264",
      );
      expect(proxyRes.status).toBe(404);
      expect(resolveProxyMock).not.toHaveBeenCalled();
    });
  });
});

describe("preview asset byte ranges", () => {
  it("streams a slice of a media file too large to read whole", async () => {
    // A sparse 3 GiB file costs no disk. readFileSync refuses anything over
    // 2 GiB (ERR_FS_FILE_TOO_LARGE), so a route that buffers the whole file
    // cannot serve a single byte of it; streaming the window must.
    const projectDir = createProjectDir();
    const size = 3 * 1024 * 1024 * 1024;
    const fd = openSync(join(projectDir, "clip.mp4"), "w");
    writeSync(fd, "WXYZ", 5_000_000);
    ftruncateSync(fd, size);
    closeSync(fd);

    const app = new Hono();
    registerPreviewRoutes(app, createAdapter(projectDir));
    const res = await app.request("http://localhost/projects/demo/preview/clip.mp4", {
      headers: { Range: "bytes=5000000-5000003" },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe(`bytes 5000000-5000003/${size}`);
    expect(res.headers.get("Content-Length")).toBe("4");
    expect(await res.text()).toBe("WXYZ");
  });

  it("answers 416 for a range that starts past the end of the file", async () => {
    const projectDir = createProjectDir();
    writeFileSync(join(projectDir, "clip.mp4"), "abc");
    const app = new Hono();
    registerPreviewRoutes(app, createAdapter(projectDir));
    const res = await app.request("http://localhost/projects/demo/preview/clip.mp4", {
      headers: { Range: "bytes=99-200" },
    });
    expect(res.status).toBe(416);
    expect(res.headers.get("Content-Range")).toBe("bytes */3");
  });
});
